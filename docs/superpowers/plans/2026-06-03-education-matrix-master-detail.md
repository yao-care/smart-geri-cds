# 衛教資源矩陣 Master-Detail 熱圖改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/education/` 衛教資源頁從「窄格 `<details>` 就地展開」改造為 master-detail 熱圖：左側矩陣只放單一數字/符號（熱圖濃淡），右側固定面板閱讀官方資源並就地填貢獻表單；窄螢幕退化為 bottom sheet。

**Architecture:** 單一 `client:load` Svelte 5 island（`EducationMatrix`）持有所有互動狀態（選取格、群組摺疊、貢獻表單），下轄 `MatrixGrid`（左熱圖）、`DetailPanel`（右欄/sheet）、`ContributionForm`（由 `ContributionModal` 抽出的表單）。官方矩陣資料在 Astro build 期由純函式 `buildCellViews` 算成可序列化的 `CellViews`，傳入 island 當 props。貢獻仍走既有 Worker→GitHub Issue，不動 schema 與產生檔。

**Tech Stack:** Astro 5 SSG、Svelte 5 runes（`$state`/`$derived`/`$props`/`$effect`）、vitest + @testing-library/svelte、CSS Custom Properties（7 token + `color-mix()`）。

**Spec:** `docs/superpowers/specs/2026-06-03-education-matrix-master-detail-design.md`

---

## File Structure

| 檔案 | 動作 | 責任 |
|------|------|------|
| `src/lib/education/matrix-view.ts` | 新增 | 純函式：`buildCellViews`（matrixData→可序列化視圖）、`cellResourceCount`、`heatBucket`、`matrixCoverage`、型別 |
| `tests/education/matrix-view.test.ts` | 新增 | 上述純函式測試 |
| `src/components/education/ContributionForm.svelte` | 新增 | 由 `ContributionModal` 抽出的貢獻表單（inline，無 modal 外殼，頂部警語） |
| `tests/components/ContributionForm.test.ts` | 新增 | 表單依 action/type 顯示欄位、警語存在 |
| `src/components/education/DetailPanel.svelte` | 新增 | 右欄/sheet 面板：空狀態（含盤點）、閱讀視圖、切換到 `ContributionForm` |
| `tests/components/DetailPanel.test.ts` | 新增 | 三狀態渲染、操作鈕切到表單 |
| `src/components/education/MatrixGrid.svelte` | 新增 | 左側熱圖 table：格子按鈕、熱檔、群組摺疊、鍵盤導覽；emit `onselect` |
| `tests/components/MatrixGrid.test.ts` | 新增 | 格子顯示數字/符號、不適用不可選、點擊 emit、群組摺疊 |
| `src/components/education/EducationMatrix.svelte` | 新增 | root island：組裝 grid + panel，桌機並排/手機 sheet，Esc 關閉 |
| `tests/components/EducationMatrix.test.ts` | 新增 | 點格子→面板換內容、未選顯示空狀態 |
| `src/pages/education/index.astro` | 改寫 | frontmatter 算 `cells`+`articleContent`，body 掛 `EducationMatrix` island，保留 `CustomEducationList` |
| `src/components/education/ContributionModal.svelte` | 刪除 | 退役（已確認僅 index.astro 引用） |

---

## Task 1: 純函式 `matrix-view.ts`（資料視圖 + 熱檔 + 盤點）

**Files:**
- Create: `src/lib/education/matrix-view.ts`
- Test: `tests/education/matrix-view.test.ts`

設計：island props 必須可序列化，故把 `MatrixData`（內含需查表的 slug/videoId）在 build 期打平成含標題的 `CellViews`。熱檔與盤點為純函式，供 island 與測試共用。

- [ ] **Step 1: 寫失敗測試**

Create `tests/education/matrix-view.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildMatrixData } from '$lib/education/matrix-data';
import {
  buildCellViews,
  cellResourceCount,
  heatBucket,
  matrixCoverage,
  type CellView,
} from '$lib/education/matrix-view';

const triggers = {
  'cga.domain.functional.adl.anomaly.cfs5':      { videoIds: ['abc1234abcde'], inapplicable: false, educationSlug: 'adl-support' },
  'cga.domain.functional.adl.anomaly.cfs1':      { videoIds: [],               inapplicable: true  },
  'cga.domain.psychological.mood.anomaly.cfs5':  { videoIds: [],               inapplicable: false, educationSlug: 'mood-care' },
};
const articleTitles = { 'adl-support': '日常活動支持', 'mood-care': '情緒照護' };
const catalog = { abc1234abcde: { title: '行走訓練', channel: '復健頻道', duration: 95, videoId: 'abc1234abcde' } };

describe('buildCellViews', () => {
  it('flattens article slug + title and video catalog into a serialisable view', () => {
    const cells = buildCellViews(buildMatrixData(triggers), articleTitles, catalog);
    expect(cells['functional.adl:cfs5']).toEqual({
      inapplicable: false,
      articles: [{ slug: 'adl-support', title: '日常活動支持' }],
      videos: [{ videoId: 'abc1234abcde', title: '行走訓練', channel: '復健頻道', duration: 95 }],
    } satisfies CellView);
  });

  it('falls back to slug when title is missing', () => {
    const cells = buildCellViews(buildMatrixData(triggers), {}, {});
    expect(cells['functional.adl:cfs5'].articles).toEqual([{ slug: 'adl-support', title: 'adl-support' }]);
  });

  it('drops video ids absent from the catalog', () => {
    const cells = buildCellViews(buildMatrixData(triggers), articleTitles, {});
    expect(cells['functional.adl:cfs5'].videos).toEqual([]);
  });

  it('keeps inapplicable cells with empty resources', () => {
    const cells = buildCellViews(buildMatrixData(triggers), articleTitles, catalog);
    expect(cells['functional.adl:cfs1']).toEqual({ inapplicable: true, articles: [], videos: [] });
  });
});

describe('cellResourceCount', () => {
  it('sums articles and videos', () => {
    const cell: CellView = {
      inapplicable: false,
      articles: [{ slug: 'a', title: 'A' }],
      videos: [{ videoId: 'v', title: 'V', channel: 'C', duration: 10 }],
    };
    expect(cellResourceCount(cell)).toBe(2);
  });
});

describe('heatBucket', () => {
  it('maps counts to fixed thresholds 0/1/2/3/4', () => {
    expect(heatBucket(0)).toBe(0);
    expect(heatBucket(1)).toBe(1);
    expect(heatBucket(2)).toBe(2);
    expect(heatBucket(3)).toBe(2);
    expect(heatBucket(4)).toBe(3);
    expect(heatBucket(5)).toBe(3);
    expect(heatBucket(6)).toBe(4);
    expect(heatBucket(99)).toBe(4);
  });
});

describe('matrixCoverage', () => {
  it('counts applicable-with-resources, empty, inapplicable, total', () => {
    const cells = buildCellViews(buildMatrixData(triggers), articleTitles, catalog);
    const cov = matrixCoverage(cells);
    // 19 二層域 × 9 CFS = 171 格
    expect(cov.total).toBe(171);
    expect(cov.inapplicable).toBe(1);          // functional.adl:cfs1
    expect(cov.withResources).toBe(2);         // adl:cfs5, mood:cfs5
    expect(cov.empty).toBe(171 - 1 - 2);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test -- matrix-view`
Expected: FAIL — `Cannot find module '$lib/education/matrix-view'`

- [ ] **Step 3: 實作 `matrix-view.ts`**

Create `src/lib/education/matrix-view.ts`:

```ts
import { DOMAIN_TOPS, DOMAIN_TREE, type DomainTop, type DomainSub } from '$lib/domain/domain-tree';
import { CFS_LEVELS } from '$lib/utils/cfs-levels';
import type { MatrixData } from './matrix-data';

export type CellArticle = { slug: string; title: string };
export type CellVideo = { videoId: string; title: string; channel: string; duration: number };
export type CellView = { inapplicable: boolean; articles: CellArticle[]; videos: CellVideo[] };
export type CellViews = Record<string, CellView>;

type CatalogEntry = { title: string; channel: string; duration: number; videoId: string };

/**
 * 把 build 期的 MatrixData 打平成可序列化、含標題的視圖，供 island props 使用。
 * slug→title 與 videoId→catalog 的查表都在此完成，island 端不再需要 Map。
 */
export function buildCellViews(
  matrix: MatrixData,
  articleTitles: Record<string, string>,
  catalog: Record<string, CatalogEntry>,
): CellViews {
  const out: CellViews = {};
  for (const top of DOMAIN_TOPS as DomainTop[]) {
    for (const sub of DOMAIN_TREE[top] as readonly DomainSub[]) {
      for (const cfs of CFS_LEVELS) {
        const key = `${top}.${sub}:${cfs}`;
        const cell = matrix[key as keyof MatrixData];
        if (!cell || cell.inapplicable) {
          out[key] = { inapplicable: true, articles: [], videos: [] };
          continue;
        }
        out[key] = {
          inapplicable: false,
          articles: cell.articleSlugs.map(slug => ({ slug, title: articleTitles[slug] ?? slug })),
          videos: cell.videoIds.flatMap(id => {
            const v = catalog[id];
            return v ? [{ videoId: id, title: v.title, channel: v.channel, duration: v.duration }] : [];
          }),
        };
      }
    }
  }
  return out;
}

export function cellResourceCount(cell: CellView): number {
  return cell.articles.length + cell.videos.length;
}

export type HeatBucket = 0 | 1 | 2 | 3 | 4;

/** 固定閾值 4 檔：1 / 2–3 / 4–5 / 6+；0 為空（另以淡點呈現）。 */
export function heatBucket(count: number): HeatBucket {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 5) return 3;
  return 4;
}

export type Coverage = { withResources: number; empty: number; inapplicable: number; total: number };

export function matrixCoverage(cells: CellViews): Coverage {
  let withResources = 0, empty = 0, inapplicable = 0, total = 0;
  for (const cell of Object.values(cells)) {
    total++;
    if (cell.inapplicable) inapplicable++;
    else if (cellResourceCount(cell) > 0) withResources++;
    else empty++;
  }
  return { withResources, empty, inapplicable, total };
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test -- matrix-view`
Expected: PASS（全部 case）

- [ ] **Step 5: Commit**

```bash
git add src/lib/education/matrix-view.ts tests/education/matrix-view.test.ts
git commit -m "feat(education): matrix-view 純函式（CellViews 打平 + 熱檔 + 盤點）"
```

---

## Task 2: `ContributionForm.svelte`（由 ContributionModal 抽出的 inline 表單）

**Files:**
- Create: `src/components/education/ContributionForm.svelte`
- Test: `tests/components/ContributionForm.test.ts`

把 `ContributionModal` 的表單邏輯原樣搬出，移除 modal 外殼（backdrop/header/close/context 行），改為 inline，並在頂部加紅字警語。props 取代原 CustomEvent。

- [ ] **Step 1: 寫失敗測試**

Create `tests/components/ContributionForm.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import ContributionForm from '../../src/components/education/ContributionForm.svelte';

afterEach(() => cleanup());

const base = { top: 'physical', sub: 'nutrition', cfsLevel: 'cfs5', onback: () => {} };

describe('ContributionForm', () => {
  it('always shows the "submission is a suggestion, not live" warning', () => {
    render(ContributionForm, { ...base, action: 'add', prefill: {} });
    expect(screen.getByText(/送出＝提交建議/)).toBeTruthy();
  });

  it('add mode shows the resource-type fieldset', () => {
    render(ContributionForm, { ...base, action: 'add', prefill: {} });
    expect(screen.getByText('資源類型')).toBeTruthy();
    expect(screen.getByText('YouTube 影片')).toBeTruthy();
  });

  it('delete-article mode shows the target slug and requires a reason', () => {
    render(ContributionForm, { ...base, action: 'delete-article', prefill: { slug: 'mood-care' } });
    expect(screen.getByText('mood-care')).toBeTruthy();
    expect(screen.getByText('刪除原因 *')).toBeTruthy();
  });

  it('edit-article mode pre-fills the title', () => {
    render(ContributionForm, { ...base, action: 'edit-article', prefill: { slug: 'mood-care', title: '情緒照護', summary: 's', content: 'c' } });
    expect((screen.getByDisplayValue('情緒照護') as HTMLInputElement).value).toBe('情緒照護');
  });

  it('delete-video mode shows the video title', () => {
    render(ContributionForm, { ...base, action: 'delete-video', prefill: { videoId: 'v', videoTitle: '用藥安全' } });
    expect(screen.getByText('用藥安全')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test -- ContributionForm`
Expected: FAIL — `Failed to resolve import .../ContributionForm.svelte`

- [ ] **Step 3: 實作 `ContributionForm.svelte`**

Create `src/components/education/ContributionForm.svelte`（搬移 ContributionModal 的表單與 `handleSubmit`，改 props 驅動）:

```svelte
<script lang="ts">
  import { domainLabel, isValidDomain } from '../../lib/domain/domain-tree';
  import { CFS_LABELS } from '../../lib/utils/cfs-levels';

  type FormAction = 'add' | 'edit-article' | 'delete-article' | 'delete-video';
  interface Prefill {
    slug?: string; title?: string; summary?: string; content?: string;
    videoId?: string; videoTitle?: string;
  }
  interface Props {
    top: string; sub: string; cfsLevel: string;
    action: FormAction;
    prefill?: Prefill;
    onback: () => void;
  }
  let { top, sub, cfsLevel, action, prefill = {}, onback }: Props = $props();

  function contextDomainLabel(t: string, s: string): string {
    return isValidDomain(t, s) ? domainLabel(t, s) : `${t}.${s}`;
  }
  function contextCfsLabel(cfs: string): string {
    return (CFS_LABELS as Record<string, string>)[cfs] ?? cfs;
  }

  // add-mode fields
  let type      = $state<'youtube' | 'article' | 'external-link'>('youtube');
  let url       = $state('');
  let title     = $state(prefill.title ?? '');
  let summary   = $state(prefill.summary ?? '');
  let content   = $state(prefill.content ?? '');
  let notes     = $state('');
  let submitter = $state('');
  // edit/delete targets
  const targetSlug    = prefill.slug ?? '';
  const targetVideoId = prefill.videoId ?? '';
  const videoTitle    = prefill.videoTitle ?? '';

  let submitting = $state(false);
  let issueUrl   = $state<string | null>(null);
  let errorMsg   = $state<string | null>(null);

  let videoPreviewId = $derived(type === 'youtube' ? extractYouTubeId(url) : null);

  function extractYouTubeId(raw: string): string | null {
    const patterns = [
      /youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/,
      /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
      /youtu\.be\/([A-Za-z0-9_-]{11})/,
    ];
    for (const p of patterns) {
      const m = raw.match(p);
      if (m) return m[1];
    }
    return null;
  }

  function heading(): string {
    if (action === 'edit-article') return '修改文章（建議）';
    if (action === 'delete-article') return '刪除文章（建議）';
    if (action === 'delete-video') return '刪除影片（建議）';
    return '貢獻資源';
  }

  function onTypeChange() {
    url = ''; title = ''; summary = ''; content = '';
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    submitting = true; errorMsg = null;
    try {
      const workerUrl = import.meta.env.PUBLIC_CONTRIBUTION_WORKER_URL as string | undefined;
      if (!workerUrl) throw new Error('Worker URL 未設定，請聯絡管理員');

      let payload: Record<string, string>;
      if (action === 'edit-article') {
        if (!targetSlug) throw new Error('缺少目標文章 slug');
        if (!title) throw new Error('標題為必填');
        payload = { type: 'edit-article', top, sub, cfsLevel, targetSlug, title, summary, content, notes, submitter };
      } else if (action === 'delete-article') {
        if (!targetSlug) throw new Error('缺少目標文章 slug');
        if (!notes) throw new Error('刪除原因為必填');
        payload = { type: 'delete-article', top, sub, cfsLevel, targetSlug, notes, submitter };
      } else if (action === 'delete-video') {
        if (!targetVideoId) throw new Error('缺少目標影片 ID');
        if (!notes) throw new Error('刪除原因為必填');
        payload = { type: 'delete-video', top, sub, cfsLevel, targetVideoId, videoTitle, notes, submitter };
      } else {
        payload = { type, top, sub, cfsLevel, url, title, summary, content, notes, submitter };
      }

      const res = await fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json() as { issueUrl?: string; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      issueUrl = data.issueUrl!;
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : '送出失敗，請稍後再試';
    } finally {
      submitting = false;
    }
  }
</script>

<div class="form-wrap">
  <header class="form-head">
    <button class="back-btn" onclick={onback} type="button">← 返回</button>
    <h3>{heading()}</h3>
  </header>

  <p class="warn-note" role="note">⚠ 送出＝提交建議，待維護者審核合併，非即時生效</p>

  <p class="context">
    情境：<strong>{contextDomainLabel(top, sub)}</strong> ×
    <strong>CFS {cfsLevel.replace('cfs', '')} {contextCfsLabel(cfsLevel)}</strong>
  </p>

  {#if issueUrl}
    <div class="success">
      <p>已成功送出！</p>
      <a href={issueUrl} target="_blank" rel="noopener noreferrer">在 GitHub 查看 Issue →</a>
      <button class="btn-secondary" onclick={onback} type="button">返回</button>
    </div>
  {:else}
    <form onsubmit={handleSubmit} class="contribution-form">
      {#if action === 'add'}
        <fieldset>
          <legend>資源類型</legend>
          <label><input type="radio" bind:group={type} value="youtube" onchange={onTypeChange} /> YouTube 影片</label>
          <label><input type="radio" bind:group={type} value="article" onchange={onTypeChange} /> Markdown 文章</label>
          <label><input type="radio" bind:group={type} value="external-link" onchange={onTypeChange} /> 外部連結</label>
        </fieldset>

        {#if type === 'youtube'}
          <label class="field">
            <span>YouTube URL *</span>
            <input type="url" bind:value={url} required placeholder="https://www.youtube.com/watch?v=..." />
          </label>
          {#if videoPreviewId}
            <img class="video-preview" src="https://i.ytimg.com/vi/{videoPreviewId}/mqdefault.jpg" alt="影片預覽" referrerpolicy="no-referrer" />
          {/if}
          <label class="field">
            <span>標題（選填）</span>
            <input type="text" bind:value={title} placeholder="影片標題" />
          </label>
        {:else if type === 'article'}
          <label class="field"><span>標題 *</span><input type="text" bind:value={title} required /></label>
          <label class="field"><span>摘要 *</span><input type="text" bind:value={summary} required /></label>
          <label class="field"><span>內容（Markdown）*</span><textarea bind:value={content} required rows="8"></textarea></label>
        {:else}
          <label class="field"><span>URL *</span><input type="url" bind:value={url} required /></label>
          <label class="field"><span>標題 *</span><input type="text" bind:value={title} required /></label>
        {/if}

        <label class="field"><span>補充說明（選填）</span><textarea bind:value={notes} rows="3" placeholder="為何適合此情境？"></textarea></label>
        <label class="field"><span>提交者（選填）</span><input type="text" bind:value={submitter} placeholder="姓名 / 科別" /></label>

      {:else if action === 'edit-article'}
        <p class="meta-info">目標文章：<code>{targetSlug}</code></p>
        <label class="field"><span>標題 *</span><input type="text" bind:value={title} required /></label>
        <label class="field"><span>摘要</span><input type="text" bind:value={summary} /></label>
        <label class="field"><span>內容（Markdown）</span><textarea bind:value={content} rows="8"></textarea></label>
        <label class="field"><span>修改說明（選填）</span><textarea bind:value={notes} rows="3" placeholder="說明修改原因或重點"></textarea></label>
        <label class="field"><span>提交者（選填）</span><input type="text" bind:value={submitter} placeholder="姓名 / 科別" /></label>

      {:else if action === 'delete-article'}
        <p class="meta-info">目標文章：<code>{targetSlug}</code></p>
        <label class="field"><span>刪除原因 *</span><textarea bind:value={notes} required rows="3" placeholder="請說明為何需要刪除此文章"></textarea></label>
        <label class="field"><span>提交者（選填）</span><input type="text" bind:value={submitter} placeholder="姓名 / 科別" /></label>

      {:else if action === 'delete-video'}
        <p class="meta-info">目標影片：<strong>{videoTitle || targetVideoId}</strong></p>
        <label class="field"><span>刪除原因 *</span><textarea bind:value={notes} required rows="3" placeholder="請說明為何需要刪除此影片（如：連結失效、內容不適切）"></textarea></label>
        <label class="field"><span>提交者（選填）</span><input type="text" bind:value={submitter} placeholder="姓名 / 科別" /></label>
      {/if}

      {#if errorMsg}<p class="error">{errorMsg}</p>{/if}

      <div class="form-actions">
        <button type="button" class="btn-secondary" onclick={onback}>取消</button>
        <button type="submit" class="btn-primary" disabled={submitting}>
          {submitting ? '送出中…' : '送出建議（開 GitHub Issue）'}
        </button>
      </div>
    </form>
  {/if}
</div>

<style>
  .form-wrap { display: flex; flex-direction: column; gap: var(--space-3); }
  .form-head { display: flex; align-items: center; gap: var(--space-2); }
  .form-head h3 { font-size: var(--text-lg); margin: 0; }
  .back-btn {
    background: none; border: 1px solid var(--line); border-radius: var(--radius-sm);
    cursor: pointer; color: var(--text); padding: var(--space-1) var(--space-2);
    min-height: 44px; font-size: var(--text-sm);
  }
  .warn-note {
    font-size: var(--text-sm); color: var(--danger);
    background: color-mix(in srgb, var(--danger) 8%, var(--bg));
    border: 1px solid color-mix(in srgb, var(--danger) 30%, var(--bg));
    border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3); margin: 0;
  }
  .context { font-size: var(--text-sm); color: color-mix(in srgb, var(--text), var(--bg) 30%); margin: 0; }
  .meta-info {
    font-size: var(--text-sm); color: color-mix(in srgb, var(--text), var(--bg) 20%); margin: 0;
    padding: var(--space-2) var(--space-3); background: color-mix(in srgb, var(--bg), var(--text) 4%);
    border-radius: var(--radius-sm); border: 1px solid var(--line);
  }
  .meta-info code {
    font-family: monospace; font-size: var(--text-xs);
    background: color-mix(in srgb, var(--bg), var(--text) 8%); padding: 2px 4px; border-radius: 2px;
  }
  fieldset { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: var(--space-3); margin: 0; }
  legend { font-size: var(--text-sm); font-weight: var(--font-medium); padding: 0 var(--space-2); }
  fieldset label { display: inline-flex; align-items: center; gap: var(--space-2); margin-right: var(--space-4); min-height: 44px; padding: var(--space-1) 0; }
  .field { display: flex; flex-direction: column; gap: var(--space-2); }
  .field span { font-size: var(--text-sm); font-weight: var(--font-medium); }
  .field input, .field textarea {
    border: 1px solid var(--line); border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3); font-size: var(--text-base);
    background: var(--surface); color: var(--text); width: 100%; min-height: 44px;
  }
  .field textarea { min-height: 88px; resize: vertical; }
  .video-preview { width: 100%; aspect-ratio: 16/9; object-fit: cover; border-radius: var(--radius-sm); }
  .form-actions { display: flex; justify-content: flex-end; gap: var(--space-3); }
  .btn-primary {
    background: var(--accent); color: var(--bg); border: none; border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-5); font-size: var(--text-base); cursor: pointer; min-height: 44px;
  }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary {
    background: none; border: 1px solid var(--line); border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-5); font-size: var(--text-base); cursor: pointer; color: var(--text); min-height: 44px;
  }
  .error { color: var(--danger); font-size: var(--text-sm); }
  .success { text-align: center; padding: var(--space-4); }
  .success a { color: var(--accent); text-decoration: underline; display: block; margin: var(--space-3) 0; }
</style>
```

> 注意：原 `ContributionModal` 的 `.error` 用了不存在的 `--color-risk-critical`；此處改用合法 token `--danger`（見 CLAUDE.md「CSS 色彩僅用 7 個 token」）。

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test -- ContributionForm`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/education/ContributionForm.svelte tests/components/ContributionForm.test.ts
git commit -m "feat(education): 抽出 ContributionForm（inline 表單 + 送出即建議警語）"
```

---

## Task 3: `DetailPanel.svelte`（右欄/sheet：空狀態 + 閱讀 + 切表單）

**Files:**
- Create: `src/components/education/DetailPanel.svelte`
- Test: `tests/components/DetailPanel.test.ts`

職責：依 `selectedKey` 解析 top/sub/cfs，顯示閱讀視圖（文章 ✎🗑、影片 🗑、＋貢獻）；點任一操作鈕切到 `ContributionForm`；`selectedKey` 為 null 時顯示空狀態 + 盤點。

- [ ] **Step 1: 寫失敗測試**

Create `tests/components/DetailPanel.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import DetailPanel from '../../src/components/education/DetailPanel.svelte';
import type { CellView } from '$lib/education/matrix-view';

afterEach(() => cleanup());

const coverage = { withResources: 2, empty: 168, inapplicable: 1, total: 171 };
const cell: CellView = {
  inapplicable: false,
  articles: [{ slug: 'mood-care', title: '情緒照護' }],
  videos: [{ videoId: 'v1', title: '用藥安全', channel: 'CH', duration: 90 }],
};

describe('DetailPanel', () => {
  it('shows the empty state with coverage when nothing is selected', () => {
    render(DetailPanel, { selectedKey: null, cell: null, articleContent: {}, coverage });
    expect(screen.getByText(/點左側任一格子/)).toBeTruthy();
    expect(screen.getByText(/168/)).toBeTruthy(); // 待補格數
  });

  it('reads the selected cell: domain/cfs heading, article and video', () => {
    render(DetailPanel, { selectedKey: 'psychological.mood:cfs5', cell, articleContent: {}, coverage });
    expect(screen.getByText('情緒')).toBeTruthy();
    expect(screen.getByText(/CFS 5/)).toBeTruthy();
    expect(screen.getByText('情緒照護')).toBeTruthy();
    expect(screen.getByText('用藥安全')).toBeTruthy();
  });

  it('clicking ＋ 貢獻資源 switches to the contribution form', async () => {
    render(DetailPanel, { selectedKey: 'psychological.mood:cfs5', cell, articleContent: {}, coverage });
    await fireEvent.click(screen.getByText('＋ 貢獻資源'));
    expect(screen.getByText(/送出＝提交建議/)).toBeTruthy();
  });

  it('clicking 返回 in the form goes back to the reading view', async () => {
    render(DetailPanel, { selectedKey: 'psychological.mood:cfs5', cell, articleContent: {}, coverage });
    await fireEvent.click(screen.getByText('＋ 貢獻資源'));
    await fireEvent.click(screen.getByText('← 返回'));
    expect(screen.getByText('＋ 貢獻資源')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test -- DetailPanel`
Expected: FAIL — 無法解析 `DetailPanel.svelte`

- [ ] **Step 3: 實作 `DetailPanel.svelte`**

Create `src/components/education/DetailPanel.svelte`:

```svelte
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
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test -- DetailPanel`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/education/DetailPanel.svelte tests/components/DetailPanel.test.ts
git commit -m "feat(education): DetailPanel（空狀態盤點 + 閱讀視圖 + 切貢獻表單）"
```

---

## Task 4: `MatrixGrid.svelte`（左側熱圖 table + 選取 + 摺疊 + 鍵盤）

**Files:**
- Create: `src/components/education/MatrixGrid.svelte`
- Test: `tests/components/MatrixGrid.test.ts`

職責：渲染 table（sticky thead、群組 row、domain header、cell 按鈕）；cell 顯示資源數或 `·`，不適用顯示 `–` 且不可選；`onselect(key)`；群組摺疊；方向鍵在格間移動 focus（roving）。

- [ ] **Step 1: 寫失敗測試**

Create `tests/components/MatrixGrid.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/svelte';
import MatrixGrid from '../../src/components/education/MatrixGrid.svelte';
import { buildCellViews } from '$lib/education/matrix-view';
import { buildMatrixData } from '$lib/education/matrix-data';

afterEach(() => cleanup());

const triggers = {
  'cga.domain.physical.comorbidity.anomaly.cfs5': { videoIds: ['v1','v2'], inapplicable: false, educationSlug: 'comorb' },
  'cga.domain.physical.comorbidity.anomaly.cfs1': { videoIds: [],          inapplicable: true  },
};
const cells = buildCellViews(buildMatrixData(triggers), { comorb: '共病照護' }, {
  v1: { title: 'A', channel: 'C', duration: 1, videoId: 'v1' },
  v2: { title: 'B', channel: 'C', duration: 1, videoId: 'v2' },
});

describe('MatrixGrid', () => {
  it('renders a top-group header (生理/醫療) and a sub-domain row (多重共病)', () => {
    render(MatrixGrid, { cells, selectedKey: null, onselect: () => {} });
    expect(screen.getByText('生理/醫療')).toBeTruthy();
    expect(screen.getByText('多重共病')).toBeTruthy();
  });

  it('shows the resource count (3) for a populated cell', () => {
    render(MatrixGrid, { cells, selectedKey: null, onselect: () => {} });
    // comorbidity:cfs5 = 1 article + 2 videos = 3
    expect(screen.getByRole('button', { name: /多重共病.*CFS 5.*3/ })).toBeTruthy();
  });

  it('renders an inapplicable cell as non-button "–"', () => {
    render(MatrixGrid, { cells, selectedKey: null, onselect: () => {} });
    expect(screen.queryByRole('button', { name: /多重共病.*CFS 1/ })).toBeNull();
  });

  it('calls onselect with the cell key when a cell is clicked', async () => {
    const onselect = vi.fn();
    render(MatrixGrid, { cells, selectedKey: null, onselect });
    await fireEvent.click(screen.getByRole('button', { name: /多重共病.*CFS 5/ }));
    expect(onselect).toHaveBeenCalledWith('physical.comorbidity:cfs5');
  });

  it('collapses a group when its header is clicked', async () => {
    render(MatrixGrid, { cells, selectedKey: null, onselect: () => {} });
    expect(screen.getByText('多重共病')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /生理\/醫療/ }));
    expect(screen.queryByText('多重共病')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test -- MatrixGrid`
Expected: FAIL — 無法解析 `MatrixGrid.svelte`

- [ ] **Step 3: 實作 `MatrixGrid.svelte`**

Create `src/components/education/MatrixGrid.svelte`:

```svelte
<script lang="ts">
  import { DOMAIN_TOPS, DOMAIN_TREE, DOMAIN_TOP_LABELS, domainLabel } from '../../lib/domain/domain-tree';
  import { CFS_LEVELS, CFS_LABELS } from '../../lib/utils/cfs-levels';
  import { cellResourceCount, heatBucket, type CellViews } from '$lib/education/matrix-view';

  interface Props {
    cells: CellViews;
    selectedKey: string | null;
    onselect: (key: string) => void;
  }
  let { cells, selectedKey, onselect }: Props = $props();

  let collapsed = $state<Record<string, boolean>>({});
  function toggle(top: string) { collapsed = { ...collapsed, [top]: !collapsed[top] }; }

  const CFS_COL_LABEL: Record<string, string> = Object.fromEntries(
    CFS_LEVELS.map(l => [l, `${l.replace('cfs', '')} ${(CFS_LABELS as Record<string, string>)[l]}`]),
  );

  function cellAria(top: string, sub: string, cfs: string, count: number): string {
    return `${domainLabel(top, sub)}，CFS ${cfs.replace('cfs', '')}，${count > 0 ? `${count} 項資源` : '待補'}`;
  }

  // 方向鍵在格按鈕間移動 focus（roving）
  function onGridKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;
    if (target.tagName !== 'BUTTON' || !target.dataset.r) return;
    const dr = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    const dc = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (dr === 0 && dc === 0) return;
    e.preventDefault();
    const r = Number(target.dataset.r), c = Number(target.dataset.c);
    const next = e.currentTarget instanceof HTMLElement
      ? e.currentTarget.querySelector<HTMLButtonElement>(`button[data-r="${r + dr}"][data-c="${c + dc}"]`)
      : null;
    next?.focus();
  }
</script>

<div class="grid-scroll">
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <table class="matrix" onkeydown={onGridKeydown}>
    <thead>
      <tr>
        <th class="corner">領域＼CFS</th>
        {#each CFS_LEVELS as cfs}<th class="cfs-col">{CFS_COL_LABEL[cfs]}</th>{/each}
      </tr>
    </thead>
    <tbody>
      {#each DOMAIN_TOPS as top, ti}
        <tr class="group-row">
          <th class="group-header" colspan={CFS_LEVELS.length + 1}>
            <button class="group-toggle" type="button" onclick={() => toggle(top)} aria-expanded={!collapsed[top]}>
              <span class="chevron">{collapsed[top] ? '▶' : '▼'}</span> {DOMAIN_TOP_LABELS[top]}
            </button>
          </th>
        </tr>
        {#if !collapsed[top]}
          {#each DOMAIN_TREE[top] as sub, si}
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
                      data-r={`${ti}-${si}`}
                      data-c={ci}
                      aria-selected={key === selectedKey}
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
    /* 熱圖：bucket 越高底色越濃（color-mix 疊 --accent） */
  }
  .cell-btn[data-heat="0"] { color: color-mix(in srgb, var(--text), var(--bg) 50%); }
  .cell-btn[data-heat="1"] { background: color-mix(in srgb, var(--accent) 12%, var(--bg)); }
  .cell-btn[data-heat="2"] { background: color-mix(in srgb, var(--accent) 24%, var(--bg)); }
  .cell-btn[data-heat="3"] { background: color-mix(in srgb, var(--accent) 38%, var(--bg)); }
  .cell-btn[data-heat="4"] { background: color-mix(in srgb, var(--accent) 55%, var(--bg)); color: var(--bg); }
  .cell-btn:hover { outline: 2px solid color-mix(in srgb, var(--accent) 50%, var(--bg)); outline-offset: -2px; }
  .cell-btn[aria-selected="true"] { outline: 3px solid var(--accent); outline-offset: -3px; font-weight: var(--font-bold); }
</style>
```

> a11y 註記：`heatBucket=4` 反白（`color:var(--bg)`）以維持對比；其餘檔位文字維持 `--text`。`min-width:640px` 比原 700px 略窄（少了寬 domain 欄內距），仍保證 9 欄可橫捲。

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test -- MatrixGrid`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/education/MatrixGrid.svelte tests/components/MatrixGrid.test.ts
git commit -m "feat(education): MatrixGrid 熱圖矩陣（選取 + 群組摺疊 + 方向鍵導覽）"
```

---

## Task 5: `EducationMatrix.svelte`（root island：組裝 + 響應式 sheet）

**Files:**
- Create: `src/components/education/EducationMatrix.svelte`
- Test: `tests/components/EducationMatrix.test.ts`

職責：持有 `selectedKey`，組裝 `MatrixGrid` + `DetailPanel`；桌機左右並排、手機把右欄變 bottom sheet（`selectedKey != null` 時開）；Esc / 遮罩 / ✕ 關閉。

- [ ] **Step 1: 寫失敗測試**

Create `tests/components/EducationMatrix.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import EducationMatrix from '../../src/components/education/EducationMatrix.svelte';
import { buildCellViews } from '$lib/education/matrix-view';
import { buildMatrixData } from '$lib/education/matrix-data';

afterEach(() => cleanup());

const cells = buildCellViews(
  buildMatrixData({ 'cga.domain.physical.comorbidity.anomaly.cfs5': { videoIds: [], inapplicable: false, educationSlug: 'comorb' } }),
  { comorb: '共病照護' }, {},
);

describe('EducationMatrix', () => {
  it('shows the empty-state panel before any selection', () => {
    render(EducationMatrix, { cells, articleContent: {} });
    expect(screen.getByText(/點左側任一格子/)).toBeTruthy();
  });

  it('selecting a cell swaps the panel to that cell content', async () => {
    render(EducationMatrix, { cells, articleContent: {} });
    await fireEvent.click(screen.getByRole('button', { name: /多重共病.*CFS 5/ }));
    expect(screen.getByText('共病照護')).toBeTruthy();
  });

  it('Escape clears the selection back to empty state', async () => {
    render(EducationMatrix, { cells, articleContent: {} });
    await fireEvent.click(screen.getByRole('button', { name: /多重共病.*CFS 5/ }));
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByText(/點左側任一格子/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test -- EducationMatrix`
Expected: FAIL — 無法解析 `EducationMatrix.svelte`

- [ ] **Step 3: 實作 `EducationMatrix.svelte`**

Create `src/components/education/EducationMatrix.svelte`:

```svelte
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
  const coverage = matrixCoverage(cells);

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
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test -- EducationMatrix`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/education/EducationMatrix.svelte tests/components/EducationMatrix.test.ts
git commit -m "feat(education): EducationMatrix root island（並排/手機 sheet + Esc 關閉）"
```

---

## Task 6: 改寫 `index.astro` 掛載 island + 退役 ContributionModal

**Files:**
- Modify: `src/pages/education/index.astro`（全面改寫 body + frontmatter）
- Delete: `src/components/education/ContributionModal.svelte`

- [ ] **Step 1: 改寫 `index.astro`**

Replace the entire file `src/pages/education/index.astro` with:

```astro
---
import App from '../../layouts/App.astro';
import { getCollection } from 'astro:content';
import EducationMatrix from '../../components/education/EducationMatrix.svelte';
import CustomEducationList from '../../components/education/CustomEducationList.svelte';
import { buildMatrixData } from '../../lib/education/matrix-data';
import { buildCellViews } from '../../lib/education/matrix-view';
import videoIndex from '../../../public/data/video-index.json';

const allEducation = await getCollection('education');

// slug → title（給格子文章標題）
const articleTitles = Object.fromEntries(allEducation.map(e => [e.id, e.data.title]));

// slug → { title, summary, content }（給「修改文章」表單預填）
const articleContent = Object.fromEntries(
  allEducation.map(e => [e.id, { title: e.data.title, summary: e.data.summary ?? '', content: e.body ?? '' }]),
);

// videoId → catalog（給格子影片資訊）
type CatalogEntry = { title: string; channel: string; duration: number; videoId: string };
const catalog = Object.fromEntries(
  Object.entries(videoIndex.catalog as Record<string, CatalogEntry>).map(([id, v]) => [id, { ...v, videoId: id }]),
);

const matrix = buildMatrixData(
  videoIndex.triggers as Record<string, { videoIds: string[]; inapplicable: boolean; educationSlug?: string }>,
);

// build 期打平成可序列化的 CellViews，傳入 island
const cells = buildCellViews(matrix, articleTitles, catalog);
---

<App title="衛教資源" description="高齡周全性評估衛教資源（領域 × 臨床衰弱量表 CFS 矩陣）">
  <h1>衛教資源</h1>
  <p class="matrix-intro">
    左側為「CGA 二層評估領域 × 臨床衰弱量表 CFS 1–9」熱圖：數字＝該情境資源數、`·`＝待補、`–`＝不適用。
    點任一格子，右側即顯示該情境的衛教資源並可提交貢獻。
  </p>

  <EducationMatrix client:load cells={cells} articleContent={articleContent} />

  <CustomEducationList client:idle />
</App>

<style>
  h1 { margin-bottom: var(--space-2); }
  .matrix-intro {
    font-size: var(--text-sm);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    margin-bottom: var(--space-6);
  }
</style>
```

- [ ] **Step 2: 刪除退役的 ContributionModal**

Run:
```bash
git rm src/components/education/ContributionModal.svelte
```
Expected: 檔案刪除（已於計畫前置確認僅 index.astro 引用，本步驟一併移除引用）

- [ ] **Step 3: 型別檢查 + lint**

Run: `pnpm check && pnpm lint`
Expected: 無錯誤（特別確認 `ContributionModal` 無殘留引用、island props 型別相符）

- [ ] **Step 4: Commit**

```bash
git add src/pages/education/index.astro
git commit -m "feat(education): index.astro 掛載 master-detail island，退役 ContributionModal"
```

---

## Task 7: 全量驗證（build / test / drift）

**Files:** 無新增（驗證 + 視需要產生檔）

- [ ] **Step 1: 全測試**

Run: `pnpm test`
Expected: 全綠（含新增的 matrix-view / 四個元件測試 + 既有 matrix-data 測試不受影響）

- [ ] **Step 2: 全量建置（含產生檔 + Pagefind + SW）**

Run: `pnpm build`
Expected: build 成功。本次不改內容/量表，理論上不動產生檔；若 `git status` 顯示產生檔有 drift，一併提交。

- [ ] **Step 3: 確認無產生檔 drift**

Run: `git status --porcelain`
Expected: 乾淨；若有 `public/data/video-index.json` 等變動，執行：
```bash
git add public/data/video-index.json src/lib/education/clinical-education.generated.ts src/lib/data/expected-questionnaire-domains.generated.json
git commit -m "chore(education): 重產產生檔"
```
（若 `git status` 本就乾淨，跳過此 commit）

- [ ] **Step 4: 視覺確認（人工）**

Run: `pnpm dev`，開 `http://localhost:4321/education/`，逐項確認：
1. 桌機：左熱圖（數字/`·`/`–`、濃淡分檔）、右欄空狀態顯示盤點數。
2. 點有資源格 → 右欄顯示文章/影片；點 ✏️/🗑️/＋ → 表單 + 紅字警語；送出（或取消/返回）。
3. 群組標題可摺疊；方向鍵可在格間移動 focus。
4. 視窗縮到 < 1024px：矩陣單欄、點格子 → bottom sheet 滑入；✕/遮罩/Esc 關閉。
5. 矩陣下方「醫院衛教內容」區（CustomEducationList）正常顯示。

- [ ] **Step 5: finishing**

完成後依 `superpowers:finishing-a-development-branch` 決定合併方式（PR / 直接合 main → 觸發部署）。

---

## Self-Review（plan 對 spec 的覆蓋檢查）

- **左熱圖總覽（決策1）** → Task 4 `MatrixGrid`（數字/`·`/`–` + `heatBucket` 濃淡）、Task 1 `heatBucket`。✓
- **右欄就地操作（決策2）** → Task 3 `DetailPanel` 切 Task 2 `ContributionForm`。✓
- **貢獻建議式、不動 schema（決策3）** → Task 2 沿用 Worker→Issue、頂部警語；無 DB 改動。✓
- **手機 bottom sheet（決策4）** → Task 5 `@media (max-width:1023px)` sheet + scrim + Esc。✓
- **單一 island（決策5）** → Task 5 root island + Task 6 `client:load` 掛載。✓
- **空狀態盤點** → Task 1 `matrixCoverage` + Task 3 空狀態。✓
- **CustomEducationList 不動** → Task 6 保留 `client:idle`。✓
- **不動產生檔** → Task 7 Step 3 drift 檢查（預期乾淨）。✓
- **a11y（≥18px/≥44px/鍵盤/aria）** → 各元件 CSS（`min-height:44px`）、`MatrixGrid` 方向鍵 + `aria-label`/`aria-selected`、`DetailPanel` `aria-live`。✓
- **型別一致性**：`CellView`/`CellViews`/`Coverage`/`HeatBucket` 定義於 Task 1，Task 3/4/5 一致 import；`FormAction`/`Prefill` 於 Task 2 定義，Task 3 對齊。✓

**Placeholder scan**：無 TBD/TODO；每個 code step 均為完整檔案內容。
```
