import { describe, it, expect } from 'vitest';
import { scoreScale, aggregateSeverity, type ScaleDef } from '$lib/scales/scale';

const gds: ScaleDef = {
  id: 'gds-15', domain: { top: 'psychological', sub: 'mood' },
  applicableCfs: ['cfs3','cfs4','cfs5'], scoring: 'sum', inputType: 'option', maxScore: 15,
  items: [], clinicallyReviewed: false,
  bands: [
    { max: 4, severity: 'normal', label: '無憂鬱徵兆' },
    { min: 5, max: 9, severity: 'monitor', label: '疑似憂鬱' },
    { min: 10, severity: 'refer', label: '高度疑似' },
  ],
};
describe('scoreScale', () => {
  it('maps raw score to band severity', () => {
    expect(scoreScale(gds, 2).severity).toBe('normal');
    expect(scoreScale(gds, 7).severity).toBe('monitor');
    expect(scoreScale(gds, 12).severity).toBe('refer');
  });
  it('returns incomplete when raw is null', () => {
    expect(scoreScale(gds, null).severity).toBe('incomplete');
  });
});
describe('aggregateSeverity', () => {
  it('takes worst, ignoring incomplete', () => {
    expect(aggregateSeverity(['normal','monitor','incomplete'])).toBe('monitor');
    expect(aggregateSeverity(['normal','refer'])).toBe('refer');
    expect(aggregateSeverity(['incomplete','incomplete'])).toBe('incomplete');
    expect(aggregateSeverity([])).toBe('incomplete');
  });
});
