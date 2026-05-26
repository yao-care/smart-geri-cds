/**
 * recommendations-age.test.ts
 *
 * Tests that recommendations.ts reads age-aware defaults from the unified
 * video-index.json and that tenant overlays (3-part key) still merge correctly.
 *
 * Uses fake-indexeddb (loaded via tests/setup.ts) and a vi.fn() fetch mock
 * to provide a minimal RuntimeIndex without hitting the network.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RuntimeIndex } from '$lib/education/schemas';

// ── Minimal RuntimeIndex fixture ──────────────────────────────────────────────

const MOCK_INDEX: RuntimeIndex = {
  catalog: {},
  triggers: {},
  educationSlugToTriggers: {},
  recommendations: {
    'monitor::gross_motor::13-24m': [
      { source: 'internal', slug: 'gross-motor-activities', title: '粗動作發展促進活動', summary: '適合各年齡層的粗動作訓練遊戲' },
      { source: 'internal', slug: 'exercise-guide', title: '兒童運動建議指南', summary: '各年齡層兒童適當運動量' },
    ],
    'refer::gross_motor::13-24m': [
      { source: 'internal', slug: 'gross-motor-activities', title: '粗動作發展促進活動', summary: '適合各年齡層的粗動作訓練遊戲' },
      { source: 'internal', slug: 'when-to-seek-help', title: '何時該尋求專業協助', summary: '兒童發展警訊與轉介建議' },
    ],
    'monitor::fine_motor::13-24m': [
      { source: 'internal', slug: 'fine-motor-activities', title: '精細動作發展促進活動', summary: '手部精細動作與手眼協調' },
    ],
    'monitor::gross_motor::25-36m': [
      { source: 'internal', slug: 'gross-motor-activities', title: '粗動作發展促進活動', summary: '適合各年齡層的粗動作訓練遊戲' },
    ],
  },
  clinicalEducation: {},
  articleSlugs: ['exercise-guide', 'gross-motor-activities', 'when-to-seek-help'],
};

// ── Fetch mock setup ──────────────────────────────────────────────────────────

// We need to reset the module-level cache in index-loader between tests.
// The easiest way is to reset modules so each import gets a fresh cache.

let getDefaultRecommendations: typeof import('$lib/db/recommendations').getDefaultRecommendations;
let mergeRecommendationsForContext: typeof import('$lib/db/recommendations').mergeRecommendationsForContext;
let saveOverlay: typeof import('$lib/db/recommendations').saveOverlay;
let mergeRecommendations: typeof import('$lib/db/recommendations').mergeRecommendations;

beforeEach(async () => {
  // Reset modules so the singleton indexPromise cache is cleared
  vi.resetModules();

  // Mock fetch to return our fixture
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(MOCK_INDEX),
  }));

  // Also stub import.meta.env.BASE_URL used in index-loader
  vi.stubEnv('BASE_URL', '/');

  // Re-import after reset
  const mod = await import('$lib/db/recommendations');
  getDefaultRecommendations = mod.getDefaultRecommendations;
  mergeRecommendationsForContext = mod.mergeRecommendationsForContext;
  saveOverlay = mod.saveOverlay;
  mergeRecommendations = mod.mergeRecommendations;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getDefaultRecommendations', () => {
  it('returns items for monitor::gross_motor::13-24m including gross-motor-activities with Chinese title', async () => {
    const items = await getDefaultRecommendations('monitor', 'gross_motor', '13-24m');
    expect(items.length).toBeGreaterThan(0);
    const gma = items.find(i => i.slug === 'gross-motor-activities');
    expect(gma).toBeDefined();
    expect(gma?.title).toBe('粗動作發展促進活動');
    expect(gma?.summary).toBeTruthy();
  });

  it('returns empty array for an age+category+domain with no recommendations', async () => {
    const items = await getDefaultRecommendations('normal', 'gross_motor', '13-24m');
    expect(items).toEqual([]);
  });

  it('returns different items for different age groups', async () => {
    const items13 = await getDefaultRecommendations('monitor', 'gross_motor', '13-24m');
    const items25 = await getDefaultRecommendations('monitor', 'gross_motor', '25-36m');
    // Both have gross-motor-activities but 13-24m also has exercise-guide
    expect(items13.length).toBeGreaterThan(items25.length);
  });
});

describe('mergeRecommendationsForContext', () => {
  it('deduplicates items across domains', async () => {
    // gross_motor and fine_motor both have items, gross_motor has gross-motor-activities + exercise-guide
    const items = await mergeRecommendationsForContext(
      'demo-tenant',
      'monitor',
      ['gross_motor', 'fine_motor'],
      '13-24m',
    );
    const slugs = items.map(i => i.slug);

    // Check gross-motor-activities appears only once
    const count = slugs.filter(s => s === 'gross-motor-activities').length;
    expect(count).toBe(1);

    // Should include items from both domains
    expect(slugs).toContain('gross-motor-activities');
    expect(slugs).toContain('fine-motor-activities');
  });

  it('returns empty array when no domains match', async () => {
    const items = await mergeRecommendationsForContext(
      'demo-tenant',
      'normal',
      ['gross_motor'],
      '13-24m',
    );
    expect(items).toEqual([]);
  });
});

describe('overlay merge (3-part key, age-independent)', () => {
  it('overlay saved with 3-part key overrides defaults when mergeWithDefault=false', async () => {
    const tenantId = 'test-tenant';
    const category = 'monitor' as const;
    const domain = 'gross_motor';
    const ageGroup = '13-24m' as const;

    // Save an overlay that replaces defaults
    await saveOverlay(tenantId, category, domain, [
      { source: 'external', url: 'https://example.com/custom', title: '自訂資源' },
    ], false);

    const items = await mergeRecommendations(tenantId, category, domain, ageGroup);
    expect(items.length).toBe(1);
    expect(items[0].source).toBe('external');
    expect((items[0] as { url?: string }).url).toBe('https://example.com/custom');
  });

  it('overlay with mergeWithDefault=true appends overlay items to defaults (deduped)', async () => {
    const tenantId = 'merge-tenant';
    const category = 'monitor' as const;
    const domain = 'gross_motor';
    const ageGroup = '13-24m' as const;

    await saveOverlay(tenantId, category, domain, [
      { source: 'internal', slug: 'when-to-seek-help', title: '何時該尋求專業協助' },
    ], true);

    const items = await mergeRecommendations(tenantId, category, domain, ageGroup);
    const slugs = items.map(i => (i as { slug?: string }).slug);

    // Should include default items + overlay item
    expect(slugs).toContain('gross-motor-activities');
    expect(slugs).toContain('when-to-seek-help');

    // No duplicates
    const unique = new Set(slugs.filter(Boolean));
    expect(unique.size).toBe(slugs.filter(Boolean).length);
  });
});
