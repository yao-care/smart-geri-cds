const SIMPLIFIED_TO_TRADITIONAL: Record<string, string> = {
  '儿': '兒', '体': '體', '语': '語', '过': '過', '关': '關', '门': '門',
  '问': '問', '间': '間', '时': '時', '会': '會', '说': '說', '话': '話',
  '听': '聽', '见': '見', '车': '車', '电': '電', '脑': '腦', '医': '醫',
  '药': '藥', '疗': '療', '诊': '診', '断': '斷', '症': '症', '状': '狀',
  '发': '發', '热': '熱', '冷': '冷', '动': '動', '运': '運', '游': '遊',
  '戏': '戲', '学': '學', '习': '習', '读': '讀', '书': '書', '写': '寫',
  '画': '畫', '图': '圖', '声': '聲', '响': '響', '应': '應', '认': '認',
  '识': '識', '议': '議', '论': '論', '设': '設', '计': '計', '产': '產',
  '业': '業', '务': '務', '员': '員', '团': '團', '队': '隊', '组': '組',
  '织': '織', '后': '後', '从': '從', '众': '眾', '们': '們',
};

const TRADITIONAL_SET = new Set(Object.values(SIMPLIFIED_TO_TRADITIONAL));
const SIMPLIFIED_SET = new Set(Object.keys(SIMPLIFIED_TO_TRADITIONAL));

const CJK_REGEX = /[一-鿿]/;

/** 對中文字符統計簡體比例。非中文（英文、數字、符號）不算分母。 */
export function simplifiedRatio(text: string): number {
  let cjkCount = 0;
  let simplifiedCount = 0;
  let traditionalCount = 0;
  for (const ch of text) {
    if (!CJK_REGEX.test(ch)) continue;
    cjkCount++;
    if (SIMPLIFIED_SET.has(ch)) simplifiedCount++;
    else if (TRADITIONAL_SET.has(ch)) traditionalCount++;
  }
  if (cjkCount === 0) return 0;
  const decisive = simplifiedCount + traditionalCount;
  if (decisive === 0) return 0;
  return simplifiedCount / decisive;
}
