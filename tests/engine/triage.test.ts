import { describe, it, expect } from 'vitest';
import { computeTriage, type TriageInput } from '../../src/engine/cdsa/triage';
import type { ScaleResult } from '../../src/lib/scales/scale';

function mkResult(overrides: Partial<ScaleResult> = {}): ScaleResult {
  return {
    scaleId: 'gds-15',
    domain: { top: 'psychological', sub: 'mood' },
    rawScore: 2,
    maxScore: 15,
    severity: 'normal',
    bandLabel: '無憂鬱徵兆',
    ...overrides,
  };
}

describe('computeTriage (per-scale, worst-severity)', () => {
  it('category = normal when every scale is normal', () => {
    const result = computeTriage({
      cfsLevel: 'cfs5',
      scaleResults: [
        mkResult({ severity: 'normal' }),
        mkResult({ scaleId: 'barthel', domain: { top: 'functional', sub: 'adl' }, severity: 'normal' }),
      ],
    });
    expect(result.category).toBe('normal');
    expect(result.details).toHaveLength(2);
  });

  it('category = monitor when worst scale is monitor', () => {
    const result = computeTriage({
      cfsLevel: 'cfs5',
      scaleResults: [
        mkResult({ severity: 'normal' }),
        mkResult({ scaleId: 'gds-15-b', severity: 'monitor', bandLabel: '疑似憂鬱' }),
      ],
    });
    expect(result.category).toBe('monitor');
  });

  it('category = refer when any scale is refer (takes worst across domains)', () => {
    const result = computeTriage({
      cfsLevel: 'cfs6',
      scaleResults: [
        mkResult({ severity: 'monitor' }),
        mkResult({ scaleId: 'spmsq', domain: { top: 'psychological', sub: 'cognition' }, severity: 'refer' }),
        mkResult({ scaleId: 'barthel', domain: { top: 'functional', sub: 'adl' }, severity: 'normal' }),
      ],
    });
    expect(result.category).toBe('refer');
  });

  it('incomplete scales do not affect aggregation', () => {
    const result = computeTriage({
      cfsLevel: 'cfs5',
      scaleResults: [
        mkResult({ severity: 'normal' }),
        mkResult({ scaleId: 'cam', domain: { top: 'psychological', sub: 'delirium' }, severity: 'incomplete', rawScore: null }),
      ],
    });
    expect(result.category).toBe('normal');
    expect(result.details).toHaveLength(2);
  });

  it('category = incomplete when all scales are incomplete', () => {
    const result = computeTriage({
      cfsLevel: 'cfs5',
      scaleResults: [
        mkResult({ severity: 'incomplete', rawScore: null }),
        mkResult({ scaleId: 'cam', severity: 'incomplete', rawScore: null }),
      ],
    });
    expect(result.category).toBe('incomplete');
  });

  it('category = incomplete when there are no scale results', () => {
    const result = computeTriage({ cfsLevel: 'cfs5', scaleResults: [] });
    expect(result.category).toBe('incomplete');
    expect(result.details).toHaveLength(0);
  });

  it('details preserve the ScaleResult shape (no z-score fields)', () => {
    const result = computeTriage({
      cfsLevel: 'cfs5',
      scaleResults: [mkResult({ rawScore: 7, severity: 'monitor', bandLabel: '疑似憂鬱' })],
    });
    const d = result.details[0];
    expect(d.scaleId).toBe('gds-15');
    expect(d.domain).toEqual({ top: 'psychological', sub: 'mood' });
    expect(d.rawScore).toBe(7);
    expect(d.maxScore).toBe(15);
    expect(d.severity).toBe('monitor');
    expect(d).not.toHaveProperty('zScore');
    expect(d).not.toHaveProperty('directionalZ');
  });

  it('summary mentions the abnormal domains in Chinese labels', () => {
    const result = computeTriage({
      cfsLevel: 'cfs6',
      scaleResults: [
        mkResult({ severity: 'refer' }), // psychological.mood → 情緒
        mkResult({ scaleId: 'barthel', domain: { top: 'functional', sub: 'adl' }, severity: 'normal' }),
      ],
    });
    expect(result.summary).toContain('情緒');
  });
});
