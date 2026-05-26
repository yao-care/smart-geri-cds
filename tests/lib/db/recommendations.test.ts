/**
 * recommendations.test.ts
 *
 * Tests the recommendations DAO overlay CRUD and merge logic on the CGA axis.
 * Defaults come from the unified video-index.json (cfs-aware);
 * overlays remain 3-part key (tenant::category::top.sub, cfs-independent).
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { RuntimeIndex } from '../../../src/lib/education/schemas';
import { db, type RecommendationItem } from '../../../src/lib/db/schema';

// ── Minimal index fixture for overlay merge tests ─────────────────────────────
// Key shape: `${severity}::${top.sub}::${cfsLevel}`.

const TEST_INDEX: RuntimeIndex = {
  catalog: {},
  triggers: {},
  educationSlugToTriggers: {},
  recommendations: {
    'monitor::functional.mobility::cfs5': [
      { source: 'internal', slug: 'mobility-activities', title: '行動訓練活動', summary: '步態與平衡練習' },
      { source: 'internal', slug: 'exercise-guide', title: '長者運動建議指南', summary: '適當運動量' },
    ],
    'monitor::functional.adl::cfs5': [
      { source: 'internal', slug: 'adl-support', title: '基本日常活動支持', summary: '自我照護輔助' },
    ],
    'monitor::psychological.cognition::cfs5': [
      { source: 'internal', slug: 'cognition-care', title: '認知促進技巧', summary: '認知活動' },
    ],
    'monitor::psychological.mood::cfs5': [
      { source: 'internal', slug: 'cognition-care', title: '認知促進技巧', summary: '情緒與認知' },
    ],
    'refer::functional.mobility::cfs5': [
      { source: 'internal', slug: 'mobility-activities', title: '行動訓練活動', summary: '步態與平衡訓練' },
      { source: 'internal', slug: 'when-to-seek-help', title: '何時該尋求專業協助', summary: '功能退化警訊' },
    ],
  },
  clinicalEducation: {},
  articleSlugs: ['adl-support', 'cognition-care', 'exercise-guide', 'mobility-activities', 'when-to-seek-help'],
};

// ── Module setup ──────────────────────────────────────────────────────────────

let getDefaultRecommendations: typeof import('../../../src/lib/db/recommendations').getDefaultRecommendations;
let getOverlay: typeof import('../../../src/lib/db/recommendations').getOverlay;
let saveOverlay: typeof import('../../../src/lib/db/recommendations').saveOverlay;
let clearOverlay: typeof import('../../../src/lib/db/recommendations').clearOverlay;
let getAllOverlays: typeof import('../../../src/lib/db/recommendations').getAllOverlays;
let mergeRecommendations: typeof import('../../../src/lib/db/recommendations').mergeRecommendations;
let mergeRecommendationsForContext: typeof import('../../../src/lib/db/recommendations').mergeRecommendationsForContext;
let DOMAINS: typeof import('../../../src/lib/db/recommendations').DOMAINS;
let CATEGORIES: typeof import('../../../src/lib/db/recommendations').CATEGORIES;

beforeEach(async () => {
  vi.resetModules();

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(TEST_INDEX),
  }));

  await db.recommendationOverlays.clear();

  const mod = await import('../../../src/lib/db/recommendations');
  getDefaultRecommendations = mod.getDefaultRecommendations;
  getOverlay = mod.getOverlay;
  saveOverlay = mod.saveOverlay;
  clearOverlay = mod.clearOverlay;
  getAllOverlays = mod.getAllOverlays;
  mergeRecommendations = mod.mergeRecommendations;
  mergeRecommendationsForContext = mod.mergeRecommendationsForContext;
  DOMAINS = mod.DOMAINS;
  CATEGORIES = mod.CATEGORIES;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('recommendations DAO + merge (CGA two-level × cfs)', () => {
  const TENANT_A = 'tenant-a';
  const TENANT_B = 'tenant-b';

  describe('DOMAINS and CATEGORIES constants', () => {
    it('exposes the full two-level domain set (top.sub keys)', () => {
      // 19 sub-domains across 6 top domains (domain-tree single source).
      expect(DOMAINS.length).toBe(19);
      expect(DOMAINS).toContain('functional.mobility');
      expect(DOMAINS).toContain('psychological.cognition');
      expect(DOMAINS).toContain('future_wishes.advance_care_planning');
      // No old pediatric domain names.
      expect(DOMAINS).not.toContain('gross_motor');
      expect(DOMAINS).not.toContain('language_comprehension');
      // Every entry is a `top.sub` key.
      for (const d of DOMAINS) expect(d).toMatch(/^[a-z_]+\.[a-z_]+$/);
    });

    it('CATEGORIES is normal/monitor/refer (severity enum, no incomplete)', () => {
      expect(CATEGORIES).toEqual(['normal', 'monitor', 'refer']);
    });
  });

  describe('getDefaultRecommendations (async, cfs-aware)', () => {
    it('returns items from index for monitor::functional.mobility::cfs5', async () => {
      const items = await getDefaultRecommendations('monitor', 'functional.mobility', 'cfs5');
      expect(items.length).toBe(2);
      expect(items.some(i => i.slug === 'mobility-activities')).toBe(true);
    });

    it('returns empty array for an unmatched key', async () => {
      const items = await getDefaultRecommendations('normal', 'functional.mobility', 'cfs5');
      expect(items).toEqual([]);
    });
  });

  describe('overlay CRUD (3-part key, top.sub domain)', () => {
    it('returns null when no overlay exists', async () => {
      expect(await getOverlay(TENANT_A, 'monitor', 'functional.mobility')).toBeNull();
    });

    it('saves and reads an overlay', async () => {
      const items: RecommendationItem[] = [{ source: 'external', url: 'https://example.com', title: 'X' }];
      await saveOverlay(TENANT_A, 'monitor', 'functional.mobility', items, false);
      const out = await getOverlay(TENANT_A, 'monitor', 'functional.mobility');
      expect(out).not.toBeNull();
      expect(out?.items[0]?.url).toBe('https://example.com');
      expect(out?.mergeWithDefault).toBe(false);
    });

    it('upserts on the same composite key', async () => {
      await saveOverlay(TENANT_A, 'monitor', 'functional.mobility', [{ source: 'internal', slug: 'a' }], true);
      await saveOverlay(TENANT_A, 'monitor', 'functional.mobility', [{ source: 'internal', slug: 'b' }], false);
      const out = await getOverlay(TENANT_A, 'monitor', 'functional.mobility');
      expect(out?.items.length).toBe(1);
      expect(out?.items[0]?.slug).toBe('b');
      expect(out?.mergeWithDefault).toBe(false);
    });

    it('isolates overlays per tenant', async () => {
      await saveOverlay(TENANT_A, 'monitor', 'functional.mobility', [{ source: 'internal', slug: 'a' }], true);
      await saveOverlay(TENANT_B, 'monitor', 'functional.mobility', [{ source: 'internal', slug: 'b' }], true);
      const a = await getOverlay(TENANT_A, 'monitor', 'functional.mobility');
      const b = await getOverlay(TENANT_B, 'monitor', 'functional.mobility');
      expect(a?.items[0]?.slug).toBe('a');
      expect(b?.items[0]?.slug).toBe('b');
    });

    it('clearOverlay deletes the row', async () => {
      await saveOverlay(TENANT_A, 'monitor', 'functional.mobility', [{ source: 'internal', slug: 'a' }], true);
      await clearOverlay(TENANT_A, 'monitor', 'functional.mobility');
      expect(await getOverlay(TENANT_A, 'monitor', 'functional.mobility')).toBeNull();
    });

    it('getAllOverlays returns only the tenant rows', async () => {
      await saveOverlay(TENANT_A, 'monitor', 'functional.mobility', [], true);
      await saveOverlay(TENANT_A, 'refer', 'psychological.cognition', [], true);
      await saveOverlay(TENANT_B, 'monitor', 'functional.mobility', [], true);
      const list = await getAllOverlays(TENANT_A);
      expect(list).toHaveLength(2);
    });
  });

  describe('mergeRecommendations (requires cfsLevel)', () => {
    it('returns defaults when no overlay exists', async () => {
      const out = await mergeRecommendations(TENANT_A, 'monitor', 'functional.mobility', 'cfs5');
      const defaults = await getDefaultRecommendations('monitor', 'functional.mobility', 'cfs5');
      expect(out).toEqual(defaults);
    });

    it('replaces default when mergeWithDefault=false', async () => {
      await saveOverlay(
        TENANT_A,
        'monitor',
        'functional.mobility',
        [{ source: 'external', url: 'https://only.example.com' }],
        false,
      );
      const out = await mergeRecommendations(TENANT_A, 'monitor', 'functional.mobility', 'cfs5');
      expect(out).toHaveLength(1);
      expect(out[0]?.url).toBe('https://only.example.com');
    });

    it('appends to default when mergeWithDefault=true (deduped)', async () => {
      const defaults = await getDefaultRecommendations('monitor', 'functional.mobility', 'cfs5');
      await saveOverlay(
        TENANT_A,
        'monitor',
        'functional.mobility',
        [{ source: 'external', url: 'https://extra.example.com', title: '額外' }],
        true,
      );
      const out = await mergeRecommendations(TENANT_A, 'monitor', 'functional.mobility', 'cfs5');
      expect(out.length).toBe(defaults.length + 1);
      expect(out[out.length - 1]?.url).toBe('https://extra.example.com');
    });

    it('dedups overlay items already present in defaults', async () => {
      const defaults = await getDefaultRecommendations('monitor', 'functional.mobility', 'cfs5');
      const defaultSlug = defaults[0]?.slug;
      await saveOverlay(
        TENANT_A,
        'monitor',
        'functional.mobility',
        [{ source: 'internal', slug: defaultSlug! }],
        true,
      );
      const out = await mergeRecommendations(TENANT_A, 'monitor', 'functional.mobility', 'cfs5');
      const matches = out.filter((i) => i.slug === defaultSlug);
      expect(matches.length).toBe(1);
    });
  });

  describe('mergeRecommendationsForContext (per-domain severity)', () => {
    it('dedups items across domains queried at their own severity', async () => {
      // cognition-care is the default for both psychological.cognition and psychological.mood.
      const out = await mergeRecommendationsForContext(
        TENANT_A,
        [
          { domain: 'psychological.cognition', severity: 'monitor' },
          { domain: 'psychological.mood', severity: 'monitor' },
        ],
        'cfs5',
      );
      const hits = out.filter((i) => i.slug === 'cognition-care');
      expect(hits.length).toBe(1);
    });

    it('excludes incomplete domains', async () => {
      const out = await mergeRecommendationsForContext(
        TENANT_A,
        [
          { domain: 'functional.mobility', severity: 'incomplete' },
          { domain: 'functional.adl', severity: 'monitor' },
        ],
        'cfs5',
      );
      const slugs = out.map((i) => i.slug);
      expect(slugs).not.toContain('mobility-activities');
      expect(slugs).toContain('adl-support');
    });

    it('returns empty when perDomain is empty', async () => {
      expect(await mergeRecommendationsForContext(TENANT_A, [], 'cfs5')).toEqual([]);
    });

    it('respects overlay replacement on one domain only', async () => {
      await saveOverlay(
        TENANT_A,
        'monitor',
        'functional.mobility',
        [{ source: 'external', url: 'https://override.example.com' }],
        false,
      );
      const out = await mergeRecommendationsForContext(
        TENANT_A,
        [
          { domain: 'functional.mobility', severity: 'monitor' },
          { domain: 'functional.adl', severity: 'monitor' },
        ],
        'cfs5',
      );
      // functional.mobility should only have the override (no mobility-activities etc.)
      expect(out.some((i) => i.slug === 'mobility-activities')).toBe(false);
      expect(out.some((i) => i.url === 'https://override.example.com')).toBe(true);
      // functional.adl should still have its default
      expect(out.some((i) => i.slug === 'adl-support')).toBe(true);
    });
  });
});
