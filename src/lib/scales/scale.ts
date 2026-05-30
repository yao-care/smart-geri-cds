import type { CfsLevel } from '$lib/utils/cfs-levels';
import type { DomainTop, DomainSub } from '$lib/domain/domain-tree';

export type Severity = 'normal' | 'monitor' | 'refer' | 'incomplete';

/**
 * Per-item answer-source role (SOP truth, not who operates the tool):
 * - 'patient'       : patient performs / self-reports (operator reads & records).
 * - 'observe'       : operator observes the patient and records.
 * - 'ask-either'    : ask the patient AND/OR family/caregiver (may use observation/records).
 * - 'ask-informant' : only a knowledgeable family member/caregiver can answer.
 * - 'measure'       : measured value (e.g. BMI, calf circumference).
 * Default: 'patient'.
 */
export type ItemMode = 'patient' | 'observe' | 'ask-either' | 'ask-informant' | 'measure';

export interface ScaleBand {
  min?: number; max?: number; severity: Exclude<Severity, 'incomplete'>; label: string;
}
export interface ScaleItem {
  id: string;
  /** Patient-facing question text (self-fill). Optional when operator-only prompt is sufficient. */
  text?: string;
  /** Operator instruction: what to say/observe/ask informant/measure. */
  prompt?: string;
  /** Answer-source role for this item. Defaults to 'patient'. */
  mode?: ItemMode;
  /** Ordered sub-question stems (e.g. AMT4 four orientation items). */
  subquestions?: string[];
  options: { label: string; score: number }[];
  /** Triggers a safety alert when a positive answer is selected. */
  redFlag?: 'self-harm';
}
export interface ScaleDef {
  id: string;
  domain: { top: DomainTop; sub: DomainSub };
  /** 'triage' = 大方向層（每域 1 題，亮燈展開 screen）；'screen' = 短篩層
   *  （亮燈展開 full）；'full' = 深評層。 */
  tier: 'triage' | 'screen' | 'full';
  /** always-run：無論 triage 結果都一律施測（病安域：譫妄 4AT C-M1、認知 C-S6）。 */
  alwaysRun?: boolean;
  /** ID of the full-scale to expand into when this screen flags (severity ≥ monitor). */
  expandsTo?: string;
  applicableCfs: CfsLevel[];
  scoring: 'sum' | 'weighted' | 'error-count' | 'measured-value' | 'timed-task';
  inputType: 'option' | 'numeric' | 'timed-task';
  /** True when the scale must be answered by the patient themselves (cognitive/emotional). */
  requiresPatient?: boolean;
  /** True when the scale must be answered by a caregiver/informant (e.g. Zarit). */
  requiresInformant?: boolean;
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

/**
 * Resolve an elapsed-seconds measurement for a `timed-task` scale (e.g. FTSTS)
 * to a severity using its second-based bands. Higher seconds = worse, encoded
 * directly in the band min/max. null/NaN → 'incomplete' (could not complete).
 * Thin wrapper over scoreScale so the timed-task UI can preview severity live
 * without building a full ScaleResult.
 */
export function elapsedSecondsToSeverity(def: ScaleDef, seconds: number | null): Severity {
  return scoreScale(def, seconds).severity;
}

const ORDER: Record<Severity, number> = { normal: 0, monitor: 1, refer: 2, incomplete: -1 };
/** 取最嚴重；忽略 incomplete；全 incomplete 或空 → incomplete。 */
export function aggregateSeverity(list: Severity[]): Severity {
  const valid = list.filter(s => s !== 'incomplete');
  if (valid.length === 0) return 'incomplete';
  return valid.reduce((a, b) => (ORDER[b] > ORDER[a] ? b : a), 'normal' as Severity);
}
