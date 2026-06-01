import { describe, it, expect } from 'vitest';
import {
  videoCatalogItemSchema, triggerEntrySchema,
  cgaTriageEntrySchema, cgaDomainEntrySchema,
  contentRelevanceSchema,
} from '../../../src/lib/education/schemas';

const validVideo = {
  videoId: 'abc123XYZ45',
  title: '範例衛教',
  channel: '台大老醫',
  channelId: 'UC' + 'a'.repeat(22),
  duration: 245,
  publishedAt: '2024-03-15',
  language: 'zh-Hant' as const,
  subtitleType: 'human' as const,
  sourceTier: 'official-tw' as const,
  viewCount: 12500,
  curatedAt: '2026-05-19',
  verifiedBy: 'claude-code' as const,
  verificationStatus: 'verified' as const,
  score: 0.92,
};

describe('videoCatalogItemSchema', () => {
  it('accepts a valid catalog item', () => {
    expect(videoCatalogItemSchema.parse(validVideo)).toBeDefined();
  });

  it('rejects invalid videoId regex (10 chars)', () => {
    expect(() => videoCatalogItemSchema.parse({ ...validVideo, videoId: 'abc123XYZ4' })).toThrow();
  });

  it('rejects score > 1', () => {
    expect(() => videoCatalogItemSchema.parse({ ...validVideo, score: 1.5 })).toThrow();
  });

  it('strips unknown extra fields (zod v4 default)', () => {
    const parsed = videoCatalogItemSchema.parse({ ...validVideo, foo: 'bar' });
    expect('foo' in parsed).toBe(false);
  });
});

describe('cgaDomainEntrySchema (two-level domain × cfs)', () => {
  it('accepts a legal top/sub combo with matching trigger', () => {
    expect(triggerEntrySchema.parse({
      trigger: 'cga.domain.psychological.cognition.anomaly.cfs5',
      category: 'domain',
      top: 'psychological',
      sub: 'cognition',
      cfsLevel: 'cfs5',
      videoIds: ['abc123XYZ45'],
    })).toBeDefined();
  });

  it('rejects an illegal top/sub combo', () => {
    // adl belongs to functional, not psychological
    expect(() => cgaDomainEntrySchema.parse({
      trigger: 'cga.domain.psychological.adl.anomaly.cfs5',
      category: 'domain',
      top: 'psychological',
      sub: 'adl',
      cfsLevel: 'cfs5',
      videoIds: [],
    })).toThrow();
  });

  it('rejects an unknown top', () => {
    expect(() => cgaDomainEntrySchema.parse({
      trigger: 'cga.domain.nope.cognition.anomaly.cfs5',
      category: 'domain',
      top: 'nope',
      sub: 'cognition',
      cfsLevel: 'cfs5',
      videoIds: [],
    })).toThrow();
  });

  it('rejects trigger string ≠ top.sub.cfs fields', () => {
    expect(() => cgaDomainEntrySchema.parse({
      trigger: 'cga.domain.psychological.cognition.anomaly.cfs4',
      category: 'domain',
      top: 'psychological',
      sub: 'cognition',
      cfsLevel: 'cfs5',
      videoIds: [],
    })).toThrow();
  });

  it('accepts cga.domain with inapplicable: true', () => {
    expect(triggerEntrySchema.parse({
      trigger: 'cga.domain.functional.adl.anomaly.cfs2',
      category: 'domain',
      top: 'functional',
      sub: 'adl',
      cfsLevel: 'cfs2',
      inapplicable: true,
      videoIds: [],
    })).toBeDefined();
  });
});

describe('cgaTriageEntrySchema (cfs)', () => {
  it('accepts a valid cga.triage entry', () => {
    expect(triggerEntrySchema.parse({
      trigger: 'cga.triage.refer.cfs5',
      category: 'triage',
      triageCategory: 'refer',
      cfsLevel: 'cfs5',
      videoIds: ['abc123XYZ45'],
    })).toBeDefined();
  });

  it('rejects cross-field mismatch (trigger ≠ category + cfs)', () => {
    expect(() => cgaTriageEntrySchema.parse({
      trigger: 'cga.triage.refer.cfs6',
      category: 'triage',
      triageCategory: 'refer',
      cfsLevel: 'cfs5',
      videoIds: [],
    })).toThrow();
  });

  it('rejects unknown cfs level', () => {
    expect(() => cgaTriageEntrySchema.parse({
      trigger: 'cga.triage.monitor.cfs99',
      category: 'triage',
      triageCategory: 'monitor',
      cfsLevel: 'cfs99',
      videoIds: [],
    })).toThrow();
  });

  it('rejects videoIds with invalid regex', () => {
    expect(() => cgaTriageEntrySchema.parse({
      trigger: 'cga.triage.monitor.cfs5',
      category: 'triage',
      triageCategory: 'monitor',
      cfsLevel: 'cfs5',
      videoIds: ['SHORT'],
    })).toThrow();
  });
});

describe('contentRelevanceSchema.inapplicable (top.sub → cfs[])', () => {
  it('accepts a legal top.sub key with cfs array', () => {
    expect(contentRelevanceSchema.parse({
      inapplicable: { 'psychological.cognition': ['cfs1', 'cfs2'] },
      triggers: [],
    })).toBeDefined();
  });

  it('rejects an illegal top.sub key', () => {
    expect(() => contentRelevanceSchema.parse({
      inapplicable: { 'psychological.adl': ['cfs1'] },
      triggers: [],
    })).toThrow();
  });

  it('rejects a non-cfs value', () => {
    expect(() => contentRelevanceSchema.parse({
      inapplicable: { 'functional.adl': ['2-6m'] },
      triggers: [],
    })).toThrow();
  });
});
