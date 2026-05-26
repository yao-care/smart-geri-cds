import { describe, it, expect } from 'vitest';
import expectedDomainsMap from '../../src/lib/data/expected-questionnaire-domains.generated.json';
import { CFS_LEVELS } from '../../src/lib/utils/cfs-levels';
import { DOMAIN_SUBS, isValidDomain } from '../../src/lib/domain/domain-tree';

/**
 * CGA axis coverage: the generated applicability map (build-questionnaire-
 * applicability.ts) is keyed by CFS level → applicable `top.sub` domain list.
 *
 * Phase 1 ships a MINIMAL content set (empty `inapplicable`), so every cell is
 * applicable/contributable. The real per-CFS scale curation + cutoffs are
 * Plan 2; this test therefore asserts STRUCTURAL correctness (valid keys, valid
 * domains, no garbage) rather than "≥ N questions per cell".
 */
describe('questionnaire applicability map (CGA axis)', () => {
  const map = expectedDomainsMap as Record<string, string[]>;

  it('is keyed by the nine CFS levels', () => {
    expect(Object.keys(map).sort()).toEqual([...CFS_LEVELS].sort());
  });

  it('every applicable domain is a valid two-level top.sub', () => {
    for (const [cfs, domains] of Object.entries(map)) {
      expect(CFS_LEVELS).toContain(cfs);
      for (const d of domains) {
        const [top, sub] = d.split('.');
        expect(isValidDomain(top, sub), `${cfs}: ${d} should be a valid domain`).toBe(true);
      }
    }
  });

  it('lists no domain outside the canonical DOMAIN_SUBS set', () => {
    const valid = new Set(DOMAIN_SUBS as string[]);
    for (const domains of Object.values(map)) {
      for (const d of domains) {
        const sub = d.split('.')[1];
        expect(valid.has(sub), `${d} sub should be in DOMAIN_SUBS`).toBe(true);
      }
    }
  });

  it('has no duplicate domains within a CFS column', () => {
    for (const [cfs, domains] of Object.entries(map)) {
      const dupes = domains.filter((d, i) => domains.indexOf(d) !== i);
      expect(dupes, `${cfs} should have no duplicate domains`).toEqual([]);
    }
  });
});
