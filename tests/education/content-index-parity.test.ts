/**
 * Parity test: build-content-index must produce a strict superset of the
 * pre-refactor video-index.json (the "before" fixture).
 *
 * Run:  pnpm test --run tests/education/content-index-parity.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import type { RuntimeIndex } from '$lib/education/schemas';

// Dynamically import build script (avoids import.meta.url side-effect at top-level)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let neu: RuntimeIndex;
let before: RuntimeIndex;
let defaultJson: {
  matrix: Record<string, Record<string, Array<{ source: string; slug?: string }>>>;
};

beforeAll(async () => {
  // Import the new build script (must export buildContentIndex)
  const mod = await import(path.join(ROOT, 'scripts/build-content-index.ts'));
  neu = await mod.buildContentIndex({ write: false });

  before = JSON.parse(
    await fs.readFile(
      path.join(ROOT, 'tests/education/fixtures/video-index.before.json'),
      'utf8',
    ),
  ) as RuntimeIndex;

  defaultJson = JSON.parse(
    await fs.readFile(
      path.join(ROOT, 'src/data/recommendations/default.json'),
      'utf8',
    ),
  );
}, 30_000);

// ---------------------------------------------------------------------------
// 1. catalog — exact match
// ---------------------------------------------------------------------------
describe('catalog', () => {
  it('matches before exactly', () => {
    expect(neu.catalog).toEqual(before.catalog);
  });
});

// ---------------------------------------------------------------------------
// 2. educationSlugToTriggers — set-exact match (keys identical, arrays same set)
//
// The before fixture was produced by insertion order (YAML file order), but the
// new build iterates content-relevance.triggers which is sorted alphabetically.
// Consumer code treats these arrays as sets; we therefore sort both sides before
// comparing to avoid false failures on permutation-only differences.
// ---------------------------------------------------------------------------
describe('educationSlugToTriggers', () => {
  it('has the same set of slug keys', () => {
    expect(new Set(Object.keys(neu.educationSlugToTriggers))).toEqual(
      new Set(Object.keys(before.educationSlugToTriggers)),
    );
  });

  it('each slug maps to the same set of triggers', () => {
    const beforeE = before.educationSlugToTriggers as Record<string, string[]>;
    const neuE = neu.educationSlugToTriggers as Record<string, string[]>;
    for (const slug of Object.keys(beforeE)) {
      expect(
        new Set(neuE[slug] ?? []),
        `educationSlugToTriggers["${slug}"] trigger set mismatch`,
      ).toEqual(new Set(beforeE[slug]));
    }
  });
});

// ---------------------------------------------------------------------------
// 3. triggers — behavioral equivalence (not byte-exact)
// ---------------------------------------------------------------------------
describe('triggers', () => {
  it('every before trigger has matching inapplicable flag and videoId set', () => {
    const beforeTriggers = before.triggers as Record<
      string,
      { videoIds: string[]; inapplicable: boolean; educationSlug?: string }
    >;
    const neuTriggers = (neu.triggers ?? {}) as typeof beforeTriggers;

    for (const [k, b] of Object.entries(beforeTriggers)) {
      const n = neuTriggers[k] ?? { videoIds: [], inapplicable: false };
      expect(n.inapplicable, `trigger ${k}: inapplicable mismatch`).toBe(b.inapplicable);
      expect(new Set(n.videoIds), `trigger ${k}: videoIds mismatch`).toEqual(
        new Set(b.videoIds),
      );
    }
  });

  it('no new non-empty applicable trigger appears in neu that was absent in before', () => {
    const beforeTriggers = before.triggers as Record<
      string,
      { videoIds: string[]; inapplicable: boolean }
    >;
    const neuTriggers = (neu.triggers ?? {}) as typeof beforeTriggers;

    for (const [k, n] of Object.entries(neuTriggers)) {
      if (k in beforeTriggers) continue;
      // New keys only allowed if empty-applicable
      expect(
        n.inapplicable || n.videoIds.length === 0,
        `new trigger ${k} appears with non-empty videos — not allowed`,
      ).toBe(true);
      expect(
        n.inapplicable,
        `new trigger ${k} must not be inapplicable (absent from before, so it was applicable but empty)`,
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. recommendations covers default.json (non-diet, non-normal domains)
// ---------------------------------------------------------------------------
describe('recommendations', () => {
  // Normalize domain names from default.json abbreviated forms
  const normalizeDomain = (d: string): string => {
    if (d === 'language_comp') return 'language_comprehension';
    if (d === 'language_expr') return 'language_expression';
    return d;
  };

  // Age groups used in CDSA domain triggers
  const CDSA_AGES = ['2-6m', '7-12m', '13-24m', '25-36m', '37-48m', '49-60m', '61-72m'];

  it('exists and is a non-empty object', () => {
    expect(neu.recommendations).toBeDefined();
    expect(typeof neu.recommendations).toBe('object');
    expect(Object.keys(neu.recommendations).length).toBeGreaterThan(0);
  });

  it('every non-diet slug in default.json appears in recommendations for at least one age', () => {
    const recs = neu.recommendations as Record<string, Array<{ source: string; slug?: string }>>;

    for (const [category, domains] of Object.entries(defaultJson.matrix)) {
      for (const [rawDomain, items] of Object.entries(domains)) {
        if (rawDomain === 'diet') continue; // diet excluded per spec

        const domain = normalizeDomain(rawDomain);

        for (const item of items) {
          if (!item.slug) continue;

          // There must be at least one age A where recommendations[`${category}::${domain}::${A}`]
          // contains an item with this slug
          const foundAge = CDSA_AGES.some(age => {
            const key = `${category}::${domain}::${age}`;
            const list = recs[key];
            return Array.isArray(list) && list.some(r => r.slug === item.slug);
          });

          expect(
            foundAge,
            `slug "${item.slug}" for ${category}::${domain} not found in any recommendations[${category}::${domain}::*]`,
          ).toBe(true);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. clinicalEducation exists
// ---------------------------------------------------------------------------
describe('clinicalEducation', () => {
  it('exists and is an object', () => {
    expect(neu.clinicalEducation).toBeDefined();
    expect(typeof neu.clinicalEducation).toBe('object');
  });
});

// ---------------------------------------------------------------------------
// 6. matrix educationSlug per cdsa.domain cell — exact parity lock
// ---------------------------------------------------------------------------
describe('matrix educationSlug parity', () => {
  it('matrix educationSlug per cdsa.domain cell matches before (exact)', () => {
    const beforeTriggers = before.triggers as Record<
      string,
      { videoIds: string[]; inapplicable: boolean; educationSlug?: string }
    >;
    const neuTriggers = (neu.triggers ?? {}) as typeof beforeTriggers;

    for (const [k, b] of Object.entries(beforeTriggers)) {
      if (!k.startsWith('cdsa.domain.')) continue;
      const n = neuTriggers[k] ?? {};
      expect((n as { educationSlug?: string }).educationSlug ?? null, k).toBe(
        (b as { educationSlug?: string }).educationSlug ?? null,
      );
    }
    // no NEW cdsa.domain cell may introduce an educationSlug absent before
    for (const [k, n] of Object.entries(neuTriggers)) {
      if (!k.startsWith('cdsa.domain.')) continue;
      if (!(k in beforeTriggers) && (n as { educationSlug?: string }).educationSlug != null) {
        throw new Error(`new cell ${k} introduced educationSlug ${(n as { educationSlug?: string }).educationSlug}`);
      }
    }
  });
});
