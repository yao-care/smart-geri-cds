<script lang="ts">
  import { authStore } from '../../lib/stores/auth.svelte';
  import { getTenantId } from '../../lib/utils/tenant';
  import { toEmbedUrl } from '../../lib/utils/youtube';
  import { getCustomEducation } from '../../lib/db/custom-education';
  import type { CustomEducation } from '../../lib/db/schema';

  let items = $state<CustomEducation[]>([]);

  const tenantId = $derived(getTenantId(authStore.fhirBaseUrl));

  $effect(() => {
    getCustomEducation(tenantId).then((list) => {
      items = list;
    });
  });

  const categoryLabels: Record<string, string> = {
    diet: '飲食',
    sleep: '睡眠',
    respiratory: '呼吸',
    exercise: '運動',
    milestone: '里程碑',
    general: '高齡照護',
  };
</script>

{#if items.length > 0}
  <section class="custom-education" aria-label="醫院自訂衛教內容">
    <h2>醫院衛教內容</h2>
    <div class="custom-grid">
      {#each items as item (item.id)}
        <article class="custom-card">
          <span class="card-badge">{item.format === 'video' ? '\uD83C\uDFAC' : '\uD83D\uDCC4'} {categoryLabels[item.category] ?? item.category}</span>
          <h3>{item.title}</h3>
          <p>{item.summary}</p>
          {#if item.format === 'video' && item.videoUrl}
            {@const embed = toEmbedUrl(item.videoUrl)}
            {#if embed}
              <div class="video-embed">
                <iframe
                  src={embed}
                  title={item.title}
                  class="video-iframe"
                  allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowfullscreen
                ></iframe>
              </div>
            {:else}
              <a href={item.videoUrl} target="_blank" rel="noopener noreferrer" class="video-link">以原始連結開啟 &rarr;</a>
            {/if}
          {/if}
        </article>
      {/each}
    </div>
  </section>
{/if}

<style>
  .custom-education {
    margin-top: var(--space-8);
  }

  .custom-education h2 {
    font-size: var(--text-xl);
    margin-bottom: var(--space-4);
  }

  .custom-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: var(--space-4);
  }

  .custom-card {
    padding: var(--space-5);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    transition: border-color 0.2s ease;
  }

  .custom-card:hover {
    border-color: var(--accent);
  }

  .card-badge {
    display: inline-block;
    font-size: var(--text-xs);
    color: color-mix(in srgb, var(--accent) 85%, black);
    background: color-mix(in srgb, var(--accent) 10%, var(--bg));
    padding: var(--space-1) var(--space-3);
    border-radius: var(--radius-full);
    margin-bottom: var(--space-3);
  }

  .custom-card h3 {
    font-size: var(--text-sm);
    font-weight: var(--font-bold);
    margin-bottom: var(--space-2);
  }

  .custom-card p {
    font-size: var(--text-xs);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    margin-bottom: var(--space-3);
  }

  .video-embed {
    width: 100%;
    aspect-ratio: 16 / 9;
    background: black;
    border-radius: var(--radius-md);
    overflow: hidden;
    margin-top: var(--space-2);
  }

  .video-iframe {
    width: 100%;
    height: 100%;
    border: none;
  }

  .video-link {
    font-size: var(--text-xs);
    color: var(--accent);
    text-decoration: none;
  }

  .video-link:hover {
    text-decoration: underline;
  }
</style>
