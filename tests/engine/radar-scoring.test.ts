import { describe, it, expect } from 'vitest';
import { computeDomainScores, type DomainScore } from '../../src/engine/cdsa/radar-scoring';
import type { TriageResult } from '../../src/engine/cdsa/triage';
import type { ScaleResult } from '../../src/lib/scales/scale';

function mkScale(overrides: Partial<ScaleResult> = {}): ScaleResult {
  return {
    scaleId: 'gds-15',
    domain: { top: 'psychological', sub: 'mood' },
    rawScore: 4,
    maxScore: 15,
    severity: 'normal',
    bandLabel: '無憂鬱徵兆',
    ...overrides,
  };
}

function mkResult(details: ScaleResult[]): TriageResult {
  return { category: 'normal', summary: '', details };
}

describe('computeDomainScores (raw/maxScore, no z/hybrid)', () => {
  it('returns empty for null triageResult', () => {
    expect(computeDomainScores(null)).toEqual([]);
  });

  it('score = round(100 * rawScore / maxScore) per top.sub', () => {
    const scores = computeDomainScores(mkResult([
      mkScale({ domain: { top: 'psychological', sub: 'mood' }, rawScore: 9, maxScore: 15 }), // 60
      mkScale({ domain: { top: 'functional', sub: 'adl' }, rawScore: 20, maxScore: 100, scaleId: 'barthel' }), // 20
    ]));
    expect(scores.find(s => s.domain === 'psychological.mood')?.score).toBe(60);
    expect(scores.find(s => s.domain === 'functional.adl')?.score).toBe(20);
  });

  it('carries the scale severity through to the DomainScore', () => {
    const scores = computeDomainScores(mkResult([
      mkScale({ domain: { top: 'psychological', sub: 'cognition' }, severity: 'refer', rawScore: 12, maxScore: 15, scaleId: 'spmsq' }),
    ]));
    const s = scores.find(d => d.domain === 'psychological.cognition');
    expect(s?.severity).toBe('refer');
  });

  it('incomplete scale → score 0 and severity incomplete', () => {
    const scores = computeDomainScores(mkResult([
      mkScale({ domain: { top: 'psychological', sub: 'delirium' }, severity: 'incomplete', rawScore: null, scaleId: 'cam' }),
    ]));
    const s = scores.find(d => d.domain === 'psychological.delirium');
    expect(s?.score).toBe(0);
    expect(s?.severity).toBe('incomplete');
  });

  it('DomainScore has no z-score / hybrid fields', () => {
    const scores: DomainScore[] = computeDomainScores(mkResult([mkScale()]));
    const s = scores[0];
    expect(s).not.toHaveProperty('isHybrid');
    expect(s).not.toHaveProperty('hasAnomaly');
    expect(Object.keys(s).sort()).toEqual(['domain', 'score', 'severity']);
  });
});
