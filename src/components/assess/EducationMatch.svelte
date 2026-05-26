<script lang="ts">
  import { authStore } from '../../lib/stores/auth.svelte';
  import { getTenantId } from '../../lib/utils/tenant';
  import {
    mergeRecommendationsForContext,
    resolveItemDisplay,
  } from '../../lib/db/recommendations';
  import type { RecommendationCategory } from '../../lib/db/schema';
  import type { AgeGroupCDSA } from '../../lib/utils/age-groups';

  interface Props {
    category: RecommendationCategory;
    domains: string[];
    ageGroup: AgeGroupCDSA;
  }

  let { category, domains, ageGroup }: Props = $props();

  const tenantId = $derived(getTenantId(authStore.fhirBaseUrl));

  interface ResolvedItem {
    href: string;
    title: string;
    summary: string;
    isExternal: boolean;
  }

  let resolved = $state<ResolvedItem[]>([]);
  let loading = $state(true);

  $effect(() => {
    // Snapshot reactive deps before async boundary
    const cat = category;
    const ds = domains;
    const tid = tenantId;
    const ag = ageGroup;
    loading = true;
    (async () => {
      const items = await mergeRecommendationsForContext(tid, cat, ds, ag);
      const display = await Promise.all(items.map((i) => resolveItemDisplay(i, tid)));
      resolved = display;
      loading = false;
    })();
  });
</script>

{#if loading}
  <p class="loading">推薦清單載入中…</p>
{:else if resolved.length > 0}
  <div class="education-match">
    {#each resolved as rec}
      {#if rec.isExternal}
        <a
          href={rec.href}
          target="_blank"
          rel="noopener noreferrer"
          class="edu-card"
        >
          <h4>{rec.title}</h4>
          <p>{rec.summary}</p>
          <span class="read-link">前往 ↗</span>
        </a>
      {:else}
        <a href={rec.href} class="edu-card">
          <h4>{rec.title}</h4>
          <p>{rec.summary}</p>
          <span class="read-link">閱讀 →</span>
        </a>
      {/if}
    {/each}
  </div>
{:else}
  <p class="no-recommendations">目前無特別建議。持續關注孩子的發展即可。</p>
{/if}

<style>
  .loading {
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    font-size: var(--text-sm);
    text-align: center;
    padding: var(--space-4);
  }

  .education-match {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: var(--space-4);
  }

  .edu-card {
    display: block;
    padding: var(--space-5);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    text-decoration: none;
    color: inherit;
    transition: border-color 0.2s;
  }

  .edu-card:hover {
    border-color: var(--accent);
  }

  .edu-card h4 {
    font-size: var(--text-sm);
    font-weight: var(--font-bold);
    margin-bottom: var(--space-2);
    color: var(--text);
  }

  .edu-card p {
    font-size: var(--text-xs);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    margin-bottom: var(--space-3);
  }

  .read-link {
    font-size: var(--text-xs);
    color: var(--accent);
    font-weight: var(--font-medium);
  }

  .no-recommendations {
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    font-size: var(--text-sm);
    text-align: center;
    padding: var(--space-4);
  }
</style>
