/**
 * cfs-band.ts — 以 title + description + channel +（有的話）字幕為輸入，分類影片最匹配的 CFS 等級集合。
 *
 * 規則依據（已核對 reports/cache 樣本，確認關鍵詞具足夠訊號）：
 *   - 末期/安寧/ACP → cfs8-9
 *   - 重度依賴（臥床/翻身/轉位/壓瘡/餵食）→ cfs7-9
 *   - 中度衰弱/失智照護/輔具 → cfs5-7
 *   - 衰弱風險區（衰弱症/復能/防跌/肌少症）→ cfs3-6
 *   - 主動預防/健康老化 → cfs1-4
 *   - 廣譜（多重慢性病/用藥安全/經濟福利/疼痛）→ all cfs
 *
 * 無訊號 → 中段 cfs3-6 fallback（多數高齡衛教預設適用對象）。
 */

export type CfsLevel = 'cfs1' | 'cfs2' | 'cfs3' | 'cfs4' | 'cfs5' | 'cfs6' | 'cfs7' | 'cfs8' | 'cfs9';
export const ALL_CFS: CfsLevel[] = ['cfs1', 'cfs2', 'cfs3', 'cfs4', 'cfs5', 'cfs6', 'cfs7', 'cfs8', 'cfs9'];

/** 規則順序：較具體先試，避免廣譜規則先吃掉 specific 詞。 */
const RULES: Array<{ band: readonly CfsLevel[]; kws: RegExp }> = [
  // 末期/安寧/ACP → cfs8-9（最特異，先比）
  { band: ['cfs8', 'cfs9'], kws: /末期|安寧|善終|病人自主|病主法|預立醫療|緩和醫療|臨終|end[\s-]?of[\s-]?life|palliative|advance\s+directive|treatment\s+preference/i },
  // 重度依賴 → cfs7-9
  { band: ['cfs7', 'cfs8', 'cfs9'], kws: /臥床|翻身|轉位|壓瘡|失智晚期|中風後|鼻胃管|餵食|輪椅|長期照護|bedfast|pressure\s+ulcer|tube\s+feeding/i },
  // 中度衰弱/失智照護 → cfs5-7
  { band: ['cfs5', 'cfs6', 'cfs7'], kws: /中度衰弱|中度失能|失智(?!晚期)|輔具|居家照護|照顧者負擔|dementia(?!.*late)|caregiver\s+burden/i },
  // 衰弱風險區 → cfs3-6
  { band: ['cfs3', 'cfs4', 'cfs5', 'cfs6'], kws: /衰弱|肌少症|復能|自立支援|跌倒|防跌|平衡訓練|fall|frail|sarcopen|reablement/i },
  // 主動預防/健康老化 → cfs1-4
  { band: ['cfs1', 'cfs2', 'cfs3', 'cfs4'], kws: /預防|活躍|健康老化|健康促進|退休|保健|肌力訓練|居家(運動|健身)|60歲|70歲|80歲|90歲|exercise|prevention|active\s+aging/i },
  // 廣譜健康主題 → all cfs
  { band: ALL_CFS, kws: /多重慢性病|共病|用藥安全|多重用藥|整合門診|老年症候群|高血壓|糖尿病|polypharmacy|multimorbidity|chronic\s+disease/i },
  // 疼痛：拆細以利 per-cell 差異化（先前單一 ALL_CFS 廣譜會把所有 pain 影片塞同一組，pain 9 格永遠相同）
  // PAINAD/失智晚期/臨終疼痛 → cfs7-9（行為觀察評估、無法言語）
  { band: ['cfs7', 'cfs8', 'cfs9'], kws: /PAINAD|失智晚期.*疼痛|臨終.*疼痛|末期.*疼痛/i },
  // 一般慢性疼痛（含 NRS/肌肉骨骼/關節炎）→ cfs3-7（衰弱風險區，多數長者疼痛落此）
  { band: ['cfs3', 'cfs4', 'cfs5', 'cfs6', 'cfs7'], kws: /慢性疼痛|疼痛(?!.*末期)|止痛|NRS|nrs|肌肉骨骼|關節炎|纖維肌痛|\bpain\b/i },
  // 經濟/福利/可近性 → all cfs（各 CFS 皆可能需要福利資源）
  { band: ALL_CFS, kws: /經濟|福利|補助|長照交通|無障礙|社會福利|financial|welfare|accessibility/i },
];

/** Classify text → CFS 等級集合。 無訊號 → cfs3-6 fallback。 */
export function classifyCfsBands(text: string): Set<CfsLevel> {
  const out = new Set<CfsLevel>();
  for (const r of RULES) {
    if (r.kws.test(text)) for (const c of r.band) out.add(c);
  }
  if (out.size === 0) {
    for (const c of ['cfs3', 'cfs4', 'cfs5', 'cfs6'] as CfsLevel[]) out.add(c);
  }
  return out;
}
