/**
 * recommendations.test.ts
 *
 * Tests the recommendations DAO overlay CRUD and merge logic.
 * Defaults now come from the unified video-index.json (age-aware);
 * overlays remain 3-part key (tenant::category::domain).
 *
 * This test uses the global fetch mock from tests/setup.ts which returns
 * a minimal index with a couple of monitor::gross_motor items.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { RuntimeIndex } from '../../../src/lib/education/schemas';
import { db, type RecommendationItem } from '../../../src/lib/db/schema';

// ── Minimal index fixture for overlay merge tests ─────────────────────────────

const TEST_INDEX: RuntimeIndex = {
  catalog: {},
  triggers: {},
  educationSlugToTriggers: {},
  recommendations: {
    'monitor::gross_motor::13-24m': [
      { source: 'internal', slug: 'gross-motor-activities', title: '粗動作發展促進活動', summary: '適合各年齡層的粗動作訓練遊戲' },
      { source: 'internal', slug: 'exercise-guide', title: '兒童運動建議指南', summary: '各年齡層兒童適當運動量' },
    ],
    'monitor::fine_motor::13-24m': [
      { source: 'internal', slug: 'fine-motor-activities', title: '精細動作發展促進活動', summary: '手部精細動作' },
    ],
    'monitor::language_comprehension::13-24m': [
      { source: 'internal', slug: 'language-stimulation', title: '語言發展促進技巧', summary: '語言理解' },
    ],
    'monitor::language_expression::13-24m': [
      { source: 'internal', slug: 'language-stimulation', title: '語言發展促進技巧', summary: '語言表達' },
    ],
    'refer::gross_motor::13-24m': [
      { source: 'internal', slug: 'gross-motor-activities', title: '粗動作發展促進活動', summary: '各年齡層粗動作訓練' },
      { source: 'internal', slug: 'when-to-seek-help', title: '何時該尋求專業協助', summary: '發展警訊' },
    ],
  },
  clinicalEducation: {},
  articleSlugs: ['exercise-guide', 'fine-motor-activities', 'gross-motor-activities', 'language-stimulation', 'when-to-seek-help'],
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
  // Reset module cache so index-loader singleton is cleared
  vi.resetModules();

  // Stub fetch to return the test fixture
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

describe('recommendations DAO + merge', () => {
  const TENANT_A = 'tenant-a';
  const TENANT_B = 'tenant-b';

  describe('DOMAINS and CATEGORIES constants', () => {
    it('exposes 8 CDSA domains (no diet, updated canonical names)', () => {
      expect(DOMAINS.length).toBe(8);
      // Should include canonical CDSA names
      expect(DOMAINS).toContain('gross_motor');
      expect(DOMAINS).toContain('language_comprehension');
      expect(DOMAINS).toContain('language_expression');
      // Should NOT include old abbreviated names or diet
      expect(DOMAINS).not.toContain('language_comp');
      expect(DOMAINS).not.toContain('language_expr');
      expect(DOMAINS).not.toContain('diet');
    });

    it('CATEGORIES is normal/monitor/refer', () => {
      expect(CATEGORIES).toEqual(['normal', 'monitor', 'refer']);
    });
  });

  describe('getDefaultRecommendations (async, age-aware)', () => {
    it('returns items from index for monitor::gross_motor::13-24m', async () => {
      const items = await getDefaultRecommendations('monitor', 'gross_motor', '13-24m');
      expect(items.length).toBe(2);
      expect(items.some(i => i.slug === 'gross-motor-activities')).toBe(true);
    });

    it('returns empty array for an unmatched key', async () => {
      const items = await getDefaultRecommendations('normal', 'gross_motor', '13-24m');
      expect(items).toEqual([]);
    });
  });

  describe('overlay CRUD', () => {
    it('returns null when no overlay exists', async () => {
      expect(await getOverlay(TENANT_A, 'monitor', 'gross_motor')).toBeNull();
    });

    it('saves and reads an overlay', async () => {
      const items: RecommendationItem[] = [{ source: 'external', url: 'https://example.com', title: 'X' }];
      await saveOverlay(TENANT_A, 'monitor', 'gross_motor', items, false);
      const out = await getOverlay(TENANT_A, 'monitor', 'gross_motor');
      expect(out).not.toBeNull();
      expect(out?.items[0]?.url).toBe('https://example.com');
      expect(out?.mergeWithDefault).toBe(false);
    });

    it('upserts on the same composite key', async () => {
      await saveOverlay(TENANT_A, 'monitor', 'gross_motor', [{ source: 'internal', slug: 'a' }], true);
      await saveOverlay(TENANT_A, 'monitor', 'gross_motor', [{ source: 'internal', slug: 'b' }], false);
      const out = await getOverlay(TENANT_A, 'monitor', 'gross_motor');
      expect(out?.items.length).toBe(1);
      expect(out?.items[0]?.slug).toBe('b');
      expect(out?.mergeWithDefault).toBe(false);
    });

    it('isolates overlays per tenant', async () => {
      await saveOverlay(TENANT_A, 'monitor', 'gross_motor', [{ source: 'internal', slug: 'a' }], true);
      await saveOverlay(TENANT_B, 'monitor', 'gross_motor', [{ source: 'internal', slug: 'b' }], true);
      const a = await getOverlay(TENANT_A, 'monitor', 'gross_motor');
      const b = await getOverlay(TENANT_B, 'monitor', 'gross_motor');
      expect(a?.items[0]?.slug).toBe('a');
      expect(b?.items[0]?.slug).toBe('b');
    });

    it('clearOverlay deletes the row', async () => {
      await saveOverlay(TENANT_A, 'monitor', 'gross_motor', [{ source: 'internal', slug: 'a' }], true);
      await clearOverlay(TENANT_A, 'monitor', 'gross_motor');
      expect(await getOverlay(TENANT_A, 'monitor', 'gross_motor')).toBeNull();
    });

    it('getAllOverlays returns only the tenant rows', async () => {
      await saveOverlay(TENANT_A, 'monitor', 'gross_motor', [], true);
      await saveOverlay(TENANT_A, 'refer', 'cognition', [], true);
      await saveOverlay(TENANT_B, 'monitor', 'gross_motor', [], true);
      const list = await getAllOverlays(TENANT_A);
      expect(list).toHaveLength(2);
    });
  });

  describe('mergeRecommendations (now requires ageGroup)', () => {
    it('returns defaults when no overlay exists', async () => {
      const out = await mergeRecommendations(TENANT_A, 'monitor', 'gross_motor', '13-24m');
      const defaults = await getDefaultRecommendations('monitor', 'gross_motor', '13-24m');
      expect(out).toEqual(defaults);
    });

    it('replaces default when mergeWithDefault=false', async () => {
      await saveOverlay(
        TENANT_A,
        'monitor',
        'gross_motor',
        [{ source: 'external', url: 'https://only.example.com' }],
        false,
      );
      const out = await mergeRecommendations(TENANT_A, 'monitor', 'gross_motor', '13-24m');
      expect(out).toHaveLength(1);
      expect(out[0]?.url).toBe('https://only.example.com');
    });

    it('appends to default when mergeWithDefault=true (deduped)', async () => {
      const defaults = await getDefaultRecommendations('monitor', 'gross_motor', '13-24m');
      await saveOverlay(
        TENANT_A,
        'monitor',
        'gross_motor',
        [{ source: 'external', url: 'https://extra.example.com', title: '額外' }],
        true,
      );
      const out = await mergeRecommendations(TENANT_A, 'monitor', 'gross_motor', '13-24m');
      expect(out.length).toBe(defaults.length + 1);
      expect(out[out.length - 1]?.url).toBe('https://extra.example.com');
    });

    it('dedups overlay items already present in defaults', async () => {
      const defaults = await getDefaultRecommendations('monitor', 'gross_motor', '13-24m');
      const defaultSlug = defaults[0]?.slug;
      await saveOverlay(
        TENANT_A,
        'monitor',
        'gross_motor',
        [{ source: 'internal', slug: defaultSlug! }],
        true,
      );
      const out = await mergeRecommendations(TENANT_A, 'monitor', 'gross_motor', '13-24m');
      const matches = out.filter((i) => i.slug === defaultSlug);
      expect(matches.length).toBe(1);
    });
  });

  describe('mergeRecommendationsForContext (replaces mergeRecommendationsForDomains)', () => {
    it('dedups items across domains', async () => {
      // language-stimulation is the default for both language_comprehension and language_expression
      const out = await mergeRecommendationsForContext(
        TENANT_A,
        'monitor',
        ['language_comprehension', 'language_expression'],
        '13-24m',
      );
      const langStim = out.filter((i) => i.slug === 'language-stimulation');
      expect(langStim.length).toBe(1);
    });

    it('returns empty when domains is empty', async () => {
      expect(await mergeRecommendationsForContext(TENANT_A, 'monitor', [], '13-24m')).toEqual([]);
    });

    it('respects overlay replacement on one domain only', async () => {
      await saveOverlay(
        TENANT_A,
        'monitor',
        'gross_motor',
        [{ source: 'external', url: 'https://override.example.com' }],
        false,
      );
      const out = await mergeRecommendationsForContext(
        TENANT_A,
        'monitor',
        ['gross_motor', 'fine_motor'],
        '13-24m',
      );
      // gross_motor should only have the override (no gross-motor-activities etc.)
      const hasGrossMotorDefault = out.some((i) => i.slug === 'gross-motor-activities');
      const hasOverride = out.some((i) => i.url === 'https://override.example.com');
      expect(hasGrossMotorDefault).toBe(false);
      expect(hasOverride).toBe(true);
      // fine_motor should still have its default
      const hasFineMotorDefault = out.some((i) => i.slug === 'fine-motor-activities');
      expect(hasFineMotorDefault).toBe(true);
    });
  });
});
