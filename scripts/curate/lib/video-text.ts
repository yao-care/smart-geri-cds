/**
 * video-text.ts — 為每支影片組裝可分類的文字訊號（title + channel + report description +（有的話）字幕）。
 *
 * 訊號出處（離線、不戳 yt-dlp）：
 *   1. src/data/video-catalog/*.yaml: title + channel
 *   2. scripts/curate/reports/*.md: subtitleHead/Tail（含「[無字幕] description: ...」）
 *   3. src/data/video-subtitles/*.vtt: 已驗證並 commit 的字幕資產（內容資產，跨 clone/CI 持久化）；
 *      scripts/curate/cache/*.vtt: curate 新跑暫存（gitignored、待人工搬到 video-subtitles/）。
 *      兩處同 videoId 時以 src/data/video-subtitles/ 為準（committed 才是真相源）。
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

  // 3. 字幕：先讀 cache（curate 新跑暫存），再讀 video-subtitles（committed 真相源）覆蓋。
  //    上限 1500 字避免單支主導訊號；剝除 [Music]/[音樂]/[Applause] 等無意義標記後若為空則跳過。
  for (const baseDir of ['scripts/curate/cache', 'src/data/video-subtitles']) {
    for (const fp of (await fg(`${baseDir}/*.vtt`)).sort()) {
      const id = path.basename(fp).split('.')[0];
      const sub = await fs.readFile(fp, 'utf8');
      const text = sub
        .split('\n')
        .filter(l => !l.includes('-->') && !/^\d+$/.test(l) && !l.startsWith('WEBVTT') && !/^Kind:|^Language:/.test(l))
        .join(' ')
        .replace(/<[^>]+>/g, '')
        .replace(/\[(Music|Applause|音樂|掌聲)\]/g, '')
        .trim();
      if (!text) continue;
      // 同 videoId 時 video-subtitles 覆蓋 cache 版本（committed 才是真相源）
      const existing = (texts.get(id) ?? '').replace(/ \| SUB:[\s\S]*$/, '');
      texts.set(id, existing + ' | SUB:' + text.slice(0, 1500));
    }
  }

  return texts;
}
