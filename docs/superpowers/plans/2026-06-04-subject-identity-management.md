# 受測者身分管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 CGA 評估能沿用既有受測者（共用 `child.id`）並合併重複受測者，使同一長者的歷次評估可正確聚合做縱貫追蹤。

**Architecture:** 資料層新增 `updateChild`/`mergeChildren`/`loadSubjectsWithStats`；store 新增 `startForExisting`（沿用既有 id、回寫編輯，不新建）；UI 在開始評估頁加 `SubjectSelector`（新增／沿用切換）、歷史頁加「再次評估」深連結與「合併」模式（`SubjectMergeDialog`）。

**Tech Stack:** Astro 5 + Svelte 5 runes、Dexie 4（IndexedDB）、vitest + @testing-library/svelte（jsdom + fake-indexeddb）。

設計來源：`docs/superpowers/specs/2026-06-04-subject-identity-management-design.md`

---

## 共用型別與介面（後續任務一致引用）

```ts
// src/lib/db/assessments.ts 內新增
export interface SubjectWithStats {
  child: Child;
  assessmentCount: number;
  lastAssessedAt: Date | null;
}
export function updateChild(child: Child): Promise<void>;
export function mergeChildren(primaryId: string, mergedIds: string[]): Promise<void>;
export function loadSubjectsWithStats(): Promise<SubjectWithStats[]>;

// src/lib/stores/assessment.svelte.ts 內新增方法
assessmentStore.startForExisting(
  child: Child,
  cfsLevel: CfsLevel,
  availability: { informantAvailable: boolean; patientAble: boolean },
): Promise<void>;

// 元件 props
// SubjectSelector:    { subjects: SubjectWithStats[]; selectedId: string | null; onSelect: (child: Child | null) => void }
// SubjectProfile:     { preselectedChildId?: string }
// SubjectMergeDialog: { subjects: SubjectWithStats[]; onConfirm: (primaryId: string) => void; onCancel: () => void }
```

## File Structure

- `src/lib/db/assessments.ts`（改）— 加 `updateChild`、`mergeChildren`、`loadSubjectsWithStats` + `SubjectWithStats`
- `src/lib/stores/assessment.svelte.ts`（改）— 加 `startForExisting`
- `src/components/assess/SubjectSelector.svelte`（新）— 新增／沿用切換 + 既有受測者清單
- `src/components/assess/SubjectProfile.svelte`（改）— 嵌入 selector、existing 模式帶入、提交分流
- `src/components/assess/AssessmentShell.svelte`（改）— 讀 `?subject=` 傳入 `preselectedChildId`
- `src/components/assess/AssessmentHistory.svelte`（改）— 「再次評估」連結、合併模式、改用 `loadSubjectsWithStats`
- `src/components/assess/SubjectMergeDialog.svelte`（新）— 選主檔 + 後果確認
- 測試：`tests/db/subject-identity.test.ts`、`tests/stores/start-for-existing.test.ts`、`tests/components/SubjectSelector.test.ts`、`tests/components/SubjectMergeDialog.test.ts`，並擴充 `tests/components/SubjectProfile.test.ts`

---

## Task 1: 資料層 `updateChild`

**Files:**
- Modify: `src/lib/db/assessments.ts`（在 Child DAO 區塊，約 `getAllChildren` 之後）
- Test: `tests/db/subject-identity.test.ts`（新建）

- [ ] **Step 1: 寫失敗測試**

建立 `tests/db/subject-identity.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { updateChild } from '../../src/lib/db/assessments';
import { db, type Child } from '../../src/lib/db/schema';

function makeChild(id: string, over: Partial<Child> = {}): Child {
  return { id, gender: 'male', birthDate: '', createdAt: new Date('2026-01-01'), ...over };
}

describe('updateChild', () => {
  beforeEach(async () => {
    await db.assessments.clear();
    await db.children.clear();
  });

  it('updates mutable fields while preserving id and createdAt', async () => {
    const created = new Date('2026-01-01');
    await db.children.put(makeChild('c1', { nickName: '舊', birthDate: '', createdAt: created }));

    await updateChild(makeChild('c1', { nickName: '新', birthDate: '1950-03-02', createdAt: created }));

    const got = await db.children.get('c1');
    expect(got!.id).toBe('c1');
    expect(got!.nickName).toBe('新');
    expect(got!.birthDate).toBe('1950-03-02');
    expect(got!.createdAt).toEqual(created);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test -- subject-identity`
Expected: FAIL — `updateChild is not a function`（或 import 解析錯誤）

- [ ] **Step 3: 實作**

在 `src/lib/db/assessments.ts` 的 `getAllChildren` 之後新增：

```ts
/** 更新既有受測者（沿用同 id）。呼叫端須帶原 id 與原 createdAt。 */
export async function updateChild(child: Child): Promise<void> {
  await db.children.put(child);
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test -- subject-identity`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/assessments.ts tests/db/subject-identity.test.ts
git commit -m "feat(db): updateChild 沿用同 id 更新受測者

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 資料層 `mergeChildren`

**Files:**
- Modify: `src/lib/db/assessments.ts`
- Test: `tests/db/subject-identity.test.ts`（沿用）

- [ ] **Step 1: 寫失敗測試**

在 `tests/db/subject-identity.test.ts` 加入（檔頂 import 補上 `mergeChildren`、`createAssessment`）：

```ts
// 檔頂 import 改為：
// import { updateChild, mergeChildren, createAssessment } from '../../src/lib/db/assessments';

describe('mergeChildren', () => {
  beforeEach(async () => {
    await db.assessments.clear();
    await db.children.clear();
  });

  it('reassigns merged children assessments to primary and deletes merged children', async () => {
    await db.children.bulkPut([makeChild('primary'), makeChild('dup1'), makeChild('dup2')]);
    const avail = { informantAvailable: true, patientAble: true };
    await createAssessment('primary', 'cfs3', avail);
    await createAssessment('dup1', 'cfs4', avail);
    await createAssessment('dup2', 'cfs5', avail);

    await mergeChildren('primary', ['dup1', 'dup2']);

    const onPrimary = await db.assessments.where('childId').equals('primary').count();
    expect(onPrimary).toBe(3);
    expect(await db.children.get('dup1')).toBeUndefined();
    expect(await db.children.get('dup2')).toBeUndefined();
    expect(await db.children.get('primary')).toBeTruthy();
  });

  it('never deletes the primary even if it appears in mergedIds', async () => {
    await db.children.bulkPut([makeChild('primary'), makeChild('dup1')]);
    await mergeChildren('primary', ['primary', 'dup1']);
    expect(await db.children.get('primary')).toBeTruthy();
    expect(await db.children.get('dup1')).toBeUndefined();
  });

  it('is a no-op when there is nothing to merge', async () => {
    await db.children.put(makeChild('primary'));
    await mergeChildren('primary', ['primary']);
    expect(await db.children.get('primary')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test -- subject-identity`
Expected: FAIL — `mergeChildren is not a function`

- [ ] **Step 3: 實作**

在 `src/lib/db/assessments.ts` 新增（`updateChild` 之後）：

```ts
/**
 * 把 mergedIds 的所有 assessment 轉移到 primaryId，並刪除 mergedIds 的 children。
 * 單一 transaction 確保原子性：任一步失敗則全部回滾，不留孤兒 assessment。
 */
export async function mergeChildren(primaryId: string, mergedIds: string[]): Promise<void> {
  const targets = mergedIds.filter((id) => id !== primaryId);
  if (targets.length === 0) return;
  await db.transaction('rw', db.children, db.assessments, async () => {
    const orphaned = await db.assessments.where('childId').anyOf(targets).toArray();
    await Promise.all(
      orphaned.map((a) => db.assessments.update(a.id, { childId: primaryId, updatedAt: new Date() })),
    );
    await db.children.bulkDelete(targets);
  });
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test -- subject-identity`
Expected: PASS（3 個 mergeChildren 測試 + Task 1 的 updateChild 測試）

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/assessments.ts tests/db/subject-identity.test.ts
git commit -m "feat(db): mergeChildren 原子轉移評估並刪除重複受測者

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 資料層 `loadSubjectsWithStats`

**Files:**
- Modify: `src/lib/db/assessments.ts`
- Test: `tests/db/subject-identity.test.ts`（沿用）

- [ ] **Step 1: 寫失敗測試**

在 `tests/db/subject-identity.test.ts` 加入（檔頂 import 補 `loadSubjectsWithStats`）：

```ts
describe('loadSubjectsWithStats', () => {
  beforeEach(async () => {
    await db.assessments.clear();
    await db.children.clear();
  });

  it('computes count and lastAssessedAt, sorted most-recent first', async () => {
    await db.children.bulkPut([makeChild('a'), makeChild('b'), makeChild('c')]);
    const avail = { informantAvailable: true, patientAble: true };

    // a: 2 次，最後完成 2026-03-10
    const a1 = await createAssessment('a', 'cfs3', avail);
    await db.assessments.update(a1.id, { completedAt: new Date('2026-02-01') });
    const a2 = await createAssessment('a', 'cfs3', avail);
    await db.assessments.update(a2.id, { completedAt: new Date('2026-03-10') });
    // b: 1 次，最後 2026-05-20（最近）
    const b1 = await createAssessment('b', 'cfs4', avail);
    await db.assessments.update(b1.id, { completedAt: new Date('2026-05-20') });
    // c: 0 次

    const list = await loadSubjectsWithStats();
    const byId = Object.fromEntries(list.map((s) => [s.child.id, s]));

    expect(byId['a'].assessmentCount).toBe(2);
    expect(byId['a'].lastAssessedAt).toEqual(new Date('2026-03-10'));
    expect(byId['b'].assessmentCount).toBe(1);
    expect(byId['c'].assessmentCount).toBe(0);
    expect(byId['c'].lastAssessedAt).toBeNull();

    // 排序：b(05-20) → a(03-10) → c(null 殿後)
    expect(list.map((s) => s.child.id)).toEqual(['b', 'a', 'c']);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test -- subject-identity`
Expected: FAIL — `loadSubjectsWithStats is not a function`

- [ ] **Step 3: 實作**

在 `src/lib/db/assessments.ts`：先確保檔案頂部已從 `./schema` import `Child`（現況已有）。在 Child DAO 區塊新增介面與函式：

```ts
export interface SubjectWithStats {
  child: Child;
  assessmentCount: number;
  lastAssessedAt: Date | null;
}

/** 受測者清單 + 統計，依 lastAssessedAt 倒序（無評估者殿後）。供選取清單與歷史頁共用。 */
export async function loadSubjectsWithStats(): Promise<SubjectWithStats[]> {
  const children = await getAllChildren();
  const rows = await Promise.all(
    children.map(async (child) => {
      const assessments = await getAssessmentsForChild(child.id);
      let lastAssessedAt: Date | null = null;
      for (const a of assessments) {
        const t = new Date(a.completedAt ?? a.startedAt);
        if (lastAssessedAt === null || t > lastAssessedAt) lastAssessedAt = t;
      }
      return { child, assessmentCount: assessments.length, lastAssessedAt };
    }),
  );
  return rows.sort((x, y) => {
    const tx = x.lastAssessedAt ? x.lastAssessedAt.getTime() : -Infinity;
    const ty = y.lastAssessedAt ? y.lastAssessedAt.getTime() : -Infinity;
    return ty - tx;
  });
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test -- subject-identity`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/db/assessments.ts tests/db/subject-identity.test.ts
git commit -m "feat(db): loadSubjectsWithStats 受測者清單+統計（次數/上次/排序）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Store `startForExisting`

**Files:**
- Modify: `src/lib/stores/assessment.svelte.ts`（在 `startNew` 之後）
- Test: `tests/stores/start-for-existing.test.ts`（新建）

- [ ] **Step 1: 寫失敗測試**

建立 `tests/stores/start-for-existing.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { assessmentStore } from '../../src/lib/stores/assessment.svelte';
import { db, type Child } from '../../src/lib/db/schema';

function makeChild(id: string, over: Partial<Child> = {}): Child {
  return { id, gender: 'male', birthDate: '', createdAt: new Date('2026-01-01'), ...over };
}

describe('assessmentStore.startForExisting', () => {
  beforeEach(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await db.assessments.clear();
    await db.children.clear();
    assessmentStore.reset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    assessmentStore.reset();
  });

  it('reuses the existing child id without creating a new child, and writes edits back', async () => {
    const created = new Date('2026-01-01');
    await db.children.put(makeChild('existing', { nickName: '舊', birthDate: '', createdAt: created }));

    await assessmentStore.startForExisting(
      makeChild('existing', { nickName: '新', birthDate: '1948-06-01', createdAt: created }),
      'cfs4',
      { informantAvailable: true, patientAble: true },
    );

    // 沒有新建 child
    expect(await db.children.count()).toBe(1);
    // 回寫編輯
    const child = await db.children.get('existing');
    expect(child!.nickName).toBe('新');
    expect(child!.birthDate).toBe('1948-06-01');
    expect(child!.createdAt).toEqual(created);
    // 建立一筆指向既有 id 的新評估
    expect(assessmentStore.assessment!.childId).toBe('existing');
    const stored = await db.assessments.where('childId').equals('existing').count();
    expect(stored).toBe(1);
  });

  it('sets an error when the child no longer exists', async () => {
    await assessmentStore.startForExisting(
      makeChild('ghost'),
      'cfs3',
      { informantAvailable: true, patientAble: true },
    );
    expect(assessmentStore.error).toBeTruthy();
    expect(assessmentStore.assessment).toBeNull();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test -- start-for-existing`
Expected: FAIL — `startForExisting is not a function`

- [ ] **Step 3: 實作**

先確認 `src/lib/stores/assessment.svelte.ts` 頂部已 import `updateChild`。檢查 import 行（現況 import `* as assessmentDao` 或具名）：本檔以 `assessmentDao` 命名空間呼叫（如 `assessmentDao.createChild`），故無需改 import；`updateChild`、`getChild` 已在 `assessmentDao` 內。在 `startNew` 方法之後新增：

```ts
/** 沿用既有受測者：保留其 id 與 createdAt，只回寫可變欄位，不新建 child。 */
async startForExisting(
  child: Child,
  cfsLevel: CfsLevel,
  availability: { informantAvailable: boolean; patientAble: boolean },
): Promise<void> {
  this.isLoading = true;
  this.error = null;
  try {
    const existing = await assessmentDao.getChild(child.id);
    if (!existing) throw new Error('該受測者已不存在，請重新選擇');
    await assessmentDao.updateChild(child);
    this.child = child;
    this.cfsLevel = cfsLevel;
    this.informantAvailable = availability.informantAvailable;
    this.patientAble = availability.patientAble;
    this.assessment = await assessmentDao.createAssessment(child.id, cfsLevel, availability);
    this.currentStepIndex = 1;
  } catch (e) {
    this.error = e instanceof Error ? e.message : 'Failed to start assessment';
  } finally {
    this.isLoading = false;
  }
}
```

> 注意：若該檔 import 形式為具名（非 `assessmentDao` 命名空間），改為 `getChild`/`updateChild`/`createAssessment` 直接呼叫，並在頂部 import 補上 `updateChild`。實作前先看檔案第 1–10 行確認 import 風格。

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test -- start-for-existing`
Expected: PASS（2 個測試）

- [ ] **Step 5: 回歸 — 確認 startNew 不受影響**

Run: `pnpm test -- assessment-resume`
Expected: PASS（既有 startNew 行為不變）

- [ ] **Step 6: Commit**

```bash
git add src/lib/stores/assessment.svelte.ts tests/stores/start-for-existing.test.ts
git commit -m "feat(store): startForExisting 沿用既有受測者並回寫編輯

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `SubjectSelector.svelte`（新元件）

**Files:**
- Create: `src/components/assess/SubjectSelector.svelte`
- Test: `tests/components/SubjectSelector.test.ts`（新建）

- [ ] **Step 1: 寫失敗測試**

建立 `tests/components/SubjectSelector.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import SubjectSelector from '../../src/components/assess/SubjectSelector.svelte';
import type { SubjectWithStats } from '../../src/lib/db/assessments';
import type { Child } from '../../src/lib/db/schema';

function subj(id: string, nickName: string): SubjectWithStats {
  const child: Child = { id, nickName, gender: 'male', birthDate: '1950-01-01', createdAt: new Date('2026-01-01') };
  return { child, assessmentCount: 2, lastAssessedAt: new Date('2026-05-20') };
}

describe('SubjectSelector', () => {
  it('defaults to 新增 mode; choosing 沿用既有 reveals the subject list', async () => {
    const onSelect = vi.fn();
    render(SubjectSelector, { props: { subjects: [subj('a', '阿嬤')], selectedId: null, onSelect } });

    // 新增 mode：清單不顯示
    expect(screen.queryByText('阿嬤')).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('radio', { name: /沿用既有/ }));
    expect(screen.getByText('阿嬤')).toBeInTheDocument();
  });

  it('clicking a subject row calls onSelect with that child', async () => {
    const onSelect = vi.fn();
    render(SubjectSelector, { props: { subjects: [subj('a', '阿嬤')], selectedId: null, onSelect } });
    await fireEvent.click(screen.getByRole('radio', { name: /沿用既有/ }));
    await fireEvent.click(screen.getByRole('button', { name: /阿嬤/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  it('switching back to 新增 calls onSelect(null)', async () => {
    const onSelect = vi.fn();
    render(SubjectSelector, { props: { subjects: [subj('a', '阿嬤')], selectedId: 'a', onSelect } });
    await fireEvent.click(screen.getByRole('radio', { name: /新增/ }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('disables 沿用既有 with a notice when there are no subjects', () => {
    render(SubjectSelector, { props: { subjects: [], selectedId: null, onSelect: vi.fn() } });
    const reuse = screen.getByRole('radio', { name: /沿用既有/ }) as HTMLInputElement;
    expect(reuse.disabled).toBe(true);
    expect(screen.getByText(/尚無既有受測者/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test -- SubjectSelector`
Expected: FAIL — 找不到元件檔

- [ ] **Step 3: 實作**

建立 `src/components/assess/SubjectSelector.svelte`：

```svelte
<script lang="ts">
  import { ageInMonths } from '../../lib/utils/cfs-levels';
  import type { Child } from '../../lib/db/schema';
  import type { SubjectWithStats } from '../../lib/db/assessments';

  interface Props {
    subjects: SubjectWithStats[];
    selectedId: string | null;
    onSelect: (child: Child | null) => void;
  }
  let { subjects, selectedId, onSelect }: Props = $props();

  let mode = $state<'new' | 'existing'>(selectedId ? 'existing' : 'new');
  const hasSubjects = $derived(subjects.length > 0);

  function setMode(next: 'new' | 'existing') {
    mode = next;
    if (next === 'new') onSelect(null);
  }
  function fmtDate(d: Date | null): string {
    return d ? new Date(d).toLocaleDateString('zh-TW', { month: '2-digit', day: '2-digit' }) : '—';
  }
  function ageYears(birthDate: string): number | null {
    if (!birthDate) return null;
    const m = ageInMonths(birthDate);
    return m > 0 ? Math.floor(m / 12) : null;
  }
</script>

<fieldset class="subject-selector">
  <legend>受測者</legend>
  <div class="mode-pills" role="radiogroup" aria-label="受測者來源">
    <label class="pill" class:selected={mode === 'new'}>
      <input type="radio" name="subjectMode" value="new" checked={mode === 'new'} onchange={() => setMode('new')} />
      新增
    </label>
    <label class="pill" class:selected={mode === 'existing'}>
      <input type="radio" name="subjectMode" value="existing" checked={mode === 'existing'}
        disabled={!hasSubjects} onchange={() => setMode('existing')} />
      沿用既有
    </label>
  </div>

  {#if mode === 'existing'}
    {#if hasSubjects}
      <ul class="subject-list">
        {#each subjects as s (s.child.id)}
          {@const yrs = ageYears(s.child.birthDate)}
          <li>
            <button type="button" class="subject-row" class:selected={selectedId === s.child.id}
              aria-pressed={selectedId === s.child.id} onclick={() => onSelect(s.child)}>
              <span class="srow-name">{s.child.nickName?.trim() || `ID: ${s.child.id.slice(0, 8)}…`}</span>
              {#if yrs !== null}<span class="srow-age">約 {yrs} 歲</span>{/if}
              <span class="srow-meta">上次 {fmtDate(s.lastAssessedAt)} · {s.assessmentCount} 次</span>
            </button>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="empty-note">尚無既有受測者</p>
    {/if}
  {/if}
</fieldset>

<style>
  .subject-selector { margin: 0 0 var(--space-3); padding: 0; border: 0; }
  legend { font-size: var(--text-sm); font-weight: var(--font-medium); margin-bottom: var(--space-1); color: var(--text); }
  .mode-pills { display: flex; gap: var(--space-2); }
  .pill {
    flex: 1; display: flex; align-items: center; justify-content: center;
    padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-md);
    cursor: pointer; font-size: var(--text-xs); min-height: 44px;
  }
  .pill.selected { background: var(--accent); color: white; border-color: var(--accent); }
  .pill input[type="radio"] { position: absolute; opacity: 0; width: 0; height: 0; }
  .subject-list { list-style: none; margin: var(--space-2) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
  .subject-row {
    width: 100%; text-align: left; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2);
    padding: var(--space-2) var(--space-3); min-height: 44px; cursor: pointer;
    border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--bg);
    font-size: var(--text-xs); color: var(--text);
  }
  .subject-row:hover { border-color: var(--accent); }
  .subject-row.selected { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--bg)); }
  .srow-name { font-weight: var(--font-medium); }
  .srow-age { color: var(--accent); font-size: var(--text-caption); }
  .srow-meta { margin-left: auto; color: color-mix(in srgb, var(--text), var(--bg) 35%); font-size: var(--text-caption); }
  .empty-note { margin: var(--space-2) 0 0; color: color-mix(in srgb, var(--text), var(--bg) 35%); font-size: var(--text-caption); }
</style>
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test -- SubjectSelector`
Expected: PASS（4 個測試）

- [ ] **Step 5: Commit**

```bash
git add src/components/assess/SubjectSelector.svelte tests/components/SubjectSelector.test.ts
git commit -m "feat(assess): SubjectSelector 新增/沿用既有受測者切換元件

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: `SubjectProfile` 整合 selector（new/existing + 帶入 + 提交分流）

**Files:**
- Modify: `src/components/assess/SubjectProfile.svelte`
- Test: `tests/components/SubjectProfile.test.ts`（擴充）

- [ ] **Step 1: 寫失敗測試**

在 `tests/components/SubjectProfile.test.ts` 結尾（最後一個 `it` 之後、`});` 之前）加入。檔頂 import 補：

```ts
// 檔頂補：
// import { db, type Child } from '../../src/lib/db/schema';
// import { assessmentStore } from '../../src/lib/stores/assessment.svelte';

it('preselects an existing subject (preselectedChildId) and prefills its data', async () => {
  const child: Child = { id: 'pre1', nickName: '阿公', gender: 'male', birthDate: '1948-02-03', createdAt: new Date('2026-01-01') };
  await db.children.clear();
  await db.children.put(child);

  render(SubjectProfile, { props: { preselectedChildId: 'pre1' } });

  // 帶入既有暱稱（在選填區塊內，已展開或值已綁定）
  const nick = await screen.findByDisplayValue('阿公');
  expect(nick).toBeInTheDocument();
});

it('existing-mode submit calls startForExisting, not startNew', async () => {
  const child: Child = { id: 'pre2', nickName: '阿婆', gender: 'female', birthDate: '1950-05-05', createdAt: new Date('2026-01-01') };
  await db.children.clear();
  await db.children.put(child);
  const spy = vi.spyOn(assessmentStore, 'startForExisting').mockResolvedValue();

  render(SubjectProfile, { props: { preselectedChildId: 'pre2' } });

  await fireEvent.click(screen.getByDisplayValue('cfs4'));
  const informant = screen.getByRole('radiogroup', { name: /是否有可提供資訊的家屬或照顧者/ });
  await fireEvent.click(informant.querySelector('input[value="yes"]') as HTMLInputElement);
  await fireEvent.click(screen.getByRole('button', { name: /開始評估/ }));

  expect(spy).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'pre2' }),
    'cfs4',
    expect.objectContaining({ informantAvailable: true }),
  );
  spy.mockRestore();
});
```

> 既有那 9 個測試（無 props 渲染）必須仍通過：空 DB 時 selector 預設「新增」、不干擾表單。

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test -- SubjectProfile`
Expected: 既有 9 測試 PASS、2 個新測試 FAIL（尚無 preselectedChildId prop 與分流）

- [ ] **Step 3: 實作**

修改 `src/components/assess/SubjectProfile.svelte` 的 `<script>`：

a) 補 import 與 props、狀態：

```ts
  import SubjectSelector from './SubjectSelector.svelte';
  import { loadSubjectsWithStats, type SubjectWithStats } from '../../lib/db/assessments';
  import type { Child } from '../../lib/db/schema';

  interface Props { preselectedChildId?: string }
  let { preselectedChildId }: Props = $props();

  let subjects = $state<SubjectWithStats[]>([]);
  let selectedChild = $state<Child | null>(null);
  const mode = $derived(selectedChild ? 'existing' : 'new');

  $effect(() => {
    loadSubjectsWithStats().then((list) => {
      subjects = list;
      if (preselectedChildId) {
        const hit = list.find((s) => s.child.id === preselectedChildId);
        if (hit) handleSelect(hit.child);
      }
    });
  });

  function handleSelect(child: Child | null) {
    selectedChild = child;
    if (child) {
      birthDate = child.birthDate ?? '';
      gender = child.gender;
      nickName = child.nickName ?? '';
    } else {
      birthDate = '';
      gender = 'male';
      nickName = '';
    }
  }
```

b) 改 `handleSubmit` 的送出分流（保留既有 cfsLevel / informantAvailable 驗證不變）：

```ts
    if (mode === 'existing' && selectedChild) {
      await assessmentStore.startForExisting(
        { ...selectedChild, birthDate, gender, nickName: nickName || undefined },
        cfsLevel,
        { informantAvailable, patientAble },
      );
    } else {
      await assessmentStore.startNew(
        { birthDate, gender, nickName: nickName || undefined },
        cfsLevel,
        { informantAvailable, patientAble },
      );
    }
```

c) 在 `<form>` 的 `<header>` 之後、`<div class="sp-grid">` 之前嵌入 selector：

```svelte
  <SubjectSelector {subjects} selectedId={selectedChild?.id ?? null} onSelect={handleSelect} />
```

d) 既有「基本資料（選填）」`<details>`：existing 模式時預設展開，讓帶入值可見。把該 `<details>` 改為：

```svelte
      <details class="optional-details" open={mode === 'existing'}>
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test -- SubjectProfile`
Expected: PASS（11 個：9 既有 + 2 新）

- [ ] **Step 5: 型別/lint 檢查**

Run: `pnpm check && pnpm lint`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/components/assess/SubjectProfile.svelte tests/components/SubjectProfile.test.ts
git commit -m "feat(assess): SubjectProfile 嵌入選取器，沿用模式帶入並走 startForExisting

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `AssessmentShell` 讀 `?subject=` 傳入

**Files:**
- Modify: `src/components/assess/AssessmentShell.svelte`
- Test: `tests/components/AssessmentShell-subject-param.test.ts`（新建）

- [ ] **Step 1: 寫失敗測試**

建立 `tests/components/AssessmentShell-subject-param.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import AssessmentShell from '../../src/components/assess/AssessmentShell.svelte';
import { db, type Child } from '../../src/lib/db/schema';
import { assessmentStore } from '../../src/lib/stores/assessment.svelte';

describe('AssessmentShell ?subject= deep link', () => {
  beforeEach(async () => {
    await db.assessments.clear();
    await db.children.clear();
    assessmentStore.reset();
  });
  afterEach(() => {
    window.history.replaceState({}, '', '/');
    assessmentStore.reset();
  });

  it('prefills the subject when ?subject= points to a valid child', async () => {
    const child: Child = { id: 'deep1', nickName: '連結阿嬤', gender: 'female', birthDate: '1949-09-09', createdAt: new Date('2026-01-01') };
    await db.children.put(child);
    window.history.replaceState({}, '', '/assess?subject=deep1');

    render(AssessmentShell, { props: { scales: [] } });

    expect(await screen.findByDisplayValue('連結阿嬤')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test -- AssessmentShell-subject-param`
Expected: FAIL — `連結阿嬤` 未帶入（profile 未收到 preselectedChildId）

- [ ] **Step 3: 實作**

修改 `src/components/assess/AssessmentShell.svelte`：

a) `<script>` 內，`let { scales = [] }` 之後新增：

```ts
  const subjectParam = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search).get('subject')
    : null;

  // 有深連結受測者時，跳過 resume 提示直接進 profile 帶入。
  if (subjectParam) showResume = false;
```

b) 把 profile 分支（現約 61–62 行）改為傳 prop，並在有深連結時即使尚無 assessment 也顯示 profile：

```svelte
    {:else if assessmentStore.currentStep === 'profile' || (subjectParam && !assessmentStore.assessment)}
      <SubjectProfile preselectedChildId={subjectParam ?? undefined} />
```

> `SubjectProfile` 在 `preselectedChildId` 無效（child 不存在）時，`loadSubjectsWithStats` 找不到該 id → 維持新增模式（Task 6 的 `find` 回 undefined 不呼叫 `handleSelect`），符合 spec 的退回行為。

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test -- AssessmentShell-subject-param`
Expected: PASS

- [ ] **Step 5: 回歸**

Run: `pnpm test -- SubjectProfile assessment-resume`
Expected: PASS（無深連結時行為不變）

- [ ] **Step 6: Commit**

```bash
git add src/components/assess/AssessmentShell.svelte tests/components/AssessmentShell-subject-param.test.ts
git commit -m "feat(assess): AssessmentShell 支援 ?subject= 深連結預選受測者

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: 歷史頁「再次評估」連結

**Files:**
- Modify: `src/components/assess/AssessmentHistory.svelte`（child-header 區，約 292–300 行）
- Test: `tests/components/AssessmentHistory-reassess.test.ts`（新建）

- [ ] **Step 1: 寫失敗測試**

建立 `tests/components/AssessmentHistory-reassess.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import AssessmentHistory from '../../src/components/assess/AssessmentHistory.svelte';
import { db, type Child } from '../../src/lib/db/schema';
import { createAssessment } from '../../src/lib/db/assessments';

describe('AssessmentHistory 再次評估', () => {
  beforeEach(async () => {
    await db.assessments.clear();
    await db.children.clear();
  });

  it('renders a 再次評估 link to /assess?subject=<childId> per subject', async () => {
    const child: Child = { id: 'h1', nickName: '歷史阿公', gender: 'male', birthDate: '1947-07-07', createdAt: new Date('2026-01-01') };
    await db.children.put(child);
    await createAssessment('h1', 'cfs3', { informantAvailable: true, patientAble: true });

    render(AssessmentHistory);

    const link = await screen.findByRole('link', { name: /再次評估/ });
    expect(link.getAttribute('href')).toBe('/assess?subject=h1');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test -- AssessmentHistory-reassess`
Expected: FAIL — 找不到「再次評估」連結

- [ ] **Step 3: 實作**

在 `src/components/assess/AssessmentHistory.svelte` 的 `<h2 class="child-header">…</h2>` 之後（即 `</h2>` 與 `<ol class="timeline">` 之間）加入連結：

```svelte
        <a class="reassess-link" href={`/assess?subject=${child.id}`}>再次評估 →</a>
```

並在 `<style>` 區新增（沿用既有連結色調慣例）：

```css
  .reassess-link {
    display: inline-block;
    margin: var(--space-1) 0 var(--space-2);
    min-height: 44px;
    line-height: 44px;
    color: var(--accent);
    text-decoration: none;
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
  }
  .reassess-link:hover { text-decoration: underline; }
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test -- AssessmentHistory-reassess`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/assess/AssessmentHistory.svelte tests/components/AssessmentHistory-reassess.test.ts
git commit -m "feat(history): 每位受測者加「再次評估」深連結

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: `SubjectMergeDialog.svelte`（新元件）

**Files:**
- Create: `src/components/assess/SubjectMergeDialog.svelte`
- Test: `tests/components/SubjectMergeDialog.test.ts`（新建）

- [ ] **Step 1: 寫失敗測試**

建立 `tests/components/SubjectMergeDialog.test.ts`：

```ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import SubjectMergeDialog from '../../src/components/assess/SubjectMergeDialog.svelte';
import type { SubjectWithStats } from '../../src/lib/db/assessments';
import type { Child } from '../../src/lib/db/schema';

function subj(id: string, nickName: string, count: number): SubjectWithStats {
  const child: Child = { id, nickName, gender: 'male', birthDate: '1950-01-01', createdAt: new Date('2026-01-01') };
  return { child, assessmentCount: count, lastAssessedAt: new Date('2026-05-20') };
}

describe('SubjectMergeDialog', () => {
  it('defaults primary to the subject with most assessments and confirms with its id', async () => {
    const onConfirm = vi.fn();
    render(SubjectMergeDialog, {
      props: { subjects: [subj('a', '甲', 1), subj('b', '乙', 3)], onConfirm, onCancel: vi.fn() },
    });
    // 後果文字：其餘 1 位、轉移 X 筆
    expect(screen.getByText(/無法復原/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /確認合併/ }));
    expect(onConfirm).toHaveBeenCalledWith('b'); // 乙 3 次為預設主檔
  });

  it('lets the user pick a different primary', async () => {
    const onConfirm = vi.fn();
    render(SubjectMergeDialog, {
      props: { subjects: [subj('a', '甲', 1), subj('b', '乙', 3)], onConfirm, onCancel: vi.fn() },
    });
    await fireEvent.click(screen.getByRole('radio', { name: /甲/ }));
    await fireEvent.click(screen.getByRole('button', { name: /確認合併/ }));
    expect(onConfirm).toHaveBeenCalledWith('a');
  });

  it('cancel calls onCancel', async () => {
    const onCancel = vi.fn();
    render(SubjectMergeDialog, {
      props: { subjects: [subj('a', '甲', 1), subj('b', '乙', 3)], onConfirm: vi.fn(), onCancel },
    });
    await fireEvent.click(screen.getByRole('button', { name: /取消/ }));
    expect(onCancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test -- SubjectMergeDialog`
Expected: FAIL — 找不到元件檔

- [ ] **Step 3: 實作**

建立 `src/components/assess/SubjectMergeDialog.svelte`：

```svelte
<script lang="ts">
  import type { SubjectWithStats } from '../../lib/db/assessments';

  interface Props {
    subjects: SubjectWithStats[];
    onConfirm: (primaryId: string) => void;
    onCancel: () => void;
  }
  let { subjects, onConfirm, onCancel }: Props = $props();

  // 預設主檔＝評估次數最多者。
  const defaultPrimary = $derived(
    [...subjects].sort((a, b) => b.assessmentCount - a.assessmentCount)[0]?.child.id ?? '',
  );
  let primaryId = $state('');
  $effect(() => { if (!primaryId) primaryId = defaultPrimary; });

  const mergedCount = $derived(subjects.length - 1);
  const transferCount = $derived(
    subjects.filter((s) => s.child.id !== primaryId).reduce((n, s) => n + s.assessmentCount, 0),
  );
  const name = (s: SubjectWithStats) => s.child.nickName?.trim() || `ID: ${s.child.id.slice(0, 8)}…`;
</script>

<div class="merge-overlay" role="dialog" aria-modal="true" aria-label="合併受測者">
  <div class="merge-box">
    <h2>合併受測者</h2>
    <p class="merge-hint">選擇要保留的主檔，其餘將併入：</p>

    <ul class="merge-list" role="radiogroup" aria-label="選擇主檔">
      {#each subjects as s (s.child.id)}
        <li>
          <label class="merge-row" class:selected={primaryId === s.child.id}>
            <input type="radio" name="primary" value={s.child.id} checked={primaryId === s.child.id}
              onchange={() => (primaryId = s.child.id)} />
            <span class="mrow-name">{name(s)}</span>
            <span class="mrow-meta">{s.assessmentCount} 次</span>
          </label>
        </li>
      {/each}
    </ul>

    <p class="merge-warn">
      將把其餘 {mergedCount} 位的 {transferCount} 筆評估轉移到主檔，並刪除那 {mergedCount} 位受測者。<strong>此動作無法復原。</strong>
    </p>

    <div class="merge-actions">
      <button type="button" class="btn-cancel" onclick={onCancel}>取消</button>
      <button type="button" class="btn-confirm" onclick={() => onConfirm(primaryId)}>確認合併</button>
    </div>
  </div>
</div>

<style>
  .merge-overlay {
    position: fixed; inset: 0; display: flex; align-items: center; justify-content: center;
    background: color-mix(in srgb, var(--text) 45%, transparent); padding: var(--space-4); z-index: 50;
  }
  .merge-box {
    background: var(--bg); border: 1px solid var(--line); border-radius: var(--radius-lg);
    padding: var(--space-5); max-width: 480px; width: 100%;
  }
  h2 { font-size: var(--text-lg); margin-bottom: var(--space-2); color: var(--text); }
  .merge-hint { font-size: var(--text-xs); color: color-mix(in srgb, var(--text), var(--bg) 25%); margin-bottom: var(--space-3); }
  .merge-list { list-style: none; margin: 0 0 var(--space-3); padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
  .merge-row {
    display: flex; align-items: center; gap: var(--space-2); min-height: 44px;
    padding: var(--space-2) var(--space-3); border: 1px solid var(--line); border-radius: var(--radius-md);
    cursor: pointer; font-size: var(--text-xs); color: var(--text);
  }
  .merge-row.selected { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--bg)); }
  .mrow-meta { margin-left: auto; color: color-mix(in srgb, var(--text), var(--bg) 35%); font-size: var(--text-caption); }
  .merge-warn {
    font-size: var(--text-xs); color: var(--danger);
    background: color-mix(in srgb, var(--danger) 8%, var(--bg)); border-radius: var(--radius-md);
    padding: var(--space-3); margin-bottom: var(--space-4);
  }
  .merge-actions { display: flex; justify-content: flex-end; gap: var(--space-2); }
  .btn-cancel, .btn-confirm {
    min-height: 44px; padding: var(--space-2) var(--space-5); border-radius: var(--radius-md);
    font-size: var(--text-xs); cursor: pointer;
  }
  .btn-cancel { background: none; border: 1px solid var(--line); color: var(--text); }
  .btn-confirm { background: var(--danger); border: 1px solid var(--danger); color: white; font-weight: var(--font-bold); }
</style>
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test -- SubjectMergeDialog`
Expected: PASS（3 個測試）

- [ ] **Step 5: Commit**

```bash
git add src/components/assess/SubjectMergeDialog.svelte tests/components/SubjectMergeDialog.test.ts
git commit -m "feat(history): SubjectMergeDialog 選主檔+不可逆後果確認

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: 歷史頁合併模式整合 + 統計改用 `loadSubjectsWithStats`

**Files:**
- Modify: `src/components/assess/AssessmentHistory.svelte`
- Test: `tests/components/AssessmentHistory-merge.test.ts`（新建）

- [ ] **Step 1: 寫失敗測試**

建立 `tests/components/AssessmentHistory-merge.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import AssessmentHistory from '../../src/components/assess/AssessmentHistory.svelte';
import { db, type Child } from '../../src/lib/db/schema';
import { createAssessment } from '../../src/lib/db/assessments';

async function seedDuplicate() {
  const mk = (id: string): Child => ({ id, nickName: '輝', gender: 'male', birthDate: '1982-04-30', createdAt: new Date('2026-01-01') });
  await db.children.bulkPut([mk('d1'), mk('d2')]);
  await createAssessment('d1', 'cfs3', { informantAvailable: true, patientAble: true });
  await createAssessment('d2', 'cfs4', { informantAvailable: true, patientAble: true });
}

describe('AssessmentHistory 合併模式', () => {
  beforeEach(async () => {
    await db.assessments.clear();
    await db.children.clear();
  });

  it('entering 合併 mode and selecting 2 subjects shows the merge action', async () => {
    await seedDuplicate();
    render(AssessmentHistory);

    await fireEvent.click(await screen.findByRole('button', { name: /管理.*合併|合併受測者/ }));
    const boxes = await screen.findAllByRole('checkbox', { name: /選取受測者/ });
    await fireEvent.click(boxes[0]);
    await fireEvent.click(boxes[1]);

    expect(screen.getByRole('button', { name: /合併 2 位/ })).toBeInTheDocument();
  });

  it('confirming the merge collapses two subjects into one', async () => {
    await seedDuplicate();
    render(AssessmentHistory);

    await fireEvent.click(await screen.findByRole('button', { name: /管理.*合併|合併受測者/ }));
    const boxes = await screen.findAllByRole('checkbox', { name: /選取受測者/ });
    await fireEvent.click(boxes[0]);
    await fireEvent.click(boxes[1]);
    await fireEvent.click(screen.getByRole('button', { name: /合併 2 位/ }));
    await fireEvent.click(screen.getByRole('button', { name: /確認合併/ }));

    // 合併後 children 只剩 1 筆
    await screen.findByText(/輝/);
    expect(await db.children.count()).toBe(1);
    expect(await db.assessments.count()).toBe(2);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test -- AssessmentHistory-merge`
Expected: FAIL — 找不到「管理/合併」按鈕

- [ ] **Step 3: 實作**

修改 `src/components/assess/AssessmentHistory.svelte`：

a) `<script>` 補 import 與狀態（與既有 `compareIds` 並存、互不干擾）：

```ts
  import SubjectMergeDialog from './SubjectMergeDialog.svelte';
  import { loadSubjectsWithStats, mergeChildren, type SubjectWithStats } from '../../lib/db/assessments';

  let mergeMode = $state(false);
  let mergeIds = $state<Set<string>>(new Set());
  let showMergeDialog = $state(false);
  let subjectStats = $state<SubjectWithStats[]>([]);

  function toggleMergePick(id: string) {
    const next = new Set(mergeIds);
    next.has(id) ? next.delete(id) : next.add(id);
    mergeIds = next;
  }
  const mergeSelection = $derived(subjectStats.filter((s) => mergeIds.has(s.child.id)));

  async function refreshStats() {
    subjectStats = await loadSubjectsWithStats();
  }
  async function handleMergeConfirm(primaryId: string) {
    const others = [...mergeIds].filter((id) => id !== primaryId);
    await mergeChildren(primaryId, others);
    showMergeDialog = false;
    mergeMode = false;
    mergeIds = new Set();
    await loadData();        // 重載歷史（既有函式）
    await refreshStats();
  }
```

並在既有載入流程（`loadData` 之後或 `$effect` 內）呼叫 `refreshStats()`，確保 `subjectStats` 有值。在既有掛載 effect 末尾加 `void refreshStats();`。

b) 模板：在統計列（`stats-row`）附近加「管理／合併」切換按鈕：

```svelte
    <button type="button" class="btn-merge-mode" onclick={() => { mergeMode = !mergeMode; mergeIds = new Set(); }}>
      {mergeMode ? '結束合併' : '合併受測者'}
    </button>
```

c) 在每個 `child-header`（`<h2>`）內、合併模式時顯示多選框：

```svelte
          {#if mergeMode}
            <label class="merge-pick">
              <input type="checkbox" aria-label={`選取受測者 ${child.nickName ?? child.id}`}
                checked={mergeIds.has(child.id)} onchange={() => toggleMergePick(child.id)} />
            </label>
          {/if}
```

d) 在合併模式且選 ≥2 時顯示動作列與對話框：

```svelte
  {#if mergeMode && mergeIds.size >= 2}
    <div class="merge-actionbar">
      <span>已選 {mergeIds.size} 位</span>
      <button type="button" class="btn-do-merge" onclick={() => (showMergeDialog = true)}>合併 {mergeIds.size} 位</button>
    </div>
  {/if}

  {#if showMergeDialog}
    <SubjectMergeDialog subjects={mergeSelection} onConfirm={handleMergeConfirm} onCancel={() => (showMergeDialog = false)} />
  {/if}
```

e) 樣式（觸控 ≥44px、僅用 token）：

```css
  .btn-merge-mode, .btn-do-merge {
    min-height: 44px; padding: var(--space-2) var(--space-4); border-radius: var(--radius-md);
    font-size: var(--text-xs); cursor: pointer; border: 1px solid var(--line);
    background: var(--bg); color: var(--text);
  }
  .btn-do-merge { background: var(--accent); border-color: var(--accent); color: white; font-weight: var(--font-medium); }
  .merge-pick { display: inline-flex; align-items: center; min-height: 44px; min-width: 44px; }
  .merge-pick input { width: 24px; height: 24px; }
  .merge-actionbar {
    display: flex; align-items: center; gap: var(--space-3); justify-content: flex-end;
    padding: var(--space-2) 0; font-size: var(--text-xs); color: var(--text);
  }
```

f) （重構，spec §7.4）若統計（總數／上次／最近分流）已可由 `subjectStats` 衍生，保留既有 `stats` 計算即可（不強制改寫，避免破壞既有測試）；本步驟僅新增合併功能，統計重構列為可選，不在本 task 強制。

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm test -- AssessmentHistory-merge AssessmentHistory-reassess`
Expected: PASS

- [ ] **Step 5: 型別/lint 檢查**

Run: `pnpm check && pnpm lint`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add src/components/assess/AssessmentHistory.svelte tests/components/AssessmentHistory-merge.test.ts
git commit -m "feat(history): 合併模式（多選→選主檔→原子合併）

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: 全量驗證

**Files:** 無（驗證）

- [ ] **Step 1: 全量測試**

Run: `pnpm test`
Expected: 全綠（既有 + 本計畫新增測試）

- [ ] **Step 2: 型別與 lint**

Run: `pnpm check && pnpm lint`
Expected: 0 errors / 0 warnings（既有 about/index 的 is:inline hint 不計）

- [ ] **Step 3: 產生檔 drift 檢查**

Run: `pnpm build`
Expected: 成功；若產生檔有變更，一併提交（本計畫未改內容/量表，預期無 drift）

- [ ] **Step 4: 手動驗證（瀏覽器）**

依 `superpowers:verification-before-completion`，dev 起站後實測：
1. `/assess` → 頂部「沿用既有」可見既有清單、選取帶入資料、可改、開始評估後歷史頁該人多一筆。
2. `/history` →「再次評估」連結進 `/assess?subject=`、預選正確。
3. `/history` →「合併受測者」→ 多選 2 位 → 選主檔 → 確認 → 兩人併為一人、評估數正確、無法復原提示出現。

- [ ] **Step 5: 收尾**

依 `superpowers:finishing-a-development-branch` 決定合併／PR。
```

## 自我檢查重點（執行者參考）

- 既有 `tests/components/SubjectProfile.test.ts` 9 個測試在 Task 6 後必須仍通過（空 DB 時 selector 預設新增、不干擾表單）。
- `startForExisting` 實作前先看 store 第 1–10 行確認 import 風格（命名空間 `assessmentDao` vs 具名）。
- 合併測試依賴 fake-indexeddb 的 Dexie transaction，若 transaction 在測試環境異常，改以非 transaction 版本並標註 in-browser 驗證原子性。
