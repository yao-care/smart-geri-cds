<script lang="ts">
import { getVideosForTriggers } from '$lib/education/video-lookup';
import type { RuntimeVideo } from '$lib/education/schemas';
import VideoGrid from './VideoGrid.svelte';

interface Props { triggers: string[]; }
const { triggers }: Props = $props();

let videosByTrigger = $state<Record<string, RuntimeVideo[]>>({});

$effect(() => {
  if (triggers.length === 0) { videosByTrigger = {}; return; }
  getVideosForTriggers(triggers, [], { maxResults: 3, ageGroupFallback: true })
    .then(result => { videosByTrigger = result; })
    .catch(err => { console.error('[TriggerVideoList] lookup failed', err); });
});
</script>

{#each Object.entries(videosByTrigger) as [trigger, videos] (trigger)}
  {#if videos.length > 0}
    <section class="trigger-videos" data-trigger={trigger}>
      <VideoGrid {videos} />
    </section>
  {/if}
{/each}

<style>
.trigger-videos { margin: var(--space-lg, 24px) 0; }
</style>
