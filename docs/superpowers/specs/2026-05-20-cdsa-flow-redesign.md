# CDSA 流程重設計 — Design Spec

- **日期**: 2026-05-20
- **作者**: Light + Claude Code
- **狀態**: v5（第 4 輪揪出 v5 .stores 與真實 v4 schema 多處不一致 blocker，本版修正）
- **範圍**: 修正 CDSA 評估流程的四個議題：(A) 問卷題目分布不均、(B) 問卷與測驗 module 在概念上重複、(C) 雷達圖 z-score 50-base 公式對照顧者太抽象、(D) social_emotional 漏 emit 的 bug 防護

---

## 1. 目標與動機

2026-05-20 用戶實機操作 production 發現的 UX 問題：

1. **問卷分數分布看起來怪**：61-72m 跑問卷各 domain 題數 1~2 不均（gross_motor 4/4 vs social_emotional 2/2），照顧者感到困惑「為什麼某些 domain 出 4 題、其他只 1 題」
2. **問卷後測驗 module 重複問同樣 domain**：問卷涵蓋 gross_motor / fine_motor / language，後面影片 / 繪圖 / 語音 module 量同樣 domain，流程冗長
3. **全選最高分仍看不到滿分**：雷達圖公式 `score = 50 + 10 × avgZ` 中 50 是「同齡平均」，問卷 raw score 沒進公式（hard-coded `directionalZ: null`），導致純問卷 domain 永遠卡在 50
4. **social_emotional domain 從結果頁雷達圖漏失**：問卷 summary 顯示 social_emotional 2/2，但到結果頁雷達圖沒列出（root cause 未 reproduce）

本 spec 一次處理四項，作為單一 plan 執行。Phase 1 在 `2026-05-19-education-videos-design.md` 之後接續推進。

> **註**：2026-05-20 已 commit `5e36a79` 做了 quick fix「問卷 directionalZ 從 normalized 換算 (-5, +5)」讓滿分至少 = 100。本 spec C 節將 rollback 此 quick fix，改採更乾淨的 percentile 公式（區分問卷與測驗兩條路徑）。

---

## 2. 範圍與決策

| 子議題 | 決策 |
|--------|------|
| **A 補題平衡** | 每 applicable ageGroup × domain ≥ 2 題；藍本（Denver II / ASQ / M-CHAT 公開評估指標）+ user 互動 review；schema 加 `clinicallyReviewed` 欄位、UI 顯示未審查 badge |
| **B 動態 skip** | 問卷 domain 滿分（normalized = 1.0）→ skip 對應測驗 module；behavior 永遠跑；step indicator 動態縮減；「跑完整評估」按鈕可 override |
| **C 雷達 UX** | 全改 0-100 percentile（問卷 normalized × 100、測驗 z → norm.cdf × 100）；標題加副標 |
| **D bug 守護** | 加 dev-mode warn + 整合測試守 emission；不主動 reproduce（被動防護） |

**Inapplicable matrix 沿用**：已在 Phase 1 (`2026-05-19-education-videos-design.md` §3.5) 鎖定，本 spec 不動。

---

## 3. A 補題流程

### 3.1 Schema 變更

`src/data/questionnaire/questions.json` 各題加兩欄位（schema 在 `src/content.config.ts` 對應 questionnaire collection 同步擴充，但 questionnaire 目前未走 Content Layer，是直接 JSON import — 故 schema 變更只在 TS 型別 + 文件層級）：

```json
{
  "id": "se-03",
  "domain": "social_emotional",
  "domainLabel": "社會情緒",
  "ageGroups": ["49-60m", "61-72m"],
  "text": "孩子能輪流和等待嗎？",
  "options": [...],
  "clinicallyReviewed": false,
  "source": "Denver II inspiration"
}
```

- `clinicallyReviewed: boolean` — **既有 31 題與新補 13 題一律預設 `false`，由臨床顧問逐筆審完才轉 `true`**
- `source: string` — 簡述藍本（如 "Denver II inspiration"、"ASQ-3 inspiration"、"manual"）— 不可直接引用原文以避免版權

### 3.2 缺題盤點（依當前 questions.json 計算，**並嚴守 Phase 1 inapplicable matrix**）

> **重要 reconcile**：Phase 1 `scripts/curate/inapplicable-matrix.json` 註解標明用途是「依 questions.json 的 ageGroups 欄位 **與 z-score 路徑可用性** 決定」— 即 video trigger / z-score path 兩用。Spec v3 對 questionnaire applicability **作保守決策：直接套用此 matrix**，因為 Phase 1 已 sign-off 過、且短期無臨床顧問可獨立判定 questionnaire path 可用性。
>
> 後續若臨床顧問認為某 (ageGroup × domain) 雖 z-score 不可用但問卷可問（例：Denver II / ASQ 對 7-12m 有 cognition 題），可走以下擴充路徑：(1) 新增 `scripts/curate/questionnaire-applicability.json`（schema 同 matrix 但 questionnaire 用途）；(2) `expected-questionnaire-domains.generated.json` 改從此檔讀；(3) 本 spec §3.2 表的「補幾題」依新檔重算。本 spec **不負責**做此擴充，僅保留路徑。
>
> Behavior 與 language 為測驗 z-score path 專屬 domain，問卷沒有對應題目，不在補題範圍。

**Matrix 各 ageGroup × 問卷 6 domain 的 applicable 狀態**：

| ageGroup | applicable 問卷 domain |
|---------|-----------------------|
| 2-6m | gross_motor (其餘 5 個 questionnaire domain 全 inapplicable) |
| 7-12m | gross_motor, fine_motor, language_comprehension, social_emotional |
| 13-24m | (全 6) |
| 25-36m | (全 6) |
| 37-48m | (全 6) |
| 49-60m | (全 6) |
| 61-72m | (全 6) |

**逐 ageGroup × 問卷 domain 補題盤點**（既有題數 → 目標 2 → 補幾題）：

| ageGroup | cog | fm | gm | lc | le | se | 補小計 |
|---------|----:|---:|---:|---:|---:|---:|------:|
| 2-6m | ⊘ | ⊘ | 1→2 (+1) | ⊘ | ⊘ | ⊘ | **1** |
| 7-12m | ⊘ | 1→2 (+1) | 2 ✓ | 1→2 (+1) | ⊘ | 2 ✓ | **2** |
| 13-24m | 2 ✓ | 1→2 (+1) | 2 ✓ | 1→2 (+1) | 2 ✓ | 2 ✓ | **2** |
| 25-36m | 2 ✓ | 2 ✓ | 1→2 (+1) | 1→2 (+1) | 1→2 (+1) | 2 ✓ | **3** |
| 37-48m | 2 ✓ | 2 ✓ | 1→2 (+1) | 2 ✓ | 2 ✓ | 2 ✓ | **1** |
| 49-60m | 2 ✓ | 2 ✓ | 2 ✓ | 2 ✓ | 2 ✓ | 2 ✓ | **0** |
| 61-72m | 2 ✓ | 1→2 (+1) | 2 ✓ | 1→2 (+1) | 1→2 (+1) | 1→2 (+1) | **4** |
| **合計** | | | | | | | **13** |

⊘ = matrix 標 inapplicable，不補題。

**註**：原 brainstorm 寫「14 條」「18 條」皆未對齊 matrix，本 v2 重算為 **13 題**。Matrix 若日後修改（如臨床顧問認定 cognition.7-12m 其實可問卷評估），需走 Phase 1 sign-off 流程重新發 PR，本 spec 不變。

### 3.3 互動補題流程

1. 補題 sub-step 1：Claude Code 依 Denver II / ASQ / M-CHAT 公開可知的「年齡評估指標」藍本，為這 13 題寫 draft（題幹 + 3 個 options + score）
2. 分 4 batches（每 batch 4-5 題）給用戶 review
3. 用戶逐題核可或修改題幹/選項
4. 寫進 `questions.json` 標 `clinicallyReviewed: false`
5. 補對應 ageGroup 的問卷 i18n（zh-Hant，目前唯一 locale）
6. 補 `tests/data/questionnaire-coverage.test.ts` 守 ageGroup × applicable-domain ≥ 2 題

### 3.4 UI 變更

問卷頁顯示「未經臨床審查」badge：

```svelte
{#if currentQuestion.clinicallyReviewed === false}
  <span class="badge-unreviewed" title="本題尚未經臨床顧問審查">未審</span>
{/if}
```

樣式：`background: var(--warn); color: var(--bg); font-size: var(--text-sm);`

> **a11y 例外**：本 badge 字級 (`--text-sm`) 小於 CLAUDE.md「最小 18px」規則。Badge 不是 primary content（僅標示性），對比度 ≥ 4.5:1 (`--warn` oklch(0.48 0.14 65) vs `--bg` oklch(0.985 0.006 85) = ~7.2:1，WCAG AA 通過)。Plan 階段需手動截圖驗證對比。

### 3.5 驗收

- `pnpm test tests/data/questionnaire-coverage.test.ts` 對每 ageGroup × applicable-domain 斷言題數 ≥ 2
- 問卷頁手動 walk-through 對每 ageGroup 看「未審」badge 出現的題目

---

## 4. B 動態 Skip 規則

### 4.1 規則表

| 問卷 domain | 條件 | Skip module |
|------------|------|-------------|
| `gross_motor` | normalized = 1.0 (滿分) | 影片錄製 (`video`) |
| `fine_motor` | normalized = 1.0 | 繪圖 (`drawing`) |
| `language_comprehension` AND `language_expression` | **兩者皆**滿分 | 語音 (`voice`) |
| (任何 domain) | (任何分數) | 互動遊戲 (`game`) — **永不 skip** |

**Threshold 為「嚴格滿分且題量足夠」**：
- normalized = 1.0 (滿分)
- **且** maxScore ≥ 4 (即至少 2 題；防 2-6m / 7-12m 單題決定 skip)

理由：1 題拿滿分就 skip 整個 module 太激進；2 題滿分（4/4）作為「至少兩個指標確認」門檻。

`profile` / `questionnaire` / `result` 三個步驟**永不 skip**。

### 4.2 Store 介面（navigation model 修正）

**設計約束**（v2 修正）：
- `currentStepIndex` **保留為 `$state<number>`**（既有 DB schema 持久化 number → STEPS index 不變，IndexedDB 無 migration 需求）
- 新增 `effectiveSteps` / `effectiveStepIndex` / `skippedModules` / `forceFullAssessment` 給 UI 使用
- `nextStep()` / `prevStep()` 的演算法改為「在 effectiveSteps 找下一個未 skip step name → 設 `currentStepIndex = STEPS.indexOf(nextName)`」

```typescript
type SkippableModule = 'game' | 'voice' | 'video' | 'drawing';

class AssessmentStore {
  // 既有
  currentStepIndex = $state<number>(0);   // 對應 STEPS index（DB 持久化）

  // 新增
  forceFullAssessment = $state<boolean>(false);

  /** Derived 自 partialAnalysis 與 forceFullAssessment，避免「忘記呼叫 compute method」的 bug。
   *  **注意**：runes block-body 必須用 $derived.by（非 $derived(()=>{})；後者把 fn 當值，
   *  MEMORY.md 已標記過此陷阱）。*/
  skippedModules = $derived.by<Set<SkippableModule>>(() => {
    if (this.forceFullAssessment) return new Set();
    const scores = this.partialAnalysis.questionnaireScores ?? {};
    const max = this.partialAnalysis.questionnaireMaxScores ?? {};
    const next = new Set<SkippableModule>();
    if (max.gross_motor && max.gross_motor >= 4 && scores.gross_motor === max.gross_motor) next.add('video');
    if (max.fine_motor && max.fine_motor >= 4 && scores.fine_motor === max.fine_motor) next.add('drawing');
    const lcFull = max.language_comprehension && max.language_comprehension >= 4 &&
                   scores.language_comprehension === max.language_comprehension;
    const leFull = max.language_expression && max.language_expression >= 4 &&
                   scores.language_expression === max.language_expression;
    if (lcFull && leFull) next.add('voice');
    return next;
  });

  /** STEPS 過濾 skippedModules 後的實際 sequence */
  effectiveSteps = $derived.by<AssessmentStep[]>(() =>
    STEPS.filter(s => !this.skippedModules.has(s as SkippableModule))
  );

  /** 當前 step 在 effectiveSteps 的 index。若 currentStep 落在 skip 集合中
   *  （例：user 回上一步改答案讓 voice 突然被 skip），fallback 為「currentStepIndex
   *  之前最後一個未 skip 的 step」，避免 StepIndicator 突然跳回 step 0 閃爍。*/
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

  /** 既有 nextStep / prevStep 改為跳 skip module，但**保留 async + DB 持久化**。
   *  演算法用「從 currentStepIndex 走 STEPS 找下一個非 skipped」而非
   *  effectiveSteps.indexOf(currentStep)，原因：currentStep 可能已落在 skip 集合
   *  （effectiveSteps.indexOf 回 -1 會卡死）。 */
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
    // 已到結尾（result 永不被 skip）
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
}
```

**設計理由**：
- `skippedModules` 用 `$derived.by` 避免「忘記呼叫 compute method」bug
- `currentStepIndex` 不動：既有 DB 持久化相容
- `nextStep` / `prevStep` 走 STEPS（非 effectiveSteps）逐步檢查 skip 集合，避免「currentStep 落在 skip 集合 → indexOf 回 -1 → return early」卡死
- `effectiveStepIndex` fallback「找 currentStepIndex 之前最後一個未 skip step」避免 StepIndicator 從 step N 跳回 step 0 的視覺閃爍

### 4.3 UI 變更

**問卷 summary 頁**新增「建議流程預覽」段：

```svelte
{#if phase === 'summary'}
  <div class="recommendation">
    <h3>依您的作答結果，建議完成：</h3>
    <ul>
      <li>✓ 互動遊戲（量「行為」面向）</li>
      <li class:skipped={skippedModules.has('video')}>
        {skippedModules.has('video') ? '✗ 影片錄製（粗動作滿分，已跳過）' : '✓ 影片錄製（粗動作）'}
      </li>
      <li class:skipped={skippedModules.has('drawing')}>
        {skippedModules.has('drawing') ? '✗ 繪圖（細動作滿分，已跳過）' : '✓ 繪圖（細動作）'}
      </li>
      <li class:skipped={skippedModules.has('voice')}>
        {skippedModules.has('voice') ? '✗ 語音（語言滿分，已跳過）' : '✓ 語音（語言）'}
      </li>
    </ul>
    <div class="actions">
      <button onclick={handleFinish}>依建議繼續</button>
      <button class="secondary" onclick={handleForceFullEval}>跑完整評估</button>
    </div>
  </div>
{/if}
```

`handleForceFullEval` 只需設 `forceFullAssessment = true`（`skippedModules` 是 `$derived`，自動 re-evaluate）+ 呼叫 `handleFinish()` 推進。

`<StepIndicator steps={assessmentStore.effectiveSteps.map(s => STEP_LABELS[s])} ... />` — StepIndicator 用 effectiveSteps 對應的 labels。

> **必要 refactor**：`STEP_LABELS` 在當前 `AssessmentShell.svelte:21` 是 `string[]`（positional array：index 對應 STEPS index）。本 spec 需以 step name 作 key 查 label（如 `STEP_LABELS['voice']`），故改為 `Record<AssessmentStep, string>`：
> ```typescript
> // src/lib/stores/assessment.svelte.ts 或 AssessmentShell.svelte
> export const STEP_LABELS: Record<AssessmentStep, string> = {
>   profile: '基本資料',
>   questionnaire: '問卷',
>   game: '互動遊戲',
>   voice: '語音互動',
>   video: '影片錄製',
>   drawing: '繪圖測試',
>   result: '評估結果',
> };
> ```
> 並建議移到 `assessment.svelte.ts` 與 STEPS 同檔 export，供 AssessmentShell + 其他 component 共用。

### 4.4 Resume 與持久化策略

**partialAnalysis 不持久化**（既有設計，本 spec 不動）：純 in-memory `$state`，session reload 後為空。

**Resume 路徑**（user 從 history 載入未完成 assessment）：

1. 載入 `Assessment` + `Child` + 所有 `AssessmentEvent`
2. 從 questionnaire events 重建 `partialAnalysis.questionnaireScores` / `questionnaireMaxScores`（依 events 中 domain × score 累加）
3. `forceFullAssessment` 也讀自 DB（**需 IndexedDB v5 migration**：Assessment 新增 `forceFullAssessment: boolean` 欄位，default `false`）
4. `skippedModules` 因為是 derived，會自動依重建的 partialAnalysis + forceFullAssessment 算出
5. `currentStepIndex` 從 Assessment.currentStep（既有欄位）載入；若該 step 已被 skip，store 在 mount 時 `$effect` 偵測並自動 `nextStep()` 推進

**IndexedDB Migration（必要 — v5，因 v4 已被 recommendationOverlays 佔用）**：

```typescript
// src/lib/db/schema.ts — Assessment interface 新增
export interface Assessment {
  // ... 既有
  forceFullAssessment?: boolean;  // v5：default false
}

// Dexie version().upgrade()。v4 已存在（含 recommendationOverlays），本 spec 新增 v5。
// 重要：Dexie 對「stores 未變更但版本升」仍要求 .stores() 顯式宣告（不可省略）；
//      實作時要完整 copy v4 schema.ts L321-L341 的所有 store keys。
// v5 stores = v4 stores 一字不改（forceFullAssessment 不需 index），verbatim copy 自
// schema.ts L321-341。Plan agent 實作時直接複製，**不可改任何 index 字串**。
db.version(5).stores({
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

**Dexie upgrade 失敗行為**：Dexie 對 upgrade 內 exception 會 abort 該 version transaction 並 rollback 至上一版；後續 `db.open()` 會再嘗試。**不需 try/catch** 包 upgrade，工程師勿過度防禦。

**讀取 fallback**：因為 migration 進行中或跨分頁 race 可能某筆 row 還沒補 false，所有讀取點一律 `assessment.forceFullAssessment ?? false`（既然 type 是 optional `boolean | undefined`）。store.resume() 與 `skippedModules` derive 都遵守。此 fallback 是雙保險，並非為了 catch migration 失敗。

`partialAnalysis` 不需新增 schema 欄位（依舊 in-memory + 從 events 重建）。

### 4.5 Edge cases 與細節

- **回上一步改答案**：每次答案變化會更新 `partialAnalysis`（既有路徑），`skippedModules` 是 `$derived`，自動 re-evaluate。無需手動觸發。
- **STEPS vs effectiveSteps mapping**：
  - `currentStepIndex` 永遠對應 `STEPS` 的 index（DB 兼容）
  - UI 顯示用 `effectiveStepIndex`（給 StepIndicator）
  - 若 currentStep 落在 skipped 集合中（例如 user 從 voice 回上一步改問卷讓 voice 被 skip）：`AssessmentShell` 在 mount + currentStep 變化的 `$effect` 中偵測 `skippedModules.has(currentStep)` → 呼叫 `store.nextStep()` auto-推進
- **題量太少 ageGroup（2-6m / 7-12m）的 skip 門檻**：見 §4.6 新增段
- **空 partialAnalysis + skip 變化的 race condition**：mount → load assessment → 重建 partialAnalysis（async）→ skippedModules 短暫為 empty → 重建完才更新。期間 UI 不應推進步驟；用 `assessmentStore.isLoading` 守。

### 4.6 題量太少 ageGroup 的 skip 門檻

對 `2-6m` / `7-12m`：matrix-applicable 問卷 domain 題量極少（2-6m 只 gross_motor 1 題、7-12m 4 個 domain 各 1-2 題）。1 題拿滿分就 skip 整個 module 過於激進。

**門檻**：`max_score ≥ 4`（即 ≥ 2 題）才可能觸發 skip。對 2-6m gross_motor 補題後 = 2 題 (max 4)，可觸發 skip。對 7-12m fine_motor 補題後 = 2 題，OK。

實作上已含在 §4.2 `skippedModules` derive 邏輯的 `max.X >= 4` 條件中。

### 4.7 驗收

- 對 5 種問卷分數場景測試（全滿、單 domain 滿、兩 domain 滿、皆未達、語言其一滿）→ skippedModules 對應正確
- StepIndicator 顯示的 step 數 = 7 − skippedModules.size
- 「跑完整評估」按鈕設 forceFullAssessment → skippedModules empty → 全跑

---

## 5. C 雷達圖 0-100 Percentile

### 5.1 公式變更（rollback quick fix + new derivation）

**第一步：rollback `triage.ts` 中 quick fix**（2026-05-20 commit `5e36a79`）：

```typescript
// 在 triage.ts 中搜尋 `metric: 'questionnaireScore'` 的 details.push(...) 區塊：
// 將 directionalZ: (normalized - 0.5) * 10  →  改回 directionalZ: null
directionalZ: null, // questionnaire 不走 z；radar 改路徑識別 (見 ResultView)
```

但保留 dev-mode warn（D 防護，§6）。

**第二步：`ResultView.svelte` domainScores 改為兩路徑 hybrid**：

```typescript
function zToPercentile(z: number): number {
  if (z === 0) return 0.5;   // 短路避免 z=0 處 ε 跳躍（A&S 5-term 對 z=0 ≈ 0.5000007）
  // Standard normal CDF approximation (Abramowitz & Stegun 26.2.17)
  // accuracy ~7.5e-8, well within UI display precision
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989422804 * Math.exp(-z * z / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return z > 0 ? 1 - p : p;
}

const domainScores = $derived.by(() => {
  if (!triageResult) return [];
  const buckets: Record<string, {
    zSum: number; zCount: number;
    rawSum: number; rawCount: number;
    hasAnomaly: boolean;
  }> = {};

  for (const d of triageResult.details) {
    if (!buckets[d.domain]) buckets[d.domain] = { zSum: 0, zCount: 0, rawSum: 0, rawCount: 0, hasAnomaly: false };

    if (d.metric === 'questionnaireScore' && d.maxScore && d.maxScore > 0) {
      // 問卷:直接 raw normalized
      buckets[d.domain].rawSum += (d.value as number) / d.maxScore;
      buckets[d.domain].rawCount++;
    } else if (d.directionalZ !== null && d.directionalZ !== undefined) {
      // 測驗:z-score
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
      // Hybrid path — 實際只發生在 fine_motor（drawing z + questionnaire raw），
      // 場景：用戶 forceFullAssessment=true 即使問卷滿分仍跑 drawing。
      //
      // 用 average 而非 max 的理由：
      // 1. 問卷是「照顧者回憶」(主觀)、測驗是「實機觀察」(客觀)，兩者互補
      // 2. 若 max() 則照顧者給滿分覆蓋掉測驗訊號，失去客觀驗證價值
      // 3. average 對「問卷說好但測驗失準」場景能顯示中等分數警示
      //
      // UX 副作用：user forceFull + 問卷滿分 + 測驗平均 → 雷達 ~75 而非 100。
      // 為避免「為什麼跑完整評估反而分數變低」的誤解，雷達卡片需加 tooltip
      // 標示此 domain 結合問卷 + 測驗兩個證據（見 §5.2 UI 變更）。
      //
      // 注意：gross_motor / language 不會走此 path：
      //   - gross_motor pose classification 寫 directionalZ=null（不進 zCount）
      //   - language z 用 domain='language'，問卷用 'language_comprehension/expression'
      //     domain key 不同，不會 bucket 一起
      const rawPct = b.rawSum / b.rawCount;
      const zPct = zToPercentile(b.zSum / b.zCount);
      score = Math.round(100 * (rawPct + zPct) / 2);
    }
    return {
      domain, score, hasAnomaly: b.hasAnomaly,
      isHybrid: b.zCount > 0 && b.rawCount > 0,  // 給 UI tooltip 用
    };
  });
});
```

**Hybrid domain 在 UI 加標示**（RadarChart label 旁顯示 ⚖ icon + 螢幕閱讀器 aria-label）：

```svelte
<text x={scorePos.x} y={scorePos.y} class="radar-score" text-anchor="middle">
  {d.score}
</text>
{#if d.isHybrid}
  <g role="img" aria-label="此面向結合問卷（照顧者回報）與測驗（實機觀察）兩個證據之平均">
    <text x={scorePos.x + 14} y={scorePos.y} class="radar-hybrid-icon" text-anchor="middle">⚖</text>
  </g>
{/if}
```

CSS 確保 emoji icon 在無 emoji font fallback 時仍可顯示：

```css
.radar-hybrid-icon {
  font-family: var(--font-sans, system-ui), "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
  fill: var(--text);
  font-size: var(--text-sm);
}
```

> **a11y 註**：SVG `<title>` 在 Safari/VoiceOver 對 inline text 支援不一致；改用 `<g role="img" aria-label>` 包圍 icon，所有主流 SR 一致朗讀。

### 5.2 UI 變更

**RadarChart.svelte Props 擴充**：

```typescript
interface Props {
  data: Array<{
    domain: string;
    score: number;
    hasAnomaly: boolean;
    isHybrid?: boolean;   // 新增；true = 此 domain 結合問卷 + 測驗兩個證據
  }>;
  size?: number;
  title?: string;         // 新增；default '各面向表現位階'
  showLegend?: boolean;   // 新增；default true
}
const { data, size = 320, title = '各面向表現位階', showLegend = true }: Props = $props();
```

**標題 + 副標**（在 SVG 外層的 wrapper）：

```svelte
<div class="radar-wrap">
  <header class="radar-header">
    <h3>{title}</h3>
    {#if showLegend}
      <p class="legend">100 = 表現傑出　·　50 = 同齡平均　·　0 = 顯著落後</p>
    {/if}
  </header>
  <svg viewBox="0 0 {size} {size}" width={size} height={size} class="radar-chart" role="img" aria-label="發展面向雷達圖">
    <!-- 既有 svg 元素 -->
  </svg>
</div>
```

**分數標籤排版**（與 domain label 分兩個 `<text>` 避免 overlap）：

```svelte
{#each data as d, i}
  {@const labelPos = polarToCartesian(angleStep * i, radius + 20)}
  {@const scorePos = polarToCartesian(angleStep * i, radius + 36)}
  <text x={labelPos.x} y={labelPos.y} class="radar-label" text-anchor="middle">
    {domainLabels[d.domain] ?? d.domain}
  </text>
  <text x={scorePos.x} y={scorePos.y} class="radar-score" text-anchor="middle">
    {d.score}
  </text>
{/each}
```

**樣式**：

```css
.radar-header h3 { font-size: var(--text-lg); margin: 0 0 var(--space-1) 0; }
.radar-header .legend {
  font-size: var(--text-sm);
  color: var(--text);
  opacity: 0.7;
  margin: 0 0 var(--space-4) 0;
}
.radar-label { font-size: var(--text-sm); fill: var(--text); }
.radar-score { font-size: var(--text-sm); fill: var(--accent); font-weight: var(--font-bold); }
```

**SVG viewBox 調整**：Plan 階段先讀 RadarChart.svelte 確認當前 radius 公式（spec 推測 `size/2 - 40`，但實際以 code 為準）。若 scorePos 在 radius+36 超出 size/2 邊界，兩種修法擇一：(a) 改 `radius = size/2 - 60`；(b) 維持 radius，加大 viewBox 為 `0 0 (size+40) (size+40)` 並 translate(20,20)。任一造成既有 RadarChart 視覺測試需更新 snapshot。

### 5.3 對照感

| z (z-score) | percentile (×100) | 文字解讀 |
|---|---|---|
| -2.0 | 2 | 顯著落後 |
| -1.5 | 7 | 明顯偏低 |
| -1.0 | 16 | 偏低 |
| -0.5 | 31 | 中後段 |
| 0 | 50 | 同齡平均 |
| +0.5 | 69 | 中上 |
| +1.0 | 84 | 良好 |
| +1.5 | 93 | 出色 |
| +2.0 | 98 | 傑出 |

問卷 normalized 1.0 → 100；0.5 → 50；0 → 0。

### 5.4 驗收

- 雷達圖標題副標含「100=傑出、50=平均、0=落後」字樣
- 問卷全選最高分跑完 + `forceFullAssessment=false` → 純問卷 domain (cognition, social_emotional, lang_comp, lang_expr) 雷達顯示 = 100
- 測驗 z=+2 → 雷達顯示介於 97-98（依 round 邊界。測試斷言用 `toBeGreaterThanOrEqual(97).toBeLessThanOrEqual(98)` 容忍 round-half-up edge case）
- `tests/components/RadarChart.test.ts` 加 zToPercentile + domainScores hybrid path 測試

---

## 6. D Bug 防護

### 6.1 Dev-Mode Warn（多層防護）

**D 的 root cause 是「component 漏 emit 某 domain」**，僅在 `triage.ts` 加 warn 已經太晚（triage 收到時 emission 已完成）。本 spec 在三個防護點都加 warn：

#### 6.1.1 QuestionnaireModule.persistScoresToStore() 內

```typescript
function persistScoresToStore(): void {
  // ... 既有邏輯產出 scores / maxScores

  if (import.meta.env.DEV) {
    // 對該 ageGroup 預期 applicable 的 questionnaire domain 全部都該在 scores 中
    const expectedDomains = expectedQuestionnaireDomainsFor(ageGroup);
    for (const d of expectedDomains) {
      if (!(d in scores)) {
        console.warn(
          `[Questionnaire] Missing domain '${d}' for ageGroup '${ageGroup}'. ` +
          `domainSummary length=${domainSummary.length}, expected ${expectedDomains.length}.`
        );
      }
    }
  }

  assessmentStore.addAnalysis({ questionnaireScores: scores, questionnaireMaxScores: maxScores });
}

// 新增 helper（從 inapplicable-matrix.json 推得 expected applicable domain）
import expectedDomainsMap from '$lib/data/expected-questionnaire-domains.generated.json';

function expectedQuestionnaireDomainsFor(ageGroup: AgeGroupCDSA): string[] {
  return expectedDomainsMap[ageGroup] ?? [];
}
```

`expected-questionnaire-domains.generated.json` 由 build script 從 inapplicable-matrix.json 計算產出（與 `video-index.json` 同階段；build-time invariant）。

#### 6.1.2 store.addAnalysis 內

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

防止「addAnalysis 替換 questionnaireScores 時誤刪某 domain」。

#### 6.1.3 triage.ts（schema drift 防線）

```typescript
const KNOWN_QUESTIONNAIRE_DOMAINS = new Set([
  'cognition', 'fine_motor', 'gross_motor',
  'language_comprehension', 'language_expression', 'social_emotional',
]);

// 在 questionnaire scores 處理前
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

只防 schema drift（如未來新增 domain 但忘記更新 enum）；component 漏 emit 由 §6.1.1 / §6.1.2 抓。

### 6.2 整合測試

`tests/components/QuestionnaireFlow.test.ts`（新檔）：

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import QuestionnaireModule from '../../src/components/assess/QuestionnaireModule.svelte';
import { assessmentStore } from '../../src/lib/stores/assessment.svelte';
import { db } from '../../src/lib/db/schema';
import expectedDomainsMap from '../../src/lib/data/expected-questionnaire-domains.generated.json';

// ageGroup → 對應的虛擬 birthDate（保持 ageInMonths 落入該 bin 中央）
const AGE_BIRTHDATES: Record<string, string> = {
  '2-6m':   isoDaysAgo(30 * 4),    // 4 個月
  '7-12m':  isoDaysAgo(30 * 10),   // 10 個月
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
    // reset store
    assessmentStore.reset();
    // 清乾淨 IndexedDB
    await db.assessmentEvents.clear();
    await db.assessments.clear();
    await db.children.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  for (const ag of Object.keys(AGE_BIRTHDATES)) {
    it(`emits all applicable domains for ${ag}`, async () => {
      // 1. set up store with child of that ageGroup
      await assessmentStore.startNew({
        nickName: 'test', birthDate: AGE_BIRTHDATES[ag], gender: 'male',
      });
      expect(assessmentStore.ageGroup).toBe(ag);
      assessmentStore.currentStepIndex = 1; // 'questionnaire'

      // 2. render
      render(QuestionnaireModule);

      // 3. 對所有題目選 max-score option
      // 用 data-score attribute 找滿分按鈕（既有 31 題的 max option label 文字
      // 多樣：「是，」「會」「能」「走得很穩」等，靠文字匹配命中率 < 1/3）。
      // QuestionnaireModule.svelte 為每個 option 加 `data-score={option.score}`。
      while (true) {
        const maxBtn = document.querySelector<HTMLButtonElement>('button[data-score="2"]');
        if (!maxBtn) break;
        await fireEvent.click(maxBtn);
        await vi.advanceTimersByTimeAsync(550); // 跳過 520ms feedback delay
        await tick(); // svelte 5 runes flush（與 fake timer 雙保險）
      }

      // 4. 斷言 partialAnalysis 中每個 expected domain 都有 score
      const expected = expectedDomainsMap[ag] ?? [];
      const scores = assessmentStore.partialAnalysis.questionnaireScores ?? {};
      const maxScores = assessmentStore.partialAnalysis.questionnaireMaxScores ?? {};
      for (const d of expected) {
        expect(scores).toHaveProperty(d);
        expect(scores[d]).toBe(maxScores[d]); // 全選最高 = 滿分
      }
      // 沒有多餘 domain（防 schema drift）
      expect(Object.keys(scores).sort()).toEqual([...expected].sort());
    });
  }
});
```

**測試 helper 補充**：
- 需在 QuestionnaireModule.svelte 為每個 option button 加 `data-score={option.score}`（既有 svelte 5 code 改一行）
- `assessmentStore.reset()` 已存在於 store；`@testing-library/svelte` fireEvent.click + `await tick()` 對 svelte 5 OK
- Plan 階段先寫 minimal smoke test 驗證 `vi.advanceTimersByTimeAsync + tick` 對 QuestionnaireModule reactivity 真的能讓題目推進，再展開 7 ageGroup 測試
- 總時間從 ~150s（真實 timer）降到 < 5s（fake timer）

`tests/components/ResultView.test.ts`（既有檔擴充）：

```typescript
it('renders all 6 questionnaire domains in radar when all provided', () => {
  const detail = (domain: string, value = 4, max = 4) => ({
    domain, metric: 'questionnaireScore',
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
  // assert RadarChart 收到的 data 含 6 個 domain
  // assert 每個 domain score 都 === 100（純問卷滿分）
});
```

### 6.3 驗收

- Dev mode 跑 `pnpm dev` 並故意提交未知 questionnaire domain → console.warn 出現
- 7 個 ageGroup × applicable domain 全 emission 都被測試覆蓋
- `pnpm test` 全綠

---

## 7. 檔案動到清單

```
src/data/questionnaire/questions.json           +13 題 + clinicallyReviewed / source
src/lib/stores/assessment.svelte.ts             +forceFullAssessment state
                                                 +skippedModules / effectiveSteps / effectiveStepIndex derived
                                                 +nextStep/prevStep 改演算法（跳 skip module）
                                                 +addAnalysis dev-warn (drop domain)
src/lib/db/schema.ts                            Assessment +forceFullAssessment?: boolean (v5)
                                                 +db.version(5).upgrade() 預設 false
                                                 （v4 已被 recommendationOverlays 佔用）
src/lib/data/expected-questionnaire-domains.generated.json  build-time 產出：依
                                                 inapplicable-matrix.json 計算 ageGroup ⇒ applicable
                                                 questionnaire domain []。給 QuestionnaireModule
                                                 dev-warn 使用
scripts/build-questionnaire-applicability.ts    新 build script（獨立於 build-video-index.ts，
                                                 避免 build-video-index 職責蔓延）。
                                                 prebuild 階段執行：讀 inapplicable-matrix.json
                                                 → emit expected-questionnaire-domains.generated.json
package.json                                    prebuild 加上新 script：
                                                 `"prebuild": "tsx scripts/build-video-index.ts &&
                                                  tsx scripts/build-questionnaire-applicability.ts"`
src/components/assess/QuestionnaireModule.svelte +summary 頁建議流程預覽 + 兩按鈕
                                                 +clinicallyReviewed badge
                                                 +option button 加 data-score attribute（供整合測試用）
                                                 +persistScoresToStore 內 dev-warn 缺 domain
src/components/assess/AssessmentShell.svelte    STEP_LABELS 從 string[] refactor 為
                                                 Record<AssessmentStep, string>（搬到
                                                 assessment.svelte.ts export）；
                                                 StepIndicator 用 effectiveSteps.map(s => STEP_LABELS[s])
src/components/assess/ResultView.svelte         domainScores 改 hybrid (raw + percentile)
                                                 +zToPercentile helper
src/components/assess/RadarChart.svelte         +副標 legend + 標籤旁顯示 score
src/engine/cdsa/triage.ts                       Rollback questionnaire directionalZ → null
                                                 +KNOWN_QUESTIONNAIRE_DOMAINS dev-warn
                                                 +questionnaireMaxScores missing dev-warn
tests/engine/triage.test.ts                     更新測試：
                                                   - 移除 'questionnaireScore detail maps normalized score to directionalZ' 與
                                                     'questionnaireScore at max → directionalZ = +5' 兩條（2026-05-20 quick fix 已 rollback）
                                                   - 新增 'questionnaireScore detail has directionalZ === null'（回到 v0 行為）
                                                   - 修正 既有 'includes questionnaire anomaly when score below 50%' 中
                                                     錯用的 domain key 'language'（應為 'language_comprehension' 或
                                                     'cognition'，因為 questionnaire 真實 emit 的 domain key 不含 'language'）
                                                   - 新增 dev-warn coverage:
                                                       a) Unknown questionnaire domain → console.warn called
                                                       b) questionnaireScores without maxScores → warn
                                                       c) prod 環境 (DEV=false) 不 warn
tests/components/QuestionnaireFlow.test.ts      新整合測試（7 ageGroup × 全選最高分）
tests/components/ResultView.test.ts             既有檔加 RadarChart data length 測試
tests/components/RadarChart.test.ts             新：zToPercentile + hybrid domainScores
tests/data/questionnaire-coverage.test.ts       新：每 ageGroup × applicable domain ≥ 2 題
docs/superpowers/specs/2026-05-20-cdsa-flow-redesign.md  本 spec
```

---

## 8. 驗收標準

1. 每個 ageGroup × applicable domain（依 inapplicable-matrix.json）題目數 ≥ 2
2. 問卷某 domain 滿分 → 對應測驗 module 從 effectiveSteps 中移除
3. 「跑完整評估」按鈕設 forceFullAssessment 後所有 module 都跑
4. RadarChart 中：
   - 純問卷 domain 滿分 = 100
   - 純測驗 z=+2 = 98
   - 混合 domain：兩 path 平均
5. RadarChart 副標含 100 / 50 / 0 解讀說明
6. `pnpm test` / `pnpm check` / `pnpm build` 全綠
7. 13 題補題標 `clinicallyReviewed: false` 並在 UI 顯示「未審」badge
8. Dev mode 偵測 unknown questionnaire domain / missing maxScores 時 console.warn

---

## 9. 風險與緩解

| 風險 | 影響 | 緩解 |
|------|------|------|
| 補題藍本未經臨床審查 | 醫療正確性 | `clinicallyReviewed: false` + UI badge；建議實際 production 前找老年醫學醫師逐筆審查 |
| 滿分 skip 漏掉真實異常 | 醫療安全 | 嚴格「滿分」threshold（非 80%）；互動遊戲永遠跑作為 safety net |
| Resume 舊 assessment 流程不一致 | 資料污染 | `forceFullAssessment` 持久化（DB v5 migration，§4.4）；`partialAnalysis` 從 events 重建；`skippedModules` 為 derived，會自動以重建結果與持久化的 force flag 計算 |
| zToPercentile 近似誤差 | 精度 | Abramowitz-Stegun 公式誤差 ~7.5e-8，遠小於 UI 精度需求 |
| social_emotional bug 未 reproduce | 可能再發生 | 整合測試覆蓋 + dev warn 守第二道 |
| StepIndicator 動態縮減導致 user 困惑 | UX | 問卷 summary 頁明列「已跳過 X 因為 Y 滿分」 |

---

## 10. 不在本 spec 範圍

- 補題的「臨床顧問逐筆審查」流程（spec 只做 v1 標 `false`，審查機制留後續）
- 雷達圖視覺化進一步優化（顏色分區、動畫）
- 問卷 i18n 多語系（目前只 zh-Hant）
- 測驗 module 內部演算法調整（heuristics 不在範圍）
- 用 LLM 直接從病歷文字推算 questionnaire scores（屬於 future spec）

---

## 11. 後續工作（給 writing-plans skill）

**Plan 依賴順序**：

0. **Build script + generated.json + schema 持久化骨架**：
   - 新建 `scripts/build-questionnaire-applicability.ts` 讀 inapplicable-matrix.json 計算各 ageGroup 的 applicable questionnaire domain
   - emit `src/lib/data/expected-questionnaire-domains.generated.json`（git tracked）
   - package.json prebuild 串接 `tsx scripts/build-video-index.ts && tsx scripts/build-questionnaire-applicability.ts`
   - schema.ts 加 `Assessment.forceFullAssessment?: boolean` + Dexie v5 migration（不可省略 .stores()，完整 copy v4 stores）
   - 跑 `pnpm prebuild` 一次產出 generated.json + 確認 v5 migration 不會 crash 既有資料
1. D dev-warn + 整合測試骨架（依賴 step 0 的 generated.json + schema）
2. C rollback `triage.ts` quick fix + 加 zToPercentile + 改 domainScores
3. C UI 副標 + 每 domain 分數顯示
4. A 補題 13 題（互動 3 batch review，每 batch ~4-5 題）
5. A clinicallyReviewed badge + i18n
6. B store `skippedModules` / `computeSkippedModules` / `effectiveSteps`
7. B QuestionnaireModule 預覽段 + 兩按鈕
8. B AssessmentShell StepIndicator 用 effectiveSteps
9. 整合測試 + 驗收

預估 task 數：~12-15 個。
