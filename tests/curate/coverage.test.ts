import { describe, it, expect } from 'vitest';
import {
  domainOf,
  broadcastDomainVideos,
  uncoveredDomainCells,
  type TriggerEntry,
} from '../../scripts/curate/lib/coverage';

describe('domainOf', () => {
  it('擷取 top.sub', () => {
    expect(domainOf('cga.domain.functional.falls.anomaly.cfs3')).toBe('functional.falls');
  });
  it('非 domain trigger 回 null', () => {
    expect(domainOf('cga.triage.refer.cfs5')).toBeNull();
    expect(domainOf('cdss.alert.sugar_intake.warning')).toBeNull();
  });
});

describe('broadcastDomainVideos', () => {
  const triggers: TriggerEntry[] = [
    { trigger: 'cga.domain.functional.falls.anomaly.cfs3', articles: [], videoIds: ['aaaaaaaaaaa', 'bbbbbbbbbbb'] },
    { trigger: 'cga.domain.functional.falls.anomaly.cfs5', articles: [], videoIds: ['ccccccccccc'] },
    { trigger: 'cga.domain.functional.falls.anomaly.cfs7', articles: [], videoIds: [] },
    { trigger: 'cga.domain.physical.pain.anomaly.cfs4', articles: [], videoIds: [] },
  ];
  const scores = { aaaaaaaaaaa: 0.9, bbbbbbbbbbb: 0.5, ccccccccccc: 0.7 };

  it('把同領域聯集依分數排序攤到所有該領域 trigger', () => {
    const out = broadcastDomainVideos(triggers, scores, 5);
    const byT = Object.fromEntries(out.map(t => [t.trigger, t.videoIds]));
    // 聯集 {aaa,bbb,ccc} 依分數 desc：aaa(0.9) > ccc(0.7) > bbb(0.5)
    expect(byT['cga.domain.functional.falls.anomaly.cfs3']).toEqual(['aaaaaaaaaaa', 'ccccccccccc', 'bbbbbbbbbbb']);
    expect(byT['cga.domain.functional.falls.anomaly.cfs5']).toEqual(['aaaaaaaaaaa', 'ccccccccccc', 'bbbbbbbbbbb']);
    expect(byT['cga.domain.functional.falls.anomaly.cfs7']).toEqual(['aaaaaaaaaaa', 'ccccccccccc', 'bbbbbbbbbbb']);
  });

  it('全空領域（pain 無任何片）維持空、不杜撰', () => {
    const out = broadcastDomainVideos(triggers, scores, 5);
    const byT = Object.fromEntries(out.map(t => [t.trigger, t.videoIds]));
    expect(byT['cga.domain.physical.pain.anomaly.cfs4']).toEqual([]);
  });

  it('cap 限制每格數量、取分數最高者', () => {
    const out = broadcastDomainVideos(triggers, scores, 2);
    const byT = Object.fromEntries(out.map(t => [t.trigger, t.videoIds]));
    expect(byT['cga.domain.functional.falls.anomaly.cfs3']).toEqual(['aaaaaaaaaaa', 'ccccccccccc']);
  });

  it('不變動輸入陣列', () => {
    const snapshot = JSON.parse(JSON.stringify(triggers));
    broadcastDomainVideos(triggers, scores, 5);
    expect(triggers).toEqual(snapshot);
  });
});

describe('selectPerCellVideos', () => {
  it('依 cfs-band classifier 為每格挑匹配影片優先；不足以分數高者補滿', async () => {
    const { selectPerCellVideos } = await import('../../scripts/curate/lib/coverage');
    const triggers: TriggerEntry[] = [
      { trigger: 'cga.domain.functional.falls.anomaly.cfs2', articles: [], videoIds: [] },
      { trigger: 'cga.domain.functional.falls.anomaly.cfs7', articles: [], videoIds: [] },
      { trigger: 'cga.domain.functional.falls.anomaly.cfs4', articles: [], videoIds: ['prevent_aaa', 'bedfast_bb', 'general_cc'] },
    ];
    const scores = { prevent_aaa: 0.8, bedfast_bb: 0.6, general_cc: 0.5 };
    // 假分類器：prevent 主動預防(cfs1-4)；bedfast 重度(cfs7-9)；general fallback(cfs3-6)
    const classify = (v: string): Set<string> => {
      if (v.startsWith('prevent_')) return new Set(['cfs1', 'cfs2', 'cfs3', 'cfs4']);
      if (v.startsWith('bedfast_')) return new Set(['cfs7', 'cfs8', 'cfs9']);
      return new Set(['cfs3', 'cfs4', 'cfs5', 'cfs6']);
    };
    const out = selectPerCellVideos(triggers, scores, classify, 5);
    const byT = Object.fromEntries(out.map(t => [t.trigger, t.videoIds]));
    // cfs2：prevent 匹配優先，其餘 fallback
    expect(byT['cga.domain.functional.falls.anomaly.cfs2'][0]).toBe('prevent_aaa');
    expect(byT['cga.domain.functional.falls.anomaly.cfs2'].slice(0, 1)).toEqual(['prevent_aaa']);
    // cfs7：bedfast 匹配優先
    expect(byT['cga.domain.functional.falls.anomaly.cfs7'][0]).toBe('bedfast_bb');
    // cfs4：prevent + general 都匹配（cfs4 ∈ cfs1-4 也 ∈ cfs3-6），bedfast 不匹配 → 補後
    const cfs4 = byT['cga.domain.functional.falls.anomaly.cfs4'];
    expect(cfs4.indexOf('prevent_aaa')).toBeLessThan(cfs4.indexOf('bedfast_bb'));
    expect(cfs4.indexOf('general_cc')).toBeLessThan(cfs4.indexOf('bedfast_bb'));
  });

  it('cell 池為空 → 該 cell videoIds 保持空（不假裝有片）', async () => {
    const { selectPerCellVideos } = await import('../../scripts/curate/lib/coverage');
    const triggers: TriggerEntry[] = [
      { trigger: 'cga.domain.physical.comorbidity.anomaly.cfs3', articles: [], videoIds: [] },
    ];
    const out = selectPerCellVideos(triggers, {}, () => new Set(), 5);
    expect(out[0].videoIds).toEqual([]);
  });

  it('cap 切上限', async () => {
    const { selectPerCellVideos } = await import('../../scripts/curate/lib/coverage');
    const triggers: TriggerEntry[] = [
      { trigger: 'cga.domain.functional.falls.anomaly.cfs5', articles: [], videoIds: ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'] },
    ];
    const scores = { v1: 0.9, v2: 0.8, v3: 0.7, v4: 0.6, v5: 0.5, v6: 0.4 };
    const out = selectPerCellVideos(triggers, scores, () => new Set(['cfs5']), 3);
    expect(out[0].videoIds).toEqual(['v1', 'v2', 'v3']);
  });

  it('窄 band 匹配優先於廣譜 ALL_CFS（即使廣譜分數較高）— 解決廣譜片擠掉 specific 片問題', async () => {
    const { selectPerCellVideos } = await import('../../scripts/curate/lib/coverage');
    const triggers: TriggerEntry[] = [
      // 池內：5 支廣譜 ALL_CFS（高分） + 2 支 cfs6-9 specific（低分）
      { trigger: 'cga.domain.physical.comorbidity.anomaly.cfs7', articles: [], videoIds: ['broad_1', 'broad_2', 'broad_3', 'broad_4', 'broad_5', 'narrow_a', 'narrow_b'] },
      { trigger: 'cga.domain.physical.comorbidity.anomaly.cfs1', articles: [], videoIds: [] },
    ];
    const scores = {
      broad_1: 0.9, broad_2: 0.8, broad_3: 0.7, broad_4: 0.6, broad_5: 0.55,
      narrow_a: 0.5, narrow_b: 0.4,
    };
    const ALL: Set<string> = new Set(['cfs1', 'cfs2', 'cfs3', 'cfs4', 'cfs5', 'cfs6', 'cfs7', 'cfs8', 'cfs9']);
    const NARROW: Set<string> = new Set(['cfs6', 'cfs7', 'cfs8', 'cfs9']);
    const classify = (v: string): Set<string> => (v.startsWith('narrow_') ? NARROW : ALL);

    const out = selectPerCellVideos(triggers, scores, classify, 5);
    const byT = Object.fromEntries(out.map(t => [t.trigger, t.videoIds]));

    // cfs7：narrow specific 優先（即使分數低），broad 補位
    expect(byT['cga.domain.physical.comorbidity.anomaly.cfs7'].slice(0, 2)).toEqual(['narrow_a', 'narrow_b']);
    // cfs1：narrow 不含 cfs1 → 只有 broad → 全是 broad
    expect(byT['cga.domain.physical.comorbidity.anomaly.cfs1'].includes('narrow_a')).toBe(false);
    expect(byT['cga.domain.physical.comorbidity.anomaly.cfs1'].includes('narrow_b')).toBe(false);
    // cfs1 vs cfs7 影片集合不同 → 真實 set 差異化
    const set1 = new Set(byT['cga.domain.physical.comorbidity.anomaly.cfs1']);
    const set7 = new Set(byT['cga.domain.physical.comorbidity.anomaly.cfs7']);
    expect([...set1].sort().join(',')).not.toBe([...set7].sort().join(','));
  });
});

describe('uncoveredDomainCells', () => {
  it('列出仍為空的 domain 格', () => {
    const triggers: TriggerEntry[] = [
      { trigger: 'cga.domain.functional.falls.anomaly.cfs3', articles: [], videoIds: ['aaaaaaaaaaa'] },
      { trigger: 'cga.domain.physical.pain.anomaly.cfs4', articles: [], videoIds: [] },
    ];
    expect(uncoveredDomainCells(triggers)).toEqual(['cga.domain.physical.pain.anomaly.cfs4']);
  });
});
