import { describe, it, expect } from 'vitest';
import { CFS_LEVELS, CFS_LABELS, cfsFromScore, ageInMonths } from '$lib/utils/cfs-levels';

describe('cfs-levels', () => {
  it('has 9 levels cfs1..cfs9', () => {
    expect(CFS_LEVELS).toEqual(['cfs1','cfs2','cfs3','cfs4','cfs5','cfs6','cfs7','cfs8','cfs9']);
  });
  it('labels every level', () => {
    for (const l of CFS_LEVELS) expect(CFS_LABELS[l]).toBeTruthy();
  });
  it('cfsFromScore maps 1..9 and clamps', () => {
    expect(cfsFromScore(1)).toBe('cfs1');
    expect(cfsFromScore(9)).toBe('cfs9');
    expect(cfsFromScore(0)).toBe('cfs1');
    expect(cfsFromScore(99)).toBe('cfs9');
  });
  it('ageInMonths returns 0 for missing birthDate', () => {
    expect(ageInMonths(undefined)).toBe(0);
  });
});
