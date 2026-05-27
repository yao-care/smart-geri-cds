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

describe('uncoveredDomainCells', () => {
  it('列出仍為空的 domain 格', () => {
    const triggers: TriggerEntry[] = [
      { trigger: 'cga.domain.functional.falls.anomaly.cfs3', articles: [], videoIds: ['aaaaaaaaaaa'] },
      { trigger: 'cga.domain.physical.pain.anomaly.cfs4', articles: [], videoIds: [] },
    ];
    expect(uncoveredDomainCells(triggers)).toEqual(['cga.domain.physical.pain.anomaly.cfs4']);
  });
});
