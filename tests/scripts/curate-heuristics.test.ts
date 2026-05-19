import { describe, it, expect } from 'vitest';
import { computeScore, classifyVerdict, type ScoreInput } from '../../scripts/curate/lib/heuristics';

const base: ScoreInput = {
  channelTier: 'pro-kol',
  subtitleType: 'auto',
  medicalTermDensity: 0.05,
  viewCount: 1000,
  dangerKeywordHits: 0,
  publishedAt: '2025-01-01',
  duration: 300,
  minDuration: 60,
  maxDuration: 600,
  timeSensitive: false,
  todayIsoDate: '2026-05-19',
};

describe('computeScore', () => {
  it('official-tw + human subs gets high score', () => {
    expect(computeScore({ ...base, channelTier: 'official-tw', subtitleType: 'human' })).toBeGreaterThan(0.75);
  });

  it('clamps at [0, 1]', () => {
    const s = computeScore({ ...base, dangerKeywordHits: 10 });
    expect(s).toBe(0);
  });

  it('viewCountSignal caps at 0.10', () => {
    expect(computeScore({ ...base, viewCount: 1_000_000_000 })).toBeLessThan(
      computeScore({ ...base, viewCount: 1_000_000 }) + 0.05,
    );
  });

  it('age decay applies linear penalty 3-8 years', () => {
    const recent = computeScore({ ...base, publishedAt: '2025-01-01' });
    const aged = computeScore({ ...base, publishedAt: '2021-01-01' });
    expect(aged).toBeLessThan(recent);
  });

  it('hard reject when > 8y AND timeSensitive', () => {
    expect(computeScore({ ...base, publishedAt: '2017-01-01', timeSensitive: true })).toBe(0);
  });

  it('does not hard reject > 8y when not timeSensitive', () => {
    expect(computeScore({ ...base, publishedAt: '2017-01-01', timeSensitive: false })).toBeGreaterThan(0);
  });
});

describe('classifyVerdict', () => {
  it('auto-verified when score >= 0.80, no danger, human, white channel', () => {
    expect(classifyVerdict({ ...base, channelTier: 'official-tw', subtitleType: 'human' }, 0.85)).toBe('auto-verified');
  });

  it('auto-rejected when score < 0.30', () => {
    expect(classifyVerdict(base, 0.2)).toBe('auto-rejected');
  });

  it('auto-rejected when danger hits', () => {
    expect(classifyVerdict({ ...base, dangerKeywordHits: 1 }, 0.85)).toBe('auto-rejected');
  });

  it('needs-review for the rest', () => {
    expect(classifyVerdict(base, 0.6)).toBe('needs-review');
  });
});
