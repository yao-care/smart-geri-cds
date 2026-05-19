#!/usr/bin/env tsx
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import fg from 'fast-glob';
import { z } from 'astro/zod';
import {
  videoCatalogItemSchema, triggerEntrySchema, runtimeIndexSchema,
  type VideoCatalogItem, type TriggerEntry,
} from '../src/lib/education/schemas';

interface InapplicableMatrix {
  version: number;
  rationale: string;
  'cdsa.domain': Record<string, { inapplicable: string[] }>;
  'cdsa.triage': { inapplicable: string[] };
  cdss: { inapplicable: string[] };
}

function sortObjectDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(k => [k, sortObjectDeep((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export interface BuildOptions {
  cwd?: string;
}

export async function buildVideoIndex(opts: BuildOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const resolve = (rel: string) => path.join(cwd, rel);

  const matrixRaw = await fs.readFile(resolve('scripts/curate/inapplicable-matrix.json'), 'utf8');
  const matrix: InapplicableMatrix = JSON.parse(matrixRaw);

  const catalogFiles = await fg('src/data/video-catalog/*.yaml', { cwd });
  const triggerFiles = await fg('src/data/education-videos/*.yaml', { cwd });

  const catalog: Record<string, VideoCatalogItem> = {};
  for (const rel of catalogFiles) {
    const arr = yaml.load(await fs.readFile(resolve(rel), 'utf8'));
    const validated = z.array(videoCatalogItemSchema).parse(arr ?? []);
    for (const v of validated) {
      if (catalog[v.videoId]) throw new Error(`Duplicate videoId: ${v.videoId} in ${rel}`);
      catalog[v.videoId] = v;
    }
  }

  const triggers: Record<string, TriggerEntry> = {};
  for (const rel of triggerFiles) {
    const arr = yaml.load(await fs.readFile(resolve(rel), 'utf8'));
    const validated = z.array(triggerEntrySchema).parse(arr ?? []);
    for (const t of validated) {
      if (triggers[t.trigger]) throw new Error(`Duplicate trigger: ${t.trigger} in ${rel}`);
      triggers[t.trigger] = t;
    }
  }

  const matrixInapplicable = new Set<string>();
  for (const [domain, def] of Object.entries(matrix['cdsa.domain'] ?? {})) {
    for (const age of def.inapplicable) {
      matrixInapplicable.add(`cdsa.domain.${domain}.anomaly.${age}`);
    }
  }
  for (const t of matrix['cdsa.triage']?.inapplicable ?? []) matrixInapplicable.add(t);
  for (const t of matrix.cdss?.inapplicable ?? []) matrixInapplicable.add(t);

  const yamlInapplicable = new Set(
    Object.values(triggers).filter(t => t.inapplicable === true).map(t => t.trigger),
  );
  const onlyInMatrix = [...matrixInapplicable].filter(k => !yamlInapplicable.has(k));
  const onlyInYaml = [...yamlInapplicable].filter(k => !matrixInapplicable.has(k));
  if (onlyInMatrix.length || onlyInYaml.length) {
    throw new Error(
      `inapplicable mismatch — matrix is source of truth.\n  missing in yaml: ${JSON.stringify(onlyInMatrix)}\n  extra in yaml: ${JSON.stringify(onlyInYaml)}`,
    );
  }

  for (const t of Object.values(triggers)) {
    for (const id of t.videoIds) {
      if (!catalog[id]) throw new Error(`Trigger ${t.trigger} references unknown videoId: ${id}`);
    }
  }

  for (const t of Object.values(triggers)) {
    if (!t.educationSlug) continue;
    const mdPath = resolve(`src/data/education/${t.educationSlug}.md`);
    try { await fs.access(mdPath); }
    catch { throw new Error(`Trigger ${t.trigger} educationSlug not found: ${mdPath}`); }
  }

  const verifiedCatalog = Object.fromEntries(
    Object.entries(catalog).filter(([, v]) => v.verificationStatus === 'verified'),
  );

  const runtime = {
    catalog: Object.fromEntries(
      Object.entries(verifiedCatalog).map(([id, v]) => [id, {
        videoId: v.videoId, title: v.title, channel: v.channel,
        duration: v.duration, language: v.language,
        sourceTier: v.sourceTier, score: v.score,
      }]),
    ),
    triggers: Object.fromEntries(
      Object.entries(triggers).map(([k, t]) => [k, {
        videoIds: t.inapplicable
          ? []
          : t.videoIds.filter(id => verifiedCatalog[id] != null),
        inapplicable: t.inapplicable === true,
      }]),
    ),
  };

  runtimeIndexSchema.parse(runtime);

  const stable = JSON.stringify(sortObjectDeep(runtime), null, 2) + '\n';
  await fs.mkdir(resolve('public/data'), { recursive: true });
  await fs.writeFile(resolve('public/data/video-index.json'), stable);

  await fs.mkdir(resolve('scripts/curate'), { recursive: true });
  await fs.writeFile(
    resolve('scripts/curate/.last-build.json'),
    JSON.stringify({ builtAt: new Date().toISOString() }, null, 2) + '\n',
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildVideoIndex().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
