# Phase 1：問卷文案去重 + 結果頁雷達圖換分組長條圖 — 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修掉問卷題目標頭的同義重複文案，並把結果頁無法閱讀的雷達圖換成可讀的分組水平長條圖。

**Architecture:** 兩個前端修正，不動分層引擎與計分。(1) 把 `QuestionnaireModule.svelte` 內嵌的 `MODE_FRAME` 抽成純模組 `src/lib/scales/mode-frame.ts`、改寫成無重複文案、加單元測試後回接元件；同步更新 `QuestionnaireModule.test.ts` 中 3 條斷言舊文案的既有測試。(2) 新增純函式 `groupDomainScores` 與 `DomainBarChart.svelte`（沿用既有 `DomainScore` 資料形狀），取代 `RadarChart.svelte`；結果頁兩個呼叫點改用新元件，刪除舊雷達元件與其測試。

**現況校正（審查補充）：** 現有 `RadarChart.svelte` 是 **SVG 環狀雷達**（`polarToCartesian` + `<polygon>` + 環狀 `<text>` 標籤），20+ 軸時標籤互相重疊不可讀；但它**已具備** title、legend（`數值＝原始分占量表滿分百分比…`）、二級中文標籤、incomplete 破折號。本 Phase 的價值在於把 SVG 環狀座標換成**分組水平長條**（天生支援 20+ 域、可讀），並**沿用**既有的 title/legend/標籤/incomplete 呈現要素（非從無到有新增）。`DomainScore` 計分不變。

**Tech Stack:** Astro 5 + Svelte 5 runes、TypeScript strict、vitest（`tests/**/*.test.ts`，jsdom）、`@testing-library/svelte`、CSS Custom Properties（`src/styles/tokens.css`）。

設計來源：`docs/superpowers/specs/2026-05-29-dual-track-self-check-and-triage-redesign.md`（§E 文案去重、§D 結果頁長條圖）。

---

## 檔案結構

新增：
- `src/lib/scales/mode-frame.ts` — 答題來源框架文案（純資料 + resolver）；單一職責：mode → {title, hint}。
- `tests/scales/mode-frame.test.ts` — mode-frame 單元測試。
- `src/lib/domain/group-domain-scores.ts` — 將 `DomainScore[]` 依 `DOMAIN_TREE` 大類分組排序（純函式）。
- `tests/domain/group-domain-scores.test.ts` — 分組函式單元測試。
- `src/components/assess/DomainBarChart.svelte` — 分組水平長條圖元件。
- `tests/components/DomainBarChart.test.ts` — 長條圖元件測試。

修改：
- `src/components/assess/QuestionnaireModule.svelte` — 移除內嵌 `MODE_FRAME`/`currentFrame`，改 import `mode-frame.ts`。
- `tests/components/QuestionnaireModule.test.ts` — 同步更新 3 條斷言舊 MODE_FRAME 文案的既有測試（`:165` patient、`:212` ask-either、`:308` ask-informant-unavailable）。
- `src/components/assess/ResultView.svelte` — `RadarChart` → `DomainBarChart`。
- `src/components/assess/ResultViewWrapper.svelte` — `RadarChart` → `DomainBarChart`。

刪除：
- `src/components/assess/RadarChart.svelte`
- `tests/components/RadarChart.test.ts`

---

## Task 1：抽出並去重 MODE_FRAME 文案

**問題**：目前 `QuestionnaireModule.svelte:247-254` 的 `patient` 框架 title 為「請受測者本人作答（操作者唸題並記錄）」、hint 為「操作者：請受測者本人作答，唸題並記錄其回答。」——兩行加上 YAML `prompt` 重複講「受測者作答／唸題記錄」三次。修法：title 只說「由誰作答」、hint 只說「操作者動作」，兩者不再含相同子句。

**Files:**
- Create: `src/lib/scales/mode-frame.ts`
- Test: `tests/scales/mode-frame.test.ts`
- Modify: `src/components/assess/QuestionnaireModule.svelte:247-260`

- [ ] **Step 1: 寫失敗測試**

Create `tests/scales/mode-frame.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { MODE_FRAME, resolveModeFrame } from '../../src/lib/scales/mode-frame';

describe('MODE_FRAME copy (de-duplicated)', () => {
  it('patient frame: title states who answers, hint states operator action — no shared clause', () => {
    const f = MODE_FRAME['patient'];
    expect(f.title).toBe('由受測者本人作答');
    expect(f.hint).toBe('操作者唸出題目，記錄其回答。');
    // Regression guard: the old hint repeated「受測者本人作答」verbatim.
    expect(f.hint).not.toContain('受測者本人作答');
  });

  it('ask-either frame title drops the old parenthetical tail', () => {
    const f = MODE_FRAME['ask-either'];
    expect(f.title).toBe('向受測者本人或家屬／照顧者詢問');
    // Regression: old title appended「（可參考觀察與病歷）」, duplicating the hint.
    expect(f.title).not.toContain('（');
  });

  it('ask-informant-unavailable: title states the state, hint carries the「無法取得」action', () => {
    const f = MODE_FRAME['ask-informant-unavailable'];
    expect(f.title).toBe('查無可詢問的知情者');
    expect(f.hint).toContain('無法取得');
  });

  it('every frame has a short title that is not duplicated inside its hint', () => {
    for (const [mode, f] of Object.entries(MODE_FRAME)) {
      expect(f.title.length, `${mode} title too long`).toBeLessThanOrEqual(20);
      expect(f.hint.includes(f.title), `${mode} hint repeats title`).toBe(false);
    }
  });
});

describe('resolveModeFrame', () => {
  it('swaps ask-informant → unavailable when informant is absent', () => {
    expect(resolveModeFrame('ask-informant', false)).toBe(MODE_FRAME['ask-informant-unavailable']);
  });

  it('keeps ask-informant when present, and returns other modes unchanged', () => {
    expect(resolveModeFrame('ask-informant', true)).toBe(MODE_FRAME['ask-informant']);
    expect(resolveModeFrame('measure', null)).toBe(MODE_FRAME['measure']);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm exec vitest run tests/scales/mode-frame.test.ts`
Expected: FAIL — `Cannot find module '../../src/lib/scales/mode-frame'`.

- [ ] **Step 3: 寫最小實作**

Create `src/lib/scales/mode-frame.ts`:

```typescript
import type { ItemMode } from './scale';

/** Answer-source framing copy shown above each questionnaire item.
 *  title = WHO answers / which method (mode-level); the item's own `prompt`
 *  says WHAT the question asks. The two must not restate each other (the old
 *  copy repeated「受測者本人作答／唸題記錄」across title, hint and prompt). */
export interface ModeFrame {
  title: string;
  hint: string;
}

/** Every `ItemMode` plus the informant-absent degraded frame. Closed union →
 *  adding a new ItemMode triggers a compile error here until its frame exists. */
export type ModeFrameKey = ItemMode | 'ask-informant-unavailable';

export const MODE_FRAME: Record<ModeFrameKey, ModeFrame> = {
  'patient': { title: '由受測者本人作答', hint: '操作者唸出題目，記錄其回答。' },
  'observe': { title: '由操作者觀察受測者', hint: '依下列觀察重點觀察，記錄結果。' },
  'ask-either': { title: '向受測者本人或家屬／照顧者詢問', hint: '可參考觀察與病歷後記錄。' },
  'ask-informant': { title: '向熟悉受測者的家屬／照顧者詢問', hint: '請選最了解其日常生活者回答。' },
  'ask-informant-unavailable': { title: '查無可詢問的知情者', hint: '本題需家屬／照顧者；可標為「無法取得」（記為未完成）。' },
  'measure': { title: '由操作者量測', hint: '依下列方式量測，記錄數值。' },
};

/** `mode` is the item's `ItemMode` (same type as the component's `currentMode`).
 *  The closed-union Record guarantees a hit, so no fallback is needed. */
export function resolveModeFrame(mode: ItemMode, informantAvailable: boolean | null): ModeFrame {
  if (mode === 'ask-informant' && informantAvailable === false) {
    return MODE_FRAME['ask-informant-unavailable'];
  }
  return MODE_FRAME[mode];
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm exec vitest run tests/scales/mode-frame.test.ts`
Expected: PASS（6 tests）。

- [ ] **Step 5: 回接 QuestionnaireModule**

In `src/components/assess/QuestionnaireModule.svelte`:

加入 import（與其他 import 同區塊，檔案頂部 `<script>` 內）：

```typescript
import { resolveModeFrame } from '../../lib/scales/mode-frame';
```

刪除 `247-254` 行的整段內嵌 `const MODE_FRAME: Record<...> = { ... };`（含上方註解 `243-246`）。

將 `255-260` 行的 `currentFrame` 改為：

```typescript
const currentFrame = $derived(resolveModeFrame(currentMode, informantAvailable));
```

（`currentMode` 第 241 行為 `ItemMode`，與 `resolveModeFrame(mode: ItemMode, …)` 第一參數型別一致；`informantAvailable` 既有變數 `boolean | null` 與第二參數一致；render 端 `569-570` 的 `currentFrame.title` / `currentFrame.hint` 不變。原 `$derived.by(() => {…})` 整段以單行 `$derived(resolveModeFrame(…))` 取代，行為等價。）

- [ ] **Step 6: 同步更新既有 QuestionnaireModule.test.ts 斷言（去重的回歸守門）**

文案去重會讓 3 條既有測試的期望字串失配（已逐一查證行號與內容）。改 `tests/components/QuestionnaireModule.test.ts`：

- `:165` `'請受測者本人作答（操作者唸題並記錄）'` → `'由受測者本人作答'`（patient title）。
- `:212` `'向受測者本人或家屬／照顧者詢問（可參考觀察與病歷）'` → `'向受測者本人或家屬／照顧者詢問'`（ask-either title）。
- `:308`（含上方 `:307` 註解）`'無知情者，標為無法取得'` → `'查無可詢問的知情者'`（ask-informant-unavailable title）；`:307` 註解同步改述。

不動的既有斷言（新值與舊值一致，不會壞）：`:177` 與 `:373` 的 `'向熟悉受測者的家屬／照顧者詢問'`、`:166` 的 YAML `prompt`、`:179` 的 `/無法取得/`（來自 UI「無法取得」標記按鈕，非 MODE_FRAME title）。

Run: `pnpm exec vitest run tests/components/QuestionnaireModule.test.ts`
Expected: PASS（測試數不變，3 條斷言改為新文案後通過）。

- [ ] **Step 7: 型別與 lint 檢查**

Run: `pnpm exec svelte-check --tsconfig ./tsconfig.json 2>&1 | tail -5`
Expected: 0 errors（warning 數不增加）。

Run: `pnpm exec eslint src/lib/scales/mode-frame.ts src/components/assess/QuestionnaireModule.svelte`
Expected: 無 error。

- [ ] **Step 8: Commit**

```bash
git add src/lib/scales/mode-frame.ts tests/scales/mode-frame.test.ts src/components/assess/QuestionnaireModule.svelte tests/components/QuestionnaireModule.test.ts
git commit -m "fix(assess): 抽出 MODE_FRAME 去重問卷標頭文案

title 只說由誰作答、hint 只說操作者動作，不再與彼此及 YAML prompt 同義重複。
抽成 src/lib/scales/mode-frame.ts 純模組可測，鍵型別收斂為 ItemMode|'ask-informant-unavailable' 封閉聯集。
同步更新 QuestionnaireModule.test.ts 3 條斷言舊文案（patient/ask-either/unavailable title）。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2：分組純函式 groupDomainScores

**Files:**
- Create: `src/lib/domain/group-domain-scores.ts`
- Test: `tests/domain/group-domain-scores.test.ts`

- [ ] **Step 1: 寫失敗測試**

Create `tests/domain/group-domain-scores.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { groupDomainScores } from '../../src/lib/domain/group-domain-scores';
import type { DomainScore } from '../../src/engine/cdsa/radar-scoring';

const s = (domain: string, score: number, severity: DomainScore['severity'] = 'normal'): DomainScore =>
  ({ domain, score, severity });

describe('groupDomainScores', () => {
  it('groups by DOMAIN_TREE top and labels groups + sub-domains in Chinese', () => {
    const groups = groupDomainScores([
      s('functional.adl', 20, 'monitor'),
      s('psychological.cognition', 80),
      s('psychological.mood', 40),
    ]);
    // psychological comes before functional in DOMAIN_TREE order
    expect(groups.map(g => g.label)).toEqual(['心理/精神', '功能']);
    expect(groups[0].items.map(i => i.label)).toEqual(['認知', '情緒']);
    expect(groups[1].items[0].label).toBe('基本日常');
  });

  it('orders sub-domains within a group by DOMAIN_TREE order, not input order', () => {
    const groups = groupDomainScores([
      s('physical.pain', 10),       // index 5
      s('physical.comorbidity', 30), // index 0
    ]);
    expect(groups[0].items.map(i => i.sub)).toEqual(['comorbidity', 'pain']);
  });

  it('omits top groups that have no scores', () => {
    const groups = groupDomainScores([s('social.financial', 0)]);
    expect(groups).toHaveLength(1);
    expect(groups[0].top).toBe('social');
  });

  it('carries score and severity through', () => {
    const [g] = groupDomainScores([s('psychological.mood', 0, 'incomplete')]);
    expect(g.items[0]).toMatchObject({ sub: 'mood', score: 0, severity: 'incomplete' });
  });

  it('returns [] for empty input', () => {
    expect(groupDomainScores([])).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm exec vitest run tests/domain/group-domain-scores.test.ts`
Expected: FAIL — `Cannot find module '../../src/lib/domain/group-domain-scores'`.

- [ ] **Step 3: 寫最小實作**

Create `src/lib/domain/group-domain-scores.ts`:

```typescript
import { DOMAIN_TREE, DOMAIN_TOP_LABELS, domainLabel, type DomainTop } from './domain-tree';
import type { DomainScore } from '../../engine/cdsa/radar-scoring';
import type { Severity } from '../scales/scale';

export interface DomainGroupRow {
  sub: string;
  label: string;
  score: number;
  severity: Severity;
}

export interface DomainGroup {
  top: DomainTop;
  label: string;
  items: DomainGroupRow[];
}

/** Group `top.sub` domain scores under their DOMAIN_TREE top category,
 *  ordered by tree order (not input order). Empty groups are omitted. */
export function groupDomainScores(scores: DomainScore[]): DomainGroup[] {
  const groups: DomainGroup[] = [];
  for (const top of Object.keys(DOMAIN_TREE) as DomainTop[]) {
    const order = DOMAIN_TREE[top] as readonly string[];
    const items: DomainGroupRow[] = scores
      .filter(d => d.domain.startsWith(`${top}.`))
      .map(d => {
        const sub = d.domain.split('.')[1] ?? '';
        return { sub, label: domainLabel(top, sub), score: d.score, severity: d.severity };
      })
      .sort((a, b) => order.indexOf(a.sub) - order.indexOf(b.sub));
    if (items.length > 0) groups.push({ top, label: DOMAIN_TOP_LABELS[top], items });
  }
  return groups;
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm exec vitest run tests/domain/group-domain-scores.test.ts`
Expected: PASS（5 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/domain/group-domain-scores.ts tests/domain/group-domain-scores.test.ts
git commit -m "feat(domain): groupDomainScores 依大類分組排序領域分數

純函式，供結果頁分組長條圖使用；依 DOMAIN_TREE 順序、略過空組。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3：DomainBarChart 元件

**Files:**
- Create: `src/components/assess/DomainBarChart.svelte`
- Test: `tests/components/DomainBarChart.test.ts`

- [ ] **Step 1: 寫失敗測試**

Create `tests/components/DomainBarChart.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import DomainBarChart from '../../src/components/assess/DomainBarChart.svelte';

afterEach(() => cleanup());

describe('DomainBarChart', () => {
  it('renders default title and legend', () => {
    render(DomainBarChart, { data: [{ domain: 'psychological.cognition', score: 80, severity: 'normal' }] });
    expect(screen.getByText('各面向評估結果')).toBeTruthy();
    expect(screen.getByText(/原始分占量表滿分百分比/)).toBeTruthy();
  });

  it('renders custom title', () => {
    render(DomainBarChart, {
      data: [{ domain: 'psychological.cognition', score: 80, severity: 'normal' }],
      title: '自訂標題',
    });
    expect(screen.getByText('自訂標題')).toBeTruthy();
  });

  it('hides legend when showLegend=false', () => {
    render(DomainBarChart, {
      data: [{ domain: 'psychological.cognition', score: 80, severity: 'normal' }],
      showLegend: false,
    });
    expect(screen.queryByText(/原始分占量表滿分百分比/)).toBeNull();
  });

  it('renders the top-category group header', () => {
    render(DomainBarChart, {
      data: [{ domain: 'psychological.cognition', score: 80, severity: 'normal' }],
    });
    expect(screen.getByText('心理/精神')).toBeTruthy();
  });

  it('renders two-level domain label (sub) instead of raw key', () => {
    render(DomainBarChart, {
      data: [{ domain: 'psychological.cognition', score: 80, severity: 'normal' }],
    });
    expect(screen.getByText('認知')).toBeTruthy();
  });

  it('renders the score next to each domain label', () => {
    render(DomainBarChart, {
      data: [
        { domain: 'psychological.cognition', score: 100, severity: 'normal' },
        { domain: 'functional.adl', score: 75, severity: 'monitor' },
      ],
    });
    expect(screen.getByText('100')).toBeTruthy();
    expect(screen.getByText('75')).toBeTruthy();
  });

  it('renders an em-dash for incomplete scales instead of a score', () => {
    render(DomainBarChart, {
      data: [{ domain: 'psychological.mood', score: 0, severity: 'incomplete' }],
    });
    expect(screen.getByText('—')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm exec vitest run tests/components/DomainBarChart.test.ts`
Expected: FAIL — 找不到 `DomainBarChart.svelte`。

- [ ] **Step 3: 寫最小實作**

Create `src/components/assess/DomainBarChart.svelte`:

```svelte
<script lang="ts">
import { groupDomainScores } from '../../lib/domain/group-domain-scores';
import type { DomainScore } from '../../engine/cdsa/radar-scoring';
import type { Severity } from '../../lib/scales/scale';

interface Props {
  /** One entry per scored `top.sub`. */
  data: DomainScore[];
  title?: string;
  showLegend?: boolean;
}
const { data, title = '各面向評估結果', showLegend = true }: Props = $props();

const groups = $derived(groupDomainScores(data));

const SEVERITY_COLOR: Record<Severity, string> = {
  normal: 'var(--accent)',
  monitor: 'var(--warn)',
  refer: 'var(--danger)',
  incomplete: 'var(--line)',
};
</script>

<div class="bars-wrap">
  <header class="bars-header">
    <h3>{title}</h3>
    {#if showLegend}
      <p class="legend">數值＝原始分占量表滿分百分比（依各量表切分點判讀嚴重度）；「—」為未完成</p>
    {/if}
  </header>

  {#each groups as g (g.top)}
    <section class="domain-group" aria-label={g.label}>
      <h4 class="group-title">{g.label}</h4>
      {#each g.items as it (it.sub + it.label)}
        <div class="bar-row">
          <span class="bar-label">{it.label}</span>
          <div class="bar-track">
            {#if it.severity !== 'incomplete'}
              <div
                class="bar-fill"
                style="width:{Math.max(it.score, 2)}%; background:{SEVERITY_COLOR[it.severity]}"
              ></div>
            {/if}
          </div>
          <span
            class="bar-val"
            class:incomplete={it.severity === 'incomplete'}
            style={it.severity === 'incomplete' ? '' : `color:${SEVERITY_COLOR[it.severity]}`}
          >
            {it.severity === 'incomplete' ? '—' : it.score}
          </span>
        </div>
      {/each}
    </section>
  {/each}
</div>

<style>
.bars-wrap { width: 100%; max-width: 560px; margin: 0 auto; }
.bars-header { text-align: center; }
.bars-header h3 { font-size: var(--text-lg); margin: 0 0 var(--space-1) 0; }
.bars-header .legend { font-size: var(--text-sm); color: var(--text); opacity: 0.7; margin: 0 0 var(--space-4) 0; }
.domain-group { margin-bottom: var(--space-3); }
.group-title { font-size: var(--text-sm); font-weight: var(--font-bold); margin: 0 0 var(--space-1) 0; color: var(--text); opacity: 0.75; }
.bar-row { display: flex; align-items: center; gap: var(--space-2); margin: var(--space-1) 0; min-height: 28px; }
.bar-label { flex: 0 0 8em; font-size: var(--text-sm); text-align: right; white-space: nowrap; }
.bar-track { flex: 1; height: 16px; background: var(--surface); border-radius: 8px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 8px; }
.bar-val { flex: 0 0 2.5em; font-size: var(--text-sm); font-weight: var(--font-bold); text-align: left; }
.bar-val.incomplete { color: color-mix(in srgb, var(--text), var(--bg) 45%); }
</style>
```

- [ ] **Step 4: 跑測試確認通過**

Run: `pnpm exec vitest run tests/components/DomainBarChart.test.ts`
Expected: PASS（7 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/components/assess/DomainBarChart.svelte tests/components/DomainBarChart.test.ts
git commit -m "feat(assess): DomainBarChart 分組水平長條圖元件

按 6 大類分組、每域一條 0-100 bar、嚴重度配色、incomplete 顯示破折號。
取代 20 軸雷達圖的可讀性問題；資料形狀沿用 DomainScore 不改計分。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4：結果頁切換並移除 RadarChart

**Files:**
- Modify: `src/components/assess/ResultView.svelte:9,161`
- Modify: `src/components/assess/ResultViewWrapper.svelte:3,126`
- Delete: `src/components/assess/RadarChart.svelte`
- Delete: `tests/components/RadarChart.test.ts`

- [ ] **Step 1: 切換 ResultView**

In `src/components/assess/ResultView.svelte`：

第 9 行 `import RadarChart from './RadarChart.svelte';` 改為：

```typescript
import DomainBarChart from './DomainBarChart.svelte';
```

第 161 行 `<RadarChart data={domainScores} />` 改為：

```svelte
<DomainBarChart data={domainScores} />
```

（第 159 `aria-label`、第 160 `<h3>各面向評估</h3>` 與 `.radar-section` 樣式保留，不影響。）

- [ ] **Step 2: 切換 ResultViewWrapper**

In `src/components/assess/ResultViewWrapper.svelte`：

第 3 行 `import RadarChart from './RadarChart.svelte';` 改為：

```typescript
import DomainBarChart from './DomainBarChart.svelte';
```

第 126 行 `<RadarChart data={domainScores} />` 改為：

```svelte
<DomainBarChart data={domainScores} />
```

- [ ] **Step 3: 刪除舊雷達元件與測試**

```bash
git rm src/components/assess/RadarChart.svelte tests/components/RadarChart.test.ts
```

- [ ] **Step 4: 確認無殘留引用**

Run: `grep -rn "RadarChart" src tests`
Expected: 無輸出（零殘留）。

- [ ] **Step 5: 全測試 + 型別 + lint**

Run: `pnpm test`
Expected: PASS；總數 = 改動前基線 366（已實跑 `vitest run` 確認）− 6（刪 RadarChart.test.ts，實測 6 個 it）+ 6（mode-frame）+ 5（group）+ 7（DomainBarChart）= **378 pass**。Task 1 Step 6 更新 QuestionnaireModule.test.ts 的 3 條斷言屬「改文案不增減」，pass 數不變。

Run: `pnpm check`
Expected: 0 errors。

Run: `pnpm lint`
Expected: 0 errors（warning 不增加）。

- [ ] **Step 6: Commit**

```bash
git add src/components/assess/ResultView.svelte src/components/assess/ResultViewWrapper.svelte
git commit -m "refactor(assess): 結果頁改用 DomainBarChart 並移除 RadarChart

ResultView 與 ResultViewWrapper 兩個呼叫點切換；刪除 20 軸雷達元件與測試。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5：端到端目視驗證（playwright，本機 preview）

**目的**：spec 教訓——抽象測試通過不代表結果頁實際可讀；需真的開頁面看一次。

- [ ] **Step 1: 建置並啟動 preview**

Run: `pnpm build && pnpm preview --port 4321 &`
Expected: build 成功（含 Pagefind 索引）、preview 起在 4321。

- [ ] **Step 2: 走一個評估到結果頁，目視長條圖**

用 playwright MCP 開 `http://localhost:4321/assess/`，跑完一個個案到結果頁，確認：
- 「各面向評估」區塊出現分組長條（6 大類分組、bar 寬度對應分數、顏色對應嚴重度）。
- 標籤不重疊、可閱讀；最長子標籤（如「預立照護諮商」「工具性日常」）完整顯示不換行、不截斷。
- incomplete 領域顯示「—」。
- 問卷某題標頭只有「title + hint」兩行且不重複（譫妄 AMT4 題或任一 patient 題）。
- console 無錯誤。

- [ ] **Step 3: 收掉 preview**

Run: 結束背景 preview 程序。

- [ ] **Step 4（無 commit）**：回報目視結果；若有問題回到對應 Task 修正。

---

## Self-Review（計畫對照 spec）

- **§E 文案去重** → Task 1 ✅
- **§D 結果頁長條圖（方向 B）** → Task 2（分組）+ Task 3（元件）+ Task 4（接線）✅
- **spec 教訓「需端到端走完」** → Task 5 ✅
- 型別一致：`DomainScore`（domain/score/severity）跨 Task 2/3 一致；`groupDomainScores` 回傳 `DomainGroup[]`，元件 `groups` 直接 each；`SEVERITY_COLOR` 鍵為 `Severity` 四值，與 `--accent/--warn/--danger/--line`（`tokens.css`）對應；字級/間距 token（`--text-lg/--text-sm/--space-*/--font-bold`）在 `typography.css`，`--text-sm = 20px ≥ 18px` 不違反最小字級。`MODE_FRAME` 鍵為 `ItemMode|'ask-informant-unavailable'` 封閉聯集、`resolveModeFrame(mode: ItemMode, …)` 與元件 `currentMode` 型別一致。
- 無 placeholder：所有步驟含實際程式碼與指令。
- 範圍：Phase 1 僅前端兩修正，不觸分層引擎（Phase 2）與自評層（Phase 3）。

### 第一輪獨立審查（Opus）修正納入（2026-05-29）

- **[blocker]** 文案去重會讓 `QuestionnaireModule.test.ts` 既有斷言失配。審查報 `:165`/`:212` 兩處；自行 grep 查證**補抓 `:308`**（unavailable title）共 3 處 → Task 1 新增 Step 6 同步更新。
- **[major]** `MODE_FRAME` 鍵型別由 `Record<string,…>` 收斂為封閉聯集 + `resolveModeFrame` 簽名改 `ItemMode`，移除型別上 unreachable 的 fallback；測試移除無意義的 `'nonsense'` 案例。
- **[major]** 校正「現況」敘述：既有 `RadarChart` 已是 SVG 環狀雷達且具 title/legend/標籤/incomplete，本 Phase 是換座標形態並沿用呈現要素（非新增）。
- **[minor]** `.bar-label` 加 `white-space: nowrap`、放寬 `8em`，防最長標籤換行；Task 5 加目視檢查。
- **[minor]** unavailable title `'無知情者可詢問'`（斷句歧義）改為 `'查無可詢問的知情者'`。
- 已逐一查證並成立：行號（241/247-260/569-570）、`ItemMode` 5 值、`DomainScore`/`Severity`/`DOMAIN_TREE`/`DOMAIN_TOP_LABELS`/`domainLabel` export 與用法、`score=round(100*raw/max)` 0–100 故 legend 與 `width:%` 語義正確、tsconfig 未開 `noUncheckedIndexedAccess`（封閉聯集索引回非 undefined）、`render(Comp,{props})` 慣例、`grep RadarChart` 僅 4 處 + 待刪測試、測試數 366→378。
