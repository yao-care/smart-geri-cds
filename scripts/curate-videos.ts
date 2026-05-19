#!/usr/bin/env tsx
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import yaml from 'js-yaml';
import { searchYtDlp, fetchMetadata, downloadSubtitle, resolveChannelId } from './curate/lib/yt-dlp';
import { computeScore, classifyVerdict, type ScoreInput } from './curate/lib/heuristics';
import { simplifiedRatio } from './curate/lib/simplified-detector';
import { writeReport, type ReportCandidate } from './curate/lib/report-writer';

const TODAY = new Date().toISOString().slice(0, 10);

const BLACKLIST = {
  channelDescriptionContains: ['简体', '简介', '简化', '中国大陆', 'CCTV'],
  titleKeywords: ['偏方', '神奇療法', '保健食品推薦', '代購', '微商'],
};

interface KeywordSpec {
  primary: string[];
  secondary?: string[];
  educationSlug?: string;
  minDuration: number;
  maxDuration: number;
  timeSensitive: boolean;
}

interface ChannelWhitelist {
  'official-tw': Record<string, string>;
  'international': Record<string, string>;
  'pro-kol': Record<string, string>;
}

async function resolveChannels(): Promise<ChannelWhitelist> {
  const seeds = JSON.parse(await fs.readFile('scripts/curate/channel-seeds.json', 'utf8')) as Record<
    keyof ChannelWhitelist,
    Array<{ tag: string; channelId: string | null }>
  >;
  const out: ChannelWhitelist = { 'official-tw': {}, 'international': {}, 'pro-kol': {} };
  for (const tier of Object.keys(out) as Array<keyof ChannelWhitelist>) {
    for (const seed of seeds[tier] ?? []) {
      const channelId = seed.channelId ?? await resolveChannelId(seed.tag);
      out[tier][channelId] = seed.tag;
    }
  }
  await fs.writeFile('scripts/curate/channel-whitelist.json', JSON.stringify(out, null, 2));
  return out;
}

function channelTierOf(channelId: string, w: ChannelWhitelist): ScoreInput['channelTier'] {
  if (channelId in w['official-tw']) return 'official-tw';
  if (channelId in w['international']) return 'international';
  if (channelId in w['pro-kol']) return 'pro-kol';
  return 'pro-kol';
}

async function processTrigger(
  trigger: string,
  kw: KeywordSpec,
  whitelist: ChannelWhitelist,
): Promise<void> {
  const cacheDir = 'scripts/curate/cache';
  const reportsDir = 'scripts/curate/reports';
  await fs.mkdir(cacheDir, { recursive: true });

  const seen = new Set<string>();
  const candidates: Array<{ id: string; title: string; duration: number }> = [];
  for (const q of [...kw.primary, ...(kw.secondary ?? [])]) {
    const results = await searchYtDlp(q, 30);
    for (const r of results) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      candidates.push(r);
    }
  }

  const stageA = candidates.filter(c => {
    if (c.duration < 30 || c.duration > 1800) return false;
    if (BLACKLIST.titleKeywords.some(kw => c.title.includes(kw))) return false;
    return true;
  }).slice(0, 8);

  const enriched: Array<ScoreInput & { id: string; title: string; channel: string; description: string }> = [];
  for (const c of stageA) {
    let meta;
    try { meta = await fetchMetadata(c.id); }
    catch (e) { console.warn(`metadata fail for ${c.id}: ${(e as Error).message}`); continue; }

    if (BLACKLIST.channelDescriptionContains.some(s => meta.description?.includes(s))) continue;

    const tier = channelTierOf(meta.channel_id, whitelist);
    enriched.push({
      id: c.id, title: c.title, channel: meta.channel, description: meta.description ?? '',
      channelTier: tier,
      subtitleType: meta.subtitles && Object.keys(meta.subtitles).length > 0 ? 'human'
                   : meta.automatic_captions && Object.keys(meta.automatic_captions).length > 0 ? 'auto' : 'none',
      medicalTermDensity: 0,
      viewCount: meta.view_count ?? 0,
      dangerKeywordHits: 0,
      publishedAt: `${meta.upload_date?.slice(0, 4)}-${meta.upload_date?.slice(4, 6)}-${meta.upload_date?.slice(6, 8)}`,
      duration: c.duration,
      minDuration: kw.minDuration,
      maxDuration: kw.maxDuration,
      timeSensitive: kw.timeSensitive,
      todayIsoDate: TODAY,
    });
  }

  const scored = enriched
    .map(e => ({ ...e, score: computeScore(e) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const reportCandidates: ReportCandidate[] = [];
  for (const c of scored) {
    try { await downloadSubtitle(c.id, cacheDir); }
    catch (e) { console.warn(`subtitle fail ${c.id}: ${(e as Error).message}`); continue; }

    const cacheFiles = await fs.readdir(cacheDir);
    const subPath = cacheFiles
      .map(f => path.join(cacheDir, f))
      .find(p => p.includes(c.id) && p.endsWith('.vtt'));
    if (!subPath) continue;

    const subContent = await fs.readFile(subPath, 'utf8');
    const text = subContent
      .split('\n')
      .filter(l => !l.includes('-->') && !/^\d+$/.test(l) && !l.startsWith('WEBVTT'))
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim();

    if (simplifiedRatio(text) > 0.3) {
      console.warn(`${c.id} rejected: simplified Chinese ratio > 0.3`);
      continue;
    }

    const score = computeScore(c);
    const verdict = classifyVerdict(c, score);

    reportCandidates.push({
      videoId: c.id, title: c.title, channel: c.channel,
      sourceTier: c.channelTier, duration: c.duration,
      subtitleType: c.subtitleType, score,
      subtitleHead: text.slice(0, 200),
      subtitleTail: text.slice(-200),
      verdict,
    });
  }

  await writeReport({
    trigger,
    generatedAt: TODAY,
    candidates: reportCandidates,
    pipelineNotes: reportCandidates.length === 0 ? ['NO_CANDIDATES'] : [],
  }, reportsDir);
  console.log(`✓ ${trigger}: ${reportCandidates.length} candidates`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      trigger: { type: 'string' },
      category: { type: 'string' },
      'validate-only': { type: 'boolean' },
      batch: { type: 'string' },
      clean: { type: 'boolean' },
    },
  });

  if (values.clean) {
    const now = Date.now();
    for (const [dir, days] of [['scripts/curate/cache', 30], ['scripts/curate/reports', 90]] as const) {
      try {
        for (const f of await fs.readdir(dir)) {
          const fp = path.join(dir, f);
          const stat = await fs.stat(fp);
          if (now - stat.mtimeMs > days * 86400_000) await fs.unlink(fp);
        }
      } catch {}
    }
    return;
  }

  if (values['validate-only']) {
    const batchSize = values.batch ? parseInt(values.batch, 10) : 50;
    const tiers = ['official-tw', 'international', 'pro-kol'] as const;
    for (const tier of tiers) {
      const fp = `src/data/video-catalog/${tier}.yaml`;
      const catalog = (yaml.load(await fs.readFile(fp, 'utf8')) as any[]) ?? [];
      catalog.sort((a, b) => (a.lastValidatedAt ?? '0000-01-01').localeCompare(b.lastValidatedAt ?? '0000-01-01'));
      let changed = 0;
      for (const v of catalog.slice(0, batchSize)) {
        try {
          await fetchMetadata(v.videoId);
          v.lastValidatedAt = TODAY;
        } catch (e) {
          const msg = (e as Error).message;
          if (/Video unavailable|Private video|Deleted/i.test(msg)) {
            v.verificationStatus = 'rejected';
            v.lastValidatedAt = TODAY;
            v.notes = `auto-rejected ${TODAY}: ${msg}`;
            changed++;
          } else {
            console.warn(`validate check fail for ${v.videoId}: ${msg}`);
          }
        }
      }
      await fs.writeFile(fp, yaml.dump(catalog));
      console.log(`validate-only ${tier}: ${changed} rejected`);
    }
    return;
  }

  const whitelist = await resolveChannels();
  const keywords = JSON.parse(await fs.readFile('scripts/curate/keywords.json', 'utf8')) as Record<string, KeywordSpec>;

  const all = Object.entries(keywords).filter(([trigger]) =>
    !values.trigger || trigger === values.trigger,
  ).filter(([trigger]) =>
    !values.category || trigger.startsWith(values.category),
  );

  for (const [trigger, kw] of all) {
    await processTrigger(trigger, kw, whitelist);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
