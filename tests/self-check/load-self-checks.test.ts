import { describe, it, expect } from 'vitest';
import { toSelfCheckScales, type SelfCheckEntry } from '../../src/lib/self-check/load-self-checks';

const entry: SelfCheckEntry = {
  data: {
    id: 'sc-falls',
    domain: { top: 'functional', sub: 'falls' },
    category: 'scored',
    maxScore: 1,
    items: [{ id: 'q', text: '跌倒？', options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] }],
    bands: [
      { min: 0, max: 0, light: 'green', advice: '沒有跌倒徵兆。' },
      { min: 1, max: 1, light: 'amber', advice: '建議評估。' },
    ],
    clinicallyReviewed: false,
  },
};

describe('toSelfCheckScales', () => {
  it('maps collection entries to SelfCheckScale[]', () => {
    const scales = toSelfCheckScales([entry]);
    expect(scales).toHaveLength(1);
    expect(scales[0].id).toBe('sc-falls');
    expect(scales[0].category).toBe('scored');
    expect(scales[0].items[0].options[1].score).toBe(1);
  });
});
