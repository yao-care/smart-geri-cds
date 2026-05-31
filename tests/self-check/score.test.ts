import { describe, it, expect } from 'vitest';
import { scoreSelfCheck, type SelfCheckScale } from '../../src/lib/self-check/self-check';

function mkScored(overrides: Partial<SelfCheckScale> = {}): SelfCheckScale {
  return {
    id: 'sc-falls',
    domain: { top: 'functional', sub: 'falls' },
    category: 'scored',
    maxScore: 1,
    items: [
      { id: 'q', text: '過去一年是否跌倒過？', options: [
        { label: '否', score: 0 }, { label: '是', score: 1 },
      ] },
    ],
    bands: [
      { min: 0, max: 0, light: 'green', advice: '目前沒有跌倒徵兆。' },
      { min: 1, max: 1, light: 'amber', advice: '建議找醫療人員評估跌倒風險。' },
    ],
    clinicallyReviewed: false,
    ...overrides,
  };
}

describe('scoreSelfCheck', () => {
  it('green band when total score 0', () => {
    const r = scoreSelfCheck(mkScored(), { q: 0 });
    expect(r.light).toBe('green');
    expect(r.advice).toContain('沒有跌倒');
  });

  it('amber band when total score 1', () => {
    const r = scoreSelfCheck(mkScored(), { q: 1 });
    expect(r.light).toBe('amber');
  });

  it('sums multiple item scores before banding (mood 2 items)', () => {
    const mood = mkScored({
      id: 'sc-mood', domain: { top: 'psychological', sub: 'mood' }, maxScore: 2,
      items: [
        { id: 'low', text: '情緒低落？', options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] },
        { id: 'sh', text: '自傷念頭？', redFlag: 'self-harm', options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] },
      ],
      bands: [
        { min: 0, max: 0, light: 'green', advice: '情緒狀態看起來還好。' },
        { min: 1, max: 2, light: 'amber', advice: '建議找醫療人員談談情緒。' },
      ],
    });
    expect(scoreSelfCheck(mood, { low: 1, sh: 0 }).light).toBe('amber');
    expect(scoreSelfCheck(mood, { low: 0, sh: 0 }).light).toBe('green');
  });

  it('unanswered item → light null (incomplete, not scored)', () => {
    const r = scoreSelfCheck(mkScored(), {});
    expect(r.light).toBeNull();
  });
});
