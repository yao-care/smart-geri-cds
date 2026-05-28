/**
 * video-text.ts — 為每支影片組裝可分類的文字訊號（title + channel + report description +（有的話）字幕）。
 *
 * 訊號出處（離線、不戳 yt-dlp）：
 *   1. src/data/video-catalog/*.yaml: title + channel
 *   2. scripts/curate/reports/*.md: subtitleHead/Tail（含「[無字幕] description: ...」）
 *   3. scripts/curate/cache/*.vtt: 有完整字幕者（catalog ~112 支中僅 11 支有 vtt）
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import fg from 'fast-glob';

interface CatalogEntry { videoId?: string; title?: string; channel?: string }

export async function loadVideoTexts(): Promise<Map<string, string>> {
  const texts = new Map<string, string>();

  // 1. catalog → title + channel
  for (const fp of (await fg('src/data/video-catalog/*.yaml')).sort()) {
    const arr = (yaml.load(await fs.readFile(fp, 'utf8')) as CatalogEntry[]) ?? [];
    for (const v of arr) {
      if (!v?.videoId) continue;
      texts.set(v.videoId, [v.title, v.channel].filter(Boolean).join(' | '));
    }
  }

  // 2. reports → subtitle head/tail（含 description fallback）
  for (const fp of (await fg('scripts/curate/reports/*.md')).sort()) {
    const raw = await fs.readFile(fp, 'utf8');
    const blocks = raw.split('## Candidate:').slice(1);
    for (const b of blocks) {
      const idMatch = b.match(/^\s*([A-Za-z0-9_-]{11})/);
      if (!idMatch) continue;
      const vid = idMatch[1];
      const head = b.match(/subtitle head[^\n]*\n```\n([\s\S]*?)\n```/)?.[1] ?? '';
      const tail = b.match(/subtitle tail[^\n]*\n```\n([\s\S]*?)\n```/)?.[1] ?? '';
      const existing = texts.get(vid) ?? '';
      const desc = [head, tail].filter(s => s && !/^\(無字幕；以 description 替代\)$/.test(s.trim())).join(' ');
      if (desc) texts.set(vid, [existing, desc].filter(Boolean).join(' | '));
    }
  }

  // 3. cache vtt → 完整字幕（11 支）；上限 1500 字避免單支主導訊號
  for (const fp of await fg('scripts/curate/cache/*.vtt')) {
    const id = path.basename(fp).split('.')[0];
    const sub = await fs.readFile(fp, 'utf8');
    const text = sub
      .split('\n')
      .filter(l => !l.includes('-->') && !/^\d+$/.test(l) && !l.startsWith('WEBVTT'))
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim();
    if (!text) continue;
    const existing = texts.get(id) ?? '';
    texts.set(id, existing + ' | SUB:' + text.slice(0, 1500));
  }

  return texts;
}
