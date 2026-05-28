import { describe, it, expect } from 'vitest';
import { classifyCfsBands } from '../../scripts/curate/lib/cfs-band';

describe('classifyCfsBands', () => {
  it('末期/安寧/ACP → cfs8-9', () => {
    const bands = classifyCfsBands('病人自主權利法 預立醫療決定 善終');
    expect(bands.has('cfs8')).toBe(true);
    expect(bands.has('cfs9')).toBe(true);
    expect(bands.has('cfs1')).toBe(false);
    expect(bands.has('cfs2')).toBe(false);
  });

  it('臥床/轉位/壓瘡 → cfs7-9（重度依賴）', () => {
    const bands = classifyCfsBands('腦中風病患輪椅轉位 翻身 預防壓瘡');
    expect(bands.has('cfs7')).toBe(true);
    expect(bands.has('cfs8')).toBe(true);
    expect(bands.has('cfs9')).toBe(true);
  });

  it('主動預防/居家運動 → cfs1-4，不波及 cfs8-9', () => {
    const bands = classifyCfsBands('60歲 70歲 90歲 居家肌力訓練 預防跌倒');
    expect(bands.has('cfs1')).toBe(true);
    expect(bands.has('cfs2')).toBe(true);
    expect(bands.has('cfs3')).toBe(true);
    expect(bands.has('cfs4')).toBe(true);
    // 同時命中「跌倒/預防」 → cfs3-6 衰弱風險區也會涵蓋；但不應涵蓋末期
    expect(bands.has('cfs9')).toBe(false);
  });

  it('衰弱症/復能/防跌 → cfs3-6 風險區', () => {
    const bands = classifyCfsBands('衰弱症 復能 自立支援 防跌訓練');
    for (const c of ['cfs3', 'cfs4', 'cfs5', 'cfs6']) expect(bands.has(c as 'cfs3')).toBe(true);
  });

  it('多重慢性病/共病 → 全 CFS 廣譜', () => {
    const bands = classifyCfsBands('多重慢性病 共病 用藥安全 整合門診');
    for (const c of ['cfs1', 'cfs2', 'cfs3', 'cfs4', 'cfs5', 'cfs6', 'cfs7', 'cfs8', 'cfs9']) {
      expect(bands.has(c as 'cfs1')).toBe(true);
    }
  });

  it('PAINAD（失智晚期行為觀察）→ cfs7-9 + 一般慢性疼痛 cfs3-7 → 聯集 cfs3-9（不再 ALL_CFS 廣譜以利差異化）', () => {
    const bands = classifyCfsBands('老年疼痛 NRS PAINAD');
    expect([...bands].sort()).toEqual(['cfs3', 'cfs4', 'cfs5', 'cfs6', 'cfs7', 'cfs8', 'cfs9']);
    expect(bands.has('cfs1')).toBe(false);
    expect(bands.has('cfs2')).toBe(false);
  });

  it('純慢性疼痛（無 PAINAD）→ cfs3-7（衰弱風險區，多數長者疼痛落此）', () => {
    const bands = classifyCfsBands('老人慢性疼痛 肌肉骨骼 關節炎');
    expect([...bands].sort()).toEqual(['cfs3', 'cfs4', 'cfs5', 'cfs6', 'cfs7']);
  });

  it('無訊號文字 → cfs3-6 fallback（不要全 CFS 亂塞，避免假性匹配）', () => {
    const bands = classifyCfsBands('健康影片');
    expect([...bands].sort()).toEqual(['cfs3', 'cfs4', 'cfs5', 'cfs6']);
  });

  it('經濟/福利/可近性 → 全 CFS', () => {
    const bands = classifyCfsBands('長者經濟安全 社會福利');
    expect(bands.size).toBe(9);
  });
});
