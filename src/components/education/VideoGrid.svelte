<script lang="ts">
import type { RuntimeVideo } from '$lib/education/schemas';
import VideoCard from './VideoCard.svelte';

interface Props { videos: RuntimeVideo[]; maxResults?: number; }
const { videos, maxResults = 3 }: Props = $props();

let expanded = $state(false);

const sorted = $derived([...videos].sort((a, b) => {
  const diff = b.score - a.score;
  if (Math.abs(diff) < 0.05) {
    const rank = { 'official-tw': 0, international: 1, 'pro-kol': 2 };
    return rank[a.sourceTier] - rank[b.sourceTier];
  }
  return diff;
}));

const display = $derived(expanded ? sorted : sorted.slice(0, maxResults));
const hasMore = $derived(sorted.length > maxResults);
</script>

<div class="video-grid">
  {#each display as v (v.videoId)}
    <VideoCard video={v} />
  {/each}
  {#if hasMore && !expanded}
    <button class="expand-btn" type="button" onclick={() => expanded = true}>
      展開其餘 {sorted.length - maxResults} 支影片
    </button>
  {/if}
</div>

<style>
.video-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--space-md, 16px); }
.expand-btn { min-height: 44px; background: transparent; border: 1px dashed var(--color-border, #ccc); border-radius: var(--radius-md, 8px); padding: var(--space-md, 16px); font-size: var(--text-base, 18px); cursor: pointer; grid-column: 1 / -1; }
</style>
