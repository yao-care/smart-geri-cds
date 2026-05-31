import { scoreSelfCheck, type SelfCheckScale, type SelfCheckAnswers } from './self-check';
import { DOMAIN_SUBS, domainLabel, type DomainTop, type DomainSub } from '$lib/domain/domain-tree';

export type SelfOverall = 'green' | 'amber' | 'red';

export interface SelfConcern {
  top: DomainTop;
  sub: DomainSub;
  label: string;
  advice: string;
}
export interface SelfAwareness {
  top: DomainTop;
  sub: DomainSub;
  label: string;
}

export interface SelfCheckSummary {
  overall: SelfOverall;
  /** 紅旗：任一 redFlag item 被選為正分（自傷念頭）。 */
  redFlag: boolean;
  /** amber 的 scored 領域，依 DOMAIN_TREE 順序。 */
  concerns: SelfConcern[];
  /** awareness 域被選「是」者（ACP/治療偏好）。 */
  awareness: SelfAwareness[];
}

/** DOMAIN_TREE 的全域 top.sub 線性順序，用於排序 concerns。 */
function domainOrderIndex(sub: DomainSub): number {
  return DOMAIN_SUBS.indexOf(sub);
}

/**
 * 任一 scale 的任一 redFlag item 被選正分 → 觸發自傷紅旗。
 * 刻意不經 scoreSelfCheck 完成度閘門：只要自傷題答「是」就一律觸發，
 * 即使該領域其他題未答完（病安優先，單一陽性即升旗）。
 */
function hasRedFlag(scales: SelfCheckScale[], answers: SelfCheckAnswers): boolean {
  return scales.some(sc =>
    sc.items.some(it => it.redFlag === 'self-harm' && (answers[it.id] ?? 0) > 0));
}

export function summariseSelfCheck(scales: SelfCheckScale[], answers: SelfCheckAnswers): SelfCheckSummary {
  const redFlag = hasRedFlag(scales, answers);

  const concerns: SelfConcern[] = [];
  const awareness: SelfAwareness[] = [];

  for (const sc of scales) {
    if (sc.category === 'awareness') {
      const positive = sc.items.some(it => (answers[it.id] ?? 0) > 0);
      if (positive) {
        awareness.push({ top: sc.domain.top, sub: sc.domain.sub, label: domainLabel(sc.domain.top, sc.domain.sub) });
      }
      continue;
    }
    const r = scoreSelfCheck(sc, answers);
    if (r.light === 'amber') {
      concerns.push({
        top: sc.domain.top, sub: sc.domain.sub,
        label: domainLabel(sc.domain.top, sc.domain.sub), advice: r.advice,
      });
    }
  }

  concerns.sort((a, b) => domainOrderIndex(a.sub) - domainOrderIndex(b.sub));

  const overall: SelfOverall = redFlag ? 'red' : concerns.length > 0 ? 'amber' : 'green';
  return { overall, redFlag, concerns, awareness };
}
