import { describe, it, expect } from 'vitest';
import { buildMatrixData, CDSA_DOMAINS, AGE_GROUPS_CDSA } from '$lib/education/matrix-data';

const triggers = {
  'cdsa.domain.language.anomaly.13-24m': { videoIds: ['abc1234abcde'], inapplicable: false },
  'cdsa.domain.language.anomaly.2-6m':   { videoIds: [],              inapplicable: true  },
  'cdsa.domain.gross_motor.anomaly.13-24m': { videoIds: [],           inapplicable: false },
  // cdss.* and cdsa.triage.* should be ignored
  'cdss.sugar_intake.critical.toddler':  { videoIds: ['xyz'],          inapplicable: false },
  'cdsa.triage.refer.13-24m':            { videoIds: [],              inapplicable: false },
};

const slugToTriggers = {
  'language-stimulation': ['cdsa.domain.language.anomaly.13-24m'],
  'diet-control': ['cdss.sugar_intake.critical.toddler'],  // cdss — must NOT appear in matrix
};

describe('buildMatrixData', () => {
  it('initialises all domain×age combinations', () => {
    const data = buildMatrixData({}, {});
    for (const domain of CDSA_DOMAINS) {
      for (const age of AGE_GROUPS_CDSA) {
        expect(data[`${domain}:${age}`]).toBeDefined();
      }
    }
  });

  it('marks inapplicable cells', () => {
    const data = buildMatrixData(triggers, slugToTriggers);
    expect(data['language:2-6m'].inapplicable).toBe(true);
  });

  it('populates videoIds for applicable cells', () => {
    const data = buildMatrixData(triggers, slugToTriggers);
    expect(data['language:13-24m'].videoIds).toEqual(['abc1234abcde']);
  });

  it('attaches article slugs only via cdsa.domain triggers', () => {
    const data = buildMatrixData(triggers, slugToTriggers);
    expect(data['language:13-24m'].articleSlugs).toContain('language-stimulation');
  });

  it('ignores cdss and cdsa.triage slugs', () => {
    const data = buildMatrixData(triggers, slugToTriggers);
    for (const domain of CDSA_DOMAINS) {
      for (const age of AGE_GROUPS_CDSA) {
        expect(data[`${domain}:${age}`].articleSlugs).not.toContain('diet-control');
      }
    }
  });

  it('applicable cell with no resources has inapplicable=false', () => {
    const data = buildMatrixData(triggers, slugToTriggers);
    expect(data['gross_motor:13-24m'].inapplicable).toBe(false);
    expect(data['gross_motor:13-24m'].videoIds).toEqual([]);
    expect(data['gross_motor:13-24m'].articleSlugs).toEqual([]);
  });
});
