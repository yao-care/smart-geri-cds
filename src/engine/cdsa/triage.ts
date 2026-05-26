import type { CfsLevel } from '../../lib/utils/cfs-levels';
import type { ScaleResult, Severity } from '../../lib/scales/scale';
import { aggregateSeverity } from '../../lib/scales/scale';
import { domainLabel } from '../../lib/domain/domain-tree';

export interface TriageInput {
  cfsLevel: CfsLevel;
  /** Per-scale results already scored against their validated cutoffs. */
  scaleResults: ScaleResult[];
}

export interface TriageResult {
  /** Overall severity = worst across all scales (incomplete ignored). */
  category: Severity;
  /** Full per-scale breakdown for the radar / detail view. */
  details: ScaleResult[];
  summary: string;
}

const CATEGORY_SUMMARY: Record<Severity, (labels: string[]) => string> = {
  normal: () => '各領域評估在正常範圍內。',
  monitor: labels => `${labels.join('、')} 領域有待觀察，建議持續追蹤。`,
  refer: labels => `${labels.join('、')} 領域顯示異常，建議進一步專業評估或轉介。`,
  incomplete: () => '尚未完成任何量表，無法分流。',
};

/**
 * 取各領域最嚴重者作為整體分流：
 *   任一 refer → refer；有 monitor → monitor；全 normal → normal；全 incomplete/空 → incomplete。
 * incomplete 量表不參與彙整但保留在 details 供標示。
 */
export function computeTriage(input: TriageInput): TriageResult {
  const details = input.scaleResults;
  const category = aggregateSeverity(details.map(d => d.severity));

  // 摘要：列出 severity 與整體分流相同（最嚴重）的領域中文標籤。
  const flaggedLabels = [
    ...new Set(
      details
        .filter(d => d.severity === category && category !== 'normal' && category !== 'incomplete')
        .map(d => domainLabel(d.domain.top, d.domain.sub)),
    ),
  ];

  return {
    category,
    details,
    summary: CATEGORY_SUMMARY[category](flaggedLabels),
  };
}
