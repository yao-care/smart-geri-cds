/**
 * Content-index format test (CGA axis, Phase 1 minimal content).
 *
 * The pediatric "before" fixture and per-cell content locks no longer apply —
 * the migrated content-relevance.yaml ships EMPTY inapplicable/triggers/
 * clinicalAlertEducation (real CGA content is Plan 2). This test therefore
 * asserts STRUCTURAL + FORMAT correctness of whatever the build compiler emits:
 *   - recommendations keys (if any) match  <severity>::<top>.<sub>::cfs<1-9>
 *   - triggers keys (if any) match the cga.domain / cga.triage grammar
 *   - empty applicable cells are allowed (contributable, not a failure)
 *
 * Run:  pnpm vitest run tests/education/content-index-parity.test.ts
 */

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RuntimeIndex } from '$lib/education/schemas';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const REC_KEY = /^(normal|monitor|refer)::[a-z_]+\.[a-z_]+::cfs[1-9]$/;
const DOMAIN_TRIGGER = /^cga\.domain\.[a-z_]+\.[a-z_]+\.anomaly\.cfs[1-9]$/;
const TRIAGE_TRIGGER = /^cga\.triage\.(normal|monitor|refer)\.cfs[1-9]$/;

let neu: RuntimeIndex;

beforeAll(async () => {
  const mod = await import(path.join(ROOT, 'scripts/build-content-index.ts'));
  neu = await mod.buildContentIndex({ write: false });
}, 30_000);

describe('index shape', () => {
  it('exposes the expected top-level keys', () => {
    for (const k of ['catalog', 'triggers', 'educationSlugToTriggers', 'recommendations', 'clinicalEducation']) {
      expect(neu, `missing index key ${k}`).toHaveProperty(k);
    }
  });

  it('catalog is an object (video catalog is independent of the axis migration)', () => {
    expect(typeof neu.catalog).toBe('object');
  });
});

describe('recommendations key format (CGA axis)', () => {
  it('every recommendations key matches <severity>::<top>.<sub>::cfs<1-9>', () => {
    for (const key of Object.keys(neu.recommendations ?? {})) {
      expect(key, `malformed recommendations key: ${key}`).toMatch(REC_KEY);
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

  it('every recommendation slug resolves to an education markdown file (slug ↔ .md)', () => {
    const recs = neu.recommendations as Record<string, Array<{ slug?: string }>>;
    const slugs = new Set<string>();
    for (const items of Object.values(recs)) {
      for (const item of items) if (item.slug) slugs.add(item.slug);
    }
    for (const slug of slugs) {
      const candidates = [
        path.join(ROOT, 'src/data/education', `${slug}.md`),
        path.join(ROOT, 'src/data/education/milestones', `${slug}.md`),
      ];
      const found = candidates.some(p => fs.existsSync(p));
      expect(found, `recommendation slug "${slug}" has no markdown file`).toBe(true);
    }
  });
});

describe('triggers grammar (CGA axis)', () => {
  it('every trigger key matches cga.domain.* or cga.triage.* grammar', () => {
    const triggers = (neu.triggers ?? {}) as Record<
      string,
      { videoIds: string[]; inapplicable: boolean; educationSlug?: string }
    >;
    for (const key of Object.keys(triggers)) {
      const ok = DOMAIN_TRIGGER.test(key) || TRIAGE_TRIGGER.test(key);
      expect(ok, `malformed trigger key: ${key}`).toBe(true);
    }
  });

  it('present triggers carry a boolean inapplicable flag and an array of videoIds', () => {
    const triggers = (neu.triggers ?? {}) as Record<
      string,
      { videoIds: string[]; inapplicable: boolean }
    >;
    for (const [key, entry] of Object.entries(triggers)) {
      expect(typeof entry.inapplicable, `${key}: inapplicable not boolean`).toBe('boolean');
      expect(Array.isArray(entry.videoIds), `${key}: videoIds not array`).toBe(true);
    }
  });

  it('allows empty triggers (minimal Phase 1 content — cells are contributable)', () => {
    expect(typeof neu.triggers).toBe('object');
  });
});

describe('clinicalEducation', () => {
  it('exists and is an object (empty in Phase 2 — CDSS deferred)', () => {
    expect(neu.clinicalEducation).toBeDefined();
    expect(typeof neu.clinicalEducation).toBe('object');
  });
});
