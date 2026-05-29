import { describe, it, expect } from 'vitest';
import { groupDomainScores } from '../../src/lib/domain/group-domain-scores';
import type { DomainScore } from '../../src/engine/cdsa/radar-scoring';

const s = (domain: string, score: number, severity: DomainScore['severity'] = 'normal'): DomainScore =>
  ({ domain, score, severity });

describe('groupDomainScores', () => {
  it('groups by DOMAIN_TREE top and labels groups + sub-domains in Chinese', () => {
    const groups = groupDomainScores([
      s('functional.adl', 20, 'monitor'),
      s('psychological.cognition', 80),
      s('psychological.mood', 40),
    ]);
    // psychological comes before functional in DOMAIN_TREE order
    expect(groups.map(g => g.label)).toEqual(['心理/精神', '功能']);
    expect(groups[0].items.map(i => i.label)).toEqual(['認知', '情緒']);
    expect(groups[1].items[0].label).toBe('基本日常');
  });

  it('orders sub-domains within a group by DOMAIN_TREE order, not input order', () => {
    const groups = groupDomainScores([
      s('physical.pain', 10),       // index 5
      s('physical.comorbidity', 30), // index 0
    ]);
    expect(groups[0].items.map(i => i.sub)).toEqual(['comorbidity', 'pain']);
  });

  it('omits top groups that have no scores', () => {
    const groups = groupDomainScores([s('social.financial', 0)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].top).toBe('social');
  });

  it('carries score and severity through', () => {
    const [g] = groupDomainScores([s('psychological.mood', 0, 'incomplete')]);
    expect(g.items[0]).toMatchObject({ sub: 'mood', score: 0, severity: 'incomplete' });
  });

  it('returns [] for empty input', () => {
    expect(groupDomainScores([])).toEqual([]);
  });

  it('collapses multiple scores for one sub-domain to the most-severe (screen flagged → full)', () => {
    // computeDomainScores emits one row per scale result, so a flagged screen +
    // its expanded full scale arrive as two rows for the same top.sub.
    const groups = groupDomainScores([
      s('functional.adl', 90, 'normal'), // screen
      s('functional.adl', 40, 'refer'),  // expanded full — more severe
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toHaveLength(1);
    expect(groups[0].items[0]).toMatchObject({ sub: 'adl', score: 40, severity: 'refer' });
  });

  it('keeps a completed result over an incomplete one for the same sub-domain', () => {
    const groups = groupDomainScores([
      s('psychological.cognition', 0, 'incomplete'),
      s('psychological.cognition', 70, 'normal'),
    ]);
    expect(groups[0].items).toHaveLength(1);
    expect(groups[0].items[0]).toMatchObject({ severity: 'normal', score: 70 });
  });
});
