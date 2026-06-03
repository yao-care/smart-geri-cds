<script lang="ts">
  import MatrixGrid from './MatrixGrid.svelte';
  import DetailPanel from './DetailPanel.svelte';
  import { matrixCoverage, type CellViews } from '$lib/education/matrix-view';

  interface ArticleContent { title: string; summary: string; content: string; }
  interface Props {
    cells: CellViews;
    articleContent: Record<string, ArticleContent>;
  }
  let { cells, articleContent }: Props = $props();

  let selectedKey = $state<string | null>(null);
  let selectedCell = $derived(selectedKey ? cells[selectedKey] ?? null : null);
  let coverage = $derived(matrixCoverage(cells));

  function select(key: string) { selectedKey = key; }
  function close() { selectedKey = null; }

  $effect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<div class="layout" class:has-selection={selectedKey != null}>
  <div class="grid-col">
    <MatrixGrid {cells} {selectedKey} onselect={select} />
  </div>

  <!-- 遮罩：僅手機 sheet 開啟時可見 -->
  <!-- svelte-ignore a11y_consider_explicit_label -->
  <button class="scrim" type="button" aria-label="關閉" onclick={close}></button>

  <aside class="detail-col" aria-live="polite">
    <button class="sheet-close" type="button" aria-label="關閉" onclick={close}>✕</button>
    <DetailPanel {selectedKey} cell={selectedCell} {articleContent} {coverage} />
  </aside>
</div>

<style>
  .layout { display: grid; grid-template-columns: 60% 40%; gap: var(--space-4); align-items: start; }
  .grid-col { min-width: 0; }
  .detail-col {
    position: sticky; top: var(--space-4); max-height: calc(100vh - var(--space-8));
    overflow-y: auto; border: 1px solid var(--line); border-radius: var(--radius-md);
    background: var(--surface); padding: var(--space-4);
  }
  .sheet-close { display: none; }
  .scrim { display: none; }

  /* 手機：單欄 + bottom sheet */
  @media (max-width: 1023px) {
    .layout { display: block; }
    .scrim {
      position: fixed; inset: 0; z-index: 900; border: none; cursor: pointer;
      background: color-mix(in srgb, var(--text) 40%, transparent);
      opacity: 0; pointer-events: none; transition: opacity 0.2s ease;
    }
    .layout.has-selection .scrim { opacity: 1; pointer-events: auto; }
    .detail-col {
      position: fixed; left: 0; right: 0; bottom: 0; top: auto; z-index: 1000;
      max-height: 80vh; border-radius: var(--radius-lg) var(--radius-lg) 0 0;
      background: var(--bg); transform: translateY(100%); transition: transform 0.25s ease;
    }
    .layout.has-selection .detail-col { transform: translateY(0); }
    .sheet-close {
      display: inline-flex; align-items: center; justify-content: center;
      position: absolute; top: var(--space-2); right: var(--space-2);
      min-width: 44px; min-height: 44px; background: none; border: none; cursor: pointer;
      font-size: var(--text-lg); color: var(--text); line-height: 1;
    }
  }
</style>
