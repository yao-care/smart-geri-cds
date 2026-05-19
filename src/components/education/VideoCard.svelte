<script lang="ts">
import type { RuntimeVideo } from '$lib/education/schemas';

interface Props { video: RuntimeVideo; }
const { video }: Props = $props();

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

const watchUrl = $derived(`https://www.youtube.com/watch?v=${video.videoId}`);

function onImgError() { thumbFailed = true; }
</script>

<article class="video-card">
  <a
    class="thumb-link"
    href={watchUrl}
    target="_blank"
    rel="noopener noreferrer"
    aria-label={`在 YouTube 觀看：${video.title}（${fmtDuration(video.duration)}）`}
  >
    {#if !thumbFailed}
      <img
        src={`https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`}
        alt={video.title}
        loading="lazy"
        referrerpolicy="no-referrer"
        onerror={onImgError}
      />
    {:else}
      <span class="no-thumbnail">
        <span class="big-title">{video.title}</span>
      </span>
    {/if}
    <span class="play-icon" aria-hidden="true">▶</span>
  </a>
  <div class="meta">
    <span class="badge">{tierLabel[video.sourceTier]}</span>
    <span class="title">{video.title}</span>
    <span class="duration">{fmtDuration(video.duration)}</span>
  </div>
</article>

<style>
.video-card { display: flex; flex-direction: column; min-width: 280px; }
.thumb-link {
  position: relative;
  display: block;
  min-height: 44px;
  border-radius: var(--radius-md);
  overflow: hidden;
  text-decoration: none;
  color: inherit;
}
.thumb-link img { width: 100%; aspect-ratio: 16/9; object-fit: cover; display: block; }
.no-thumbnail {
  aspect-ratio: 16/9;
  background: var(--surface);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: var(--space-4);
  text-align: center;
}
.no-thumbnail .big-title { font-size: var(--text-lg); font-weight: var(--font-bold); line-height: 1.3; }
.play-icon {
  position: absolute;
  inset: auto auto var(--space-2) var(--space-2);
  padding: var(--space-1) var(--space-2);
  background: oklch(0 0 0 / 0.6);
  color: white;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
}
.meta { padding: var(--space-2) 0; display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; }
.badge { background: var(--surface); padding: var(--space-1) var(--space-2); border-radius: var(--radius-lg); font-size: var(--text-sm); }
.title { font-size: var(--text-base); display: -webkit-box; line-clamp: 2; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; flex: 1; }
.duration { font-size: var(--text-sm); color: var(--text); opacity: 0.7; }
</style>
