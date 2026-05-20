#!/usr/bin/env tsx
import fs from 'node:fs/promises';
import path from 'node:path';

interface InapplicableMatrix {
  version: number;
  'cdsa.domain': Record<string, { inapplicable: string[] }>;
}

const QUESTIONNAIRE_DOMAINS = [
  'cognition', 'fine_motor', 'gross_motor',
  'language_comprehension', 'language_expression', 'social_emotional',
] as const;

const AGE_GROUPS_CDSA = [
  '2-6m', '7-12m', '13-24m', '25-36m', '37-48m', '49-60m', '61-72m',
] as const;

async function main(): Promise<void> {
  const cwd = process.cwd();
  const matrixPath = path.join(cwd, 'scripts/curate/inapplicable-matrix.json');
  const matrix: InapplicableMatrix = JSON.parse(await fs.readFile(matrixPath, 'utf8'));

  const result: Record<string, string[]> = {};
  for (const ag of AGE_GROUPS_CDSA) {
    result[ag] = QUESTIONNAIRE_DOMAINS.filter(domain => {
      const inapp = matrix['cdsa.domain'][domain]?.inapplicable ?? [];
      return !inapp.includes(ag);
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
