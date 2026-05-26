import type { TriageResult } from './triage';
import type { Severity } from '../../lib/scales/scale';
import { domainKey } from '../../lib/domain/domain-tree';

export interface DomainScore {
  /** `${top}.${sub}` key. */
  domain: string;
  /** Normalised 0-100 = round(100 * rawScore / maxScore); incomplete → 0. */
  score: number;
  severity: Severity;
}

/**
 * Per top.sub radar score. Pure raw/maxScore normalisation — no z-score,
 * no percentile, no hybrid path (CGA scales use validated cutoffs, not norms).
 * One DomainScore per scale result; incomplete scales render as 0 + incomplete.
 */
export function computeDomainScores(triageResult: TriageResult | null): DomainScore[] {
  if (!triageResult) return [];

  return triageResult.details.map(d => {
    const score =
      d.rawScore !== null && d.maxScore > 0
        ? Math.round((100 * d.rawScore) / d.maxScore)
        : 0;
    return {
      domain: domainKey(d.domain.top, d.domain.sub),
      score,
      severity: d.severity,
    };
  });
}
