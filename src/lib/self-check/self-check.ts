import type { DomainTop, DomainSub } from '$lib/domain/domain-tree';

/** 民眾白話紅黃綠燈。red 不由 band 決定（自評不宣稱嚴重度），僅由 redFlag 在 summarise 階段覆寫。 */
export type SelfLight = 'green' | 'amber';

export interface SelfCheckItem {
  id: string;
  /** 白話、第二人稱題幹；同時作為 TTS 朗讀文字。 */
  text: string;
  options: { label: string; score: number }[];
  /** 觸發自傷安全提示（與專業層共用語意）。 */
  redFlag?: 'self-harm';
}

export interface SelfCheckBand {
  min?: number;
  max?: number;
  light: SelfLight;
  /** 該燈號對民眾顯示的白話建議。 */
  advice: string;
}

export interface SelfCheckScale {
  id: string;
  domain: { top: DomainTop; sub: DomainSub };
  /** 'scored' 計入紅黃綠；'awareness' 為 ACP/治療偏好覺察題，不計風險、只在結尾提示。 */
  category: 'scored' | 'awareness';
  maxScore: number;
  items: SelfCheckItem[];
  bands: SelfCheckBand[];
  clinicallyReviewed: boolean;
}

export interface SelfCheckScaleResult {
  scaleId: string;
  domain: { top: DomainTop; sub: DomainSub };
  /** null = 該域尚有未答題（incomplete，不納入結果統計）。 */
  light: SelfLight | null;
  advice: string;
  rawScore: number | null;
}

/** Answers map：itemId → 選到的 score。 */
export type SelfCheckAnswers = Record<string, number>;

/**
 * 計一個自評領域的紅黃綠。所有 item 必須都已作答才計分（任一未答 → light null）。
 * 分數加總後落入 bands；無對應 band → light null。
 */
export function scoreSelfCheck(scale: SelfCheckScale, answers: SelfCheckAnswers): SelfCheckScaleResult {
  const unanswered = scale.items.some(it => answers[it.id] === undefined);
  if (unanswered) {
    return { scaleId: scale.id, domain: scale.domain, light: null, advice: '', rawScore: null };
  }
  const rawScore = scale.items.reduce((sum, it) => sum + (answers[it.id] ?? 0), 0);
  const band = scale.bands.find(b =>
    (b.min === undefined || rawScore >= b.min) && (b.max === undefined || rawScore <= b.max));
  if (!band) {
    return { scaleId: scale.id, domain: scale.domain, light: null, advice: '', rawScore };
  }
  return { scaleId: scale.id, domain: scale.domain, light: band.light, advice: band.advice, rawScore };
}
