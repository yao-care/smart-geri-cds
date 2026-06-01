import { scoreScale, type ScaleDef, type ScaleResult } from '../scales/scale';
import type { CfsLevel } from '../utils/cfs-levels';
import type { PartialAnalysis } from '../db/schema';
import { dedupeTriageResults, type TieredResult } from '../domain/dedupe-triage-results';
import { computeTriage, type TriageResult } from '../../engine/cdsa/triage';

/**
 * Build ScaleResult[] for the scales that actually ran in the tiered flow.
 *
 * A scale "ran" if it has a precomputed result (operator-gated option scales +
 * timed tasks + 「無法取得」 incompletes) or a raw questionnaire score. Full
 * scales whose screen did NOT flag are intentionally absent (not run) and must
 * NOT appear as spurious 'incomplete' spokes.
 *
 * `partial` MUST be a plain object (callers in Svelte pass
 * `$state.snapshot(assessmentStore.partialAnalysis)` so the precomputed
 * ScaleResult objects are de-proxied before they flow into IndexedDB).
 *
 * Extracted from ResultView so the questionnaire summary can finalise the same
 * triage result the result page would — keeping a single source of truth.
 */
export function buildScaleResults(
  scales: ScaleDef[],
  partial: PartialAnalysis,
  cfsLevel: CfsLevel | null,
): ScaleResult[] {
  if (!cfsLevel) return [];
  const raw = partial.questionnaireScores ?? {};
  const precomputed = partial.scaleResults ?? {};
  const applicable = scales.filter(s => s.applicableCfs.includes(cfsLevel));
  const collected: TieredResult[] = [];
  for (const def of applicable) {
    let res: ScaleResult | undefined;
    if (def.id in precomputed) {
      res = precomputed[def.id];
    } else if (def.id in raw) {
      res = scoreScale(def, raw[def.id]);
    }
    if (res) collected.push({ result: res, tier: def.tier });
  }
  return dedupeTriageResults(collected);
}

/**
 * Compute the overall TriageResult from the current partial analysis, or null
 * when no CFS level is set (entry gate not yet resolved). Both the result page
 * and the questionnaire summary use this so a fully-answered questionnaire
 * always yields a persisted triageResult — even if the user never advances to
 * the result step.
 */
export function buildTriageResult(
  scales: ScaleDef[],
  partial: PartialAnalysis,
  cfsLevel: CfsLevel | null,
): TriageResult | null {
  if (!cfsLevel) return null;
  return computeTriage({ cfsLevel, scaleResults: buildScaleResults(scales, partial, cfsLevel) });
}
