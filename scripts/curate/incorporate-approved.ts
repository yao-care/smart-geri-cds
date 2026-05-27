#!/usr/bin/env tsx
/**
 * incorporate-approved.ts
 *
 * 一次性腳本：人工審核通過後，把 curate 報告（scripts/curate/reports/*.md）裡的候選影片
 * 納入正式 catalog 並接到 content-relevance triggers。
 *
 * 流程：
 *  1. 解析每份報告：trigger（檔名）+ 候選（videoId/title/channel/tier/duration/subtitleType/score）
 *  2. 對每個 unique videoId 重抓完整 metadata（channelId/upload_date/view_count），補齊 schema
 *  3. 依 sourceTier 寫入 src/data/video-catalog/<tier>.yaml（verificationStatus: verified, verifiedBy: manual）
 *  4. 更新 src/data/education/content-relevance.yaml：每個 trigger 的 videoIds = 其成功納入的候選
 *
 * per-video try/catch：抓不到（rate-limit 耗盡等）就跳過、不納入該 trigger，最後印 summary。
 * 重跑時已在 catalog 的 videoId 會略過重抓（idempotent）。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import yaml from 'js-yaml';
import fg from 'fast-glob';
import { fetchMetadata } from './lib/yt-dlp.js';

const TODAY = new Date().toISOString().slice(0, 10);

// --verified-by：標記本次新納入影片的驗證來源。預設 manual（人工審核流程）；
// 自動策劃補片用 claude-code（未臨床審核、待抽查）。既存影片 idempotent skip、不受影響。
const { values: cliArgs } = parseArgs({ options: { 'verified-by': { type: 'string' } } });
const VERIFIED_BY: 'manual' | 'claude-code' =
  cliArgs['verified-by'] === 'claude-code' ? 'claude-code' : 'manual';
const REPORTS_DIR = 'scripts/curate/reports';
const CATALOG_DIR = 'src/data/video-catalog';
const RELEVANCE = 'src/data/education/content-relevance.yaml';

interface Candidate {
  videoId: string;
  title: string;
  channel: string;
  tier: 'official-tw' | 'international' | 'pro-kol';
  duration: number;
  subtitleType: 'human' | 'auto' | 'none';
  score: number;
}

interface CatalogEntry {
  videoId: string; title: string; channel: string; channelId: string;
  duration: number; publishedAt: string; language: 'zh-Hant' | 'en';
  subtitleType: 'human' | 'auto' | 'none'; sourceTier: string;
  viewCount: number; curatedAt: string; lastValidatedAt: string;
  verifiedBy: 'manual' | 'claude-code'; verificationStatus: 'verified'; score: number;
  notes?: string;
}

function parseReport(text: string): Candidate[] {
  const out: Candidate[] = [];
  const blocks = text.split('## Candidate:').slice(1);
  for (const b of blocks) {
    const idTitle = b.match(/^\s*([A-Za-z0-9_-]{11})\s+—\s+(.+)/);
    const chan = b.match(/- channel:\s+(.+?)\s+\((official-tw|international|pro-kol)\)/);
    const meta = b.match(/- duration:\s+(\d+)s\s+\|\s+subtitleType:\s+(human|auto|none)\s+\|\s+score:\s+([\d.]+)/);
    if (!idTitle || !chan || !meta) continue;
    out.push({
      videoId: idTitle[1], title: idTitle[2].trim(),
      channel: chan[1].trim(), tier: chan[2] as Candidate['tier'],
      duration: Number(meta[1]), subtitleType: meta[2] as Candidate['subtitleType'],
      score: Number(meta[3]),
    });
  }
  return out;
}

function ymd(uploadDate: string): string {
  // yt-dlp upload_date = YYYYMMDD
  return `${uploadDate.slice(0, 4)}-${uploadDate.slice(4, 6)}-${uploadDate.slice(6, 8)}`;
}

async function loadExistingCatalog(): Promise<Map<string, CatalogEntry>> {
  const map = new Map<string, CatalogEntry>();
  for (const tier of ['official-tw', 'international', 'pro-kol']) {
    const fp = path.join(CATALOG_DIR, `${tier}.yaml`);
    try {
      const arr = (yaml.load(await fs.readFile(fp, 'utf8')) as CatalogEntry[]) ?? [];
      for (const e of arr) if (e?.videoId) map.set(e.videoId, e);
    } catch { /* file missing/empty */ }
  }
  return map;
}

async function main(): Promise<void> {
  const reportFiles = await fg(`${REPORTS_DIR}/*.md`);
  const triggerVideoIds = new Map<string, string[]>(); // trigger -> [videoId]
  const allCandidates = new Map<string, Candidate>();   // videoId -> candidate (dedup)

  for (const rf of reportFiles.sort()) {
    const trigger = path.basename(rf, '.md');
    const cands = parseReport(await fs.readFile(rf, 'utf8'));
    triggerVideoIds.set(trigger, cands.map(c => c.videoId));
    for (const c of cands) if (!allCandidates.has(c.videoId)) allCandidates.set(c.videoId, c);
  }
  console.log(`報告 ${reportFiles.length} 份，unique 候選 ${allCandidates.size} 支`);

  const catalog = await loadExistingCatalog();
  const failed: string[] = [];
  let fetched = 0, skipped = 0;

  for (const [videoId, c] of allCandidates) {
    if (catalog.has(videoId)) { skipped++; continue; } // idempotent
    try {
      const m = await fetchMetadata(videoId);
      const subKeys = Object.keys(m.subtitles ?? {});
      const language: 'zh-Hant' | 'en' =
        subKeys.some(k => /^zh/i.test(k)) ? 'zh-Hant'
        : subKeys.some(k => /^en/i.test(k)) ? 'en'
        : 'zh-Hant'; // 台灣高齡衛教預設中文
      catalog.set(videoId, {
        videoId, title: c.title, channel: m.channel, channelId: m.channel_id,
        duration: m.duration || c.duration, publishedAt: ymd(m.upload_date),
        language, subtitleType: c.subtitleType, sourceTier: c.tier,
        viewCount: m.view_count ?? 0, curatedAt: TODAY, lastValidatedAt: TODAY,
        verifiedBy: VERIFIED_BY, verificationStatus: 'verified', score: c.score,
        ...(VERIFIED_BY === 'claude-code' ? { notes: `auto-curated ${TODAY}；未臨床審核，待抽查` } : {}),
      });
      fetched++;
      console.log(`✓ ${videoId} ${c.title.slice(0, 30)} (ch ${m.channel_id})`);
    } catch (e) {
      failed.push(videoId);
      console.warn(`✗ ${videoId} metadata 失敗：${(e as Error).message.slice(0, 80)}`);
    }
  }

  // 寫 catalog（依 tier 分檔）
  const byTier: Record<string, CatalogEntry[]> = { 'official-tw': [], 'international': [], 'pro-kol': [] };
  for (const e of catalog.values()) (byTier[e.sourceTier] ??= []).push(e);
  for (const tier of Object.keys(byTier)) {
    const arr = byTier[tier].sort((a, b) => a.videoId.localeCompare(b.videoId));
    await fs.writeFile(path.join(CATALOG_DIR, `${tier}.yaml`), yaml.dump(arr, { lineWidth: 120 }));
  }

  // 更新 content-relevance.yaml triggers 的 videoIds（只放成功納入者，保留 header 註解）
  const raw = await fs.readFile(RELEVANCE, 'utf8');
  const headerEnd = raw.indexOf('\ninapplicable:');
  const header = headerEnd > 0 ? raw.slice(0, headerEnd + 1) : '';
  const data = yaml.load(raw) as { inapplicable: unknown; triggers: Array<{ trigger: string; videoIds: string[]; articles: unknown[] }>; clinicalAlertEducation: unknown };
  const verified = new Set([...catalog.keys()]);
  for (const t of data.triggers) {
    const ids = (triggerVideoIds.get(t.trigger) ?? []).filter(id => verified.has(id));
    if (ids.length) t.videoIds = ids;
  }
  const body = yaml.dump(data, { lineWidth: 120, noRefs: true });
  await fs.writeFile(RELEVANCE, header + (header ? '\n' : '') + body);

  console.log(`\nSummary：納入 ${fetched} 支、已存在略過 ${skipped}、失敗 ${failed.length}`);
  if (failed.length) console.log(`失敗 videoIds（可重跑補抓）：${failed.join(', ')}`);
  console.log(`catalog: official-tw ${byTier['official-tw'].length} / international ${byTier['international'].length} / pro-kol ${byTier['pro-kol'].length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
