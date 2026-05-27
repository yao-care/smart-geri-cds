import { describe, it, expect } from 'vitest';
import { scoreScale, aggregateSeverity, elapsedSecondsToSeverity, type ScaleDef } from '$lib/scales/scale';

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
// FTSTS-like timed task: higher elapsed seconds = worse. Bands are second-based.
const sitToStand: ScaleDef = {
  id: 'sit-to-stand', domain: { top: 'functional', sub: 'mobility' },
  applicableCfs: ['cfs2','cfs3','cfs4','cfs5','cfs6'],
  scoring: 'measured-value', inputType: 'timed-task', maxScore: 30,
  items: [], clinicallyReviewed: false,
  bands: [
    { max: 12, severity: 'normal', label: '順暢完成' },
    { min: 13, max: 15, severity: 'monitor', label: '略慢，建議追蹤' },
    { min: 16, severity: 'refer', label: '吃力或需扶，建議評估' },
  ],
};

describe('scoreScale (timed-task)', () => {
  it('maps elapsed seconds to band severity (higher = worse)', () => {
    expect(scoreScale(sitToStand, 8).severity).toBe('normal');
    expect(scoreScale(sitToStand, 12).severity).toBe('normal');
    expect(scoreScale(sitToStand, 13).severity).toBe('monitor');
    expect(scoreScale(sitToStand, 15).severity).toBe('monitor');
    expect(scoreScale(sitToStand, 16).severity).toBe('refer');
    expect(scoreScale(sitToStand, 40).severity).toBe('refer');
  });
  it('carries the elapsed value through as rawScore for the radar', () => {
    const r = scoreScale(sitToStand, 14);
    expect(r.rawScore).toBe(14);
    expect(r.maxScore).toBe(30);
    expect(r.bandLabel).toBe('略慢，建議追蹤');
  });
  it('returns incomplete when the task was not completed (null)', () => {
    expect(scoreScale(sitToStand, null).severity).toBe('incomplete');
  });
});

describe('elapsedSecondsToSeverity', () => {
  it('resolves seconds against second-based bands', () => {
    expect(elapsedSecondsToSeverity(sitToStand, 10)).toBe('normal');
    expect(elapsedSecondsToSeverity(sitToStand, 14)).toBe('monitor');
    expect(elapsedSecondsToSeverity(sitToStand, 20)).toBe('refer');
  });
  it('returns incomplete for null/NaN (could not complete)', () => {
    expect(elapsedSecondsToSeverity(sitToStand, null)).toBe('incomplete');
    expect(elapsedSecondsToSeverity(sitToStand, Number.NaN)).toBe('incomplete');
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
