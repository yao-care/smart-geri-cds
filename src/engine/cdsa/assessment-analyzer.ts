import { getEventsByModule } from '../../lib/db/assessment-events';
import { computeTriage, type TriageResult } from './triage';
import type { CfsLevel } from '../../lib/utils/cfs-levels';
import type { ScaleResult, Severity } from '../../lib/scales/scale';
import { isValidDomain, type DomainTop, type DomainSub } from '../../lib/domain/domain-tree';

export interface AssessmentAnalysisResult {
  triageResult: TriageResult;
  analyzedAt: Date;
}

interface ScaleAccumulator {
  scaleId: string;
  top: DomainTop;
  sub: DomainSub;
  rawScore: number;
  maxScore: number;
}

/**
 * Phase 1 placeholder severity: until per-scale validated cutoffs (ScaleDef
 * bands) are loaded from the scales collection (Task 1.14), derive severity
 * from the normalised ratio. Higher score = worse (matches deficit-style
 * scales like GDS-15/SPMSQ); function-style scales whose direction differs
 * are reconciled when band-based scoreScale wiring lands.
 */
function placeholderSeverity(rawScore: number, maxScore: number): Severity {
  if (maxScore <= 0) return 'incomplete';
  const ratio = rawScore / maxScore;
  if (ratio >= 0.66) return 'refer';
  if (ratio >= 0.33) return 'monitor';
  return 'normal';
}

/**
 * Questionnaire-only analysis (post sensor-module removal).
 * Reads questionnaire events for the assessment, aggregates them per scale
 * (`top.sub`), produces ScaleResult[], and runs the triage aggregation.
 */
export async function analyzeAssessment(
  assessmentId: string,
  cfsLevel: CfsLevel,
): Promise<AssessmentAnalysisResult> {
  const questionnaireEvents = await getEventsByModule(assessmentId, 'questionnaire');

  // Aggregate per scaleId. Each event carries { scaleId, top, sub, score, maxScore }.
  const accumulators = new Map<string, ScaleAccumulator>();
  for (const e of questionnaireEvents) {
    const scaleId = e.data.scaleId as string | undefined;
    const top = e.data.top as string | undefined;
    const sub = e.data.sub as string | undefined;
    const score = e.data.score as number | undefined;
    const maxScore = e.data.maxScore as number | undefined;

    if (!scaleId || !top || !sub || typeof score !== 'number') continue;
    if (!isValidDomain(top, sub)) continue;

    const existing = accumulators.get(scaleId);
    if (existing) {
      existing.rawScore += score;
      existing.maxScore += maxScore ?? 0;
    } else {
      accumulators.set(scaleId, {
        scaleId,
        top: top as DomainTop,
        sub: sub as DomainSub,
        rawScore: score,
        maxScore: maxScore ?? 0,
      });
    }
  }

  const scaleResults: ScaleResult[] = [...accumulators.values()].map(a => {
    const severity = placeholderSeverity(a.rawScore, a.maxScore);
    return {
      scaleId: a.scaleId,
      domain: { top: a.top, sub: a.sub },
      rawScore: severity === 'incomplete' ? null : a.rawScore,
      maxScore: a.maxScore,
      severity,
      bandLabel: severity === 'incomplete' ? '未完成' : '',
    };
  });

  const triageResult = computeTriage({ cfsLevel, scaleResults });

  return {
    triageResult,
    analyzedAt: new Date(),
  };
}
