#!/usr/bin/env tsx
/**
 * broadcast-domain-coverage.ts
 *
 * 為每個 (domain, cfs) cell 從該域影片池挑選最匹配的影片：
 *   ① 用 cfs-band classifier（讀 title+description+channel+字幕）判斷影片適配的 CFS 等級。
 *   ② 該 cfs 落在 classifier 結果集的影片優先（按 catalog score 降冪）；不足 cap 以分數高者補滿（fallback 保每格 ≥1）。
 *
 * 取代舊版「同域全 CFS 一視同仁」的攤平做法 — 真實 description 訊號讓不同 CFS 格的影片排序／內容會差異化。
 * 純資料轉換、零抓取（只讀本地 catalog/reports/cache）。
 */
import fs from 'node:fs/promises';
import yaml from 'js-yaml';
import fg from 'fast-glob';
import { selectPerCellVideos, uncoveredDomainCells, type TriggerEntry } from './lib/coverage.js';
import { classifyCfsBands } from './lib/cfs-band.js';
import { loadVideoTexts } from './lib/video-text.js';

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

  const [scores, texts] = await Promise.all([loadVerifiedScores(), loadVideoTexts()]);
  const verified = new Set(Object.keys(scores));

  // 先剔除非 verified id（避免廣播假覆蓋）
  for (const t of data.triggers) t.videoIds = (t.videoIds ?? []).filter(id => verified.has(id));

  // per-cell 內容感知選片
  const classify = (vid: string) => classifyCfsBands(texts.get(vid) ?? '');
  data.triggers = selectPerCellVideos(data.triggers, scores, classify, CAP);

  const body = yaml.dump(data, { lineWidth: 120, noRefs: true });
  await fs.writeFile(RELEVANCE, header + (header ? '\n' : '') + body);

  // 統計：仍空格數 + per-domain 差異化（不同 cfs 格內容是否真的不同）
  const stillEmpty = uncoveredDomainCells(data.triggers);
  const total = data.triggers.filter(t => /^cga\.domain\./.test(t.trigger)).length;
  console.log(`per-cell 選片完成：${total} 個 domain 格，仍空 ${stillEmpty.length} 格`);
  if (stillEmpty.length) console.log(`仍空（池為零）：\n  ${stillEmpty.join('\n  ')}`);

  // 抽樣：同域不同 CFS 格的內容是否差異化
  const sampled = ['functional.falls', 'physical.pain', 'future_wishes.advance_care_planning'];
  for (const dom of sampled) {
    const cells = data.triggers.filter(t => t.trigger.includes(`.${dom}.anomaly.`));
    if (cells.length < 2) continue;
    const uniqueOrderings = new Set(cells.map(c => (c.videoIds ?? []).join(',')));
    console.log(`  ${dom}: ${cells.length} 格 → ${uniqueOrderings.size} 種影片排序（>1 = 已差異化）`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
