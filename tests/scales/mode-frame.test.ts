import { describe, it, expect } from 'vitest';
import { MODE_FRAME, resolveModeFrame } from '$lib/scales/mode-frame';

describe('MODE_FRAME copy (de-duplicated)', () => {
  it('patient frame: title states who answers, hint states operator action — no shared clause', () => {
    const f = MODE_FRAME['patient'];
    expect(f.title).toBe('由受測者本人作答');
    expect(f.hint).toBe('操作者唸出題目，記錄其回答。');
    // Regression guard: the old hint repeated「受測者本人作答」verbatim.
    expect(f.hint).not.toContain('受測者本人作答');
  });

  it('ask-either frame title drops the old parenthetical tail', () => {
    const f = MODE_FRAME['ask-either'];
    expect(f.title).toBe('向受測者本人或家屬／照顧者詢問');
    // Regression: old title appended「（可參考觀察與病歷）」, duplicating the hint.
    expect(f.title).not.toContain('（');
  });

  it('ask-informant-unavailable: title states the state, hint carries the「無法取得」action', () => {
    const f = MODE_FRAME['ask-informant-unavailable'];
    expect(f.title).toBe('查無可詢問的知情者');
    expect(f.hint).toContain('無法取得');
  });

  it('every frame has a short title that is not duplicated inside its hint', () => {
    for (const [mode, f] of Object.entries(MODE_FRAME)) {
      expect(f.title.length, `${mode} title too long`).toBeLessThanOrEqual(20);
      expect(f.hint.includes(f.title), `${mode} hint repeats title`).toBe(false);
    }
  });
});

describe('resolveModeFrame', () => {
  it('swaps ask-informant → unavailable when informant is absent', () => {
    expect(resolveModeFrame('ask-informant', false)).toBe(MODE_FRAME['ask-informant-unavailable']);
  });

  it('keeps ask-informant when present, and returns other modes unchanged', () => {
    expect(resolveModeFrame('ask-informant', true)).toBe(MODE_FRAME['ask-informant']);
    expect(resolveModeFrame('measure', null)).toBe(MODE_FRAME['measure']);
  });
});
