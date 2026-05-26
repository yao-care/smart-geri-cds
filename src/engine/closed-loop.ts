import { createAlert, getOpenAlerts, updateAlertStatus, findDuplicateAlert } from '../lib/db/alerts';
import { updateRiskLevel } from '../lib/db/patients';
import type { Alert } from '../lib/db/schema';
import type { RiskLevel } from '../lib/utils/risk-levels';
import { isEscalation } from '../lib/utils/risk-levels';
import type { RiskAnalysisResult } from './risk-analyzer';
import { CLINICAL_EDUCATION } from '../lib/education/clinical-education.generated';

export interface ClosedLoopConfig {
  advisoryToWarningHours: number;    // default 48
  warningToCriticalHours: number;    // default 24
  windowMinutes: number;             // dedup window, default 60
  alertAfterHours: number;           // no-data alert, default 24
  onAlert?: (alert: Alert) => void;  // callback when new alert created
}

export class ClosedLoopEngine {
  private config: ClosedLoopConfig;
  private escalationTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: ClosedLoopConfig) {
    this.config = config;
  }

  /**
   * Process a risk analysis result — create/update alerts as needed.
   */
  async processResult(result: RiskAnalysisResult): Promise<Alert | null> {
    if (result.overallRisk === 'normal') {
      // Check if we should auto-resolve open alerts
      await this.autoResolve(result.patientId);
      await updateRiskLevel(result.patientId, 'normal');
      return null;
    }

    // Dedup check
    const indicators = result.ruleResult.indicators
      .filter(i => i.level !== 'normal')
      .map(i => i.indicator);

    const duplicate = await findDuplicateAlert(
      result.patientId,
      indicators,
      this.config.windowMinutes,
    );
    if (duplicate) return null;

    // Create new alert
    const alert: Alert = {
      id: crypto.randomUUID(),
      patientId: result.patientId,
      riskLevel: result.overallRisk,
      status: 'open',
      indicators,
      rationale: this.buildRationale(result),
      ruleVersion: result.ruleVersion,
      modelVersion: result.modelVersion,
      inputSnapshot: {
        ruleResult: result.ruleResult,
        mlResult: result.mlResult,
        baselines: result.baselines,
      },
      createdAt: new Date(),
    };

    // Add education recommendations based on trigger indicators
    alert.educationRecommended = this.getEducationRecommendations(indicators);
    if (alert.educationRecommended.length > 0) {
      alert.educationTriggeredAt = new Date();
    }

    await createAlert(alert);
    await updateRiskLevel(result.patientId, result.overallRisk);
    this.config.onAlert?.(alert);
    return alert;
  }

  /**
   * Auto-resolve open alerts when all indicators return to normal.
   */
  private async autoResolve(patientId: string): Promise<void> {
    const openAlerts = await getOpenAlerts(patientId);
    for (const alert of openAlerts) {
      await updateAlertStatus(
        alert.id,
        'resolved',
        'Auto-resolved: indicators returned to normal',
      );
    }
  }

  /**
   * Check for time-based escalations. Call this periodically.
   */
  async checkEscalations(): Promise<Alert[]> {
    const escalated: Alert[] = [];
    const openAlerts = await getOpenAlerts();
    const now = Date.now();

    for (const alert of openAlerts) {
      const ageHours = (now - alert.createdAt.getTime()) / (1000 * 60 * 60);
      let newLevel: RiskLevel | null = null;

      if (alert.riskLevel === 'advisory' && ageHours >= this.config.advisoryToWarningHours) {
        newLevel = 'warning';
      } else if (alert.riskLevel === 'warning' && ageHours >= this.config.warningToCriticalHours) {
        newLevel = 'critical';
      }

      if (newLevel && isEscalation(alert.riskLevel, newLevel)) {
        // Create escalated alert with parent reference
        const escalatedAlert: Alert = {
          id: crypto.randomUUID(),
          patientId: alert.patientId,
          riskLevel: newLevel,
          status: 'open',
          indicators: alert.indicators,
          rationale: `Time-based escalation: ${alert.riskLevel} -> ${newLevel} after ${Math.round(ageHours)}h`,
          ruleVersion: alert.ruleVersion,
          modelVersion: alert.modelVersion,
          inputSnapshot: alert.inputSnapshot,
          parentAlertId: alert.id,
          createdAt: new Date(),
        };

        // Close old alert
        await updateAlertStatus(alert.id, 'resolved', `Escalated to ${newLevel}`);
        await createAlert(escalatedAlert);
        await updateRiskLevel(alert.patientId, newLevel);
        this.config.onAlert?.(escalatedAlert);
        escalated.push(escalatedAlert);
      }
    }
    return escalated;
  }

  /**
   * Check for missing data alerts.
   */
  async checkMissingData(
    patientIds: string[],
    lastObservationTimes: Record<string, Date>,
  ): Promise<Alert[]> {
    const alerts: Alert[] = [];
    const cutoff = Date.now() - this.config.alertAfterHours * 60 * 60 * 1000;

    for (const patientId of patientIds) {
      const lastTime = lastObservationTimes[patientId];
      if (!lastTime || lastTime.getTime() < cutoff) {
        // Check if we already have a missing-data alert
        const existing = await findDuplicateAlert(
          patientId,
          ['missing_data'],
          this.config.windowMinutes,
        );
        if (existing) continue;

        const alert: Alert = {
          id: crypto.randomUUID(),
          patientId,
          riskLevel: 'advisory',
          status: 'open',
          indicators: ['missing_data'],
          rationale: `No new observations for over ${this.config.alertAfterHours} hours`,
          ruleVersion: 'system',
          inputSnapshot: { lastObservationTime: lastTime?.toISOString() ?? 'never' },
          createdAt: new Date(),
        };

        await createAlert(alert);
        this.config.onAlert?.(alert);
        alerts.push(alert);
      }
    }
    return alerts;
  }

  /** Start periodic escalation checks (every 5 minutes) */
  startEscalationChecks(intervalMs = 300000): void {
    this.stopEscalationChecks();
    this.escalationTimer = setInterval(() => this.checkEscalations(), intervalMs);
  }

  stopEscalationChecks(): void {
    if (this.escalationTimer) {
      clearInterval(this.escalationTimer);
      this.escalationTimer = null;
    }
  }

  private buildRationale(result: RiskAnalysisResult): string {
    const parts: string[] = [];

    // Rule results
    for (const ind of result.ruleResult.indicators) {
      if (ind.level !== 'normal') {
        const baseline = result.baselines[ind.indicator];
        const zInfo = baseline?.zScore !== null && baseline?.zScore !== undefined
          ? `, z-score=${baseline.zScore.toFixed(2)}`
          : '';
        parts.push(`[Rule] ${ind.rationale}${zInfo}`);
      }
    }

    // ML result
    if (result.mlResult) {
      parts.push(`[ML] predicted=${result.mlResult.level}, P(${result.mlResult.level})=${
        (result.mlResult.probabilities[result.mlResult.level] * 100).toFixed(1)}%`);
    }

    if (result.ruleResult.escalated) {
      parts.push('[Escalated by multi-indicator or trend rule]');
    }

    return parts.join('; ') || 'No abnormalities detected';
  }

  private getEducationRecommendations(indicators: string[]): string[] {
    // Map indicator names to education content slugs.
    // Source of truth: src/data/education/content-relevance.yaml clinicalAlertEducation section
    // (compiled to CLINICAL_EDUCATION by scripts/build-content-index.ts).
    return indicators.flatMap(ind => CLINICAL_EDUCATION[ind] ?? []);
  }
}
