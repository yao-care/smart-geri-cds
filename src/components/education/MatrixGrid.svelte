<script lang="ts">
  import { DOMAIN_TOPS, DOMAIN_TREE, DOMAIN_TOP_LABELS, domainLabel } from '../../lib/domain/domain-tree';
  import { CFS_LEVELS, CFS_LABELS, type CfsLevel } from '../../lib/utils/cfs-levels';
  import { cellResourceCount, heatBucket, type CellViews } from '$lib/education/matrix-view';

  interface Props {
    cells: CellViews;
    selectedKey: string | null;
    onselect: (key: string) => void;
  }
  let { cells, selectedKey, onselect }: Props = $props();

  let collapsed = $state<Record<string, boolean>>({});
  function toggle(top: string) { collapsed = { ...collapsed, [top]: !collapsed[top] }; }

  const CFS_COL_LABEL = Object.fromEntries(
    CFS_LEVELS.map(l => [l, `${l.replace('cfs', '')} ${CFS_LABELS[l]}`]),
  );

  function cellAria(top: string, sub: string, cfs: CfsLevel, count: number): string {
    return `${domainLabel(top, sub)}，CFS ${cfs.replace('cfs', '')}（${CFS_LABELS[cfs]}），${count > 0 ? `${count} 項資源` : '待補'}`;
  }

  // 方向鍵在格按鈕間移動 focus（roving）。以 DOM 相鄰列查找，天然跳過群組標題列與不適用格。
  function onGridKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.tagName !== 'BUTTON' || target.dataset.c === undefined) return;
    const c = Number(target.dataset.c);
    let next: HTMLButtonElement | null = null;

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const dc = e.key === 'ArrowRight' ? 1 : -1;
      const row = target.closest('tr');
      next = row?.querySelector<HTMLButtonElement>(`button[data-c="${c + dc}"]`) ?? null;
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const dir = e.key === 'ArrowDown' ? 'nextElementSibling' : 'previousElementSibling';
      let row = target.closest('tr')?.[dir] as HTMLElement | null;
      // 跳過沒有對應欄按鈕的列（群組標題列、或該欄不適用的列）
      while (row && !row.querySelector(`button[data-c="${c}"]`)) {
        row = row[dir] as HTMLElement | null;
      }
      next = row?.querySelector<HTMLButtonElement>(`button[data-c="${c}"]`) ?? null;
    } else {
      return;
    }

    if (next) { e.preventDefault(); next.focus(); }
  }
</script>

<div class="grid-scroll">
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <table class="matrix" onkeydown={onGridKeydown}>
    <thead>
      <tr>
        <th class="corner">領域＼CFS</th>
        {#each CFS_LEVELS as cfs}<th class="cfs-col">{CFS_COL_LABEL[cfs]}</th>{/each}
      </tr>
    </thead>
    <tbody>
      {#each DOMAIN_TOPS as top}
        <tr class="group-row">
          <th class="group-header" colspan={CFS_LEVELS.length + 1}>
            <button class="group-toggle" type="button" onclick={() => toggle(top)} aria-expanded={!collapsed[top]}>
              <span class="chevron">{collapsed[top] ? '▶' : '▼'}</span> {DOMAIN_TOP_LABELS[top]}
            </button>
          </th>
        </tr>
        {#if !collapsed[top]}
          {#each DOMAIN_TREE[top] as sub}
            <tr>
              <th class="domain-header">{domainLabel(top, sub)}</th>
              {#each CFS_LEVELS as cfs, ci}
                {@const key = `${top}.${sub}:${cfs}`}
                {@const cell = cells[key]}
                <td class="cell">
                  {#if !cell || cell.inapplicable}
                    <span class="na" aria-hidden="true">–</span>
                  {:else}
                    {@const count = cellResourceCount(cell)}
                    <button
                      class="cell-btn"
                      type="button"
                      data-heat={heatBucket(count)}
                      data-c={ci}
                      aria-current={key === selectedKey ? 'true' : undefined}
                      aria-label={cellAria(top, sub, cfs, count)}
                      onclick={() => onselect(key)}
                    >{count > 0 ? count : '·'}</button>
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
        {/if}
      {/each}
    </tbody>
  </table>
</div>

<style>
  .grid-scroll { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
  .matrix { border-collapse: collapse; min-width: 640px; width: 100%; }
  .matrix th, .matrix td { border: 1px solid var(--line); padding: 0; vertical-align: middle; }

  thead th { position: sticky; top: 0; z-index: 2; background: color-mix(in srgb, var(--bg), var(--text) 3%); }
  .corner {
    position: sticky; left: 0; z-index: 3; width: 6rem; white-space: nowrap;
    font-size: var(--text-xs); padding: var(--space-2);
  }
  .cfs-col { font-size: var(--text-xs); text-align: center; padding: var(--space-2) var(--space-1); white-space: nowrap; }

  .group-header { text-align: left; padding: 0; background: color-mix(in srgb, var(--accent) 8%, var(--bg)); }
  .group-toggle {
    width: 100%; text-align: left; background: none; border: none; cursor: pointer;
    font-size: var(--text-sm); font-weight: var(--font-bold); color: var(--accent);
    padding: var(--space-2) var(--space-3); min-height: 44px;
  }
  .chevron { display: inline-block; width: 1em; }

  .domain-header {
    position: sticky; left: 0; z-index: 1;
    font-size: var(--text-sm); font-weight: var(--font-medium);
    padding: var(--space-2) var(--space-3); text-align: left; white-space: nowrap;
    background: color-mix(in srgb, var(--bg), var(--text) 2%);
  }
  .cell { text-align: center; min-width: var(--space-9); }
  .na { color: color-mix(in srgb, var(--text), var(--bg) 60%); font-size: var(--text-base); }

  .cell-btn {
    width: 100%; min-width: 44px; min-height: 44px; border: none; cursor: pointer;
    font-size: var(--text-base); color: var(--text); background: transparent;
  }
  .cell-btn[data-heat="0"] { color: color-mix(in srgb, var(--text), var(--bg) 50%); }
  .cell-btn[data-heat="1"] { background: color-mix(in srgb, var(--accent) 12%, var(--bg)); }
  .cell-btn[data-heat="2"] { background: color-mix(in srgb, var(--accent) 24%, var(--bg)); }
  .cell-btn[data-heat="3"] { background: color-mix(in srgb, var(--accent) 38%, var(--bg)); }
  .cell-btn[data-heat="4"] { background: color-mix(in srgb, var(--accent) 55%, var(--bg)); color: var(--text); }
  .cell-btn:hover { outline: 2px solid color-mix(in srgb, var(--accent) 50%, var(--bg)); outline-offset: -2px; }
  .cell-btn[aria-current="true"] { outline: 3px solid var(--accent); outline-offset: -3px; font-weight: var(--font-bold); }
</style>
