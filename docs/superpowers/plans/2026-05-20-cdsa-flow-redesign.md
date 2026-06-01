# CDSA 流程重設計 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修正 CDSA 評估流程 4 個議題：(A) 問卷題目分布不均（補 13 題到每 ageGroup × applicable domain ≥ 2 題）、(B) 問卷某 domain 滿分時動態 skip 對應測驗 module、(C) 雷達圖 z-score 50-base 改 0-100 percentile、(D) social_emotional 漏 emit bug 防護（多層 dev-warn + 整合測試）。

**Architecture:** Phase 0 先建 build script + generated.json + DB v5 schema 骨架（後續 task 依賴）；Phase 1-3 依序處理 D / C / A / B；Phase 4 整合測試 + 驗收。Spec §10 / §11 為 source of truth。

**Tech Stack:** TypeScript strict, Astro 6 + Svelte 5 runes, Dexie 4.x (IndexedDB v5), vitest + @testing-library/svelte, fake-indexeddb, tsx.

**Spec reference:** `docs/superpowers/specs/2026-05-20-cdsa-flow-redesign.md` (v5, 5 輪 reviewer approved)。任何決策衝突以 spec 為準。

---

## File Structure

```
新增：
src/lib/data/expected-questionnaire-domains.generated.json    build-time 產出，git tracked
scripts/build-questionnaire-applicability.ts                  新 build script
tests/components/QuestionnaireFlow.test.ts                    7 ageGroup × 全選最高分整合測試
tests/data/questionnaire-coverage.test.ts                     每 ageGroup × applicable-domain ≥ 2 題
tests/components/RadarChart.test.ts                           zToPercentile + hybrid path

修改：
src/lib/db/schema.ts                              Assessment +forceFullAssessment?: boolean
                                                   db.version(5).stores(...) verbatim copy v4 + upgrade
src/lib/stores/assessment.svelte.ts               +forceFullAssessment / skippedModules /
                                                   effectiveSteps / effectiveStepIndex
                                                   nextStep/prevStep 演算法改寫
                                                   addAnalysis 加 dev-warn
                                                   STEP_LABELS 從 AssessmentShell 搬來並改 Record
src/components/assess/AssessmentShell.svelte      STEP_LABELS 移除（改從 store import）
                                                   StepIndicator 用 effectiveSteps + STEP_LABELS map
src/components/assess/QuestionnaireModule.svelte  +summary 頁建議流程預覽 + 兩按鈕
                                                   +clinicallyReviewed badge
                                                   +option button data-score attribute
                                                   +persistScoresToStore 內 dev-warn 缺 domain
src/components/assess/ResultView.svelte           domainScores 改 hybrid (raw + percentile)
                                                   +zToPercentile helper
                                                   +isHybrid flag
src/components/assess/RadarChart.svelte           Props 加 title/showLegend/isHybrid 型別
                                                   +副標 legend + 每 domain 分數顯示
                                                   +hybrid icon ⚖
src/engine/cdsa/triage.ts                         rollback questionnaire directionalZ → null
                                                   +KNOWN_QUESTIONNAIRE_DOMAINS dev-warn
                                                   +questionnaireMaxScores missing dev-warn
src/data/questionnaire/questions.json             既有 31 題 + 新補 13 題；全部加
                                                   clinicallyReviewed: false + source 欄位
package.json                                      prebuild 加上 tsx
                                                   scripts/build-questionnaire-applicability.ts
tests/engine/triage.test.ts                       移除 quick fix 的 directionalZ 測試；
                                                   加 directionalZ === null + dev-warn coverage；
                                                   修 'language' → 'language_comprehension'
tests/components/ResultView.test.ts               加 6 questionnaire domain 完整測試
.gitignore                                        無變更
```

---

## Phase 0: 基建骨架（後續所有 task 的依賴）

### Task 1: 新建 build-questionnaire-applicability.ts + emit generated.json

**Files:**
- Create: `scripts/build-questionnaire-applicability.ts`
- Create: `src/lib/data/expected-questionnaire-domains.generated.json`
- Modify: `package.json`（prebuild 串接）

- [ ] **Step 1: 寫 build script**

Create `scripts/build-questionnaire-applicability.ts`:

```typescript
#!/usr/bin/env tsx
import fs from 'node:fs/promises';
import path from 'node:path';

interface InapplicableMatrix {
  version: number;
  'cdsa.domain': Record<string, { inapplicable: string[] }>;
}

const QUESTIONNAIRE_DOMAINS = [
  'cognition', 'fine_motor', 'gross_motor',
  'language_comprehension', 'language_expression', 'social_emotional',
] as const;

const AGE_GROUPS_CDSA = [
  '2-6m', '7-12m', '13-24m', '25-36m', '37-48m', '49-60m', '61-72m',
] as const;

async function main(): Promise<void> {
  const cwd = process.cwd();
  const matrixPath = path.join(cwd, 'scripts/curate/inapplicable-matrix.json');
  const matrix: InapplicableMatrix = JSON.parse(await fs.readFile(matrixPath, 'utf8'));

  const result: Record<string, string[]> = {};
  for (const ag of AGE_GROUPS_CDSA) {
    result[ag] = QUESTIONNAIRE_DOMAINS.filter(domain => {
      const inapp = matrix['cdsa.domain'][domain]?.inapplicable ?? [];
      return !inapp.includes(ag);
    });
  }

  // sort keys deep for reproducibility
  const sorted = Object.fromEntries(
    Object.keys(result).sort().map(k => [k, result[k].sort()]),
  );

  const outPath = path.join(cwd, 'src/lib/data/expected-questionnaire-domains.generated.json');
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(sorted, null, 2) + '\n');
  console.log(`[build-questionnaire-applicability] wrote ${outPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err); process.exit(1); });
}
```

- [ ] **Step 2: 跑一次產出 generated.json**

Run: `tsx scripts/build-questionnaire-applicability.ts`
Expected: `[build-questionnaire-applicability] wrote /Users/lightman/yao.care/smart-geri-cds/src/lib/data/expected-questionnaire-domains.generated.json`

- [ ] **Step 3: 驗 generated.json 內容**

Run: `cat src/lib/data/expected-questionnaire-domains.generated.json`
Expected：
```json
{
  "13-24m": ["cognition","fine_motor","gross_motor","language_comprehension","language_expression","social_emotional"],
  "2-6m": ["gross_motor"],
  "25-36m": [...全 6 個],
  "37-48m": [...全 6 個],
  "49-60m": [...全 6 個],
  "61-72m": [...全 6 個],
  "7-12m": ["fine_motor","gross_motor","language_comprehension","social_emotional"]
}
```

- [ ] **Step 4: 修 package.json prebuild 串接**

讀現有 `package.json` prebuild，改為（如果現在是 `tsx scripts/build-video-index.ts`）：

```json
"prebuild": "tsx scripts/build-video-index.ts && tsx scripts/build-questionnaire-applicability.ts",
"predev":   "tsx scripts/build-video-index.ts && tsx scripts/build-questionnaire-applicability.ts",
```

- [ ] **Step 5: 跑 pnpm prebuild 驗整鏈**

Run: `pnpm prebuild`
Expected: 兩個 script 都跑成功，無 error

- [ ] **Step 6: Commit**

```bash
git add scripts/build-questionnaire-applicability.ts src/lib/data/expected-questionnaire-domains.generated.json package.json
git commit -m "feat(cdsa): build-questionnaire-applicability + generated.json from matrix"
```

---

### Task 2: DB v5 migration — Assessment.forceFullAssessment

**Files:**
- Modify: `src/lib/db/schema.ts`

- [ ] **Step 1: 讀現有 v4 stores 確認 verbatim 對齊**

Run: `sed -n '321,341p' src/lib/db/schema.ts`
Expected: 看到 17 個 store key 的完整定義（spec §4.4 已列出對照）

- [ ] **Step 2: 修 Assessment interface 加 forceFullAssessment**

在 `src/lib/db/schema.ts` 找 `interface Assessment` 區塊，加：

```typescript
export interface Assessment {
  // ... 既有欄位
  forceFullAssessment?: boolean;  // v5: default false; '跑完整評估' override
}
```

- [ ] **Step 3: 加 v5 migration**

在 `src/lib/db/schema.ts` 的 `constructor` 內，`this.version(4).stores(...)` 之後加：

```typescript
this.version(5).stores({
  patients: 'id, ageGroup, currentRiskLevel, lastSyncedAt',
  observations: 'id, patientId, indicator, effectiveDateTime, [patientId+indicator]',
  alerts: 'id, patientId, riskLevel, status, createdAt, [patientId+status]',
  baselines: '[patientId+indicator], patientId, updatedAt',
  syncQueue: 'id, createdAt',
  serverConfigs: 'id, lastUsedAt',
  educationInteractions: 'id, contentSlug, createdAt',
  ruleVersions: 'id, createdAt',
  webhookHistory: 'id, webhookId, alertId, createdAt',
  children: 'id, createdAt',
  assessments: 'id, childId, status, createdAt, [childId+status]',
  assessmentEvents: 'id, assessmentId, childId, moduleType, timestamp, [assessmentId+moduleType]',
  mediaFiles: 'id, assessmentId, childId, fileType, createdAt, [assessmentId+fileType]',
  normThresholds: 'id, ageGroup, metric, [ageGroup+metric]',
  customEducation: 'id, tenantId, category, isActive, [tenantId+isActive]',
  tenantSettings: 'id, tenantId',
  recommendationOverlays: 'id, tenantId, category, domain, [tenantId+category+domain]',
}).upgrade(async tx => {
  await tx.table('assessments').toCollection().modify(a => {
    a.forceFullAssessment = false;
  });
});
```

- [ ] **Step 4: 跑 `pnpm check` 驗型別**

Run: `pnpm check`
Expected: 0 errors

- [ ] **Step 5: 跑現有 DB 相關 tests**

Run: `pnpm test src/lib/db tests/lib/db 2>&1 | tail -10`
Expected: 全 pass（既有測試不應 regression）

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts
git commit -m "feat(cdsa): DB v5 migration — Assessment.forceFullAssessment default false"
```

---

## Phase 1: D bug 防護（dev-warn + 整合測試骨架）

### Task 3: triage.ts rollback + KNOWN_QUESTIONNAIRE_DOMAINS dev-warn

**Files:**
- Modify: `src/engine/cdsa/triage.ts`
- Modify: `tests/engine/triage.test.ts`

- [ ] **Step 1: 修 triage.ts — rollback quick fix + 加 KNOWN_QUESTIONNAIRE_DOMAINS dev-warn**

在 `src/engine/cdsa/triage.ts` 中找 `metric: 'questionnaireScore'` 區塊（quick fix 留下的 `directionalZ: (normalized - 0.5) * 10`），改回 `null`：

```typescript
// 改前
directionalZ: (normalized - 0.5) * 10,

// 改後
directionalZ: null, // questionnaire 不走 z；radar 改路徑識別 (ResultView)
```

在 `triage.ts` 開頭（imports 之後）加：

```typescript
const KNOWN_QUESTIONNAIRE_DOMAINS = new Set([
  'cognition', 'fine_motor', 'gross_motor',
  'language_comprehension', 'language_expression', 'social_emotional',
]);
```

在 `computeTriage` 內 questionnaire scores 處理區塊**之前**加：

```typescript
// Dev-mode: 偵測 schema drift
if (input.questionnaireScores && import.meta.env?.DEV) {
  for (const domain of Object.keys(input.questionnaireScores)) {
    if (!KNOWN_QUESTIONNAIRE_DOMAINS.has(domain)) {
      console.warn(`[triage] Unknown questionnaire domain: ${domain}`);
    }
  }
  if (!input.questionnaireMaxScores) {
    console.warn('[triage] questionnaireScores provided without questionnaireMaxScores');
  }
}
```

- [ ] **Step 2: 修 tests/engine/triage.test.ts**

找這兩條測試並改回原行為（搜 `directionalZ.*-2.*5` 或 `directionalZ.*\+5`）：

```typescript
// 改回（rollback quick fix 的測試）
it('questionnaireScore detail has directionalZ === null', async () => {
  const result = await computeTriage({
    ...baseInput,
    questionnaireScores: { cognition: 3 },
  });
  const detail = result.details.find((d) => d.metric === 'questionnaireScore');
  expect(detail?.directionalZ).toBeNull();
});
```

移除 `'questionnaireScore at max → directionalZ = +5'` 測試（如有）。

找既有 `'includes questionnaire anomaly when score below 50% of max'` 測試，把 `language` domain 改為 `language_comprehension`：

```typescript
// 改前
questionnaireScores: { cognition: 3, language: 8 },

// 改後
questionnaireScores: { cognition: 3, language_comprehension: 8 },
```

- [ ] **Step 3: 加 dev-warn 測試**

在 `tests/engine/triage.test.ts` 末尾加：

```typescript
import { vi } from 'vitest';

describe('triage dev-mode warnings', () => {
  it('warns on unknown questionnaire domain', async () => {
    vi.stubEnv('DEV', true);
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await computeTriage({
      ...baseInput,
      questionnaireScores: { unknown_domain: 5 },
      questionnaireMaxScores: { unknown_domain: 10 },
    });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Unknown questionnaire domain'));
    spy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('warns when questionnaireScores has no questionnaireMaxScores', async () => {
    vi.stubEnv('DEV', true);
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await computeTriage({
      ...baseInput,
      questionnaireScores: { cognition: 3 },
      // 故意省略 questionnaireMaxScores
    });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('without questionnaireMaxScores'));
    spy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('does not warn in prod (DEV=false)', async () => {
    vi.stubEnv('DEV', false);
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await computeTriage({
      ...baseInput,
      questionnaireScores: { unknown_domain: 5 },
    });
    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('Unknown'));
    spy.mockRestore();
    vi.unstubAllEnvs();
  });
});
```

- [ ] **Step 4: 跑測試**

Run: `pnpm test tests/engine/triage.test.ts`
Expected: 全 pass

- [ ] **Step 5: Commit**

```bash
git add src/engine/cdsa/triage.ts tests/engine/triage.test.ts
git commit -m "fix(cdsa): rollback questionnaire directionalZ quick fix + add KNOWN_DOMAINS dev-warn"
```

---

### Task 4: store.addAnalysis dev-warn

**Files:**
- Modify: `src/lib/stores/assessment.svelte.ts`

- [ ] **Step 1: 修 addAnalysis 加 dev-warn**

在 `src/lib/stores/assessment.svelte.ts` 找 `addAnalysis` 方法，改為：

```typescript
addAnalysis(partial: Partial<PartialAnalysis>): void {
  // ⚠ 此 warn 依賴 addAnalysis 為 shallow spread（partial.questionnaireScores
  // 整個替換 this.partialAnalysis.questionnaireScores 而非深 merge）。若日後改深 merge，
  // 此守護需重寫（newKeys 將包含 prev 所有 key + new，永遠抓不到 drop）。
  if (import.meta.env.DEV && partial.questionnaireScores) {
    const prevKeys = Object.keys(this.partialAnalysis.questionnaireScores ?? {});
    const newKeys = Object.keys(partial.questionnaireScores);
    const missing = prevKeys.filter(k => !newKeys.includes(k));
    if (missing.length > 0) {
      console.warn(
        `[AssessmentStore] addAnalysis(questionnaireScores) drops previously-set domains: ${missing.join(', ')}`
      );
    }
  }
  this.partialAnalysis = { ...this.partialAnalysis, ...partial };
}
```

- [ ] **Step 2: 跑 check**

Run: `pnpm check`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/stores/assessment.svelte.ts
git commit -m "fix(cdsa): addAnalysis dev-warn when questionnaireScores drops domain"
```

---

## Phase 2: C 雷達 0-100 percentile

### Task 5: zToPercentile helper + 改 ResultView.domainScores

**Files:**
- Modify: `src/components/assess/ResultView.svelte`

- [ ] **Step 1: 加 zToPercentile helper**

在 `src/components/assess/ResultView.svelte` 的 `<script>` 內，imports 之後加：

```typescript
function zToPercentile(z: number): number {
  if (z === 0) return 0.5;   // 短路避免 z=0 處 ε 跳躍
  // Standard normal CDF approximation (Abramowitz & Stegun 26.2.17)
  // accuracy ~7.5e-8
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804 * Math.exp(-z * z / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}
```

- [ ] **Step 2: 改 domainScores derive**

在 `ResultView.svelte` 找現有 `const domainScores = $derived.by(...)` 區塊，整段替換為：

```typescript
const domainScores = $derived.by(() => {
  if (!triageResult) return [];
  const buckets: Record<string, {
    zSum: number; zCount: number;
    rawSum: number; rawCount: number;
    hasAnomaly: boolean;
  }> = {};

  for (const d of triageResult.details) {
    if (!buckets[d.domain]) {
      buckets[d.domain] = { zSum: 0, zCount: 0, rawSum: 0, rawCount: 0, hasAnomaly: false };
    }

    if (d.metric === 'questionnaireScore' && d.maxScore && d.maxScore > 0) {
      // 問卷：直接 raw normalized
      buckets[d.domain].rawSum += (d.value as number) / d.maxScore;
      buckets[d.domain].rawCount++;
    } else if (d.directionalZ !== null && d.directionalZ !== undefined) {
      // 測驗：z-score
      buckets[d.domain].zSum += d.directionalZ;
      buckets[d.domain].zCount++;
    }
    if (d.isAnomaly) buckets[d.domain].hasAnomaly = true;
  }

  return Object.entries(buckets).map(([domain, b]) => {
    let score = 50;
    if (b.rawCount > 0 && b.zCount === 0) {
      score = Math.round(100 * b.rawSum / b.rawCount);
    } else if (b.zCount > 0 && b.rawCount === 0) {
      score = Math.round(100 * zToPercentile(b.zSum / b.zCount));
    } else if (b.zCount > 0 && b.rawCount > 0) {
      // Hybrid path — 實際只發生在 fine_motor (drawing z + questionnaire raw)
      // 場景：用戶 forceFullAssessment=true 即使問卷滿分仍跑 drawing
      // 兩 path 平均：問卷主觀 + 測驗客觀互補
      const rawPct = b.rawSum / b.rawCount;
      const zPct = zToPercentile(b.zSum / b.zCount);
      score = Math.round(100 * (rawPct + zPct) / 2);
    }
    return {
      domain,
      score,
      hasAnomaly: b.hasAnomaly,
      isHybrid: b.zCount > 0 && b.rawCount > 0,
    };
  });
});
```

- [ ] **Step 3: 跑 check**

Run: `pnpm check`
Expected: 0 errors

- [ ] **Step 4: 跑既有 ResultView test**

Run: `pnpm test tests/components/ResultView.test.ts 2>&1 | tail -5`
Expected: 既有測試 pass（domainScores 介面對外不變，只是分數公式改）

- [ ] **Step 5: Commit**

```bash
git add src/components/assess/ResultView.svelte
git commit -m "feat(cdsa): radar 0-100 percentile (questionnaire raw + test z hybrid)"
```

---

### Task 6: RadarChart Props 擴充 + 副標 + 分數顯示 + hybrid icon

**Files:**
- Modify: `src/components/assess/RadarChart.svelte`
- Create: `tests/components/RadarChart.test.ts`

- [ ] **Step 1: 寫 test**

Create `tests/components/RadarChart.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import RadarChart from '../../src/components/assess/RadarChart.svelte';

describe('RadarChart', () => {
  it('renders default title and legend', () => {
    render(RadarChart, { data: [{ domain: 'cognition', score: 80, hasAnomaly: false }] });
    expect(screen.getByText('各面向表現位階')).toBeTruthy();
    expect(screen.getByText(/100 = 表現傑出/)).toBeTruthy();
  });

  it('renders custom title', () => {
    render(RadarChart, {
      data: [{ domain: 'cognition', score: 80, hasAnomaly: false }],
      title: '自訂標題',
    });
    expect(screen.getByText('自訂標題')).toBeTruthy();
  });

  it('hides legend when showLegend=false', () => {
    render(RadarChart, {
      data: [{ domain: 'cognition', score: 80, hasAnomaly: false }],
      showLegend: false,
    });
    expect(screen.queryByText(/100 = 表現傑出/)).toBeNull();
  });

  it('renders score next to each domain label', () => {
    render(RadarChart, {
      data: [
        { domain: 'cognition', score: 100, hasAnomaly: false },
        { domain: 'fine_motor', score: 75, hasAnomaly: false, isHybrid: true },
      ],
    });
    expect(screen.getByText('100')).toBeTruthy();
    expect(screen.getByText('75')).toBeTruthy();
  });

  it('renders hybrid icon for isHybrid=true domains', () => {
    render(RadarChart, {
      data: [{ domain: 'fine_motor', score: 75, hasAnomaly: false, isHybrid: true }],
    });
    expect(screen.getByLabelText(/結合問卷.*測驗.*平均/)).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑 test 確認 fail**

Run: `pnpm test tests/components/RadarChart.test.ts 2>&1 | tail -10`
Expected: 多項 FAIL（title / legend / score / hybrid 都 not found）

- [ ] **Step 3: 改 RadarChart.svelte**

替換 `src/components/assess/RadarChart.svelte` 整檔內容（保留 svg + polarToCartesian 等既有 helper）：

```svelte
<script lang="ts">
interface Props {
  data: Array<{
    domain: string;
    score: number;
    hasAnomaly: boolean;
    isHybrid?: boolean;
  }>;
  size?: number;
  title?: string;
  showLegend?: boolean;
}
const { data, size = 320, title = '各面向表現位階', showLegend = true }: Props = $props();

const domainLabels: Record<string, string> = {
  behavior: '行為',
  gross_motor: '粗動作',
  fine_motor: '細動作',
  language: '語言',
  language_comprehension: '語言理解',
  language_expression: '語言表達',
  cognition: '認知',
  social_emotional: '社會情緒',
};

const center = $derived(size / 2);
const radius = $derived(size / 2 - 60);  // 加大 padding 容 label + score
const angleStep = $derived(data.length > 0 ? (2 * Math.PI) / data.length : 0);

function polarToCartesian(angle: number, r: number): { x: number; y: number } {
  return {
    x: center + r * Math.cos(angle - Math.PI / 2),
    y: center + r * Math.sin(angle - Math.PI / 2),
  };
}
</script>

<div class="radar-wrap">
  <header class="radar-header">
    <h3>{title}</h3>
    {#if showLegend}
      <p class="legend">100 = 表現傑出　·　50 = 同齡平均　·　0 = 顯著落後</p>
    {/if}
  </header>
  <svg viewBox="0 0 {size} {size}" width={size} height={size} class="radar-chart" role="img" aria-label="發展面向雷達圖">
    <!-- background polygon (max radius) -->
    {#if data.length >= 3}
      <polygon
        points={data.map((_, i) => {
          const p = polarToCartesian(angleStep * i, radius);
          return `${p.x},${p.y}`;
        }).join(' ')}
        fill="none"
        stroke="var(--line)"
        stroke-width="1"
      />
    {/if}

    <!-- data polygon -->
    {#if data.length >= 3}
      <polygon
        points={data.map((d, i) => {
          const p = polarToCartesian(angleStep * i, radius * d.score / 100);
          return `${p.x},${p.y}`;
        }).join(' ')}
        fill="var(--accent)"
        fill-opacity="0.2"
        stroke="var(--accent)"
        stroke-width="2"
      />
    {/if}

    <!-- per-domain label + score + hybrid icon -->
    {#each data as d, i}
      {@const labelPos = polarToCartesian(angleStep * i, radius + 20)}
      {@const scorePos = polarToCartesian(angleStep * i, radius + 38)}
      <text x={labelPos.x} y={labelPos.y} class="radar-label" text-anchor="middle">
        {domainLabels[d.domain] ?? d.domain}
      </text>
      <text x={scorePos.x} y={scorePos.y} class="radar-score" text-anchor="middle">
        {d.score}
      </text>
      {#if d.isHybrid}
        <g role="img" aria-label="此面向結合問卷（照顧者回報）與測驗（實機觀察）兩個證據之平均">
          <text x={scorePos.x + 14} y={scorePos.y} class="radar-hybrid-icon" text-anchor="middle">⚖</text>
        </g>
      {/if}
    {/each}
  </svg>
</div>

<style>
.radar-wrap { display: flex; flex-direction: column; align-items: center; }
.radar-header { text-align: center; }
.radar-header h3 { font-size: var(--text-lg); margin: 0 0 var(--space-1) 0; }
.radar-header .legend {
  font-size: var(--text-sm);
  color: var(--text);
  opacity: 0.7;
  margin: 0 0 var(--space-4) 0;
}
.radar-chart { display: block; }
.radar-label { font-size: var(--text-sm); fill: var(--text); }
.radar-score { font-size: var(--text-sm); fill: var(--accent); font-weight: var(--font-bold); }
.radar-hybrid-icon {
  font-family: var(--font-sans, system-ui), "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
  fill: var(--text);
  font-size: var(--text-sm);
}
</style>
```

- [ ] **Step 4: 跑 test 確認 pass**

Run: `pnpm test tests/components/RadarChart.test.ts 2>&1 | tail -10`
Expected: 5/5 pass

- [ ] **Step 5: 跑全測試確認無 regression**

Run: `pnpm test 2>&1 | tail -5`
Expected: 全 pass

- [ ] **Step 6: Commit**

```bash
git add src/components/assess/RadarChart.svelte tests/components/RadarChart.test.ts
git commit -m "feat(cdsa): RadarChart 副標 + per-domain score + hybrid icon"
```

---

## Phase 3: A 補 13 題（人工互動 review）

> **本 phase 為人工互動執行，subagent 不適合一次跑完。** Plan agent 應將每 batch 4-5 題的 review 視為「需主對話人類介入」的工作。

### Task 7: 補題 schema 變更（既有 31 題加 clinicallyReviewed / source 欄位）

**Files:**
- Modify: `src/data/questionnaire/questions.json`

- [ ] **Step 1: 對既有 31 題每筆加兩欄**

對 `src/data/questionnaire/questions.json` 中既有 31 題每筆 append：

```json
{
  "id": "gm-01",
  ... 既有欄位 ...,
  "clinicallyReviewed": false,
  "source": "manual"
}
```

可用 `jq` 一鍵更新：

```bash
jq '.questions |= map(. + {clinicallyReviewed: false, source: "manual"})' \
   src/data/questionnaire/questions.json > /tmp/q.json && mv /tmp/q.json src/data/questionnaire/questions.json
```

- [ ] **Step 2: 驗結果**

Run: `jq '.questions[0:2]' src/data/questionnaire/questions.json`
Expected: 看到前 2 筆都有 `clinicallyReviewed: false` + `source: "manual"`

- [ ] **Step 3: Commit**

```bash
git add src/data/questionnaire/questions.json
git commit -m "feat(cdsa): existing 31 questions add clinicallyReviewed/source (default false/manual)"
```

---

### Task 8: 補 13 題 batch 1（4 題）— 與用戶互動 review

**Files:**
- Modify: `src/data/questionnaire/questions.json`

> **執行方式**：plan agent 把 batch 1 draft 列出給用戶 review；用戶批准/修改後寫入 questions.json。

**Batch 1 candidates**（plan agent 列出 4 題，每題：id, domain, ageGroups, text, options, source）：

```
1. id="gm-07"  domain="gross_motor"   ageGroups=["2-6m"]
   text="寶寶趴著時能用手臂支撐胸部抬離地面嗎？"
   options: [{value:"yes",label:"是，經常可以",score:2},
             {value:"sometimes",label:"有時候可以",score:1},
             {value:"no",label:"還不能",score:0}]
   source: "Denver II inspiration"

2. id="fm-06"  domain="fine_motor"   ageGroups=["7-12m"]
   text="寶寶能用拇指和食指捏起小東西嗎？"
   options: [{value:"yes",label:"可以準確地捏起",score:2},
             {value:"sometimes",label:"還用整隻手抓",score:1},
             {value:"no",label:"還不會",score:0}]
   source: "ASQ-3 inspiration"

3. id="lc-05"  domain="language_comprehension"   ageGroups=["7-12m"]
   text="叫寶寶名字時，他會轉頭回應嗎？"
   options: [{value:"yes",label:"是，經常轉頭",score:2},
             {value:"sometimes",label:"偶爾會",score:1},
             {value:"no",label:"幾乎不會",score:0}]
   source: "M-CHAT inspiration"

4. id="fm-07"  domain="fine_motor"   ageGroups=["13-24m"]
   text="孩子能堆疊 2-3 塊積木嗎？"
   options: [{value:"yes",label:"可以穩定堆 3 塊以上",score:2},
             {value:"sometimes",label:"勉強堆 2 塊",score:1},
             {value:"no",label:"還不會",score:0}]
   source: "Denver II inspiration"
```

- [ ] **Step 1: Plan agent 把 batch 1 draft 印到主對話讓用戶 review**

寫一段話：「Batch 1 candidates 如上 4 題。請 review 題幹 / 選項 / score；確認後我寫入 questions.json。」

- [ ] **Step 2: 用戶批准/修改後寫入 questions.json**

把 4 題 append 到 `.questions` array（id 不可重複；ageGroups 對應 spec §3.2 缺題盤點）。

- [ ] **Step 3: 跑 jq 驗 schema 完整**

```bash
jq '.questions | length' src/data/questionnaire/questions.json
```
Expected: `35`（既有 31 + 補 4）

- [ ] **Step 4: Commit**

```bash
git add src/data/questionnaire/questions.json
git commit -m "feat(cdsa): add 4 new questions (batch 1/3) — 2-6m gm, 7-12m fm/lc, 13-24m fm"
```

---

### Task 9: 補 13 題 batch 2（5 題）— 與用戶互動 review

**Files:**
- Modify: `src/data/questionnaire/questions.json`

**Batch 2 candidates**（plan agent 列出 5 題，flow 同 Task 8）：

```
1. id="lc-06"  domain="language_comprehension"   ageGroups=["13-24m"]
   text="孩子能理解「過來」「坐下」等簡單指令嗎？"
   options: [{value:"yes",label:"是，能正確回應",score:2},
             {value:"sometimes",label:"有時聽得懂",score:1},
             {value:"no",label:"還聽不懂",score:0}]
   source: "Denver II inspiration"

2. id="gm-08"  domain="gross_motor"   ageGroups=["25-36m"]
   text="孩子能雙腳跳離地面嗎？"
   options: [{value:"yes",label:"可以跳得很穩",score:2},
             {value:"sometimes",label:"勉強一隻腳離地",score:1},
             {value:"no",label:"還不會",score:0}]
   source: "Denver II inspiration"

3. id="lc-07"  domain="language_comprehension"   ageGroups=["25-36m"]
   text="孩子能理解兩個物品的「大」「小」概念嗎？"
   options: [{value:"yes",label:"是，能正確指認",score:2},
             {value:"sometimes",label:"有時對",score:1},
             {value:"no",label:"還無法",score:0}]
   source: "ASQ-3 inspiration"

4. id="le-06"  domain="language_expression"   ageGroups=["25-36m"]
   text="孩子會說兩個字以上的詞嗎？（例如：「媽媽抱」「狗狗叫」）"
   options: [{value:"yes",label:"是，會說很多",score:2},
             {value:"sometimes",label:"偶爾說",score:1},
             {value:"no",label:"還只說單字",score:0}]
   source: "Denver II inspiration"

5. id="gm-09"  domain="gross_motor"   ageGroups=["37-48m"]
   text="孩子能用單腳站立 2 秒以上嗎？"
   options: [{value:"yes",label:"可以穩穩站",score:2},
             {value:"sometimes",label:"勉強一下",score:1},
             {value:"no",label:"還不會",score:0}]
   source: "Denver II inspiration"
```

- [ ] **Step 1: Plan agent 列出 batch 2 給用戶 review**

- [ ] **Step 2: 用戶批准/修改後寫入 questions.json**

- [ ] **Step 3: 驗**

```bash
jq '.questions | length' src/data/questionnaire/questions.json
```
Expected: `40`

- [ ] **Step 4: Commit**

```bash
git add src/data/questionnaire/questions.json
git commit -m "feat(cdsa): add 5 new questions (batch 2/3) — 13-24m lc, 25-36m gm/lc/le, 37-48m gm"
```

---

### Task 10: 補 13 題 batch 3（4 題）— 與用戶互動 review

**Files:**
- Modify: `src/data/questionnaire/questions.json`

**Batch 3 candidates**：

```
1. id="fm-08"  domain="fine_motor"   ageGroups=["61-72m"]
   text="孩子能用剪刀沿線剪簡單圖形嗎？"
   options: [{value:"yes",label:"是，剪得很整齊",score:2},
             {value:"sometimes",label:"勉強能剪",score:1},
             {value:"no",label:"還不會用",score:0}]
   source: "Denver II inspiration"

2. id="lc-08"  domain="language_comprehension"   ageGroups=["61-72m"]
   text="孩子能理解「在桌上」「在椅子下」等空間概念嗎？"
   options: [{value:"yes",label:"是，能正確執行指令",score:2},
             {value:"sometimes",label:"有時聽得懂",score:1},
             {value:"no",label:"還無法",score:0}]
   source: "ASQ-3 inspiration"

3. id="le-07"  domain="language_expression"   ageGroups=["61-72m"]
   text="孩子能用完整句子描述昨天發生的事嗎？"
   options: [{value:"yes",label:"能講得清楚有條理",score:2},
             {value:"sometimes",label:"只能講重點",score:1},
             {value:"no",label:"還無法描述",score:0}]
   source: "Denver II inspiration"

4. id="se-03"  domain="social_emotional"   ageGroups=["61-72m"]
   text="孩子能輪流和等待嗎？（例如：玩遊戲輪流）"
   options: [{value:"yes",label:"能耐心等待",score:2},
             {value:"sometimes",label:"需提醒",score:1},
             {value:"no",label:"還無法",score:0}]
   source: "Denver II inspiration"
```

- [ ] **Step 1: Plan agent 列出 batch 3 給用戶 review**

- [ ] **Step 2: 用戶批准/修改後寫入 questions.json**

- [ ] **Step 3: 驗**

```bash
jq '.questions | length' src/data/questionnaire/questions.json
```
Expected: `44`

- [ ] **Step 4: 跑 build:video-index + prebuild 確認其他依賴不破**

Run: `pnpm prebuild`
Expected: 兩個 build script 都成功

- [ ] **Step 5: Commit**

```bash
git add src/data/questionnaire/questions.json
git commit -m "feat(cdsa): add 4 new questions (batch 3/3) — 61-72m fm/lc/le/se"
```

---

### Task 11: questionnaire-coverage 驗收測試

**Files:**
- Create: `tests/data/questionnaire-coverage.test.ts`

- [ ] **Step 1: 寫 test**

Create `tests/data/questionnaire-coverage.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import questionsData from '../../src/data/questionnaire/questions.json';
import expectedDomainsMap from '../../src/lib/data/expected-questionnaire-domains.generated.json';

interface Question {
  id: string;
  domain: string;
  ageGroups: string[];
}

describe('questionnaire coverage per ageGroup × applicable domain', () => {
  const questions = (questionsData.questions as Question[]);
  for (const [ageGroup, applicableDomains] of Object.entries(expectedDomainsMap)) {
    for (const domain of applicableDomains as string[]) {
      it(`${ageGroup} × ${domain} has ≥ 2 questions`, () => {
        const count = questions.filter(q =>
          q.ageGroups.includes(ageGroup) && q.domain === domain
        ).length;
        expect(count).toBeGreaterThanOrEqual(2);
      });
    }
  }

  it('every existing 31 + new 13 questions have clinicallyReviewed and source fields', () => {
    const q = questions as Array<Question & { clinicallyReviewed?: boolean; source?: string }>;
    expect(q.length).toBe(44);
    for (const item of q) {
      expect(item).toHaveProperty('clinicallyReviewed');
      expect(item).toHaveProperty('source');
    }
  });
});
```

- [ ] **Step 2: 跑 test**

Run: `pnpm test tests/data/questionnaire-coverage.test.ts 2>&1 | tail -10`
Expected: 全 pass（每個 applicable cell 都有 ≥ 2 題）

- [ ] **Step 3: Commit**

```bash
git add tests/data/questionnaire-coverage.test.ts
git commit -m "test(cdsa): questionnaire coverage ≥ 2 questions per ageGroup × applicable domain"
```

---

### Task 12: clinicallyReviewed badge + QuestionnaireModule UI

**Files:**
- Modify: `src/components/assess/QuestionnaireModule.svelte`

- [ ] **Step 1: 加 badge**

在 `QuestionnaireModule.svelte` 找 currentQuestion 題幹渲染區塊（搜 `currentQuestion.text`），在其旁加：

```svelte
{#if currentQuestion?.clinicallyReviewed === false}
  <span
    class="badge-unreviewed"
    title="本題尚未經臨床顧問審查"
    aria-label="本題尚未經臨床顧問審查"
  >未審</span>
{/if}
```

- [ ] **Step 2: 加樣式**

在 `<style>` 區塊末尾加：

```css
.badge-unreviewed {
  display: inline-block;
  background: var(--warn);
  color: var(--bg);
  font-size: var(--text-sm);
  padding: var(--space-1) var(--space-2);
  border-radius: var(--radius-sm);
  margin-left: var(--space-2);
  vertical-align: middle;
}
```

> a11y 例外：badge 字級 `--text-sm` 小於 18px 規則；非 primary content；對比度 `--warn` vs `--bg` ≈ 7.2:1 (WCAG AA 通過)。

- [ ] **Step 3: 跑 check**

Run: `pnpm check`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add src/components/assess/QuestionnaireModule.svelte
git commit -m "feat(cdsa): clinicallyReviewed badge on questionnaire"
```

---

## Phase 4: B 動態 skip

### Task 13: assessment.svelte.ts — STEP_LABELS map + forceFullAssessment + skippedModules

**Files:**
- Modify: `src/lib/stores/assessment.svelte.ts`

- [ ] **Step 1: STEP_LABELS 從 AssessmentShell 搬到 store**

在 `src/lib/stores/assessment.svelte.ts` 既有 STEPS 定義旁加：

```typescript
export type AssessmentStep = typeof STEPS[number];
export type SkippableModule = 'game' | 'voice' | 'video' | 'drawing';

export const STEP_LABELS: Record<AssessmentStep, string> = {
  profile: '基本資料',
  questionnaire: '問卷',
  game: '互動遊戲',
  voice: '語音互動',
  video: '影片錄製',
  drawing: '繪圖測試',
  result: '評估結果',
};
```

- [ ] **Step 2: 加 forceFullAssessment + skippedModules + effectiveSteps + effectiveStepIndex**

在 `AssessmentStore` class 內加（位置：currentStepIndex 之後）：

```typescript
forceFullAssessment = $state<boolean>(false);

/** Derived 自 partialAnalysis 與 forceFullAssessment */
skippedModules = $derived.by<Set<SkippableModule>>(() => {
  if (this.forceFullAssessment) return new Set();
  const scores = this.partialAnalysis.questionnaireScores ?? {};
  const max = this.partialAnalysis.questionnaireMaxScores ?? {};
  const next = new Set<SkippableModule>();
  if (max.gross_motor && max.gross_motor >= 4 && scores.gross_motor === max.gross_motor) {
    next.add('video');
  }
  if (max.fine_motor && max.fine_motor >= 4 && scores.fine_motor === max.fine_motor) {
    next.add('drawing');
  }
  const lcFull = max.language_comprehension && max.language_comprehension >= 4 &&
                 scores.language_comprehension === max.language_comprehension;
  const leFull = max.language_expression && max.language_expression >= 4 &&
                 scores.language_expression === max.language_expression;
  if (lcFull && leFull) next.add('voice');
  return next;
});

effectiveSteps = $derived.by<AssessmentStep[]>(() =>
  STEPS.filter(s => !this.skippedModules.has(s as SkippableModule))
);

effectiveStepIndex = $derived.by<number>(() => {
  const idx = this.effectiveSteps.indexOf(this.currentStep);
  if (idx >= 0) return idx;
  // fallback：找 currentStepIndex 之前 STEPS 中最大的、且在 effectiveSteps 內的 step
  for (let i = this.currentStepIndex - 1; i >= 0; i--) {
    const name = STEPS[i];
    const j = this.effectiveSteps.indexOf(name);
    if (j >= 0) return j;
  }
  return 0;
});
```

- [ ] **Step 3: 改寫 nextStep / prevStep**

找 `async nextStep()` / `async prevStep()`，改為：

```typescript
async nextStep(): Promise<void> {
  let idx = this.currentStepIndex;
  while (idx < STEPS.length - 1) {
    idx++;
    const name = STEPS[idx];
    if (!this.skippedModules.has(name as SkippableModule)) {
      this.currentStepIndex = idx;
      if (this.assessment) {
        await assessmentDao.updateAssessmentStep(this.assessment.id, idx);
      }
      return;
    }
  }
}

async prevStep(): Promise<void> {
  let idx = this.currentStepIndex;
  while (idx > 0) {
    idx--;
    const name = STEPS[idx];
    if (!this.skippedModules.has(name as SkippableModule)) {
      this.currentStepIndex = idx;
      if (this.assessment) {
        await assessmentDao.updateAssessmentStep(this.assessment.id, idx);
      }
      return;
    }
  }
}
```

- [ ] **Step 4: 從 IndexedDB resume 時讀 forceFullAssessment**

找 `async resumeAssessment(id: string)` 或類似 method，確保載入後設 `this.forceFullAssessment = assessment.forceFullAssessment ?? false`。

並從 events 重建 partialAnalysis（若 store 沒此邏輯則新增 `rebuildPartialAnalysisFromEvents(assessmentId)`）。

> 若既有 resume 邏輯複雜，本 task 只加 `forceFullAssessment ?? false` 一行；events 重建留待 Task 15 整合測試補上。

- [ ] **Step 5: 跑 check + 既有 test**

Run: `pnpm check && pnpm test tests/lib/stores 2>&1 | tail -10`
Expected: 0 errors + 既有 test 全 pass

- [ ] **Step 6: Commit**

```bash
git add src/lib/stores/assessment.svelte.ts
git commit -m "feat(cdsa): store skippedModules/effectiveSteps derived + nextStep/prevStep 演算法"
```

---

### Task 14: AssessmentShell + QuestionnaireModule — UI 整合動態 skip

**Files:**
- Modify: `src/components/assess/AssessmentShell.svelte`
- Modify: `src/components/assess/QuestionnaireModule.svelte`

- [ ] **Step 1: AssessmentShell 移除舊 STEP_LABELS、改 import from store**

在 `src/components/assess/AssessmentShell.svelte`：

刪除：
```typescript
const STEP_LABELS = ['基本資料', '問卷', '互動遊戲', '語音互動', '影片錄製', '繪圖測試', '評估結果'];
```

改 import：
```typescript
import { assessmentStore, STEP_LABELS, type AssessmentStep } from '../../lib/stores/assessment.svelte';
```

StepIndicator 用 effectiveSteps：
```svelte
<StepIndicator
  steps={assessmentStore.effectiveSteps.map(s => STEP_LABELS[s as AssessmentStep])}
  currentStep={assessmentStore.effectiveStepIndex}
/>
```

- [ ] **Step 2: AssessmentShell 加 auto-skip $effect**

```svelte
<script lang="ts">
import { tick } from 'svelte';

$effect(() => {
  // 若 currentStep 落在 skippedModules（例：user 改答案讓 voice 突然被 skip），auto 推進
  const current = assessmentStore.currentStep;
  if (assessmentStore.skippedModules.has(current as SkippableModule)) {
    tick().then(() => assessmentStore.nextStep());
  }
});
</script>
```

- [ ] **Step 3: QuestionnaireModule option button 加 data-score attribute**

找 option 渲染區塊（`<button onclick={() => handleAnswer(option)}>`），加 `data-score`：

```svelte
<button
  data-score={option.score}
  onclick={() => handleAnswer(option)}
  ...
>{option.label}</button>
```

- [ ] **Step 4: QuestionnaireModule summary 頁加建議流程預覽 + 兩按鈕**

找 `{#if phase === 'summary'}` 區塊，在現有 summary 表格之後加：

```svelte
<div class="recommendation">
  <h3>依您的作答結果，建議完成：</h3>
  <ul>
    <li>✓ 互動遊戲（量「行為」面向）</li>
    <li class:skipped={assessmentStore.skippedModules.has('video')}>
      {assessmentStore.skippedModules.has('video') ? '✗ 影片錄製（粗動作滿分，已跳過）' : '✓ 影片錄製（粗動作）'}
    </li>
    <li class:skipped={assessmentStore.skippedModules.has('drawing')}>
      {assessmentStore.skippedModules.has('drawing') ? '✗ 繪圖（細動作滿分，已跳過）' : '✓ 繪圖（細動作）'}
    </li>
    <li class:skipped={assessmentStore.skippedModules.has('voice')}>
      {assessmentStore.skippedModules.has('voice') ? '✗ 語音（語言滿分，已跳過）' : '✓ 語音（語言）'}
    </li>
  </ul>
  <div class="actions">
    <button onclick={handleFinish}>依建議繼續</button>
    <button class="secondary" onclick={handleForceFullEval}>跑完整評估</button>
  </div>
</div>
```

加 handleForceFullEval：

```typescript
async function handleForceFullEval() {
  assessmentStore.forceFullAssessment = true;
  await handleFinish();
}
```

樣式：

```css
.recommendation { margin-top: var(--space-4); }
.recommendation ul { list-style: none; padding: 0; }
.recommendation li { padding: var(--space-2) 0; font-size: var(--text-base); }
.recommendation li.skipped { color: var(--text); opacity: 0.5; text-decoration: line-through; }
.recommendation .actions { display: flex; gap: var(--space-3); margin-top: var(--space-4); }
.recommendation .actions button.secondary { background: transparent; border: 1px solid var(--line); }
```

- [ ] **Step 5: persistScoresToStore 內加 dev-warn**

找 `function persistScoresToStore()`，在 `assessmentStore.addAnalysis(...)` 之前加：

```typescript
if (import.meta.env.DEV) {
  // @ts-ignore - generated.json import
  const expectedMap: Record<string, string[]> = (await import('$lib/data/expected-questionnaire-domains.generated.json')).default;
  const expected = expectedMap[ageGroup as string] ?? [];
  for (const d of expected) {
    if (!(d in scores)) {
      console.warn(
        `[Questionnaire] Missing domain '${d}' for ageGroup '${ageGroup}'. ` +
        `domainSummary length=${domainSummary.length}, expected ${expected.length}.`
      );
    }
  }
}
```

實際上靜態 import（更乾淨）：

```typescript
import expectedDomainsMap from '$lib/data/expected-questionnaire-domains.generated.json';

function persistScoresToStore(): void {
  // ... 既有
  if (import.meta.env.DEV && ageGroup) {
    const expected = (expectedDomainsMap as Record<string, string[]>)[ageGroup] ?? [];
    for (const d of expected) {
      if (!(d in scores)) {
        console.warn(`[Questionnaire] Missing domain '${d}' for ageGroup '${ageGroup}'.`);
      }
    }
  }
  assessmentStore.addAnalysis({ questionnaireScores: scores, questionnaireMaxScores: maxScores });
}
```

- [ ] **Step 6: 跑 check + 既有 test**

Run: `pnpm check && pnpm test 2>&1 | tail -10`
Expected: 全 pass

- [ ] **Step 7: 跑 build + 開 dev server 手動驗證**

Run: `pnpm build && pnpm preview`
手動驗證：
- 開 `/`，跑問卷某 ageGroup 全部選 score=2
- 看到 summary 頁顯示「✗ 影片錄製（粗動作滿分，已跳過）」等
- 按「依建議繼續」→ StepIndicator 顯示步數變少，跳過對應 module
- 按「跑完整評估」→ 所有 module 都跑

- [ ] **Step 8: Commit**

```bash
git add src/components/assess/AssessmentShell.svelte src/components/assess/QuestionnaireModule.svelte
git commit -m "feat(cdsa): UI 整合動態 skip — 建議預覽 + 強制完整評估 + auto-skip effect"
```

---

## Phase 5: 整合測試 + 驗收

### Task 15: QuestionnaireFlow 7 ageGroup × 全選最高分整合測試

**Files:**
- Create: `tests/components/QuestionnaireFlow.test.ts`

- [ ] **Step 1: 寫測試**

Create `tests/components/QuestionnaireFlow.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import QuestionnaireModule from '../../src/components/assess/QuestionnaireModule.svelte';
import { assessmentStore } from '../../src/lib/stores/assessment.svelte';
import { db } from '../../src/lib/db/schema';
import expectedDomainsMap from '../../src/lib/data/expected-questionnaire-domains.generated.json';

// ageGroup → 對應的虛擬 birthDate（保持 ageInMonths 落入該 bin 中央）
const AGE_BIRTHDATES: Record<string, string> = {
  '2-6m':   isoDaysAgo(30 * 4),
  '7-12m':  isoDaysAgo(30 * 10),
  '13-24m': isoDaysAgo(30 * 18),
  '25-36m': isoDaysAgo(30 * 30),
  '37-48m': isoDaysAgo(30 * 42),
  '49-60m': isoDaysAgo(30 * 54),
  '61-72m': isoDaysAgo(30 * 66),
};

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
}

describe('QuestionnaireModule emission per ageGroup', () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    await db.assessmentEvents.clear();
    await db.assessments.clear();
    await db.children.clear();
    assessmentStore.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  for (const ag of Object.keys(AGE_BIRTHDATES)) {
    it(`emits all applicable domains for ${ag}`, async () => {
      await assessmentStore.startNew({
        nickName: 'test', birthDate: AGE_BIRTHDATES[ag], gender: 'male',
      });
      expect(assessmentStore.ageGroup).toBe(ag);
      assessmentStore.currentStepIndex = 1; // 'questionnaire'

      render(QuestionnaireModule);

      // 點所有 max-score (data-score="2") 按鈕
      let safety = 50;
      while (safety-- > 0) {
        const maxBtn = document.querySelector<HTMLButtonElement>('button[data-score="2"]');
        if (!maxBtn) break;
        await fireEvent.click(maxBtn);
        await vi.advanceTimersByTimeAsync(550); // 跳過 520ms feedback delay
        await tick();
      }

      const expected = (expectedDomainsMap as Record<string, string[]>)[ag] ?? [];
      const scores = assessmentStore.partialAnalysis.questionnaireScores ?? {};
      const maxScores = assessmentStore.partialAnalysis.questionnaireMaxScores ?? {};
      for (const d of expected) {
        expect(scores).toHaveProperty(d);
        expect(scores[d]).toBe(maxScores[d]); // 全選最高 = 滿分
      }
      expect(Object.keys(scores).sort()).toEqual([...expected].sort());
    });
  }
});
```

- [ ] **Step 2: 跑 test**

Run: `pnpm test tests/components/QuestionnaireFlow.test.ts 2>&1 | tail -10`
Expected: 7/7 pass

- [ ] **Step 3: Commit**

```bash
git add tests/components/QuestionnaireFlow.test.ts
git commit -m "test(cdsa): QuestionnaireModule emission 7 ageGroup × all-max"
```

---

### Task 16: ResultView 6 questionnaire domain 完整測試

**Files:**
- Modify: `tests/components/ResultView.test.ts`

- [ ] **Step 1: 加新測試到既有 ResultView.test.ts**

```typescript
it('renders all 6 questionnaire domains in radar when all provided', () => {
  const detail = (domain: string, value = 4, max = 4) => ({
    domain, metric: 'questionnaireScore' as const,
    value, maxScore: max,
    zScore: null, directionalZ: null,
    isAnomaly: value / max < 0.5,
  });
  const triageResult = {
    category: 'normal' as const,
    confidence: 0.85,
    summary: '',
    anomalyCount: 0,
    details: [
      detail('cognition'),
      detail('fine_motor'),
      detail('gross_motor'),
      detail('language_comprehension'),
      detail('language_expression'),
      detail('social_emotional'),
    ],
  };
  // 對 ResultView 注入 mocked triageResult（依既有 ResultView.test.ts 的 mocking pattern）
  // 例：
  // assessmentStore.partialAnalysis = { /* fake */ };
  // render(ResultView);
  // await waitFor(() => screen.getByRole('img', { name: /雷達/ }));
  // const radar = screen.getByRole('img', { name: /雷達/ });
  // for each of 6 domain，斷言 radar 顯示對應分數 = 100
});
```

> Plan agent 實作時依既有 ResultView.test.ts 的 mock pattern（可能用 `vi.mock('../../src/engine/cdsa/triage')`）注入 triageResult。

- [ ] **Step 2: 跑 test**

Run: `pnpm test tests/components/ResultView.test.ts 2>&1 | tail -10`
Expected: 全 pass

- [ ] **Step 3: Commit**

```bash
git add tests/components/ResultView.test.ts
git commit -m "test(cdsa): ResultView renders all 6 questionnaire domains in radar"
```

---

### Task 17: 完整驗收 + push

**Files:** 無新增

- [ ] **Step 1: 跑全測試 + check + build**

Run:
```bash
pnpm test 2>&1 | tail -5
pnpm check
pnpm build
```
Expected:
- 所有 test pass
- 0 type error
- build success

- [ ] **Step 2: 手動 walk-through**

Run: `pnpm preview`

驗證：
1. 開 `/`，選 61-72m 長者
2. 問卷各題顯示「未審」badge
3. 全選 score=2 → summary 顯示「建議完成：互動遊戲 / ✗ 影片錄製 / ✗ 繪圖 / ✗ 語音」
4. 按「依建議繼續」→ StepIndicator 顯示 3 步（profile→questionnaire→game→result）
5. 跑完互動遊戲 → 進結果頁
6. RadarChart 顯示 6 domain（含 social_emotional），純問卷 domain 分數 = 100
7. 標題副標「100 = 表現傑出 · 50 = 同齡平均 · 0 = 顯著落後」
8. Devtools console 無未預期 warn

- [ ] **Step 3: Push**

Run: `git push`
Expected: push success

- [ ] **Step 4: 確認 GitHub Actions CI 過**

Run: `gh run watch` or 等通知
Expected: CI 全 pass

---

## 後續維護

- 補題逐筆走臨床顧問審查 → 改 `clinicallyReviewed: true`
- 若日後 inapplicable matrix 變動：跑 `tsx scripts/build-questionnaire-applicability.ts` 重產 generated.json
- 若新增 questionnaire domain：更新 spec §6.1.3 KNOWN_QUESTIONNAIRE_DOMAINS + questions.json + matrix（如需）

---

## 驗收標準對照 spec §4.7 / §8

| 驗收項 | 對應 Task |
|--------|-----------|
| 每 ageGroup × applicable domain ≥ 2 題 | Task 11 |
| 滿分 → skip 對應 module | Task 13, 14, 15 |
| 「跑完整評估」按鈕 override | Task 14, 17 |
| 純問卷 domain 滿分 = 100 | Task 5, 16 |
| 測驗 z=+2 ≈ 97-98 | Task 6 |
| 副標 100/50/0 解讀 | Task 6 |
| 13 題標 clinicallyReviewed: false | Task 7-10 |
| 「未審」badge | Task 12 |
| Dev mode warn unknown domain | Task 3 |
| `pnpm test` / `pnpm check` / `pnpm build` 全綠 | Task 17 |
