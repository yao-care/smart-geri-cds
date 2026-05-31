import { describe, it, expect, beforeEach } from 'vitest';
import { SelfCheckStore } from '../../src/lib/stores/self-check.svelte';
import type { SelfCheckScale } from '../../src/lib/self-check/self-check';

const falls: SelfCheckScale = {
  id: 'sc-falls', domain: { top: 'functional', sub: 'falls' }, category: 'scored', maxScore: 1,
  items: [{ id: 'f', text: '跌倒？', options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] }],
  bands: [
    { min: 0, max: 0, light: 'green', advice: '沒事。' },
    { min: 1, max: 1, light: 'amber', advice: '評估。' },
  ],
  clinicallyReviewed: false,
};
const mood: SelfCheckScale = {
  id: 'sc-mood', domain: { top: 'psychological', sub: 'mood' }, category: 'scored', maxScore: 2,
  items: [
    { id: 'low', text: '低落？', options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] },
    { id: 'sh', text: '自傷？', redFlag: 'self-harm', options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] },
  ],
  bands: [
    { min: 0, max: 0, light: 'green', advice: '還好。' },
    { min: 1, max: 2, light: 'amber', advice: '談談。' },
  ],
  clinicallyReviewed: false,
};

describe('SelfCheckStore', () => {
  let store: SelfCheckStore;
  beforeEach(() => { store = new SelfCheckStore([falls, mood]); });

  it('starts at intro', () => {
    expect(store.step).toBe('intro');
  });

  it('start() moves to screening at first question', () => {
    store.start();
    expect(store.step).toBe('screening');
    expect(store.currentItem?.id).toBe('f');
    expect(store.totalQuestions).toBe(3);
  });

  it('answer() records score and advances; last answer → summary', () => {
    store.start();
    store.answer(0);            // f
    expect(store.currentItem?.id).toBe('low');
    store.answer(1);            // low
    expect(store.currentItem?.id).toBe('sh');
    store.answer(0);            // sh (last)
    expect(store.step).toBe('summary');
  });

  it('summary reflects answers (amber from mood low)', () => {
    store.start();
    store.answer(0); store.answer(1); store.answer(0);
    expect(store.summary.overall).toBe('amber');
    expect(store.summary.concerns.map(c => c.sub)).toContain('mood');
  });

  it('redFlagActive becomes true once self-harm answered positive', () => {
    store.start();
    store.answer(0); store.answer(0);
    expect(store.redFlagActive).toBe(false);
    store.answer(1);            // sh = 是
    expect(store.redFlagActive).toBe(true);
  });

  it('back() returns to previous question keeping its answer', () => {
    store.start();
    store.answer(1);            // f = 1
    store.back();
    expect(store.currentItem?.id).toBe('f');
    expect(store.answers['f']).toBe(1);
  });

  it('reset() returns to intro and clears answers', () => {
    store.start(); store.answer(1);
    store.reset();
    expect(store.step).toBe('intro');
    expect(Object.keys(store.answers)).toHaveLength(0);
  });
});
