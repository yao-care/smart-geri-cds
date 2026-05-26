/**
 * Phase 2 (CDSS deferred): the pure-questionnaire CGA build ships an EMPTY
 * CLINICAL_EDUCATION map (content-relevance.yaml clinicalAlertEducation is
 * empty). The closed-loop wiring is preserved but, with no clinical-alert
 * indicators mapped, processResult attaches no education slugs. This test
 * asserts that degraded-but-correct behaviour. The geriatric physiological
 * indicator → education mapping returns in Phase 3.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { ClosedLoopEngine } from '../../src/engine/closed-loop';
import { db } from '../../src/lib/db/schema';
import { CLINICAL_EDUCATION } from '../../src/lib/education/clinical-education.generated';
import type { RiskAnalysisResult } from '../../src/engine/risk-analyzer';

function makeResult(
  indicators: string[],
  overallRisk: 'advisory' | 'warning' | 'critical' = 'advisory',
): RiskAnalysisResult {
  return {
    patientId: 'test-patient-01',
    overallRisk,
    ruleResult: {
      level: overallRisk,
      rationale: 'test',
      escalated: false,
      indicators: indicators.map(indicator => ({
        indicator,
        value: 1,
        level: overallRisk,
        range: null,
        rationale: `${indicator} out of range`,
      })),
    },
    mlResult: null,
    baselines: {},
    timestamp: new Date(),
    ruleVersion: 'v1',
  };
}

const engine = new ClosedLoopEngine({
  advisoryToWarningHours: 48,
  warningToCriticalHours: 24,
  windowMinutes: 60,
  alertAfterHours: 24,
});

describe('CLINICAL_EDUCATION constant (Phase 2: empty)', () => {
  it('is an empty map until CDSS is geriatric-ised (Phase 3)', () => {
    expect(CLINICAL_EDUCATION).toEqual({});
  });

  it('returns no entry for any indicator', () => {
    expect(CLINICAL_EDUCATION['sugar_intake']).toBeUndefined();
    expect(CLINICAL_EDUCATION['heart_rate']).toBeUndefined();
  });
});

describe('ClosedLoopEngine educationRecommended (empty map)', () => {
  beforeEach(async () => {
    await db.alerts.clear();
    await db.patients.clear();
  });

  it('attaches no education slugs while CLINICAL_EDUCATION is empty', async () => {
    const result = makeResult(['sugar_intake', 'sleep_quality', 'spo2', 'activity_level']);
    const alert = await engine.processResult(result);

    expect(alert).not.toBeNull();
    expect(alert!.educationRecommended ?? []).toEqual([]);
  });

  it('still produces an alert (closed-loop wiring intact)', async () => {
    const result = makeResult(['heart_rate']);
    const alert = await engine.processResult(result);
    expect(alert).not.toBeNull();
  });
});
