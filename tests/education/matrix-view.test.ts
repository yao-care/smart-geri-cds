import { describe, it, expect } from 'vitest';
import { buildMatrixData } from '$lib/education/matrix-data';
import {
  buildCellViews,
  cellResourceCount,
  heatBucket,
  matrixCoverage,
  type CellView,
} from '$lib/education/matrix-view';

const triggers = {
  'cga.domain.functional.adl.anomaly.cfs5':      { videoIds: ['abc1234abcde'], inapplicable: false, educationSlug: 'adl-support' },
  'cga.domain.functional.adl.anomaly.cfs1':      { videoIds: [],               inapplicable: true  },
  'cga.domain.psychological.mood.anomaly.cfs5':  { videoIds: [],               inapplicable: false, educationSlug: 'mood-care' },
};
const articleTitles = { 'adl-support': '日常活動支持', 'mood-care': '情緒照護' };
const catalog = { abc1234abcde: { title: '行走訓練', channel: '復健頻道', duration: 95, videoId: 'abc1234abcde' } };

describe('buildCellViews', () => {
  it('flattens article slug + title and video catalog into a serialisable view', () => {
    const cells = buildCellViews(buildMatrixData(triggers), articleTitles, catalog);
    expect(cells['functional.adl:cfs5']).toEqual({
      inapplicable: false,
      articles: [{ slug: 'adl-support', title: '日常活動支持' }],
      videos: [{ videoId: 'abc1234abcde', title: '行走訓練', channel: '復健頻道', duration: 95 }],
    } satisfies CellView);
  });

  it('falls back to slug when title is missing', () => {
    const cells = buildCellViews(buildMatrixData(triggers), {}, {});
    expect(cells['functional.adl:cfs5'].articles).toEqual([{ slug: 'adl-support', title: 'adl-support' }]);
  });

  it('drops video ids absent from the catalog', () => {
    const cells = buildCellViews(buildMatrixData(triggers), articleTitles, {});
    expect(cells['functional.adl:cfs5'].videos).toEqual([]);
  });

  it('keeps inapplicable cells with empty resources', () => {
    const cells = buildCellViews(buildMatrixData(triggers), articleTitles, catalog);
    expect(cells['functional.adl:cfs1']).toEqual({ inapplicable: true, articles: [], videos: [] });
  });
});

describe('cellResourceCount', () => {
  it('sums articles and videos', () => {
    const cell: CellView = {
      inapplicable: false,
      articles: [{ slug: 'a', title: 'A' }],
      videos: [{ videoId: 'v', title: 'V', channel: 'C', duration: 10 }],
    };
    expect(cellResourceCount(cell)).toBe(2);
  });
});

describe('heatBucket', () => {
  it('maps counts to fixed thresholds 0/1/2/3/4', () => {
    expect(heatBucket(0)).toBe(0);
    expect(heatBucket(1)).toBe(1);
    expect(heatBucket(2)).toBe(2);
    expect(heatBucket(3)).toBe(2);
    expect(heatBucket(4)).toBe(3);
    expect(heatBucket(5)).toBe(3);
    expect(heatBucket(6)).toBe(4);
    expect(heatBucket(99)).toBe(4);
  });
});

describe('matrixCoverage', () => {
  it('counts applicable-with-resources, empty, inapplicable, total', () => {
    const cells = buildCellViews(buildMatrixData(triggers), articleTitles, catalog);
    const cov = matrixCoverage(cells);
    // 20 二層域 × 9 CFS = 180 格
    expect(cov.total).toBe(180);
    expect(cov.inapplicable).toBe(1);          // functional.adl:cfs1
    expect(cov.withResources).toBe(2);         // adl:cfs5, mood:cfs5
    expect(cov.empty).toBe(180 - 1 - 2);
  });
});
