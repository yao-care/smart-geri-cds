import { getEventsByModule } from '../../lib/db/assessment-events';
import { computeTriage, type TriageResult } from './triage';
import type { CfsLevel } from '../../lib/utils/cfs-levels';
import type { ScaleResult, ScaleDef } from '../../lib/scales/scale';
import { scoreScale } from '../../lib/scales/scale';
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
 * Questionnaire-only analysis (post sensor-module removal).
 * Reads questionnaire events for the assessment, aggregates them per scale,
 * scores each scale against its validated cutoff bands (scoreScale), and runs
 * the triage aggregation (worst severity, incomplete ignored).
 *
 * Band direction is honoured entirely by the scale's own bands — there is no
 * hardcoded "higher = worse". When a matching ScaleDef is not supplied, the
 * accumulated raw/max is still recorded so the radar/detail view can render,
 * but the scale carries no flag (severity = normal) since it can't be judged.
 */
export async function analyzeAssessment(
  assessmentId: string,
  cfsLevel: CfsLevel,
  scaleDefs: ScaleDef[] = [],
): Promise<AssessmentAnalysisResult> {
  const questionnaireEvents = await getEventsByModule(assessmentId, 'questionnaire');
  const defById = new Map(scaleDefs.map(d => [d.id, d]));

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
    const def = defById.get(a.scaleId);
    if (def) {
      // Real scoring: bands carry the validated cutoffs + direction.
      return scoreScale(def, a.rawScore);
    }
    // No def supplied: record raw/max but leave un-flagged (cannot classify).
    return {
      scaleId: a.scaleId,
      domain: { top: a.top, sub: a.sub },
      rawScore: a.rawScore,
      maxScore: a.maxScore,
      severity: 'normal',
      bandLabel: '',
    };
  });

  const triageResult = computeTriage({ cfsLevel, scaleResults });

  return {
    triageResult,
    analyzedAt: new Date(),
  };
}
