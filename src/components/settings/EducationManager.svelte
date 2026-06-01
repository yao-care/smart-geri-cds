<script lang="ts">
  import { authStore } from '../../lib/stores/auth.svelte';
  import { getTenantId, getTenantDisplayName } from '../../lib/utils/tenant';
  import { CFS_LEVELS, CFS_LABELS } from '../../lib/utils/cfs-levels';
  import {
    getAllCustomEducation,
    createCustomEducation,
    updateCustomEducation,
    deleteCustomEducation,
    toggleCustomEducation,
  } from '../../lib/db/custom-education';
  import type { CustomEducation } from '../../lib/db/schema';

  let items = $state<CustomEducation[]>([]);
  let isLoading = $state(true);
  let showForm = $state(false);
  let editingId = $state<string | null>(null);

  // Form state
  let formTitle = $state('');
  let formSummary = $state('');
  let formCategory = $state('general');
  let formCfsLevels = $state<string[]>([]);
  let formFormat = $state<'article' | 'video'>('article');
  let formContent = $state('');
  let formVideoUrl = $state('');
  let formTriggerIndicators = $state('');

  const tenantId = $derived(getTenantId(authStore.fhirBaseUrl));
  const tenantName = $derived(getTenantDisplayName(authStore.fhirBaseUrl));
  const isConnected = $derived(authStore.isAuthenticated);

  const categories = [
    { value: 'general', label: '一般照護' },
    { value: 'cognition', label: '認知' },
    { value: 'mood', label: '情緒' },
    { value: 'mobility', label: '行動與跌倒' },
    { value: 'nutrition', label: '營養' },
    { value: 'medication', label: '用藥安全' },
    { value: 'social', label: '社會支持' },
  ];

  // 適用分層改採 CFS 等級（取代年齡帶）。
  const cfsOptions = CFS_LEVELS.map((value) => ({ value, label: `${value.replace('cfs', 'CFS ')}：${CFS_LABELS[value]}` }));

  $effect(() => {
    loadItems();
  });

  async function loadItems() {
    isLoading = true;
    try {
      items = await getAllCustomEducation(tenantId);
    } finally {
      isLoading = false;
    }
  }

  function resetForm() {
    formTitle = '';
    formSummary = '';
    formCategory = 'general';
    formCfsLevels = [];
    formFormat = 'article';
    formContent = '';
    formVideoUrl = '';
    formTriggerIndicators = '';
    editingId = null;
    showForm = false;
  }

  function editItem(item: CustomEducation) {
    formTitle = item.title;
    formSummary = item.summary;
    formCategory = item.category;
    formCfsLevels = [...item.ageGroup];
    formFormat = item.format;
    formContent = item.content;
    formVideoUrl = item.videoUrl ?? '';
    formTriggerIndicators = item.triggerIndicators.join(', ');
    editingId = item.id;
    showForm = true;
  }

  async function handleSubmit() {
    const data = {
      title: formTitle,
      summary: formSummary,
      category: formCategory,
      ageGroup: formCfsLevels,
      format: formFormat,
      content: formContent,
      videoUrl: formFormat === 'video' ? formVideoUrl : undefined,
      triggerIndicators: formTriggerIndicators
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    };

    if (editingId) {
      await updateCustomEducation(editingId, data);
    } else {
      await createCustomEducation(tenantId, data);
    }

    resetForm();
    await loadItems();
  }

  async function handleDelete(id: string) {
    if (!confirm('確定要刪除此衛教內容嗎？')) return;
    await deleteCustomEducation(id);
    await loadItems();
  }

  async function handleToggle(id: string, currentActive: boolean) {
    await toggleCustomEducation(id, !currentActive);
    await loadItems();
  }

  function toggleCfs(value: string) {
    if (formCfsLevels.includes(value)) {
      formCfsLevels = formCfsLevels.filter((v) => v !== value);
    } else {
      formCfsLevels = [...formCfsLevels, value];
    }
  }
</script>

<div class="edu-manager">
  <div class="manager-header">
    <div>
      <h3>衛教內容管理</h3>
      <p class="tenant-info">
        {#if isConnected}
          目前醫院：<strong>{tenantName}</strong>
        {:else}
          未連線（編輯預設內容）
        {/if}
      </p>
    </div>
    <button class="btn-add" onclick={() => { resetForm(); showForm = true; }}>
      + 新增衛教內容
    </button>
  </div>

  {#if showForm}
    <form class="edu-form" onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
      <h4>{editingId ? '編輯衛教內容' : '新增衛教內容'}</h4>

      <div class="field">
        <label for="edu-title">標題 *</label>
        <input id="edu-title" type="text" bind:value={formTitle} required />
      </div>

      <div class="field">
        <label for="edu-summary">摘要 *</label>
        <input id="edu-summary" type="text" bind:value={formSummary} required />
      </div>

      <div class="field">
        <label for="edu-category">分類</label>
        <select id="edu-category" bind:value={formCategory}>
          {#each categories as cat}
            <option value={cat.value}>{cat.label}</option>
          {/each}
        </select>
      </div>

      <fieldset class="field">
        <legend>適用 CFS 等級</legend>
        <div class="checkbox-group">
          {#each cfsOptions as ag}
            <label class="checkbox-label">
              <input
                type="checkbox"
                checked={formCfsLevels.includes(ag.value)}
                onchange={() => toggleCfs(ag.value)}
              />
              {ag.label}
            </label>
          {/each}
        </div>
      </fieldset>

      <fieldset class="field">
        <legend>格式</legend>
        <div class="radio-group">
          <label class="radio-label">
            <input type="radio" name="format" value="article" bind:group={formFormat} />
            文章
          </label>
          <label class="radio-label">
            <input type="radio" name="format" value="video" bind:group={formFormat} />
            影片
          </label>
        </div>
      </fieldset>

      {#if formFormat === 'video'}
        <div class="field">
          <label for="edu-video">YouTube 網址 *</label>
          <input
            id="edu-video"
            type="url"
            bind:value={formVideoUrl}
            placeholder="https://youtube.com/..."
            required
          />
        </div>
      {/if}

      <div class="field">
        <label for="edu-content">{formFormat === 'article' ? '內容（Markdown）' : '說明文字'}</label>
        <textarea
          id="edu-content"
          bind:value={formContent}
          rows={formFormat === 'article' ? 10 : 3}
        ></textarea>
      </div>

      <div class="field">
        <label for="edu-triggers">觸發領域（逗號分隔）</label>
        <input
          id="edu-triggers"
          type="text"
          bind:value={formTriggerIndicators}
          placeholder="functional.falls, physical.nutrition"
        />
        <small>填 CGA 二層領域鍵，如 functional.falls、physical.nutrition、psychological.cognition、social.caregiver。</small>
      </div>

      <div class="form-actions">
        <button type="button" class="btn-cancel" onclick={resetForm}>取消</button>
        <button type="submit" class="btn-save">{editingId ? '更新' : '建立'}</button>
      </div>
    </form>
  {/if}

  {#if isLoading}
    <p class="loading">載入中...</p>
  {:else if items.length === 0}
    <p class="empty">尚無自訂衛教內容。預設內容仍可供使用。</p>
  {:else}
    <div class="edu-list">
      {#each items as item (item.id)}
        <div class="edu-item" class:inactive={!item.isActive}>
          <div class="item-info">
            <span class="item-format">{item.format === 'video' ? '\uD83C\uDFAC' : '\uD83D\uDCC4'}</span>
            <div>
              <strong>{item.title}</strong>
              <p class="item-summary">{item.summary}</p>
              <div class="item-tags">
                <span class="tag">{categories.find((c) => c.value === item.category)?.label ?? item.category}</span>
                {#each item.ageGroup as ag}
                  <span class="tag">{cfsOptions.find((o) => o.value === ag)?.label ?? ag}</span>
                {/each}
                {#if !item.isActive}
                  <span class="tag inactive-tag">已停用</span>
                {/if}
              </div>
            </div>
          </div>
          <div class="item-actions">
            <button
              class="btn-toggle"
              onclick={() => handleToggle(item.id, item.isActive)}
              title={item.isActive ? '停用' : '啟用'}
            >
              {item.isActive ? '停用' : '啟用'}
            </button>
            <button class="btn-edit" onclick={() => editItem(item)}>編輯</button>
            <button class="btn-delete" onclick={() => handleDelete(item.id)}>刪除</button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .edu-manager {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .manager-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .manager-header h3 {
    font-size: var(--text-base);
    font-weight: var(--font-medium);
    color: var(--text);
    margin: 0;
  }

  .tenant-info {
    font-size: var(--text-xs);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    margin: var(--space-1) 0 0 0;
  }

  .btn-add {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: white;
    background: var(--accent);
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: opacity 0.15s ease;
    white-space: nowrap;
  }

  .btn-add:hover {
    opacity: 0.85;
  }

  /* Form */
  .edu-form {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    padding: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .edu-form h4 {
    font-size: var(--text-lg);
    font-weight: var(--font-bold);
    color: var(--text);
    margin: 0;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .field > label {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: var(--text);
  }

  .field input[type='text'],
  .field input[type='url'],
  .field select,
  .field textarea {
    font-size: var(--text-sm);
    min-height: 44px;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--text);
    font-family: inherit;
    transition: border-color 0.15s ease;
  }

  .field input[type='text']:focus,
  .field input[type='url']:focus,
  .field select:focus,
  .field textarea:focus {
    outline: none;
    border-color: var(--accent);
  }

  .field textarea {
    resize: vertical;
    min-height: 80px;
  }

  .field small {
    font-size: var(--text-xs);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
  }

  .checkbox-group,
  .radio-group {
    display: flex;
    gap: var(--space-4);
    flex-wrap: wrap;
  }

  .checkbox-label,
  .radio-label {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    color: var(--text);
    cursor: pointer;
    min-height: 44px;
  }

  .checkbox-label input,
  .radio-label input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .form-actions {
    display: flex;
    gap: var(--space-3);
    justify-content: flex-end;
    padding-top: var(--space-2);
  }

  .btn-cancel {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: var(--space-2) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: color 0.15s ease;
  }

  .btn-cancel:hover {
    color: var(--text);
  }

  .btn-save {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: var(--space-2) var(--space-5);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: white;
    background: var(--accent);
    border: none;
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: opacity 0.15s ease;
  }

  .btn-save:hover {
    opacity: 0.85;
  }

  /* List */
  .edu-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .edu-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    flex-wrap: wrap;
    transition: opacity 0.2s ease;
  }

  .edu-item.inactive {
    opacity: 0.6;
  }

  .item-info {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    flex: 1;
    min-width: 0;
  }

  .item-format {
    font-size: var(--text-lg);
    flex-shrink: 0;
    line-height: 1;
    padding-top: 2px;
  }

  .item-info strong {
    font-size: var(--text-sm);
    font-weight: var(--font-bold);
    color: var(--text);
  }

  .item-summary {
    font-size: var(--text-xs);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    margin: var(--space-1) 0;
  }

  .item-tags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .tag {
    display: inline-block;
    padding: var(--space-1) var(--space-2);
    font-size: var(--text-xs);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    background: color-mix(in srgb, var(--bg), var(--text) 5%);
    border-radius: var(--radius-sm);
  }

  .inactive-tag {
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 12%, var(--bg));
  }

  .item-actions {
    display: flex;
    gap: var(--space-2);
    flex-shrink: 0;
  }

  .item-actions button {
    min-height: 44px;
    padding: var(--space-2) var(--space-3);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    cursor: pointer;
    transition: color 0.15s ease, border-color 0.15s ease;
  }

  .item-actions button:hover {
    color: var(--text);
    border-color: color-mix(in srgb, var(--text), var(--bg) 30%);
  }

  .item-actions .btn-delete {
    color: var(--danger);
  }

  .item-actions .btn-delete:hover {
    color: var(--danger);
    border-color: var(--danger);
  }

  /* States */
  .loading,
  .empty {
    text-align: center;
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    font-size: var(--text-sm);
    padding: var(--space-8) var(--space-4);
    border: 1px dashed var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
    margin: 0;
  }
</style>
