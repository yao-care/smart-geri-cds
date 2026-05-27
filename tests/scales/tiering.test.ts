import { describe, it, expect } from 'vitest';
import { selectScreenScales, expandedFullScales, resolveCognitionScreen } from '$lib/scales/tiering';
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

// --- resolveCognitionScreen (C-M2 no-informant fallback) ---
//
// Real-id fixtures: AD8 screen requires an informant; when no informant is
// available (informantAvailable=false), cognition must instead use Mini-Cog
// (objective, requiresPatient). Both expand to SPMSQ.

const ad8Screen: ScaleDef = {
  id: 'cognition-screen',
  domain: { top: 'psychological', sub: 'cognition' },
  tier: 'screen',
  expandsTo: 'spmsq',
  applicableCfs: ['cfs1', 'cfs2', 'cfs3', 'cfs4', 'cfs5', 'cfs6', 'cfs7', 'cfs8'],
  scoring: 'sum',
  inputType: 'option',
  requiresInformant: true,
  maxScore: 8,
  items: [],
  bands: [],
  clinicallyReviewed: false,
};

const miniCog: ScaleDef = {
  id: 'mini-cog',
  domain: { top: 'psychological', sub: 'cognition' },
  tier: 'full',
  expandsTo: 'spmsq',
  applicableCfs: ['cfs1', 'cfs2', 'cfs3', 'cfs4', 'cfs5', 'cfs6', 'cfs7', 'cfs8'],
  scoring: 'sum',
  inputType: 'option',
  requiresPatient: true,
  maxScore: 5,
  items: [],
  bands: [],
  clinicallyReviewed: false,
};

const moodScreenReal: ScaleDef = {
  id: 'mood-screen',
  domain: { top: 'psychological', sub: 'mood' },
  tier: 'screen',
  expandsTo: 'gds-15',
  applicableCfs: ['cfs3', 'cfs4', 'cfs5'],
  scoring: 'sum',
  inputType: 'option',
  maxScore: 2,
  items: [],
  bands: [],
  clinicallyReviewed: false,
};

const cognitionAll: ScaleDef[] = [ad8Screen, miniCog, moodScreenReal, spmsq];

describe('resolveCognitionScreen', () => {
  it('keeps AD8 (cognition-screen) when an informant is available (informantAvailable=true)', () => {
    const screens = [ad8Screen, moodScreenReal];
    const out = resolveCognitionScreen(screens, true);
    const ids = out.map(s => s.id);
    expect(ids).toContain('cognition-screen');
    expect(ids).not.toContain('mini-cog');
    expect(ids).toContain('mood-screen');
  });

  it('replaces AD8 with Mini-Cog when no informant available (informantAvailable=false)', () => {
    const screens = [ad8Screen, moodScreenReal];
    const out = resolveCognitionScreen(screens, false, cognitionAll);
    const ids = out.map(s => s.id);
    expect(ids).not.toContain('cognition-screen');
    expect(ids).toContain('mini-cog');
    expect(ids).toContain('mood-screen');
  });

  it('substituted Mini-Cog still expandsTo spmsq', () => {
    const out = resolveCognitionScreen([ad8Screen], false, cognitionAll);
    const cog = out.find(s => s.domain.sub === 'cognition');
    expect(cog?.id).toBe('mini-cog');
    expect(cog?.expandsTo).toBe('spmsq');
  });

  it('leaves screens untouched when there is no cognition screen', () => {
    const out = resolveCognitionScreen([moodScreenReal], false, cognitionAll);
    expect(out.map(s => s.id)).toEqual(['mood-screen']);
  });
});

describe('selectScreenScales — informant-aware cognition fallback', () => {
  it('informantAvailable=true → cognition screen is AD8 (cognition-screen)', () => {
    const out = selectScreenScales(cognitionAll, 'cfs5', true);
    const cog = out.find(s => s.domain.sub === 'cognition');
    expect(cog?.id).toBe('cognition-screen');
  });

  it('informantAvailable=false → cognition screen is Mini-Cog', () => {
    const out = selectScreenScales(cognitionAll, 'cfs5', false);
    const cog = out.find(s => s.domain.sub === 'cognition');
    expect(cog?.id).toBe('mini-cog');
  });

  it('no informant flag passed → cognition screen unchanged (AD8)', () => {
    const out = selectScreenScales(cognitionAll, 'cfs5');
    const cog = out.find(s => s.domain.sub === 'cognition');
    expect(cog?.id).toBe('cognition-screen');
  });

  it('substituted Mini-Cog passes the applicableCfs filter (cfs5 in range)', () => {
    const out = selectScreenScales(cognitionAll, 'cfs5', false);
    expect(out.map(s => s.id)).toContain('mini-cog');
  });
});
