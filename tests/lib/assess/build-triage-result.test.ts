import { describe, it, expect } from 'vitest';
import { buildScaleResults, buildTriageResult } from '../../../src/lib/assess/build-triage-result';
import type { ScaleDef, ScaleResult } from '../../../src/lib/scales/scale';
import type { PartialAnalysis } from '../../../src/lib/db/schema';

const gds: ScaleDef = {
  id: 'gds-15',
  domain: { top: 'psychological', sub: 'mood' },
  tier: 'screen',
  applicableCfs: ['cfs5'],
  scoring: 'sum',
  inputType: 'option',
  maxScore: 15,
  items: [],
  bands: [
    { max: 4, severity: 'normal', label: '無憂鬱徵兆' },
    { min: 5, max: 9, severity: 'monitor', label: '疑似憂鬱' },
    { min: 10, severity: 'refer', label: '高度疑似' },
  ],
  clinicallyReviewed: false,
};

const adl: ScaleDef = {
  id: 'adl-triage',
  domain: { top: 'functional', sub: 'adl' },
  tier: 'triage',
  applicableCfs: ['cfs5'],
  scoring: 'sum',
  inputType: 'option',
  maxScore: 1,
  items: [],
  bands: [
    { max: 0, severity: 'normal', label: '可獨立' },
    { min: 1, severity: 'monitor', label: '需協助' },
  ],
  clinicallyReviewed: false,
};

describe('buildScaleResults', () => {
  it('returns [] when cfsLevel is null', () => {
    const partial: PartialAnalysis = { questionnaireScores: { 'gds-15': 7 } };
    expect(buildScaleResults([gds], partial, null)).toEqual([]);
  });

  it('re-scores a raw questionnaire score when no precomputed result exists', () => {
    const partial: PartialAnalysis = { questionnaireScores: { 'gds-15': 7 } };
    const out = buildScaleResults([gds], partial, 'cfs5');
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('monitor');
  });

  it('prefers a precomputed scaleResult over re-scoring raw', () => {
    const precomputed: ScaleResult = {
      scaleId: 'gds-15', domain: gds.domain, rawScore: null, maxScore: 15,
      severity: 'incomplete', bandLabel: '無知情者，無法取得',
    };
    const partial: PartialAnalysis = {
      questionnaireScores: { 'gds-15': 7 },
      scaleResults: { 'gds-15': precomputed },
    };
    const out = buildScaleResults([gds], partial, 'cfs5');
    expect(out).toHaveLength(1);
    expect(out[0].severity).toBe('incomplete');
  });

  it('skips scales with neither a precomputed nor a raw score (never ran)', () => {
    const partial: PartialAnalysis = { questionnaireScores: { 'adl-triage': 0 } };
    const out = buildScaleResults([gds, adl], partial, 'cfs5');
    expect(out.map(r => r.scaleId)).toEqual(['adl-triage']);
  });
});

describe('buildTriageResult', () => {
  it('returns null when cfsLevel is null', () => {
    expect(buildTriageResult([gds], { questionnaireScores: { 'gds-15': 7 } }, null)).toBeNull();
  });

  it('produces an overall category = worst across scored scales', () => {
    const partial: PartialAnalysis = {
      questionnaireScores: { 'gds-15': 7, 'adl-triage': 0 },
    };
    const result = buildTriageResult([gds, adl], partial, 'cfs5');
    expect(result).not.toBeNull();
    expect(result!.category).toBe('monitor');
    expect(result!.details).toHaveLength(2);
  });

  it('produces normal when every scored scale is normal (all-answered, no flags)', () => {
    const partial: PartialAnalysis = {
      questionnaireScores: { 'gds-15': 2, 'adl-triage': 0 },
    };
    const result = buildTriageResult([gds, adl], partial, 'cfs5');
    expect(result!.category).toBe('normal');
  });
});
