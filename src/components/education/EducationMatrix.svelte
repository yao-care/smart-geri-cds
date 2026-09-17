<script lang="ts">
  import MatrixGrid from './MatrixGrid.svelte';
  import DetailPanel from './DetailPanel.svelte';
  import { matrixCoverage, type CellViews } from '$lib/education/matrix-view';
  import { domainLabel } from '../../lib/domain/domain-tree';
  import { CFS_LABELS } from '../../lib/utils/cfs-levels';

  interface ArticleContent { title: string; summary: string; content: string; }
  interface Props {
    cells: CellViews;
    articleContent: Record<string, ArticleContent>;
  }
  let { cells, articleContent }: Props = $props();

  let selectedKey = $state<string | null>(null);
  let selectedCell = $derived(selectedKey ? cells[selectedKey] ?? null : null);
  let coverage = $derived(matrixCoverage(cells));
  let liveMsg = $derived.by(() => {
    if (!selectedKey) return '';
    const [domain, cfs] = selectedKey.split(':');
    const [top, sub] = domain.split('.');
    const label = (CFS_LABELS as Record<string, string>)[cfs] ?? '';
    return `已選取 ${domainLabel(top, sub)}，CFS ${cfs.replace('cfs', '')}（${label}）`;
  });

  // 桌機是並排面板（無 modal 語意）；手機是覆蓋畫面的 bottom sheet，才需要 dialog + 焦點管理。
  let isMobile = $state(false);
  $effect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(max-width: 1023px)');
    isMobile = mq.matches;
    const onChange = (e: MediaQueryListEvent) => (isMobile = e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  });
  let sheetOpen = $derived(isMobile && selectedKey != null);

  let sheetEl = $state<HTMLElement | null>(null);
  let closeBtnEl = $state<HTMLButtonElement | null>(null);
  let lastTrigger: HTMLElement | null = null;

  function select(key: string) {
    lastTrigger = document.activeElement as HTMLElement | null;
    selectedKey = key;
  }
  function close() {
    selectedKey = null;
    // 關閉後把焦點還給觸發的格子，否則鍵盤使用者會被丟回文件開頭。
    lastTrigger?.focus();
    lastTrigger = null;
  }

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  function sheetFocusables(): HTMLElement[] {
    return sheetEl ? [...sheetEl.querySelectorAll<HTMLElement>(FOCUSABLE)] : [];
  }

  // sheet 開啟時把焦點移入面板（只在開啟的那一刻做，不干擾使用者後續移動焦點）。
  let wasOpen = false;
  $effect(() => {
    const open = sheetOpen;
    if (open && !wasOpen) closeBtnEl?.focus();
    wasOpen = open;
  });

  $effect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key !== 'Tab' || !sheetOpen) return;
      // focus-trap：inert 已擋掉矩陣，但 sheet 外仍有頁首等可聚焦元素，故自行循環。
      const items = sheetFocusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && !!sheetEl?.contains(active);
      if (e.shiftKey && (!inside || active === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || active === last)) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

<div class="layout" class:has-selection={selectedKey != null}>
  <p class="sr-only" aria-live="polite">{liveMsg}</p>
  <div class="grid-col" inert={sheetOpen}>
    <MatrixGrid {cells} {selectedKey} onselect={select} />
  </div>

  <!-- 遮罩：僅手機 sheet 開啟時可見；tabindex=-1 讓它留在焦點循環之外（✕ 與 Escape 已可關閉） -->
  <button class="scrim" type="button" tabindex="-1" aria-hidden="true" onclick={close}></button>

  <aside
    class="detail-col"
    bind:this={sheetEl}
    role={sheetOpen ? 'dialog' : undefined}
    aria-modal={sheetOpen ? 'true' : undefined}
    aria-label={sheetOpen ? (liveMsg || '格子詳情') : undefined}
  >
    <button class="sheet-close" type="button" aria-label="關閉面板" bind:this={closeBtnEl} onclick={close}>✕</button>
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
