#!/usr/bin/env tsx
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import { CFS_LEVELS } from '../src/lib/utils/cfs-levels.js';
import { DOMAIN_TREE, DOMAIN_TOPS } from '../src/lib/domain/domain-tree.js';

interface ContentRelevance {
  // key = "top.sub"; value = inapplicable CFS levels for that cell.
  inapplicable: Record<string, string[]>;
}

// 全部二層子項（`top.sub`）為適用矩陣的列；單一源於 domain-tree。
const QUESTIONNAIRE_DOMAINS: string[] = DOMAIN_TOPS.flatMap(
  top => DOMAIN_TREE[top].map(sub => `${top}.${sub}`),
);

async function main(): Promise<void> {
  const cwd = process.cwd();
  const relevancePath = path.join(cwd, 'src/data/education/content-relevance.yaml');
  const relevance = yaml.load(await fs.readFile(relevancePath, 'utf8')) as ContentRelevance;

  // For each CFS level, list the top.sub domains that are applicable
  // (i.e. NOT listed in inapplicable[topSub] for that CFS level).
  const result: Record<string, string[]> = {};
  for (const cfs of CFS_LEVELS) {
    result[cfs] = QUESTIONNAIRE_DOMAINS.filter(topSub => {
      const inapp = relevance.inapplicable?.[topSub] ?? [];
      return !inapp.includes(cfs);
    });
  }

  const sorted = Object.fromEntries(
    Object.keys(result).sort().map(k => [k, result[k].sort()]),
  );

  const outPath = path.join(cwd, 'src/lib/data/expected-questionnaire-domains.generated.json');
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`[build-questionnaire-applicability] wrote ${outPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err); process.exit(1); });
}
