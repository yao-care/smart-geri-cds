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

/** Group `top.sub` domain scores under their DOMAIN_TREE top category,
 *  ordered by tree order (not input order). Empty groups are omitted. */
export function groupDomainScores(scores: DomainScore[]): DomainGroup[] {
  const groups: DomainGroup[] = [];
  for (const top of Object.keys(DOMAIN_TREE) as DomainTop[]) {
    const order = DOMAIN_TREE[top] as readonly string[];
    const items: DomainGroupRow[] = scores
      .filter(d => d.domain.startsWith(`${top}.`))
      .map(d => {
        const sub = d.domain.split('.')[1] ?? '';
        return { sub, label: domainLabel(top, sub), score: d.score, severity: d.severity };
      })
      .sort((a, b) => order.indexOf(a.sub) - order.indexOf(b.sub));
    if (items.length > 0) groups.push({ top, label: DOMAIN_TOP_LABELS[top], items });
  }
  return groups;
}
