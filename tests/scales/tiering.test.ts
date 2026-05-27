import { describe, it, expect } from 'vitest';
import { selectScreenScales, expandedFullScales } from '$lib/scales/tiering';
import type { ScaleDef, ScaleResult } from '$lib/scales/scale';

// --- Fixture ScaleDef objects ---

const cogScreen: ScaleDef = {
  id: 'cog-screen',
  domain: { top: 'psychological', sub: 'cognition' },
  tier: 'screen',
  expandsTo: 'spmsq',
  applicableCfs: ['cfs3', 'cfs4', 'cfs5'],
  scoring: 'sum',
  inputType: 'option',
  maxScore: 8,
  items: [],
  bands: [],
  clinicallyReviewed: false,
};

const spmsq: ScaleDef = {
  id: 'spmsq',
  domain: { top: 'psychological', sub: 'cognition' },
  tier: 'full',
  applicableCfs: ['cfs3', 'cfs4', 'cfs5'],
  scoring: 'error-count',
  inputType: 'option',
  maxScore: 10,
  items: [],
  bands: [],
  clinicallyReviewed: false,
};

const moodScreen: ScaleDef = {
  id: 'mood-screen',
  domain: { top: 'psychological', sub: 'mood' },
  tier: 'screen',
  expandsTo: 'gds-15',
  applicableCfs: ['cfs3', 'cfs4'],
  scoring: 'sum',
  inputType: 'option',
  maxScore: 2,
  items: [],
  bands: [],
  clinicallyReviewed: false,
};

const gds15: ScaleDef = {
  id: 'gds-15',
  domain: { top: 'psychological', sub: 'mood' },
  tier: 'full',
  applicableCfs: ['cfs3', 'cfs4'],
  scoring: 'sum',
  inputType: 'option',
  maxScore: 15,
  items: [],
  bands: [],
  clinicallyReviewed: false,
};

// Screen without expandsTo (no deep assessment)
const fallsScreen: ScaleDef = {
  id: 'falls-screen',
  domain: { top: 'functional', sub: 'falls' },
  tier: 'screen',
  applicableCfs: ['cfs3', 'cfs4', 'cfs5'],
  scoring: 'sum',
  inputType: 'option',
  maxScore: 3,
  items: [],
  bands: [],
  clinicallyReviewed: false,
};

const allDefs: ScaleDef[] = [cogScreen, spmsq, moodScreen, gds15, fallsScreen];

// --- selectScreenScales ---

describe('selectScreenScales', () => {
  it('returns only tier:screen scales applicable to the given CFS level', () => {
    const result = selectScreenScales(allDefs, 'cfs3');
    const ids = result.map(s => s.id);
    expect(ids).toContain('cog-screen');
    expect(ids).toContain('mood-screen');
    expect(ids).toContain('falls-screen');
    expect(ids).not.toContain('spmsq');
    expect(ids).not.toContain('gds-15');
  });

  it('filters by applicableCfs — cfs5 excludes mood-screen', () => {
    const result = selectScreenScales(allDefs, 'cfs5');
    const ids = result.map(s => s.id);
    expect(ids).toContain('cog-screen');
    expect(ids).toContain('falls-screen');
    expect(ids).not.toContain('mood-screen'); // mood-screen only covers cfs3,cfs4
  });

  it('returns empty when no screen scales match CFS level', () => {
    const result = selectScreenScales(allDefs, 'cfs1');
    expect(result).toHaveLength(0);
  });

  it('never returns full-tier scales', () => {
    const result = selectScreenScales(allDefs, 'cfs4');
    result.forEach(s => expect(s.tier).toBe('screen'));
  });
});

// --- expandedFullScales ---

describe('expandedFullScales', () => {
  it('expands full scales for flagged screens (severity=monitor)', () => {
    const screenResults: ScaleResult[] = [
      {
        scaleId: 'cog-screen',
        domain: { top: 'psychological', sub: 'cognition' },
        rawScore: 3,
        maxScore: 8,
        severity: 'monitor',
        bandLabel: '疑似認知問題',
      },
    ];
    const result = expandedFullScales(allDefs, screenResults);
    expect(result.map(s => s.id)).toContain('spmsq');
  });

  it('expands full scales for flagged screens (severity=refer)', () => {
    const screenResults: ScaleResult[] = [
      {
        scaleId: 'mood-screen',
        domain: { top: 'psychological', sub: 'mood' },
        rawScore: 2,
        maxScore: 2,
        severity: 'refer',
        bandLabel: '高度疑似憂鬱',
      },
    ];
    const result = expandedFullScales(allDefs, screenResults);
    expect(result.map(s => s.id)).toContain('gds-15');
  });

  it('does NOT expand when severity=normal', () => {
    const screenResults: ScaleResult[] = [
      {
        scaleId: 'cog-screen',
        domain: { top: 'psychological', sub: 'cognition' },
        rawScore: 0,
        maxScore: 8,
        severity: 'normal',
        bandLabel: '認知功能正常',
      },
    ];
    const result = expandedFullScales(allDefs, screenResults);
    expect(result).toHaveLength(0);
  });

  it('does NOT expand when severity=incomplete', () => {
    const screenResults: ScaleResult[] = [
      {
        scaleId: 'cog-screen',
        domain: { top: 'psychological', sub: 'cognition' },
        rawScore: null,
        maxScore: 8,
        severity: 'incomplete',
        bandLabel: '未完成',
      },
    ];
    const result = expandedFullScales(allDefs, screenResults);
    expect(result).toHaveLength(0);
  });

  it('silently skips when screen has no expandsTo', () => {
    const screenResults: ScaleResult[] = [
      {
        scaleId: 'falls-screen',
        domain: { top: 'functional', sub: 'falls' },
        rawScore: 2,
        maxScore: 3,
        severity: 'monitor',
        bandLabel: '跌倒風險',
      },
    ];
    const result = expandedFullScales(allDefs, screenResults);
    expect(result).toHaveLength(0);
  });

  it('expands multiple screens independently', () => {
    const screenResults: ScaleResult[] = [
      {
        scaleId: 'cog-screen',
        domain: { top: 'psychological', sub: 'cognition' },
        rawScore: 4,
        maxScore: 8,
        severity: 'refer',
        bandLabel: '明顯認知障礙',
      },
      {
        scaleId: 'mood-screen',
        domain: { top: 'psychological', sub: 'mood' },
        rawScore: 2,
        maxScore: 2,
        severity: 'refer',
        bandLabel: '高度疑似憂鬱',
      },
    ];
    const result = expandedFullScales(allDefs, screenResults);
    const ids = result.map(s => s.id);
    expect(ids).toContain('spmsq');
    expect(ids).toContain('gds-15');
    expect(result).toHaveLength(2);
  });
});
