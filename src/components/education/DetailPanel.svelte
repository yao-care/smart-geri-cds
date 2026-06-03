<script lang="ts">
  import ContributionForm from './ContributionForm.svelte';
  import { domainLabel } from '../../lib/domain/domain-tree';
  import { CFS_LABELS } from '../../lib/utils/cfs-levels';
  import type { CellView } from '$lib/education/matrix-view';
  import type { Coverage } from '$lib/education/matrix-view';

  type FormAction = 'add' | 'edit-article' | 'delete-article' | 'delete-video';
  interface Prefill { slug?: string; title?: string; summary?: string; content?: string; videoId?: string; videoTitle?: string; }
  interface ArticleContent { title: string; summary: string; content: string; }
  interface Props {
    selectedKey: string | null;
    cell: CellView | null;
    articleContent: Record<string, ArticleContent>;
    coverage: Coverage;
  }
  let { selectedKey, cell, articleContent, coverage }: Props = $props();

  let form = $state<{ action: FormAction; prefill: Prefill } | null>(null);

  // 切換選格時收掉開著的表單
  $effect(() => {
    selectedKey; // track
    form = null;
  });

  let parts = $derived.by(() => {
    if (!selectedKey) return null;
    const [domain, cfs] = selectedKey.split(':');
    const [top, sub] = domain.split('.');
    return { top, sub, cfs };
  });

  function subLabel(): string { return parts ? domainLabel(parts.top, parts.sub) : ''; }
  function cfsText(): string {
    if (!parts) return '';
    const n = parts.cfs.replace('cfs', '');
    const label = (CFS_LABELS as Record<string, string>)[parts.cfs] ?? '';
    return `CFS ${n}（${label}）`;
  }

  function fmtDuration(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = String(sec % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  function startAdd() { form = { action: 'add', prefill: {} }; }
  function editArticle(slug: string) {
    const c = articleContent[slug];
    form = { action: 'edit-article', prefill: { slug, title: c?.title ?? '', summary: c?.summary ?? '', content: c?.content ?? '' } };
  }
  function deleteArticle(slug: string) { form = { action: 'delete-article', prefill: { slug } }; }
  function deleteVideo(videoId: string, videoTitle: string) { form = { action: 'delete-video', prefill: { videoId, videoTitle } }; }
</script>

<div class="panel">
  {#if !selectedKey || !cell || !parts}
    <div class="empty">
      <p class="empty-title">◐ 衛教資源地圖</p>
      <p class="empty-hint">點左側任一格子，查看該情境的衛教資源、或提交貢獻。</p>
      <div class="coverage">
        <p class="coverage-row"><strong>{coverage.withResources}</strong> 格有資源</p>
        <p class="coverage-row coverage-gap"><strong>{coverage.empty}</strong> 格待補</p>
        <p class="coverage-row coverage-na"><strong>{coverage.inapplicable}</strong> 格不適用</p>
      </div>
    </div>
  {:else if form}
    <ContributionForm
      top={parts.top} sub={parts.sub} cfsLevel={parts.cfs}
      action={form.action} prefill={form.prefill}
      onback={() => (form = null)}
    />
  {:else}
    <header class="read-head">
      <h3>{subLabel()}</h3>
      <p class="read-cfs">{cfsText()}</p>
    </header>

    <section class="read-section">
      <p class="section-label">📄 官方文章 ({cell.articles.length})</p>
      {#if cell.articles.length > 0}
        <ul class="res-list">
          {#each cell.articles as a (a.slug)}
            <li class="res-item">
              <a class="article-link" href={`/education/${a.slug}/`}>{a.title}</a>
              <button class="item-action" type="button" aria-label="修改文章" onclick={() => editArticle(a.slug)}>✏️</button>
              <button class="item-action" type="button" aria-label="刪除文章" onclick={() => deleteArticle(a.slug)}>🗑️</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="none">尚無文章</p>
      {/if}
    </section>

    <section class="read-section">
      <p class="section-label">🎬 官方影片 ({cell.videos.length})</p>
      {#if cell.videos.length > 0}
        <ul class="res-list">
          {#each cell.videos as v (v.videoId)}
            <li class="res-item">
              <a class="video-item" href={`https://www.youtube.com/watch?v=${v.videoId}`} target="_blank" rel="noopener noreferrer">
                <img class="video-thumb" src={`https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`} alt={v.title} loading="lazy" referrerpolicy="no-referrer" />
                <span class="video-info">
                  <span class="video-title">{v.title}</span>
                  <span class="video-meta">{v.channel} · {fmtDuration(v.duration)}</span>
                </span>
              </a>
              <button class="item-action" type="button" aria-label="刪除影片" onclick={() => deleteVideo(v.videoId, v.title)}>🗑️</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="none">尚無影片</p>
      {/if}
    </section>

    <button class="contribute-btn" type="button" onclick={startAdd}>＋ 貢獻資源</button>
  {/if}
</div>

<style>
  .panel { display: flex; flex-direction: column; gap: var(--space-3); }
  .empty { text-align: center; padding: var(--space-6) var(--space-3); }
  .empty-title { font-size: var(--text-lg); font-weight: var(--font-bold); margin: 0 0 var(--space-3); color: var(--accent); }
  .empty-hint { font-size: var(--text-sm); color: color-mix(in srgb, var(--text), var(--bg) 30%); margin: 0 0 var(--space-5); }
  .coverage { display: flex; flex-direction: column; gap: var(--space-2); align-items: center; }
  .coverage-row { font-size: var(--text-sm); margin: 0; }
  .coverage-gap strong { color: var(--warn); }
  .coverage-na strong { color: color-mix(in srgb, var(--text), var(--bg) 40%); }

  .read-head { border-bottom: 1px solid var(--line); padding-bottom: var(--space-2); }
  .read-head h3 { font-size: var(--text-lg); margin: 0; }
  .read-cfs { font-size: var(--text-sm); color: color-mix(in srgb, var(--text), var(--bg) 30%); margin: var(--space-1) 0 0; }

  .read-section { display: flex; flex-direction: column; gap: var(--space-2); }
  .section-label { font-size: var(--text-sm); font-weight: var(--font-medium); margin: 0; }
  .none { font-size: var(--text-sm); color: color-mix(in srgb, var(--text), var(--bg) 45%); margin: 0; }

  .res-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  .res-item { display: flex; align-items: flex-start; gap: var(--space-1); }
  .article-link { flex: 1; min-width: 0; font-size: var(--text-base); color: var(--accent); text-decoration: none; padding: var(--space-1) 0; }
  .article-link:hover { text-decoration: underline; }

  .video-item { flex: 1; min-width: 0; display: flex; gap: var(--space-2); align-items: flex-start; text-decoration: none; color: inherit; }
  .video-thumb { width: var(--space-12); aspect-ratio: 16/9; object-fit: cover; border-radius: var(--radius-sm); flex-shrink: 0; }
  .video-info { display: flex; flex-direction: column; gap: var(--space-1); min-width: 0; }
  .video-title { font-size: var(--text-sm); font-weight: var(--font-medium); color: var(--text); }
  .video-meta { font-size: var(--text-xs); color: color-mix(in srgb, var(--text), var(--bg) 40%); }

  .item-action {
    flex-shrink: 0; background: none; border: none; cursor: pointer; font-size: var(--text-base);
    color: color-mix(in srgb, var(--text), var(--bg) 50%); padding: var(--space-1);
    min-height: 44px; min-width: 44px; display: inline-flex; align-items: center; justify-content: center;
    border-radius: var(--radius-sm); line-height: 1;
  }
  .item-action:hover { background: color-mix(in srgb, var(--text) 8%, var(--bg)); color: var(--text); }

  .contribute-btn {
    display: block; width: 100%; margin-top: var(--space-2); padding: var(--space-3);
    background: color-mix(in srgb, var(--accent) 8%, var(--bg)); color: var(--accent);
    border: 1px dashed var(--accent); border-radius: var(--radius-sm); font-size: var(--text-base);
    cursor: pointer; min-height: 44px; text-align: center;
  }
  .contribute-btn:hover { background: color-mix(in srgb, var(--accent) 15%, var(--bg)); }
</style>
