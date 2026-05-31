/**
 * 民眾自評層 TTS（Web Speech API / SpeechSynthesis），語言 zh-TW。
 * 零後端、本機合成、無音檔資產，符合「不使用大陸廠牌 AI 服務」（用 OS/瀏覽器本機語音）。
 * 所有函式在 speechSynthesis 不存在（SSR、舊瀏覽器）時安全 no-op，呼叫端據 hasZhTwVoice() 降級。
 */

function synth(): SpeechSynthesis | null {
  return typeof globalThis !== 'undefined' && 'speechSynthesis' in globalThis
    ? (globalThis.speechSynthesis as SpeechSynthesis)
    : null;
}

/** 是否有可朗讀中文（zh 開頭，優先 zh-TW）的本機語音。供降級判斷。 */
export function hasZhTwVoice(): boolean {
  const s = synth();
  if (!s) return false;
  const voices = s.getVoices();
  return voices.some(v => v.lang === 'zh-TW') || voices.some(v => v.lang.startsWith('zh'));
}

/** 取消當前朗讀。 */
export function cancelSpeech(): void {
  synth()?.cancel();
}

/** 朗讀一段文字（先取消在途語音避免疊音）。無 speechSynthesis 時 no-op。 */
export function speak(text: string): void {
  const s = synth();
  if (!s || typeof globalThis.SpeechSynthesisUtterance === 'undefined') return;
  s.cancel();
  const u = new globalThis.SpeechSynthesisUtterance(text);
  u.lang = 'zh-TW';
  u.rate = 0.9; // 略慢，長者較易聽清楚
  s.speak(u);
}
