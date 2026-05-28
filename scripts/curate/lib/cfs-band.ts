/**
 * cfs-band.ts — 以 title + description + channel +（有的話）字幕為輸入，分類影片最匹配的 CFS 等級集合。
 *
 * 規則依據（已核對 reports/cache 樣本，確認關鍵詞具足夠訊號）：
 *   - 末期/安寧/ACP → cfs8-9
 *   - 重度依賴（臥床/翻身/轉位/壓瘡/餵食）→ cfs7-9
 *   - 失禁 + 重度照護（尿片/尿套/尿管/護理之家）→ cfs7-9
 *   - 多重慢性病 + 失能/在宅醫療/家醫整合 → cfs6-9
 *   - 長照 + 經濟弱勢/補助/低收入 → cfs5-9
 *   - 中度衰弱/失智照護/輔具 → cfs5-7
 *   - 衰弱風險區（衰弱症/復能/防跌/肌少症）→ cfs3-6
 *   - 退休 + 經濟安全/年金/理財 → cfs1-4（主動規劃）
 *   - 主動預防/健康老化 → cfs1-4
 *   - 廣譜（多重慢性病/用藥安全/整合門診）→ all cfs
 *   - 純權益（老人福利/敬老/健保/社會福利） → all cfs
 *
 * 無訊號 → 中段 cfs3-6 fallback（多數高齡衛教預設適用對象）。
 *
 * 規則順序原則：「具體 → 廣譜」。新加的 specific 規則（失禁重度/失能整合/長照弱勢/退休經濟）
 * 必須插在原 chronic-broad 與 welfare 廣譜之前，否則會被廣譜 union 吃成 ALL_CFS。
 */

export type CfsLevel = 'cfs1' | 'cfs2' | 'cfs3' | 'cfs4' | 'cfs5' | 'cfs6' | 'cfs7' | 'cfs8' | 'cfs9';
export const ALL_CFS: CfsLevel[] = ['cfs1', 'cfs2', 'cfs3', 'cfs4', 'cfs5', 'cfs6', 'cfs7', 'cfs8', 'cfs9'];

/** 規則順序：較具體先試，避免廣譜規則先吃掉 specific 詞。 */
const RULES: Array<{ band: readonly CfsLevel[]; kws: RegExp }> = [
  // 末期/安寧/ACP → cfs8-9（最特異，先比）
  { band: ['cfs8', 'cfs9'], kws: /末期|安寧|善終|病人自主|病主法|預立醫療|緩和醫療|臨終|end[\s-]?of[\s-]?life|palliative|advance\s+directive|treatment\s+preference/i },
  // 重度依賴 → cfs7-9
  { band: ['cfs7', 'cfs8', 'cfs9'], kws: /臥床|翻身|轉位|壓瘡|失智晚期|中風後|鼻胃管|餵食|輪椅|長期照護|bedfast|pressure\s+ulcer|tube\s+feeding/i },
  // 失禁 + 重度照護（尿片/尿套/尿管/換尿片/護理之家排泄）→ cfs7-9
  // 主動骨盆底肌訓練不會命中（fallback cfs3-6）；機構照護 + 大小便/排泄/失禁 才命中。
  { band: ['cfs7', 'cfs8', 'cfs9'], kws: /失禁.{0,15}(護理|尿片|尿布|尿套|尿管|更換)|(尿片|尿布|尿套|尿管|更換成人尿片).{0,15}(失禁|長者|老人|高齡|長輩|照護|護理)|更換成人尿片|護理之家.{0,15}(大小便|失禁|排泄|尿)|大小便護理.{0,15}(失禁|照護|護理之家|長者|老人)/i },
  // 多重慢性病 + 失能/在宅醫療/家醫整合 → cfs6-9
  // 純「多重慢性病/整合門診」廣譜不命中此規則（落到下方 chronic-broad ALL_CFS）。
  { band: ['cfs6', 'cfs7', 'cfs8', 'cfs9'], kws: /(多重慢性病|多重共病|共病|多重用藥|慢性病).{0,15}(失能|惡化|在宅醫療|居家醫療|長期照護)|(失能|在宅醫療|居家醫療).{0,15}(多重慢性病|共病|多重用藥|慢性病|整合)|在宅醫療.{0,15}(失能|長者|長輩|老人)|失能(者|長者|長輩)|家庭醫師.{0,15}(失能|慢性病)/i },
  // 長照 + 經濟弱勢/補助/低收入 → cfs5-9（接受長照的受照顧者，多落中重度）
  { band: ['cfs5', 'cfs6', 'cfs7', 'cfs8', 'cfs9'], kws: /長照.{0,15}(經濟|弱勢|補助|低收入|貧困|貧窮|全額補助)|(經濟弱勢|弱勢權益|中低收入|低收入|貧困).{0,15}(長照|長期照護|長期照顧)|(中、?低收入戶?|中低收入).{0,15}長照/i },
  // 中度衰弱/失智照護 → cfs5-7
  { band: ['cfs5', 'cfs6', 'cfs7'], kws: /中度衰弱|中度失能|失智(?!晚期)|輔具|居家照護|照顧者負擔|dementia(?!.*late)|caregiver\s+burden/i },
  // 衰弱風險區 → cfs3-6
  { band: ['cfs3', 'cfs4', 'cfs5', 'cfs6'], kws: /衰弱|肌少症|復能|自立支援|跌倒|防跌|平衡訓練|fall|frail|sarcopen|reablement/i },
  // 退休 + 經濟安全/年金/理財 → cfs1-4（主動財務規劃，非長照弱勢）
  // 規則早於 active 與 welfare：避免 active 規則因「退休」單字落到 cfs1-4，又被 welfare 廣譜拉成 ALL。
  { band: ['cfs1', 'cfs2', 'cfs3', 'cfs4'], kws: /退休.{0,15}(制度|金融|年金|理財|經濟安全|保險|準備|規劃)|(年金|理財|經濟安全|退休準備|退休規劃).{0,15}退休|老年經濟安全|老年.{0,8}經濟保障/i },
  // 主動預防/健康老化 → cfs1-4
  { band: ['cfs1', 'cfs2', 'cfs3', 'cfs4'], kws: /預防|活躍|健康老化|健康促進|退休|保健|肌力訓練|居家(運動|健身)|60歲|70歲|80歲|90歲|exercise|prevention|active\s+aging/i },
  // 廣譜健康主題 → all cfs
  // 限縮：移除單字「高血壓|糖尿病」（病名單獨會誤吃失禁照護等 specific 片）。
  { band: ALL_CFS, kws: /多重慢性病|共病|用藥安全|多重用藥|整合門診|老年症候群|polypharmacy|multimorbidity|chronic\s+disease/i },
  // 疼痛：拆細以利 per-cell 差異化（先前單一 ALL_CFS 廣譜會把所有 pain 影片塞同一組，pain 9 格永遠相同）
  // PAINAD/失智晚期/臨終疼痛 → cfs7-9（行為觀察評估、無法言語）
  { band: ['cfs7', 'cfs8', 'cfs9'], kws: /PAINAD|失智晚期.*疼痛|臨終.*疼痛|末期.*疼痛/i },
  // 一般慢性疼痛（含 NRS/肌肉骨骼/關節炎）→ cfs3-7（衰弱風險區，多數長者疼痛落此）
  { band: ['cfs3', 'cfs4', 'cfs5', 'cfs6', 'cfs7'], kws: /慢性疼痛|疼痛(?!.*末期)|止痛|NRS|nrs|肌肉骨骼|關節炎|纖維肌痛|\bpain\b/i },
  // 純權益/福利 → all cfs（限縮：只命中明確權益詞，避免「補助/經濟」單字把 specific 片誤吃成 ALL）
  { band: ALL_CFS, kws: /老人福利|長者權益|敬老|健保(?:卡|身分|費)?|社會福利|無障礙環境|long[\s-]?term\s+care\s+(?:welfare|benefit)|welfare\s+(?:for|of)\s+(?:elderly|seniors?)/i },
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
