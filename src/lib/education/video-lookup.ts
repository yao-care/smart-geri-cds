import type { CustomVideo, RuntimeIndex, RuntimeVideo } from './schemas';
import { CFS_LEVELS, type CfsLevel } from '../utils/cfs-levels';
import { mergeCustomVideos } from './merge-custom-videos';
import { CFS_FALLBACK_CHAIN } from './cfs-fallback';
import { loadVideoIndex } from './index-loader';

// Matches both cga.triage.<cat>.<cfs> and cga.domain.<top>.<sub>.anomaly.<cfs>.
// Captures everything up to (but not including) the trailing CFS level.
const CGA_TRIGGER_REGEX = new RegExp(
  `^(cga\\.(?:triage|domain)\\..+)\\.(${CFS_LEVELS.join('|')})$`,
);

// Re-export for callers that imported loadIndex via video-lookup (none currently, but kept for safety)
export { loadVideoIndex as loadIndex };

export interface VideoLookupOptions {
  maxResults?: number;
  cfsFallback?: boolean;
}

export function tryCfsFallback(trigger: string, idx: RuntimeIndex): string[] {
  const m = trigger.match(CGA_TRIGGER_REGEX);
  if (!m) return [];
  const [, prefix, currentCfs] = m;
  const chain = CFS_FALLBACK_CHAIN[currentCfs as CfsLevel] ?? [];
  for (const altCfs of chain) {
    const altTrigger = `${prefix}.${altCfs}`;
    const altEntry = idx.triggers[altTrigger];
    if (!altEntry || altEntry.inapplicable) continue;
    if (altEntry.videoIds.length === 0) continue;
    return altEntry.videoIds;
  }
  return [];
}

export async function getVideosForTrigger(
  trigger: string,
  customVideos: CustomVideo[] = [],
  options: VideoLookupOptions = {},
): Promise<RuntimeVideo[]> {
  const idx = await loadVideoIndex();
  const entry = idx.triggers[trigger];

  if (entry?.inapplicable) return [];

  const opts = { maxResults: 3, cfsFallback: false, ...options };
  let ids = entry?.videoIds ?? [];
  if (ids.length === 0 && opts.cfsFallback) {
    ids = tryCfsFallback(trigger, idx);
  }

  const staticVideos = ids
    .map(id => idx.catalog[id])
    .filter((v): v is RuntimeVideo => v != null)
    .sort((a, b) => b.score - a.score);

  return mergeCustomVideos(staticVideos, customVideos, trigger, opts);
}

export async function getVideosForTriggers(
  triggerList: string[],
  customVideos: CustomVideo[] = [],
  options?: VideoLookupOptions,
): Promise<Record<string, RuntimeVideo[]>> {
  const results = await Promise.all(
    triggerList.map(async t => [t, await getVideosForTrigger(t, customVideos, options)] as const),
  );
  return Object.fromEntries(results);
}
