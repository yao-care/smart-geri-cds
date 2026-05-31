import { describe, it, expect } from 'vitest';
import { summariseSelfCheck } from '../../src/lib/self-check/summarise';
import type { SelfCheckScale } from '../../src/lib/self-check/self-check';

const falls: SelfCheckScale = {
  id: 'sc-falls', domain: { top: 'functional', sub: 'falls' }, category: 'scored', maxScore: 1,
  items: [{ id: 'f', text: '跌倒？', options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] }],
  bands: [
    { min: 0, max: 0, light: 'green', advice: '沒有跌倒徵兆。' },
    { min: 1, max: 1, light: 'amber', advice: '建議評估跌倒風險。' },
  ],
  clinicallyReviewed: false,
};
const mood: SelfCheckScale = {
  id: 'sc-mood', domain: { top: 'psychological', sub: 'mood' }, category: 'scored', maxScore: 2,
  items: [
    { id: 'low', text: '情緒低落？', options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] },
    { id: 'sh', text: '自傷念頭？', redFlag: 'self-harm', options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] },
  ],
  bands: [
    { min: 0, max: 0, light: 'green', advice: '情緒還好。' },
    { min: 1, max: 2, light: 'amber', advice: '建議談談情緒。' },
  ],
  clinicallyReviewed: false,
};
const acp: SelfCheckScale = {
  id: 'sc-acp', domain: { top: 'future_wishes', sub: 'advance_care_planning' }, category: 'awareness', maxScore: 1,
  items: [{ id: 'a', text: '想了解預立醫療？', options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] }],
  bands: [], clinicallyReviewed: false,
};

describe('summariseSelfCheck', () => {
  it('all green → overall green, no concerns, no red flag', () => {
    const s = summariseSelfCheck([falls, mood], { f: 0, low: 0, sh: 0 });
    expect(s.overall).toBe('green');
    expect(s.concerns).toHaveLength(0);
    expect(s.redFlag).toBe(false);
  });

  it('one amber → overall amber, concern listed with label + advice', () => {
    const s = summariseSelfCheck([falls, mood], { f: 1, low: 0, sh: 0 });
    expect(s.overall).toBe('amber');
    expect(s.concerns).toHaveLength(1);
    expect(s.concerns[0].label).toBe('平衡跌倒');
    expect(s.concerns[0].advice).toContain('跌倒');
  });

  it('self-harm answered positive → redFlag true and overall red', () => {
    const s = summariseSelfCheck([falls, mood], { f: 0, low: 1, sh: 1 });
    expect(s.redFlag).toBe(true);
    expect(s.overall).toBe('red');
  });

  it('awareness positive → listed under awareness, not in concerns', () => {
    const s = summariseSelfCheck([falls, acp], { f: 0, a: 1 });
    expect(s.concerns).toHaveLength(0);
    expect(s.awareness.map(a => a.sub)).toContain('advance_care_planning');
  });

  it('concerns sorted by DOMAIN_TREE order (physical before functional)', () => {
    const pain: SelfCheckScale = {
      ...falls, id: 'sc-pain', domain: { top: 'physical', sub: 'pain' },
      items: [{ id: 'p', text: '疼痛？', options: falls.items[0].options }],
    };
    const s = summariseSelfCheck([falls, pain], { f: 1, p: 1 });
    expect(s.concerns.map(c => c.sub)).toEqual(['pain', 'falls']);
  });

  it('incomplete scored scale → not a concern, stays green', () => {
    const s = summariseSelfCheck([mood], {});   // no answers at all
    expect(s.concerns).toHaveLength(0);
    expect(s.overall).toBe('green');
  });
});
