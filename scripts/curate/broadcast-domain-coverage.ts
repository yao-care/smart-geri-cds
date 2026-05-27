#!/usr/bin/env tsx
/**
 * broadcast-domain-coverage.ts
 *
 * 把每個二層域已有的影片（聯集、依 catalog score 降冪、上限 CAP）攤到該域的
 * 「每一個」適用 CFS trigger，使矩陣每格至少有片。純資料轉換、零抓取。
 * 只廣播 verified catalog 內的影片（與 build-content-index 過濾一致）。
 */
import fs from 'node:fs/promises';
import yaml from 'js-yaml';
import fg from 'fast-glob';
import { broadcastDomainVideos, uncoveredDomainCells, type TriggerEntry } from './lib/coverage.js';

const RELEVANCE = 'src/data/education/content-relevance.yaml';
const CATALOG_DIR = 'src/data/video-catalog';
const CAP = 5;

async function loadVerifiedScores(): Promise<Record<string, number>> {
  const scores: Record<string, number> = {};
  for (const fp of (await fg(`${CATALOG_DIR}/*.yaml`)).sort()) {
    const arr = (yaml.load(await fs.readFile(fp, 'utf8')) as Array<{ videoId?: string; verificationStatus?: string; score?: number }>) ?? [];
    for (const v of arr) {
      if (v?.videoId && v.verificationStatus === 'verified') scores[v.videoId] = v.score ?? 0;
    }
  }
  return scores;
}

async function main(): Promise<void> {
  const raw = await fs.readFile(RELEVANCE, 'utf8');
  const headerEnd = raw.indexOf('\ninapplicable:');
  const header = headerEnd > 0 ? raw.slice(0, headerEnd + 1) : '';
  const data = yaml.load(raw) as {
    inapplicable: unknown;
    triggers: TriggerEntry[];
    clinicalAlertEducation: unknown;
  };

  const scores = await loadVerifiedScores();
  const verified = new Set(Object.keys(scores));
  // 先剔除 content-relevance 內已非 verified 的 id（避免攤出假覆蓋）。
  for (const t of data.triggers) t.videoIds = (t.videoIds ?? []).filter(id => verified.has(id));

  data.triggers = broadcastDomainVideos(data.triggers, scores, CAP);

  const body = yaml.dump(data, { lineWidth: 120, noRefs: true });
  await fs.writeFile(RELEVANCE, header + (header ? '\n' : '') + body);

  const stillEmpty = uncoveredDomainCells(data.triggers);
  const total = data.triggers.filter(t => /^cga\.domain\./.test(t.trigger)).length;
  console.log(`廣播完成：${total} 個 domain 格，仍空 ${stillEmpty.length} 格`);
  if (stillEmpty.length) console.log(`仍空（需新抓）：\n  ${stillEmpty.join('\n  ')}`);
}

main().catch(e => { console.error(e); process.exit(1); });
