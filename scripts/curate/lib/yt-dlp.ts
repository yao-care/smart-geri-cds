import * as childProcess from 'node:child_process';
import { promisify } from 'node:util';

export interface SearchResult {
  id: string;
  title: string;
  duration: number;
}

export interface FullMetadata extends SearchResult {
  channel: string;
  channel_id: string;
  upload_date: string;
  view_count: number;
  description: string;
  subtitles?: Record<string, unknown>;
  automatic_captions?: Record<string, unknown>;
}

export function detectRateLimit(stderr: string): boolean {
  return /HTTP Error 429|Too Many Requests|Sign in to confirm/i.test(stderr);
}

const BACKOFFS_SECONDS = [30, 60, 120, 240];

// 預設帶 Chrome Default cookies 過 YouTube anti-bot 牆（『Sign in to confirm you're not a bot』）。
// 可用 YT_DLP_COOKIES_FROM_BROWSER 環境變數覆寫（如 'firefox' 或 'chrome:Profile 1'）。
const COOKIES_FROM_BROWSER = process.env.YT_DLP_COOKIES_FROM_BROWSER ?? 'chrome:Default';

async function runYtDlp(args: string[]): Promise<string> {
  const fullArgs = ['--cookies-from-browser', COOKIES_FROM_BROWSER, ...args];
  for (let attempt = 0; attempt < BACKOFFS_SECONDS.length; attempt++) {
    try {
      const exec = promisify(childProcess.execFile);
      const { stdout } = await exec('yt-dlp', fullArgs, { maxBuffer: 50 * 1024 * 1024 });
      return stdout;
    } catch (err) {
      const e = err as { stderr?: string };
      if (e.stderr && detectRateLimit(e.stderr)) {
        const wait = BACKOFFS_SECONDS[attempt] * 1000;
        console.warn(`[yt-dlp] rate-limited, backing off ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  throw new Error('yt-dlp rate-limit retries exhausted');
}

export async function searchYtDlp(query: string, n: number = 30): Promise<SearchResult[]> {
  const stdout = await runYtDlp([
    '--flat-playlist', '--print-json',
    '--sleep-requests', '1.5', '--retries', '3', '--no-warnings',
    `ytsearch${n}:${query}`,
  ]);
  return stdout
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const obj = JSON.parse(line) as Record<string, unknown>;
      return {
        id: String(obj.id),
        title: String(obj.title ?? ''),
        duration: Number(obj.duration ?? 0),
      };
    });
}

export async function fetchMetadata(videoId: string): Promise<FullMetadata> {
  const stdout = await runYtDlp([
    '--skip-download', '--print-json', '--no-warnings',
    `https://www.youtube.com/watch?v=${videoId}`,
  ]);
  return JSON.parse(stdout) as FullMetadata;
}

export async function downloadSubtitle(videoId: string, cacheDir: string): Promise<void> {
  await runYtDlp([
    '--skip-download',
    '--write-subs', '--write-auto-subs',
    '--sub-langs', 'zh-Hant,zh-TW,zh,en',
    '--sub-format', 'vtt',
    '--output', `${cacheDir}/%(id)s.%(ext)s`,
    '--no-warnings',
    `https://www.youtube.com/watch?v=${videoId}`,
  ]);
}

export async function resolveChannelId(handle: string): Promise<string> {
  const stdout = await runYtDlp([
    '-J', '--playlist-end', '1', '--no-warnings',
    `https://www.youtube.com/${handle}/videos`,
  ]);
  const obj = JSON.parse(stdout) as { channel_id?: string };
  if (!obj.channel_id) throw new Error(`Cannot resolve channelId for ${handle}`);
  return obj.channel_id;
}
