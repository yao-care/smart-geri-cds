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
    const bands = classifyCfsBands('老人福利 社會福利');
    expect(bands.size).toBe(9);
  });

  // ── Task 1 新規則：差異化 comorbidity / continence / financial ──

  it('失禁 + 重度照護（尿片/尿套/換尿片）→ cfs7-9', () => {
    const a = classifyCfsBands('換尿片教學 : 更換成人尿片專業正確方法 真善美護理頻道');
    expect(a.has('cfs7')).toBe(true);
    expect(a.has('cfs8')).toBe(true);
    expect(a.has('cfs9')).toBe(true);
    // 不應蔓延到主動 cfs1-2
    expect(a.has('cfs1')).toBe(false);
    expect(a.has('cfs2')).toBe(false);

    const b = classifyCfsBands('【失禁】 如何使用尿套 失禁問題多面睇');
    expect(b.has('cfs7')).toBe(true);
    expect(b.has('cfs9')).toBe(true);
  });

  it('失禁 + 預防/骨盆底肌訓練 → 主動/中段（cfs3-6 fallback，不誤分為重度）', () => {
    const bands = classifyCfsBands('改善尿失禁 骨盆底肌強化運動');
    // 主動骨盆肌訓練不應命中重度規則
    expect(bands.has('cfs7')).toBe(false);
    expect(bands.has('cfs8')).toBe(false);
    expect(bands.has('cfs9')).toBe(false);
    // fallback 落入 cfs3-6
    for (const c of ['cfs3', 'cfs4', 'cfs5', 'cfs6']) expect(bands.has(c as 'cfs3')).toBe(true);
  });

  it('多重慢性病 + 失能/在宅醫療/家庭醫師 → cfs6-9（重度整合照護）', () => {
    const a = classifyCfsBands('面對老化加速在宅醫療守護失能長者');
    expect(a.has('cfs6')).toBe(true);
    expect(a.has('cfs7')).toBe(true);
    expect(a.has('cfs9')).toBe(true);
    expect(a.has('cfs1')).toBe(false);
    expect(a.has('cfs2')).toBe(false);

    const b = classifyCfsBands('家庭醫師照護方案防失能者慢性病惡化');
    expect(b.has('cfs6')).toBe(true);
    expect(b.has('cfs7')).toBe(true);
    expect(b.has('cfs1')).toBe(false);
  });

  it('多重慢性病/整合門診 純廣譜（無失能/在宅）→ ALL_CFS 不變', () => {
    const bands = classifyCfsBands('高齡整合門診 照護老人多重慢性病 公視');
    expect(bands.size).toBe(9);
  });

  it('長照 + 經濟弱勢/補助/低收入 → cfs5-9（受照顧者，非主動）', () => {
    const a = classifyCfsBands('中、低收入戶長照應全額補助並提高上限');
    expect(a.has('cfs5')).toBe(true);
    expect(a.has('cfs7')).toBe(true);
    expect(a.has('cfs9')).toBe(true);
    expect(a.has('cfs1')).toBe(false);
    expect(a.has('cfs2')).toBe(false);

    const b = classifyCfsBands('長照2年上路全民納保 學者憂弱勢權益');
    expect(b.has('cfs5')).toBe(true);
    expect(b.has('cfs9')).toBe(true);
    expect(b.has('cfs1')).toBe(false);
  });

  it('退休 + 經濟安全/年金/理財 → cfs1-4（活躍主動）', () => {
    const a = classifyCfsBands('退休制度及老年經濟安全保障');
    expect(a.has('cfs1')).toBe(true);
    expect(a.has('cfs2')).toBe(true);
    expect(a.has('cfs3')).toBe(true);
    expect(a.has('cfs4')).toBe(true);
    expect(a.has('cfs7')).toBe(false);
    expect(a.has('cfs8')).toBe(false);
    expect(a.has('cfs9')).toBe(false);
  });

  it('純權益（老人福利/敬老/健保）→ ALL_CFS', () => {
    const a = classifyCfsBands('搭公車不用錢 免交健保費 65歲以上應知的老人福利');
    expect(a.size).toBeGreaterThanOrEqual(9);

    const b = classifyCfsBands('林澄輝社會福利基金會');
    expect(b.size).toBe(9);
  });

  it('限縮 chronic-broad：純病名「糖尿病/高血壓」單獨出現不應放 ALL_CFS（避免廣譜誤吃）', () => {
    // 含「糖尿病」但語境是大小便護理 → 不能因「糖尿病」誤拉成 ALL
    const bands = classifyCfsBands('大小便護理 護理之家 失禁照護 糖尿病');
    expect(bands.size).toBeLessThan(9);
    // 應命中重度照護（護理之家 + 大小便|失禁）
    expect(bands.has('cfs7')).toBe(true);
  });
});
