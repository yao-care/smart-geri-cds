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
// 4. recommendations — structural integrity (default.json removed; parity was
//    verified at migration time and is now enforced by content-relevance.yaml)
// ---------------------------------------------------------------------------
describe('recommendations', () => {
  it('exists and is a non-empty object', () => {
    expect(neu.recommendations).toBeDefined();
    expect(typeof neu.recommendations).toBe('object');
    expect(Object.keys(neu.recommendations).length).toBeGreaterThan(0);
  });

  it('all keys match pattern <severity>::<domain>::<ageGroup>', () => {
    for (const key of Object.keys(neu.recommendations)) {
      expect(key, `malformed recommendations key: ${key}`).toMatch(
        /^(normal|monitor|refer)::[a-z_]+::[0-9]+-[0-9]+m$/,
      );
    }
  });

  it('all recommendation items have source=internal and a slug', () => {
    const recs = neu.recommendations as Record<string, Array<{ source: string; slug?: string }>>;
    for (const [key, items] of Object.entries(recs)) {
      for (const item of items) {
        expect(item.source, `${key}: item missing source`).toBe('internal');
        expect(item.slug, `${key}: item missing slug`).toBeTruthy();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 5. recommendations — content lock for representative cells
//
// Snapshot locked from current video-index.json (2026-05-26).
// A regression swapping article slugs across cells would silently pass the
// structural tests above; this test catches that by fixing the ACTUAL slug
// sets for a representative cross-section of category × domain × ageGroup.
// Order-independent (Set comparison). Each item must also have a non-empty title.
// ---------------------------------------------------------------------------
describe('recommendations content lock — representative cells', () => {
  type RecItem = { slug: string; title: string; source: string; summary?: string };
  type Recs = Record<string, RecItem[]>;

  // Cells that MUST have specific slugs (came from default.json with explicit severities)
  const EXPECTED_SLUGS: Record<string, Set<string>> = {
    'monitor::gross_motor::13-24m': new Set(['exercise-guide', 'gross-motor-activities']),
    'refer::gross_motor::13-24m': new Set(['exercise-guide', 'gross-motor-activities', 'when-to-seek-help']),
    'monitor::cognition::13-24m': new Set(['cognitive-play']),
    'refer::social_emotional::13-24m': new Set(['social-emotional-guide', 'when-to-seek-help']),
  };

  // Cells that must be ABSENT or EMPTY — browse-only articles that were never
  // in default.json and must not leak into recommendations (parity fix).
  const EXPECTED_ABSENT: string[] = [
    'monitor::language::13-24m',
    'refer::language::13-24m',
  ];

  it('locked cells contain exactly the expected slug sets', () => {
    const recs = neu.recommendations as Recs;
    for (const [key, expectedSlugs] of Object.entries(EXPECTED_SLUGS)) {
      const items = recs[key];
      expect(items, `recommendations["${key}"] should exist`).toBeDefined();
      const actualSlugs = new Set(items.map((item) => item.slug));
      expect(actualSlugs, `recommendations["${key}"] slug set mismatch`).toEqual(expectedSlugs);
    }
  });

  it('browse-only language cells are absent from recommendations (parity with pre-refactor)', () => {
    const recs = neu.recommendations as Recs;
    for (const key of EXPECTED_ABSENT) {
      const items = recs[key];
      const isEmpty = items == null || items.length === 0;
      expect(
        isEmpty,
        `recommendations["${key}"] should be absent/empty (browse-only article must not leak), but got: ${JSON.stringify(items)}`,
      ).toBe(true);
    }
  });

  it('all items in locked cells have a non-empty title', () => {
    const recs = neu.recommendations as Recs;
    for (const key of Object.keys(EXPECTED_SLUGS)) {
      const items = recs[key] ?? [];
      for (const item of items) {
        expect(
          item.title,
          `recommendations["${key}"] item slug="${item.slug}" has empty title`,
        ).toBeTruthy();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 6. clinicalEducation exists
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
