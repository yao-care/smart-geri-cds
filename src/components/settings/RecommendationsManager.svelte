<script lang="ts">
  import { authStore } from '../../lib/stores/auth.svelte';
  import { getTenantId, getTenantDisplayName } from '../../lib/utils/tenant';
  import {
    DOMAINS,
    CATEGORIES,
    getDefaultRecommendations,
    getOverlay,
    saveOverlay,
    clearOverlay,
  } from '../../lib/db/recommendations';
  import {
    type RecommendationCategory,
    type RecommendationItem,
    type RecommendationSource,
    type CustomEducation,
  } from '../../lib/db/schema';
  import { getCustomEducation } from '../../lib/db/custom-education';
  import { loadVideoIndex } from '../../lib/education/index-loader';
  import { AGE_GROUPS_CDSA } from '../../lib/utils/age-groups';

  const DOMAIN_LABELS: Record<string, string> = {
    behavior: '生活行為',
    gross_motor: '粗動作',
    fine_motor: '精細動作',
    language: '語言',
    language_comprehension: '語言理解',
    language_expression: '語言表達',
    cognition: '認知',
    social_emotional: '社會情緒',
  };

  const CATEGORY_LABELS: Record<RecommendationCategory, string> = {
    normal: '正常',
    monitor: '追蹤觀察',
    refer: '建議轉介',
  };

  const SOURCE_LABELS: Record<RecommendationSource, string> = {
    internal: '系統內建衛教',
    custom: '醫院自上傳',
    external: '外部連結',
  };

  // Internal article slugs loaded from the index (replaces hardcoded list).
  let internalSlugs = $state<string[]>([]);

  // Load slug list once on mount
  $effect(() => {
    (async () => {
      try {
        const idx = await loadVideoIndex();
        internalSlugs = idx.articleSlugs ?? [];
      } catch {
        internalSlugs = [];
      }
    })();
  });

  const tenantId = $derived(getTenantId(authStore.fhirBaseUrl));
  const tenantDisplay = $derived(getTenantDisplayName(authStore.fhirBaseUrl));

  let activeCategory = $state<RecommendationCategory>('monitor');
  let customEducation = $state<CustomEducation[]>([]);

  // Per-domain editor state — keyed by domain
  interface CellState {
    hasOverlay: boolean;
    mergeWithDefault: boolean;
    items: RecommendationItem[];
    expanded: boolean;
    dirty: boolean;
    saving: boolean;
  }
  let cells = $state<Record<string, CellState>>({});

  // Load overlays whenever tenant or category changes
  $effect(() => {
    const tid = tenantId;
    const cat = activeCategory;
    (async () => {
      const list = await getCustomEducation(tid);
      customEducation = list;
      const next: Record<string, CellState> = {};
      for (const d of DOMAINS) {
        const overlay = await getOverlay(tid, cat, d);
        next[d] = {
          hasOverlay: !!overlay,
          mergeWithDefault: overlay?.mergeWithDefault ?? true,
          items: overlay
            ? (JSON.parse(JSON.stringify(overlay.items)) as RecommendationItem[])
            : [],
          expanded: false,
          dirty: false,
          saving: false,
        };
      }
      cells = next;
    })();
  });

  async function startEdit(domain: string): Promise<void> {
    const cell = cells[domain];
    if (!cell) return;
    cell.expanded = true;
    if (!cell.hasOverlay) {
      // Seed editor with the union of default items across all ages (deduped by slug)
      // so the user can tweak instead of starting blank.
      const seen = new Set<string>();
      const seed: RecommendationItem[] = [];
      for (const age of AGE_GROUPS_CDSA) {
        const items = await getDefaultRecommendations(activeCategory, domain, age);
        for (const item of items) {
          const k = item.slug ?? item.url ?? item.customId ?? '';
          if (!seen.has(k)) {
            seen.add(k);
            seed.push(item);
          }
        }
      }
      cell.items = JSON.parse(JSON.stringify(seed)) as RecommendationItem[];
      cell.dirty = false;
    }
    cells = { ...cells };
  }

  function addItem(domain: string): void {
    const cell = cells[domain];
    if (!cell) return;
    cell.items = [...cell.items, { source: 'internal', slug: internalSlugs[0] ?? '' }];
    cell.dirty = true;
    cells = { ...cells };
  }

  function removeItem(domain: string, index: number): void {
    const cell = cells[domain];
    if (!cell) return;
    cell.items = cell.items.filter((_, i) => i !== index);
    cell.dirty = true;
    cells = { ...cells };
  }

  function changeSource(domain: string, index: number, source: RecommendationSource): void {
    const cell = cells[domain];
    if (!cell) return;
    const next: RecommendationItem = { source };
    if (source === 'internal') next.slug = internalSlugs[0] ?? '';
    if (source === 'custom') next.customId = customEducation[0]?.id;
    if (source === 'external') next.url = '';
    cell.items[index] = next;
    cell.dirty = true;
    cells = { ...cells };
  }

  function patchItem(domain: string, index: number, patch: Partial<RecommendationItem>): void {
    const cell = cells[domain];
    if (!cell) return;
    cell.items[index] = { ...cell.items[index], ...patch };
    cell.dirty = true;
    cells = { ...cells };
  }

  function toggleMerge(domain: string): void {
    const cell = cells[domain];
    if (!cell) return;
    cell.mergeWithDefault = !cell.mergeWithDefault;
    cell.dirty = true;
    cells = { ...cells };
  }

  async function save(domain: string): Promise<void> {
    const cell = cells[domain];
    if (!cell) return;
    cell.saving = true;
    cells = { ...cells };
    try {
      await saveOverlay(tenantId, activeCategory, domain, cell.items, cell.mergeWithDefault);
      cell.hasOverlay = true;
      cell.dirty = false;
    } finally {
      cell.saving = false;
      cells = { ...cells };
    }
  }

  async function reset(domain: string): Promise<void> {
    if (!confirm(`確定還原 [${DOMAIN_LABELS[domain]}] 為系統預設？醫院自訂將被刪除。`)) return;
    const cell = cells[domain];
    if (!cell) return;
    cell.saving = true;
    cells = { ...cells };
    try {
      await clearOverlay(tenantId, activeCategory, domain);
      cell.hasOverlay = false;
      cell.mergeWithDefault = true;
      cell.items = [];
      cell.expanded = false;
      cell.dirty = false;
    } finally {
      cell.saving = false;
      cells = { ...cells };
    }
  }

  function cancel(domain: string): void {
    const cell = cells[domain];
    if (!cell) return;
    cell.expanded = false;
    cells = { ...cells };
  }
</script>

<section class="recs-manager">
  <header class="manager-header">
    <p class="header-tenant">
      目前租戶：<strong>{tenantDisplay}</strong>
      <span class="header-note">（未自訂時，使用系統預設清單）</span>
    </p>
  </header>

  <nav class="category-tabs" aria-label="分流結果分類">
    {#each CATEGORIES as cat}
      <button
        type="button"
        class="cat-tab"
        class:active={activeCategory === cat}
        onclick={() => (activeCategory = cat)}
      >
        {CATEGORY_LABELS[cat]}
      </button>
    {/each}
  </nav>

  <ul class="domain-tree">
    {#each DOMAINS as domain}
      {@const cell = cells[domain]}
      {@const overlayItems = cell?.items ?? []}
      <li class="domain-row" class:has-overlay={cell?.hasOverlay} class:expanded={cell?.expanded}>
        {#if !cell || (cell && !cell.expanded)}
          <div class="row-header">
            <button
              type="button"
              class="row-toggle"
              onclick={() => startEdit(domain)}
              aria-expanded="false"
            >
              <span class="row-caret" aria-hidden="true">▸</span>
              <span class="row-title">{DOMAIN_LABELS[domain] ?? domain}</span>
              {#if cell?.hasOverlay}
                <span class="badge badge-override">已自訂</span>
              {:else}
                <span class="badge badge-default">系統預設（依年齡）</span>
              {/if}
              {#if cell?.hasOverlay}
                <span class="row-count">{overlayItems.length} 項（覆蓋）</span>
                <span class="row-preview">
                  {#if overlayItems.length === 0}
                    <em>（無覆蓋項目）</em>
                  {:else}
                    {overlayItems.slice(0, 3).map((i) => i.title ?? i.slug ?? i.url ?? '?').join('、')}
                    {overlayItems.length > 3 ? `…` : ''}
                  {/if}
                </span>
              {:else}
                <span class="row-preview"><em>（依評估年齡自動選取）</em></span>
              {/if}
            </button>
            {#if cell?.hasOverlay}
              <button type="button" class="btn-link danger" onclick={() => reset(domain)} disabled={cell.saving}>
                還原預設
              </button>
            {/if}
          </div>
        {:else}
          <div class="editor">
            <label class="merge-toggle">
              <input
                type="checkbox"
                checked={cell.mergeWithDefault}
                onchange={() => toggleMerge(domain)}
              />
              合併系統預設（取消勾選代表完全取代預設清單）
            </label>

            <ul class="item-editor">
              {#each cell.items as item, i}
                <li class="item-row">
                  <select
                    class="source-select"
                    value={item.source}
                    onchange={(e) => changeSource(domain, i, (e.currentTarget as HTMLSelectElement).value as RecommendationSource)}
                  >
                    {#each Object.entries(SOURCE_LABELS) as [k, label]}
                      <option value={k}>{label}</option>
                    {/each}
                  </select>

                  {#if item.source === 'internal'}
                    <select
                      class="value-select"
                      value={item.slug}
                      onchange={(e) => patchItem(domain, i, { slug: (e.currentTarget as HTMLSelectElement).value })}
                    >
                      {#each internalSlugs as slug}
                        <option value={slug}>{slug}</option>
                      {/each}
                      {#if internalSlugs.length === 0}
                        <option value="">（載入中…）</option>
                      {/if}
                    </select>
                  {:else if item.source === 'custom'}
                    {#if customEducation.length > 0}
                      <select
                        class="value-select"
                        value={item.customId}
                        onchange={(e) => patchItem(domain, i, { customId: (e.currentTarget as HTMLSelectElement).value })}
                      >
                        {#each customEducation as edu}
                          <option value={edu.id}>{edu.title}</option>
                        {/each}
                      </select>
                    {:else}
                      <span class="hint">尚無自上傳衛教（先到「衛教管理」新增）</span>
                    {/if}
                  {:else if item.source === 'external'}
                    <input
                      type="url"
                      class="value-input"
                      placeholder="https://..."
                      value={item.url ?? ''}
                      oninput={(e) => patchItem(domain, i, { url: (e.currentTarget as HTMLInputElement).value })}
                    />
                  {/if}

                  <input
                    type="text"
                    class="title-input"
                    placeholder="顯示標題（選填，留白時用來源預設）"
                    value={item.title ?? ''}
                    oninput={(e) => patchItem(domain, i, { title: (e.currentTarget as HTMLInputElement).value })}
                  />

                  <button type="button" class="btn-icon danger" aria-label="刪除此項" onclick={() => removeItem(domain, i)}>×</button>
                </li>
              {/each}
            </ul>

            <button type="button" class="btn-add" onclick={() => addItem(domain)}>+ 新增項目</button>

            <div class="editor-actions">
              <button type="button" class="btn-cancel" onclick={() => cancel(domain)}>取消</button>
              <button
                type="button"
                class="btn-save"
                onclick={() => save(domain)}
                disabled={!cell.dirty || cell.saving}
              >
                {cell.saving ? '儲存中…' : '儲存'}
              </button>
            </div>
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</section>

<style>
  .recs-manager {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .manager-header {
    padding: var(--space-3) var(--space-4);
    background: color-mix(in srgb, var(--bg), var(--text) 5%);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
  }

  .header-note {
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    font-size: var(--text-xs);
    margin-left: var(--space-2);
  }

  .category-tabs {
    display: flex;
    gap: var(--space-2);
    border-bottom: 1px solid var(--line);
  }

  .cat-tab {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    padding: var(--space-3) var(--space-5);
    font-size: var(--text-sm);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    cursor: pointer;
    min-height: 44px;
    font-weight: var(--font-medium);
  }

  .cat-tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .domain-tree {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .domain-row {
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
    overflow: hidden;
  }

  .domain-row.has-overlay {
    border-color: var(--accent);
  }

  .domain-row.expanded {
    padding: var(--space-4);
  }

  .row-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding-right: var(--space-3);
  }

  .row-toggle {
    flex: 1;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    background: none;
    border: none;
    padding: var(--space-3) var(--space-3) var(--space-3) var(--space-2);
    cursor: pointer;
    text-align: left;
    font: inherit;
    color: inherit;
    min-height: 44px;
  }

  .row-toggle:hover {
    background: color-mix(in srgb, var(--bg), var(--text) 5%);
  }

  .row-caret {
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    font-size: var(--text-sm);
    width: 16px;
  }

  .row-title {
    font-weight: var(--font-bold);
    min-width: 80px;
  }

  .row-count {
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    font-size: var(--text-xs);
    margin-left: var(--space-2);
  }

  .row-preview {
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .row-preview em {
    font-style: italic;
    opacity: 0.7;
  }

  .badge {
    font-size: var(--text-xs);
    padding: 2px 8px;
    border-radius: var(--radius-full);
    font-weight: var(--font-bold);
  }

  .badge-default {
    background: color-mix(in srgb, var(--bg), var(--text) 5%);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
  }

  .badge-override {
    background: color-mix(in srgb, var(--accent) 12%, var(--bg));
    color: var(--accent);
  }

  .btn-link {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: var(--text-sm);
    padding: 0;
    min-height: 32px;
  }

  .btn-link.danger {
    color: var(--danger);
  }

  .editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .merge-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-xs);
    color: var(--text);
  }

  .item-editor {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .item-row {
    display: grid;
    grid-template-columns: 110px 1fr 1fr 32px;
    gap: var(--space-2);
    align-items: center;
  }

  .source-select,
  .value-select,
  .value-input,
  .title-input {
    min-height: 36px;
    padding: 4px 8px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--bg);
    font-size: var(--text-xs);
  }

  .btn-icon {
    min-height: 32px;
    min-width: 32px;
    background: none;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--text-base);
    line-height: 1;
  }

  .btn-icon.danger {
    color: var(--danger);
    border-color: var(--danger);
  }

  .btn-add {
    align-self: flex-start;
    background: none;
    border: 1px dashed var(--line);
    border-radius: var(--radius-sm);
    padding: 6px 12px;
    cursor: pointer;
    font-size: var(--text-xs);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    min-height: 36px;
  }

  .btn-add:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .editor-actions {
    display: flex;
    gap: var(--space-2);
    justify-content: flex-end;
  }

  .btn-cancel,
  .btn-save {
    min-height: 36px;
    padding: 6px 14px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--line);
    cursor: pointer;
    font-size: var(--text-xs);
  }

  .btn-cancel {
    background: none;
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
  }

  .btn-save {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  .btn-save:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .hint {
    font-size: var(--text-xs);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    grid-column: 2 / 4;
  }
</style>
