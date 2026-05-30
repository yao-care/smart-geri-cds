import type { ScaleResult } from '../scales/scale';

export interface TieredResult {
  result: ScaleResult;
  tier: 'triage' | 'screen' | 'full';
}

/** Drop a domain's triage result when that top.sub also has a screen/full result.
 *  triage (maxScore 1 → 0/100%) is a routing gate; a deep result's nuanced % wins
 *  (groupDomainScores ties go to the first-seen row, and triage is appended first).
 *  triage is kept only when its domain was not expanded — its sole normal marker
 *  so a cold-start all-normal assessment still shows every domain (使用者決策). */
export function dedupeTriageResults(items: TieredResult[]): ScaleResult[] {
  const key = (r: ScaleResult) => `${r.domain.top}.${r.domain.sub}`;
  const deep = new Set(items.filter(i => i.tier !== 'triage').map(i => key(i.result)));
  return items.filter(i => i.tier !== 'triage' || !deep.has(key(i.result))).map(i => i.result);
}
