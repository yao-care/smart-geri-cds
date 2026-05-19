<script lang="ts">
import type { RuntimeVideo } from '$lib/education/schemas';

interface Props { video: RuntimeVideo; }
const { video }: Props = $props();

let showIframe = $state(false);
let thumbFailed = $state(false);

const tierLabel: Record<RuntimeVideo['sourceTier'], string> = {
  'official-tw': '官方',
  international: '國際',
  'pro-kol': '專業',
};

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  return `${m} 分 ${s} 秒`;
}

function isSessionFailed(id: string): boolean {
  if (typeof window === 'undefined' || !('sessionStorage' in window)) return false;
  try {
    const set = sessionStorage.getItem('failed-thumbnails');
    return set ? set.split(',').includes(id) : false;
  } catch { return false; }
}

function markSessionFailed(id: string): void {
  if (typeof window === 'undefined' || !('sessionStorage' in window)) return;
  try {
    const cur = sessionStorage.getItem('failed-thumbnails') ?? '';
    sessionStorage.setItem('failed-thumbnails', cur ? `${cur},${id}` : id);
  } catch {}
}

$effect(() => { if (isSessionFailed(video.videoId)) thumbFailed = true; });

function onPlay() { showIframe = true; }
function onImgError() { markSessionFailed(video.videoId); thumbFailed = true; }
</script>

<article class="video-card">
  {#if !showIframe}
    {#if !thumbFailed}
      <button
        type="button"
        onclick={onPlay}
        aria-label={`播放影片：${video.title}（${fmtDuration(video.duration)}）`}
      >
        <img
          src={`https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`}
          alt={video.title}
          loading="lazy"
          referrerpolicy="no-referrer"
          onerror={onImgError}
        />
        <span class="play-icon" aria-hidden="true">▶</span>
      </button>
    {:else}
      <button
        type="button"
        onclick={onPlay}
        class="no-thumbnail"
        aria-label={`播放影片：${video.title}（${fmtDuration(video.duration)}）`}
      >
        <span class="big-title">{video.title}</span>
        <span class="play-icon" aria-hidden="true">▶ 觀看</span>
      </button>
    {/if}
  {:else}
    <iframe
      src={`https://www.youtube-nocookie.com/embed/${video.videoId}?cc_load_policy=1&hl=zh-Hant&modestbranding=1&autoplay=1`}
      title={video.title}
      loading="lazy"
      allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
      referrerpolicy="no-referrer"
      allowfullscreen
    ></iframe>
  {/if}
  <div class="meta">
    <span class="badge">{tierLabel[video.sourceTier]}</span>
    <span class="title">{video.title}</span>
    <span class="duration">{fmtDuration(video.duration)}</span>
  </div>
</article>

<style>
.video-card { display: flex; flex-direction: column; min-width: 280px; }
.video-card button { min-height: 44px; padding: 0; border: 0; background: transparent; cursor: pointer; }
.video-card img { width: 100%; aspect-ratio: 16/9; object-fit: cover; border-radius: var(--radius-md, 8px); }
.video-card iframe { width: 100%; aspect-ratio: 16/9; border: 0; border-radius: var(--radius-md, 8px); }
.no-thumbnail { aspect-ratio: 16/9; background: var(--color-bg-muted, #eaeaea); display: flex; flex-direction: column; justify-content: center; align-items: center; padding: var(--space-md, 16px); }
.no-thumbnail .big-title { font-size: var(--text-lg, 22px); font-weight: 600; line-height: 1.3; }
.play-icon { font-size: var(--text-base, 18px); margin-top: var(--space-sm, 8px); }
.meta { padding: var(--space-sm, 8px) 0; display: flex; gap: var(--space-sm, 8px); align-items: center; flex-wrap: wrap; }
.badge { background: var(--color-bg-accent, #ddd); padding: 2px 8px; border-radius: 12px; font-size: var(--text-sm, 16px); }
.title { font-size: var(--text-base, 18px); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; flex: 1; }
.duration { font-size: var(--text-sm, 16px); color: var(--color-text-muted, #666); }
</style>
