import { describe, it, expect } from 'vitest';
import {
  selectTriageScales,
  selectAlwaysRunScreens,
  expandedScreenScales,
} from '../../src/lib/scales/tiering';
import type { ScaleDef, ScaleResult } from '../../src/lib/scales/scale';

const def = (over: Partial<ScaleDef>): ScaleDef => ({
  id: 'x', domain: { top: 'functional', sub: 'falls' }, tier: 'triage',
  applicableCfs: ['cfs5'], scoring: 'sum', inputType: 'option',
  maxScore: 1, items: [], bands: [], clinicallyReviewed: false, ...over,
});
const result = (scaleId: string, severity: ScaleResult['severity']): ScaleResult => ({
  scaleId, domain: { top: 'functional', sub: 'falls' }, rawScore: 0, maxScore: 1, severity, bandLabel: '',
});

describe('selectTriageScales', () => {
  it('returns only tier:triage scales applicable to the CFS level', () => {
    const all = [
      def({ id: 'falls-triage', tier: 'triage', applicableCfs: ['cfs2', 'cfs5'] }),
      def({ id: 'adl-triage', tier: 'triage', applicableCfs: ['cfs7'] }),
      def({ id: 'steadi-falls', tier: 'screen', applicableCfs: ['cfs5'] }),
    ];
    expect(selectTriageScales(all, 'cfs5').map(s => s.id)).toEqual(['falls-triage']);
  });
});

describe('selectAlwaysRunScreens', () => {
  it('returns tier:screen scales with alwaysRun applicable to the CFS level', () => {
    const all = [
      def({ id: '4at', tier: 'screen', alwaysRun: true, applicableCfs: ['cfs4', 'cfs5'] }),
      def({ id: 'mood-screen', tier: 'screen', applicableCfs: ['cfs5'] }),
      def({ id: '4at-other', tier: 'screen', alwaysRun: true, applicableCfs: ['cfs9'] }),
    ];
    expect(selectAlwaysRunScreens(all, 'cfs5').map(s => s.id)).toEqual(['4at']);
  });

  it('applies C-M2 cognition fallback: no informant → AD8 (cognition-screen) becomes mini-cog', () => {
    const all = [
      def({ id: 'cognition-screen', tier: 'screen', alwaysRun: true, requiresInformant: true,
        domain: { top: 'psychological', sub: 'cognition' }, applicableCfs: ['cfs5'] }),
      def({ id: 'mini-cog', tier: 'full', requiresPatient: true,
        domain: { top: 'psychological', sub: 'cognition' }, applicableCfs: ['cfs5'] }),
    ];
    expect(selectAlwaysRunScreens(all, 'cfs5', true).map(s => s.id)).toEqual(['cognition-screen']);
    expect(selectAlwaysRunScreens(all, 'cfs5', false).map(s => s.id)).toEqual(['mini-cog']);
  });
});

describe('expandedScreenScales (triage concern → screen)', () => {
  it('expands the screen a flagged triage points to via expandsTo', () => {
    const all = [
      def({ id: 'falls-triage', tier: 'triage', expandsTo: 'steadi-falls' }),
      def({ id: 'steadi-falls', tier: 'screen', expandsTo: 'sit-to-stand' }),
    ];
    expect(expandedScreenScales(all, [result('falls-triage', 'monitor')]).map(s => s.id)).toEqual(['steadi-falls']);
  });

  it('does NOT expand when the triage result is normal', () => {
    const all = [
      def({ id: 'falls-triage', tier: 'triage', expandsTo: 'steadi-falls' }),
      def({ id: 'steadi-falls', tier: 'screen' }),
    ];
    expect(expandedScreenScales(all, [result('falls-triage', 'normal')])).toHaveLength(0);
  });

  it('does NOT expand on incomplete (only monitor/refer flag)', () => {
    const all = [
      def({ id: 'falls-triage', tier: 'triage', expandsTo: 'steadi-falls' }),
      def({ id: 'steadi-falls', tier: 'screen' }),
    ];
    expect(expandedScreenScales(all, [result('falls-triage', 'incomplete')])).toHaveLength(0);
  });

  it('dedupes when two flagged sources expand to the same target (no each_key_duplicate)', () => {
    const all = [
      def({ id: 'a-triage', tier: 'triage', expandsTo: 'shared-screen' }),
      def({ id: 'b-triage', tier: 'triage', expandsTo: 'shared-screen' }),
      def({ id: 'shared-screen', tier: 'screen' }),
    ];
    const out = expandedScreenScales(all, [result('a-triage', 'monitor'), result('b-triage', 'monitor')]);
    expect(out.map(s => s.id)).toEqual(['shared-screen']);
  });
});
