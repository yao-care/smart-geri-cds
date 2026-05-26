import type { CfsLevel } from '$lib/utils/cfs-levels';
import type { DomainTop, DomainSub } from '$lib/domain/domain-tree';

export type Severity = 'normal' | 'monitor' | 'refer' | 'incomplete';

export interface ScaleBand {
  min?: number; max?: number; severity: Exclude<Severity, 'incomplete'>; label: string;
}
export interface ScaleItem { id: string; text: string; options: { label: string; score: number }[]; }
export interface ScaleDef {
  id: string;
  domain: { top: DomainTop; sub: DomainSub };
  applicableCfs: CfsLevel[];
  scoring: 'sum' | 'weighted' | 'error-count' | 'measured-value';
  inputType: 'option' | 'numeric';
  maxScore: number;
  items: ScaleItem[];
  bands: ScaleBand[];
  clinicallyReviewed: boolean;
}

export interface ScaleResult {
  scaleId: string;
  domain: { top: DomainTop; sub: DomainSub };
  rawScore: number | null;
  maxScore: number;
  severity: Severity;
  bandLabel: string;
}

export function scoreScale(def: ScaleDef, rawScore: number | null): ScaleResult {
  if (rawScore === null || rawScore === undefined || Number.isNaN(rawScore)) {
    return { scaleId: def.id, domain: def.domain, rawScore: null, maxScore: def.maxScore, severity: 'incomplete', bandLabel: '未完成' };
  }
  const band = def.bands.find(b =>
    (b.min === undefined || rawScore >= b.min) && (b.max === undefined || rawScore <= b.max));
  if (!band) {
    return { scaleId: def.id, domain: def.domain, rawScore, maxScore: def.maxScore, severity: 'incomplete', bandLabel: '無對應分段' };
  }
  return { scaleId: def.id, domain: def.domain, rawScore, maxScore: def.maxScore, severity: band.severity, bandLabel: band.label };
}

const ORDER: Record<Severity, number> = { normal: 0, monitor: 1, refer: 2, incomplete: -1 };
/** 取最嚴重；忽略 incomplete；全 incomplete 或空 → incomplete。 */
export function aggregateSeverity(list: Severity[]): Severity {
  const valid = list.filter(s => s !== 'incomplete');
  if (valid.length === 0) return 'incomplete';
  return valid.reduce((a, b) => (ORDER[b] > ORDER[a] ? b : a), 'normal' as Severity);
}
