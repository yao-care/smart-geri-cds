#!/usr/bin/env tsx
/**
 * build-content-index.ts
 *
 * Reads the single source of truth src/data/education/content-relevance.yaml
 * plus src/data/video-catalog/*.yaml and produces public/data/video-index.json.
 *
 * The output is a strict superset of the pre-refactor video-index.json:
 * it adds `recommendations` and `clinicalEducation` keys while keeping
 * `catalog`, `triggers`, and `educationSlugToTriggers` behaviorally equivalent.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import fg from 'fast-glob';
import { z } from 'astro/zod';
import {
  videoCatalogItemSchema,
  contentRelevanceSchema,
  runtimeIndexSchema,
  CDSA_DOMAIN_NAMES,
  type VideoCatalogItem,
  type RuntimeIndex,
} from '../src/lib/education/schemas.js';

// ---------------------------------------------------------------------------
// Frontmatter helper — reads title/summary from education markdown files
// ---------------------------------------------------------------------------

/** Cache: slug → { title, summary } */
const frontmatterCache = new Map<string, { title?: string; summary?: string }>();

async function readFrontmatter(
  slug: string,
  cwd: string,
): Promise<{ title?: string; summary?: string }> {
  if (frontmatterCache.has(slug)) return frontmatterCache.get(slug)!;

  const candidates = [
    path.join(cwd, 'src/data/education', `${slug}.md`),
    path.join(cwd, 'src/data/education/milestones', `${slug}.md`),
  ];

  for (const filePath of candidates) {
    let raw: string;
    try {
      raw = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }

    // Parse --- frontmatter ---
    const match = raw.match(/^---\n([\s\S]*?)\n---/);
    if (!match) break;

    let parsed: Record<string, unknown>;
    try {
      parsed = yaml.load(match[1]) as Record<string, unknown>;
    } catch {
      break;
    }

    const result = {
      title: typeof parsed.title === 'string' ? parsed.title : undefined,
      summary: typeof parsed.summary === 'string' ? parsed.summary : undefined,
    };
    frontmatterCache.set(slug, result);
    return result;
  }

  frontmatterCache.set(slug, {});
  return {};
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sortObjectDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map(k => [k, sortObjectDeep((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface BuildOptions {
  /** If false, skip writing to disk and just return the index object. Default: true */
  write?: boolean;
  cwd?: string;
}

export async function buildContentIndex(opts: BuildOptions = {}): Promise<RuntimeIndex> {
  const write = opts.write ?? true;
  const cwd = opts.cwd ?? process.cwd();
  const resolve = (rel: string) => path.join(cwd, rel);

  // ── 1. Load content-relevance.yaml ────────────────────────────────────────

  const crRaw = yaml.load(
    await fs.readFile(resolve('src/data/education/content-relevance.yaml'), 'utf8'),
  );
  const contentRelevance = contentRelevanceSchema.parse(crRaw);

  // ── 2. Load video catalog ─────────────────────────────────────────────────

  const catalogFiles = await fg('src/data/video-catalog/*.yaml', { cwd });
  const fullCatalog: Record<string, VideoCatalogItem> = {};
  for (const rel of catalogFiles.sort()) {
    const arr = yaml.load(await fs.readFile(resolve(rel), 'utf8'));
    const validated = z.array(videoCatalogItemSchema).parse(arr ?? []);
    for (const v of validated) {
      if (fullCatalog[v.videoId]) throw new Error(`Duplicate videoId: ${v.videoId} in ${rel}`);
      fullCatalog[v.videoId] = v;
    }
  }

  // Verified-only catalog (slim shape)
  const verifiedCatalog: Record<string, VideoCatalogItem> = Object.fromEntries(
    Object.entries(fullCatalog).filter(([, v]) => v.verificationStatus === 'verified'),
  );

  const runtimeCatalog = Object.fromEntries(
    Object.entries(verifiedCatalog).map(([id, v]) => [
      id,
      {
        videoId: v.videoId,
        title: v.title,
        channel: v.channel,
        duration: v.duration,
        language: v.language,
        sourceTier: v.sourceTier,
        score: v.score,
      },
    ]),
  );

  // ── 3. Build inapplicable trigger set ─────────────────────────────────────
  //
  // content-relevance.yaml inapplicable section:
  //   Record<domain, ageCDSA[]>
  // Expand to Set<trigger string> e.g. "cdsa.domain.behavior.anomaly.2-6m"

  const inapplicableTriggerSet = new Set<string>();
  for (const [domain, ages] of Object.entries(contentRelevance.inapplicable)) {
    for (const age of ages) {
      inapplicableTriggerSet.add(`cdsa.domain.${domain}.anomaly.${age}`);
    }
  }

  // ── 4. Build triggers map ─────────────────────────────────────────────────
  //
  // Shape: Record<trigger, {videoIds, inapplicable, educationSlug?}>
  //
  // Sources:
  //   a) inapplicable section → emit {videoIds:[], inapplicable:true}
  //   b) content-relevance.triggers → emit applicable entries with verified-filtered videoIds

  const triggers: Record<
    string,
    { videoIds: string[]; inapplicable: boolean; educationSlug?: string }
  > = {};

  // (a) Inapplicable cells
  for (const triggerKey of inapplicableTriggerSet) {
    triggers[triggerKey] = { videoIds: [], inapplicable: true };
  }

  // (b) Applicable entries from content-relevance.triggers
  for (const entry of contentRelevance.triggers) {
    if (inapplicableTriggerSet.has(entry.trigger)) {
      // Should not happen if yaml is consistent, but guard anyway
      continue;
    }
    const verifiedVideoIds = entry.videoIds.filter(id => verifiedCatalog[id] != null);
    // Use the article marked browse:true as the matrix/browse educationSlug.
    // Fall back to first article only for non-cdsa.domain triggers (triage/cdss)
    // which never have browse markers but may still have an educationSlug.
    const browseArticle = entry.articles.find(a => a.browse === true);
    const educationSlugSource = browseArticle
      ? browseArticle.slug
      : (entry.trigger.startsWith('cdsa.domain.') ? undefined : entry.articles[0]?.slug);
    triggers[entry.trigger] = {
      videoIds: verifiedVideoIds,
      inapplicable: false,
      ...(educationSlugSource ? { educationSlug: educationSlugSource } : {}),
    };
  }

  // ── 5. educationSlugToTriggers ────────────────────────────────────────────
  //
  // Rule (mirrors old build):
  //   - Only cdsa.domain.* triggers
  //   - Not inapplicable
  //   - Has educationSlug
  //   - Has ≥1 verified video
  //
  // NOTE: The old build also included cdss.* and cdsa.triage.* triggers in
  // educationSlugToTriggers if they had ≥1 verified video. We replicate
  // the same logic without restricting to cdsa.domain.* only.

  const educationSlugToTriggers: Record<string, string[]> = {};
  for (const [k, t] of Object.entries(triggers)) {
    if (t.educationSlug && !t.inapplicable && t.videoIds.length > 0) {
      (educationSlugToTriggers[t.educationSlug] ??= []).push(k);
    }
  }

  // ── 6. recommendations ────────────────────────────────────────────────────
  //
  // Key: `${severity}::${domain}::${age}`
  // Value: Array<{source:'internal', slug, title?, summary?}>
  //
  // Derived from content-relevance.triggers for cdsa.domain.* entries only.
  // Each article with an EXPLICIT, non-empty severities array → push slug into
  // recommendations[`${sev}::${domain}::${age}`] for each listed severity.
  //
  // Articles with NO severities (browse-only / matrix-only) are intentionally
  // skipped — they must NOT appear in recommendations. No default fallback.
  // title/summary are read from src/data/education/<slug>.md frontmatter.

  const recommendations: Record<
    string,
    Array<{ source: 'internal'; slug: string; title?: string; summary?: string }>
  > = {};

  // Collect all education slugs while building recommendations
  const allEducationSlugs = new Set<string>();

  for (const entry of contentRelevance.triggers) {
    // Only cdsa.domain triggers contribute to recommendations
    const domainMatch = entry.trigger.match(
      /^cdsa\.domain\.([^.]+)\.anomaly\.([^.]+)$/,
    );
    if (!domainMatch) continue;

    const [, domain, age] = domainMatch;

    for (const article of entry.articles) {
      allEducationSlugs.add(article.slug);

      // Skip browse-only / matrix-only articles that have no explicit severities.
      // These were never part of default.json recommendations; adding a default
      // would cause parity violations (e.g. language-stimulation leaking into
      // monitor::language::13-24m where pre-refactor no article was recommended).
      if (!article.severities || article.severities.length === 0) continue;

      const severities = article.severities;

      // Read title/summary from frontmatter (cached)
      const fm = await readFrontmatter(article.slug, cwd);

      for (const sev of severities) {
        const key = `${sev}::${domain}::${age}`;
        const list = (recommendations[key] ??= []);
        if (!list.some(r => r.slug === article.slug)) {
          const item: { source: 'internal'; slug: string; title?: string; summary?: string } = {
            source: 'internal',
            slug: article.slug,
          };
          if (fm.title) item.title = fm.title;
          if (fm.summary) item.summary = fm.summary;
          list.push(item);
        }
      }
    }
  }

  // ── 6b. articleSlugs — all .md slugs in src/data/education (excl. README) ─
  //
  // Used by RecommendationsManager at runtime to populate the internal-article
  // picker without needing a filesystem glob in the browser.

  const mdFiles = await fg('src/data/education/**/*.md', { cwd });
  const articleSlugs = mdFiles
    .map(f => {
      // Convert path → slug: strip prefix, optional subdir, .md extension
      const rel = f
        .replace(/^src\/data\/education\//, '')
        .replace(/\.md$/, '');
      return rel;
    })
    .filter(s => !s.toLowerCase().includes('readme'))
    .sort();

  // ── 7. clinicalEducation ──────────────────────────────────────────────────
  //
  // Key: indicator (e.g. "sugar_intake")
  // Value: slug[] from clinicalAlertEducation section (the authoritative closed-loop map)
  //
  // Previously derived from cdss cell articles — now read directly from the
  // clinicalAlertEducation section so that indicator→slug mapping has a single source.

  const clinicalEducation: Record<string, string[]> = Object.fromEntries(
    Object.entries(contentRelevance.clinicalAlertEducation ?? {}),
  );

  // ── 8. Assemble and validate ──────────────────────────────────────────────

  const runtime: RuntimeIndex = {
    catalog: runtimeCatalog,
    triggers,
    educationSlugToTriggers,
    recommendations,
    clinicalEducation,
    articleSlugs,
  };

  runtimeIndexSchema.parse(runtime);

  // ── 9. Write (optional) ───────────────────────────────────────────────────

  if (write) {
    const stable = JSON.stringify(sortObjectDeep(runtime), null, 2) + '\n';
    await fs.mkdir(resolve('public/data'), { recursive: true });
    await fs.writeFile(resolve('public/data/video-index.json'), stable);
    console.log(`Written: public/data/video-index.json`);
    console.log(`  catalog: ${Object.keys(runtimeCatalog).length} verified videos`);
    console.log(`  triggers: ${Object.keys(triggers).length} entries`);
    console.log(
      `  recommendations: ${Object.keys(recommendations).length} keys`,
    );
    console.log(
      `  clinicalEducation: ${Object.keys(clinicalEducation).length} indicators`,
    );
    console.log(`  articleSlugs: ${articleSlugs.length} slugs`);

    // ── Generate CLINICAL_EDUCATION constant for closed-loop engine ──────────
    //
    // closed-loop.ts runs in a sync engine context and cannot fetch JSON at
    // runtime, so we generate a TS module that can be statically imported.

    const clinicalEduEntries = Object.entries(clinicalEducation)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`)
      .join('\n');

    const generatedTs = [
      '// AUTO-GENERATED by scripts/build-content-index.ts — do not edit.',
      '// Source: src/data/education/content-relevance.yaml clinicalAlertEducation section.',
      'export const CLINICAL_EDUCATION: Record<string, string[]> = {',
      clinicalEduEntries,
      '};',
      '',
    ].join('\n');

    const generatedPath = resolve('src/lib/education/clinical-education.generated.ts');
    await fs.writeFile(generatedPath, generatedTs, 'utf8');
    console.log(`Written: src/lib/education/clinical-education.generated.ts`);
  }

  return runtime;
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  buildContentIndex().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
