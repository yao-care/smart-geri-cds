#!/usr/bin/env tsx
/**
 * One-time migration script: build-content-relevance.ts
 *
 * Reads the scattered content-mapping sources and produces the single
 * cell/trigger-centric source: src/data/education/content-relevance.yaml
 *
 * Sources:
 *   A. scripts/curate/inapplicable-matrix.json
 *   B. src/data/education-videos/*.yaml  (3 files)
 *   C. src/data/recommendations/default.json  (severities for cdsa.domain cells)
 *   D. closed-loop indicator→slug map (from src/engine/closed-loop.ts)
 *   E. diet items from default.json → cdss.sugar_intake.* triggers
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

// ---------- types ----------

interface InapplicableMatrix {
  'cdsa.domain': Record<string, { inapplicable: string[] }>;
}

interface TriggerEntry {
  trigger: string;
  inapplicable?: boolean;
  videoIds?: string[];
  educationSlug?: string;
}

interface RecommendationItem {
  source: string;
  slug?: string;
}

interface DefaultJson {
  matrix: Record<string, Record<string, RecommendationItem[]>>;
}

interface ArticleRef {
  slug: string;
  severities?: string[];
  browse?: boolean;
}

interface TriggerRelevance {
  trigger: string;
  videoIds: string[];
  articles: ArticleRef[];
}

// Intermediate mutable form (sets for dedup)
interface TriggerRecord {
  videoIds: string[];
  articles: Map<string, Set<string>>; // slug -> severity set
  browseSlugs: Set<string>;           // slugs that originated from Rule B (curated matrix/browse)
}

// ---------- constants ----------

const ALL_CDSA_AGES = ['2-6m', '7-12m', '13-24m', '25-36m', '37-48m', '49-60m', '61-72m'] as const;
const SEVERITY_ORDER = ['normal', 'monitor', 'refer'] as const;

// From src/engine/closed-loop.ts getEducationRecommendations
const CLOSED_LOOP_MAP: Record<string, string> = {
  sugar_intake:   'diet-control',
  sleep_quality:  'sleep-hygiene',
  spo2:           'respiratory-care',
  activity_level: 'exercise-guide',
};

// Normalize domain names from default.json to canonical schema form
function normalizeDomain(domain: string): string {
  if (domain === 'language_comp') return 'language_comprehension';
  if (domain === 'language_expr') return 'language_expression';
  return domain;
}

// CDSA developmental domains (8 domains in CDSA_DOMAIN_NAMES)
const CDSA_DEV_DOMAINS = new Set([
  'behavior', 'gross_motor', 'fine_motor', 'language',
  'cognition', 'language_comprehension', 'language_expression', 'social_emotional',
]);

// ---------- helpers ----------

function ensureTrigger(map: Map<string, TriggerRecord>, trigger: string): TriggerRecord {
  if (!map.has(trigger)) {
    map.set(trigger, { videoIds: [], articles: new Map(), browseSlugs: new Set() });
  }
  return map.get(trigger)!;
}

function addArticle(
  rec: TriggerRecord,
  slug: string,
  severities: string[],
  browse = false,
): void {
  if (!rec.articles.has(slug)) {
    rec.articles.set(slug, new Set(severities));
  } else {
    const existing = rec.articles.get(slug)!;
    for (const s of severities) existing.add(s);
  }
  // browse flag wins: once marked browse, always browse
  if (browse) rec.browseSlugs.add(slug);
}

// ---------- main ----------

async function main(): Promise<void> {
  const cwd = process.cwd();
  const resolve = (rel: string) => path.join(cwd, rel);

  // ── A. inapplicable section ──────────────────────────────────────────────

  const matrixRaw = JSON.parse(
    await fs.readFile(resolve('scripts/curate/inapplicable-matrix.json'), 'utf8'),
  ) as InapplicableMatrix;

  // Build inapplicable: ALL 8 CDSA domains must be present (schema uses z.record(z.enum(CDSA_DOMAIN_NAMES), ...))
  // Domains with no inapplicable ages get an empty array.
  const ALL_CDSA_DOMAINS = [
    'behavior', 'gross_motor', 'fine_motor', 'language',
    'cognition', 'language_comprehension', 'language_expression', 'social_emotional',
  ] as const;

  const inapplicableSection: Record<string, string[]> = {};
  for (const domain of ALL_CDSA_DOMAINS) {
    const def = matrixRaw['cdsa.domain'][domain];
    inapplicableSection[domain] = def?.inapplicable ?? [];
  }

  // Build per-domain applicable ages (for rule C)
  const applicableAges: Record<string, string[]> = {};
  for (const [domain, def] of Object.entries(matrixRaw['cdsa.domain'])) {
    const inapplicableSet = new Set(def.inapplicable);
    applicableAges[domain] = ALL_CDSA_AGES.filter(a => !inapplicableSet.has(a));
  }

  // ── B. Education-videos YAMLs ────────────────────────────────────────────

  const triggerMap = new Map<string, TriggerRecord>();

  const videoYamlFiles = [
    'src/data/education-videos/cdsa-domains.yaml',
    'src/data/education-videos/cdsa-triage.yaml',
    'src/data/education-videos/cdss-vital-signs.yaml',
  ];

  for (const rel of videoYamlFiles) {
    const entries = yaml.load(await fs.readFile(resolve(rel), 'utf8')) as TriggerEntry[];
    for (const entry of entries ?? []) {
      // Skip inapplicable entries — they live only in inapplicableSection
      if (entry.inapplicable === true) continue;

      const rec = ensureTrigger(triggerMap, entry.trigger);

      // Merge videoIds (preserve order, deduplicate)
      for (const id of entry.videoIds ?? []) {
        if (!rec.videoIds.includes(id)) rec.videoIds.push(id);
      }

      // If there's an educationSlug, add as article (browse = true for cdsa.domain entries)
      // browse marks this as the curated matrix/browse article (the old educationSlug)
      if (entry.educationSlug) {
        const isBrowse = entry.trigger.startsWith('cdsa.domain.');
        addArticle(rec, entry.educationSlug, [], isBrowse);
      }
    }
  }

  // ── C. Fold default.json severities for cdsa.domain cells ───────────────

  const defaultJson = JSON.parse(
    await fs.readFile(resolve('src/data/recommendations/default.json'), 'utf8'),
  ) as DefaultJson;

  for (const category of (['normal', 'monitor', 'refer'] as const)) {
    const categoryData = defaultJson.matrix[category] ?? {};
    for (const [rawDomain, items] of Object.entries(categoryData)) {
      const domain = normalizeDomain(rawDomain);

      // diet domain is handled in rule E (not a developmental CDSA domain)
      if (rawDomain === 'diet') continue;

      if (!CDSA_DEV_DOMAINS.has(domain)) continue;

      const domainAges = applicableAges[domain] ?? [];

      for (const item of items) {
        if (!item.slug) continue;

        for (const age of domainAges) {
          const trigger = `cdsa.domain.${domain}.anomaly.${age}`;
          const rec = ensureTrigger(triggerMap, trigger);
          addArticle(rec, item.slug, [category]);
        }
      }
    }
  }

  // ── D. Fold closed-loop map ───────────────────────────────────────────────

  // For each indicator -> slug, add article to every existing cdss.<indicator>.<level>.<age> trigger
  for (const [indicator, slug] of Object.entries(CLOSED_LOOP_MAP)) {
    for (const [trigger, rec] of triggerMap.entries()) {
      if (trigger.startsWith(`cdss.${indicator}.`)) {
        addArticle(rec, slug, []);
      }
    }
  }

  // ── E. Diet items → every cdss.sugar_intake.*.* trigger ──────────────────

  const dietSlugsForCdss: string[] = [];
  for (const category of ['monitor', 'refer'] as const) {
    const dietItems = defaultJson.matrix[category]?.diet ?? [];
    for (const item of dietItems) {
      if (item.slug && !dietSlugsForCdss.includes(item.slug)) {
        dietSlugsForCdss.push(item.slug);
      }
    }
  }

  for (const [trigger, rec] of triggerMap.entries()) {
    if (trigger.startsWith('cdss.sugar_intake.')) {
      for (const slug of dietSlugsForCdss) {
        addArticle(rec, slug, []);
      }
    }
  }

  // ── F. Finalize ───────────────────────────────────────────────────────────

  const triggersOut: TriggerRelevance[] = [];

  const sortedTriggerKeys = [...triggerMap.keys()].sort();

  for (const triggerKey of sortedTriggerKeys) {
    const rec = triggerMap.get(triggerKey)!;

    // Sort articles by slug
    const sortedSlugs = [...rec.articles.keys()].sort();

    const articles: ArticleRef[] = sortedSlugs.map(slug => {
      const severitySet = rec.articles.get(slug)!;
      const isBrowse = rec.browseSlugs.has(slug);

      // Only cdsa.domain.* cells get severities
      if (triggerKey.startsWith('cdsa.domain.')) {
        const sortedSeverities = SEVERITY_ORDER.filter(s => severitySet.has(s));
        const result: ArticleRef = sortedSeverities.length > 0
          ? { slug, severities: sortedSeverities }
          : { slug };
        if (isBrowse) result.browse = true;
        return result;
      }
      // triage / cdss articles: never set severities
      return { slug };
    });

    triggersOut.push({
      trigger: triggerKey,
      videoIds: rec.videoIds,
      articles,
    });
  }

  const output = {
    inapplicable: inapplicableSection,
    triggers: triggersOut,
  };

  const yamlStr = yaml.dump(output, {
    noRefs: true,
    lineWidth: 120,
    quotingType: '"',
    forceQuotes: false,
  });

  await fs.writeFile(resolve('src/data/education/content-relevance.yaml'), yamlStr, 'utf8');
  console.log(`Written: src/data/education/content-relevance.yaml`);
  console.log(`  inapplicable domains: ${Object.keys(inapplicableSection).length}`);
  console.log(`  triggers: ${triggersOut.length}`);

  // Sanity print
  const sanityTriggers = [
    'cdsa.domain.gross_motor.anomaly.13-24m',
    'cdss.sugar_intake.critical.infant',
    'cdsa.domain.behavior.anomaly.25-36m',
    'cdsa.triage.refer.2-6m',
  ];
  console.log('\n── Sanity check ──');
  for (const t of sanityTriggers) {
    const entry = triggersOut.find(e => e.trigger === t);
    if (entry) {
      console.log(`\n${t}:`);
      console.log(`  videoIds: [${entry.videoIds.join(', ')}]`);
      for (const a of entry.articles) {
        const sevStr = a.severities ? ` → severities: [${a.severities.join(', ')}]` : '';
        console.log(`  article: ${a.slug}${sevStr}`);
      }
    } else {
      console.log(`\n${t}: NOT FOUND in triggers`);
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
