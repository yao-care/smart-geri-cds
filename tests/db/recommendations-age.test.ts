/**
 * recommendations-age.test.ts
 *
 * Tests that recommendations.ts reads CFS-aware defaults from the unified
 * video-index.json and that tenant overlays (3-part key, cfs-independent) still
 * merge correctly. Per-domain severity merge excludes `incomplete`.
 *
 * Uses fake-indexeddb (loaded via tests/setup.ts) and a vi.fn() fetch mock
 * to provide a minimal RuntimeIndex without hitting the network.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RuntimeIndex } from '$lib/education/schemas';

// ── Minimal RuntimeIndex fixture ──────────────────────────────────────────────
// Key shape: `${severity}::${top.sub}::${cfsLevel}`.

const MOCK_INDEX: RuntimeIndex = {
  catalog: {},
  triggers: {},
  educationSlugToTriggers: {},
  recommendations: {
    'monitor::functional.mobility::cfs5': [
      { source: 'internal', slug: 'mobility-activities', title: '行動訓練活動', summary: '步態與平衡練習' },
      { source: 'internal', slug: 'exercise-guide', title: '長者運動建議指南', summary: '適當運動量' },
    ],
    'refer::functional.mobility::cfs5': [
      { source: 'internal', slug: 'mobility-activities', title: '行動訓練活動', summary: '步態與平衡練習' },
      { source: 'internal', slug: 'when-to-seek-help', title: '何時該尋求專業協助', summary: '功能退化警訊與轉介' },
    ],
    'monitor::functional.adl::cfs5': [
      { source: 'internal', slug: 'adl-support', title: '基本日常活動支持', summary: '自我照護輔助' },
    ],
    'monitor::functional.mobility::cfs6': [
      { source: 'internal', slug: 'mobility-activities', title: '行動訓練活動', summary: '步態與平衡練習' },
    ],
  },
  clinicalEducation: {},
  articleSlugs: ['adl-support', 'exercise-guide', 'mobility-activities', 'when-to-seek-help'],
};

// ── Fetch mock setup ──────────────────────────────────────────────────────────

let getDefaultRecommendations: typeof import('$lib/db/recommendations').getDefaultRecommendations;
let mergeRecommendationsForContext: typeof import('$lib/db/recommendations').mergeRecommendationsForContext;
let saveOverlay: typeof import('$lib/db/recommendations').saveOverlay;
let mergeRecommendations: typeof import('$lib/db/recommendations').mergeRecommendations;

beforeEach(async () => {
  vi.resetModules();

  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(MOCK_INDEX),
  }));

  vi.stubEnv('BASE_URL', '/');

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
  it('returns items for monitor::functional.mobility::cfs5 with Chinese title', async () => {
    const items = await getDefaultRecommendations('monitor', 'functional.mobility', 'cfs5');
    expect(items.length).toBeGreaterThan(0);
    const m = items.find(i => i.slug === 'mobility-activities');
    expect(m).toBeDefined();
    expect(m?.title).toBe('行動訓練活動');
    expect(m?.summary).toBeTruthy();
  });

  it('returns empty array for a cfs+severity+domain with no recommendations', async () => {
    const items = await getDefaultRecommendations('normal', 'functional.mobility', 'cfs5');
    expect(items).toEqual([]);
  });

  it('returns different items for different CFS levels', async () => {
    const cfs5 = await getDefaultRecommendations('monitor', 'functional.mobility', 'cfs5');
    const cfs6 = await getDefaultRecommendations('monitor', 'functional.mobility', 'cfs6');
    // cfs5 has mobility-activities + exercise-guide; cfs6 only mobility-activities
    expect(cfs5.length).toBeGreaterThan(cfs6.length);
  });
});

describe('mergeRecommendationsForContext (per-domain severity × cfs)', () => {
  it('queries each domain at its own severity and dedups across domains', async () => {
    const items = await mergeRecommendationsForContext(
      'demo-tenant',
      [
        { domain: 'functional.mobility', severity: 'monitor' },
        { domain: 'functional.adl', severity: 'monitor' },
      ],
      'cfs5',
    );
    const slugs = items.map(i => i.slug);

    // mobility-activities appears once
    expect(slugs.filter(s => s === 'mobility-activities').length).toBe(1);
    // items from both domains present
    expect(slugs).toContain('mobility-activities');
    expect(slugs).toContain('adl-support');
  });

  it('excludes incomplete domains from the query', async () => {
    const items = await mergeRecommendationsForContext(
      'demo-tenant',
      [
        { domain: 'functional.mobility', severity: 'incomplete' },
        { domain: 'functional.adl', severity: 'monitor' },
      ],
      'cfs5',
    );
    const slugs = items.map(i => i.slug);
    expect(slugs).not.toContain('mobility-activities');
    expect(slugs).toContain('adl-support');
  });

  it('respects per-domain severity (refer vs monitor pull different lists)', async () => {
    const items = await mergeRecommendationsForContext(
      'demo-tenant',
      [{ domain: 'functional.mobility', severity: 'refer' }],
      'cfs5',
    );
    const slugs = items.map(i => i.slug);
    expect(slugs).toContain('when-to-seek-help');
    expect(slugs).not.toContain('exercise-guide');
  });

  it('returns empty array when perDomain is empty', async () => {
    const items = await mergeRecommendationsForContext('demo-tenant', [], 'cfs5');
    expect(items).toEqual([]);
  });
});

describe('overlay merge (3-part key, cfs-independent)', () => {
  it('overlay saved with 3-part key overrides defaults when mergeWithDefault=false', async () => {
    const tenantId = 'test-tenant';
    const category = 'monitor' as const;
    const domain = 'functional.mobility';
    const cfsLevel = 'cfs5' as const;

    await saveOverlay(tenantId, category, domain, [
      { source: 'external', url: 'https://example.com/custom', title: '自訂資源' },
    ], false);

    const items = await mergeRecommendations(tenantId, category, domain, cfsLevel);
    expect(items.length).toBe(1);
    expect(items[0].source).toBe('external');
    expect((items[0] as { url?: string }).url).toBe('https://example.com/custom');
  });

  it('overlay with mergeWithDefault=true appends overlay items to defaults (deduped)', async () => {
    const tenantId = 'merge-tenant';
    const category = 'monitor' as const;
    const domain = 'functional.mobility';
    const cfsLevel = 'cfs5' as const;

    await saveOverlay(tenantId, category, domain, [
      { source: 'internal', slug: 'when-to-seek-help', title: '何時該尋求專業協助' },
    ], true);

    const items = await mergeRecommendations(tenantId, category, domain, cfsLevel);
    const slugs = items.map(i => (i as { slug?: string }).slug);

    expect(slugs).toContain('mobility-activities');
    expect(slugs).toContain('when-to-seek-help');

    const unique = new Set(slugs.filter(Boolean));
    expect(unique.size).toBe(slugs.filter(Boolean).length);
  });
});
