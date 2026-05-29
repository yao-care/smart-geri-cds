import type { ItemMode } from './scale';

/** Answer-source framing copy shown above each questionnaire item.
 *  title = WHO answers / which method (mode-level); the item's own `prompt`
 *  says WHAT the question asks. The two must not restate each other (the old
 *  copy repeated「受測者本人作答／唸題記錄」across title, hint and prompt). */
export interface ModeFrame {
  title: string;
  hint: string;
}

/** Every `ItemMode` plus the informant-absent degraded frame. Closed union →
 *  adding a new ItemMode triggers a compile error here until its frame exists. */
export type ModeFrameKey = ItemMode | 'ask-informant-unavailable';

export const MODE_FRAME: Record<ModeFrameKey, ModeFrame> = {
  'patient': { title: '由受測者本人作答', hint: '操作者唸出題目，記錄其回答。' },
  'observe': { title: '由操作者觀察受測者', hint: '依下列觀察重點觀察，記錄結果。' },
  'ask-either': { title: '向受測者本人或家屬／照顧者詢問', hint: '可參考觀察與病歷後記錄。' },
  'ask-informant': { title: '向熟悉受測者的家屬／照顧者詢問', hint: '請選最了解其日常生活者回答。' },
  'ask-informant-unavailable': { title: '查無可詢問的知情者', hint: '本題需家屬／照顧者；可標為「無法取得」（記為未完成）。' },
  'measure': { title: '由操作者量測', hint: '依下列方式量測，記錄數值。' },
};

/** `mode` is the item's `ItemMode` (same type as the component's `currentMode`).
 *  The closed-union Record guarantees a hit, so no fallback is needed. */
export function resolveModeFrame(mode: ItemMode, informantAvailable: boolean | null): ModeFrame {
  if (mode === 'ask-informant' && informantAvailable === false) {
    return MODE_FRAME['ask-informant-unavailable'];
  }
  return MODE_FRAME[mode];
}
