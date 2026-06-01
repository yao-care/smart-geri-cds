import { describe, it, expect } from 'vitest';
import { simplifiedRatio } from '../../scripts/curate/lib/simplified-detector';

describe('simplifiedRatio', () => {
  it('returns 0 for pure traditional', () => {
    expect(simplifiedRatio('長者體重變化')).toBeLessThan(0.1);
  });

  it('returns > 0.3 for simplified content', () => {
    expect(simplifiedRatio('儿童体重发展评估')).toBeGreaterThan(0.3);
  });

  it('returns 0 for empty input', () => {
    expect(simplifiedRatio('')).toBe(0);
  });

  it('returns 0 for non-Chinese text', () => {
    expect(simplifiedRatio('Hello world 123')).toBe(0);
  });
});
