import { DOMAIN_TREE, DOMAIN_TOP_LABELS, domainLabel, type DomainTop } from './domain-tree';
import type { DomainScore } from '../../engine/cdsa/radar-scoring';
import type { Severity } from '../scales/scale';

export interface DomainGroupRow {
  sub: string;
  label: string;
  score: number;
  severity: Severity;
}

export interface DomainGroup {
  top: DomainTop;
  label: string;
  items: DomainGroupRow[];
}

/** Severity ranked by clinical urgency. `computeDomainScores` emits one score
 *  *per scale result*, so a sub-domain whose screen flagged and expanded into a
 *  full scale arrives as two rows for the same `top.sub`. We collapse to the
 *  most-severe — consistent with the engine's「取最嚴重」aggregation — and rank
 *  incomplete lowest so a completed result always wins over an unfilled one. */
const SEVERITY_RANK: Record<Severity, number> = { refer: 3, monitor: 2, normal: 1, incomplete: 0 };

/** Group domain scores under their DOMAIN_TREE top category, ordered by tree
 *  order (not input order). Multiple scores for one `top.sub` collapse to a
 *  single most-severe row (spec §D「每子域一條」). Empty groups are omitted. */
export function groupDomainScores(scores: DomainScore[]): DomainGroup[] {
  const groups: DomainGroup[] = [];
  for (const top of Object.keys(DOMAIN_TREE) as DomainTop[]) {
    const order = DOMAIN_TREE[top] as readonly string[];
    const bySub = new Map<string, DomainGroupRow>();
    for (const d of scores) {
      if (!d.domain.startsWith(`${top}.`)) continue;
      const sub = d.domain.split('.')[1] ?? '';
      const prev = bySub.get(sub);
      if (!prev || SEVERITY_RANK[d.severity] > SEVERITY_RANK[prev.severity]) {
        bySub.set(sub, { sub, label: domainLabel(top, sub), score: d.score, severity: d.severity });
      }
    }
    const items = [...bySub.values()].sort((a, b) => order.indexOf(a.sub) - order.indexOf(b.sub));
    if (items.length > 0) groups.push({ top, label: DOMAIN_TOP_LABELS[top], items });
  }
  return groups;
}
