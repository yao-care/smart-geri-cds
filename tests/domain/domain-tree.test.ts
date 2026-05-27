import { describe, it, expect } from 'vitest';
import { DOMAIN_TREE, DOMAIN_TOPS, isValidDomain, domainLabel } from '$lib/domain/domain-tree';
describe('domain-tree', () => {
  it('has 6 tops', () => expect(DOMAIN_TOPS.length).toBe(6));
  it('physical has 6 subs (incl. pain)', () => expect(DOMAIN_TREE.physical.length).toBe(6));
  it('physical includes pain', () => expect((DOMAIN_TREE.physical as readonly string[])).toContain('pain'));
  it('validates legal combos', () => {
    expect(isValidDomain('psychological','cognition')).toBe(true);
    expect(isValidDomain('psychological','adl')).toBe(false);
    expect(isValidDomain('physical','pain')).toBe(true);
    expect(isValidDomain('nope','x')).toBe(false);
  });
  it('labels top.sub', () => expect(domainLabel('psychological','cognition')).toContain('認知'));
  it('labels pain', () => expect(domainLabel('physical','pain')).toContain('疼痛'));
});
