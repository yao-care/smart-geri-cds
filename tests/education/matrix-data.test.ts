import { describe, it, expect } from 'vitest';
import { buildMatrixData, CDSA_DOMAINS, CFS_LEVELS } from '$lib/education/matrix-data';

const triggers = {
  'cga.domain.functional.adl.anomaly.cfs5':      { videoIds: ['abc1234abcde'], inapplicable: false, educationSlug: 'adl-support' },
  'cga.domain.functional.adl.anomaly.cfs1':      { videoIds: [],               inapplicable: true  },
  'cga.domain.functional.mobility.anomaly.cfs5': { videoIds: [],               inapplicable: false },
  // article-only cell (educationSlug, no videos) must still surface in the matrix
  'cga.domain.psychological.mood.anomaly.cfs5':  { videoIds: [],               inapplicable: false, educationSlug: 'mood-care' },
  // non-domain keys (cga.triage.* and any legacy key, incl. their educationSlug) must be ignored by the matrix
  'legacy.ignored.key.cfs5':                     { videoIds: ['xyz'],          inapplicable: false, educationSlug: 'nutrition-guide' },
  'cga.triage.refer.cfs5':                       { videoIds: [],               inapplicable: false },
};

describe('buildMatrixData', () => {
  it('initialises all top.sub × cfs combinations', () => {
    const data = buildMatrixData({});
    for (const topSub of CDSA_DOMAINS) {
      for (const cfs of CFS_LEVELS) {
        expect(data[`${topSub}:${cfs}`]).toBeDefined();
      }
    }
  });

  it('marks inapplicable cells', () => {
    const data = buildMatrixData(triggers);
    expect(data['functional.adl:cfs1'].inapplicable).toBe(true);
  });

  it('populates videoIds for applicable cells', () => {
    const data = buildMatrixData(triggers);
    expect(data['functional.adl:cfs5'].videoIds).toEqual(['abc1234abcde']);
  });

  it('attaches article via the cell educationSlug', () => {
    const data = buildMatrixData(triggers);
    expect(data['functional.adl:cfs5'].articleSlugs).toContain('adl-support');
  });

  it('surfaces article-only cells (educationSlug without any video)', () => {
    const data = buildMatrixData(triggers);
    expect(data['psychological.mood:cfs5'].articleSlugs).toEqual(['mood-care']);
    expect(data['psychological.mood:cfs5'].videoIds).toEqual([]);
    expect(data['psychological.mood:cfs5'].inapplicable).toBe(false);
  });

  it('ignores cdss and cga.triage educationSlugs', () => {
    const data = buildMatrixData(triggers);
    for (const topSub of CDSA_DOMAINS) {
      for (const cfs of CFS_LEVELS) {
        expect(data[`${topSub}:${cfs}`].articleSlugs).not.toContain('diet-control');
      }
    }
  });

  it('applicable cell with no resources has inapplicable=false', () => {
    const data = buildMatrixData(triggers);
    expect(data['functional.mobility:cfs5'].inapplicable).toBe(false);
    expect(data['functional.mobility:cfs5'].videoIds).toEqual([]);
    expect(data['functional.mobility:cfs5'].articleSlugs).toEqual([]);
  });

  it('treats cells with no trigger entry as applicable (contributable)', () => {
    // Regression: cells absent from the trigger map must default to applicable,
    // not inapplicable — only the explicit inapplicable combos show "—".
    const data = buildMatrixData(triggers);
    expect(data['social.financial:cfs9'].inapplicable).toBe(false);
    expect(data['social.financial:cfs9'].videoIds).toEqual([]);
    expect(data['social.financial:cfs9'].articleSlugs).toEqual([]);
  });

  it('marks only explicitly-flagged combos as inapplicable', () => {
    const data = buildMatrixData(triggers);
    let inapplicableCount = 0;
    for (const topSub of CDSA_DOMAINS) {
      for (const cfs of CFS_LEVELS) {
        if (data[`${topSub}:${cfs}`].inapplicable) inapplicableCount++;
      }
    }
    // test fixture has exactly one inapplicable trigger (functional.adl:cfs1)
    expect(inapplicableCount).toBe(1);
  });
});
