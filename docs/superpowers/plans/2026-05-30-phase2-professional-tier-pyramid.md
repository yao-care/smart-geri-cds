# Phase 2：專業層三層金字塔（triage → screen → full）實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在現有 screen/full 兩層之上新增「大方向 triage 層」——每域 1 題快速分流，亮燈才逐層展開 screen→full；冷啟動全正常即結束（依 CFS 約 18-23 題）；譫妄 4AT 與認知 AD8/Mini-Cog 兩個病安域一律施測（always-run，不被 triage 守門）。

**Architecture:** 三層分流純函式化於 `tiering.ts`（`selectTriageScales`、`selectAlwaysRunScreens`、共用 `expandFlagged` helper 衍生 `expandedScreenScales`/`expandedFullScales`）。新增 18 個 `tier:'triage'` 量表 YAML（排除兩個 always-run 病安域 delirium、cognition），每個 1 題、`expandsTo` 指向對應 screen。`QuestionnaireModule.svelte` 的 tier 狀態由二值擴為三值，展開邏輯由「screen→full 一段」改為「triage→screen→full 兩段」，並補強 resume 的逐層重建。計分與結果頁不變。

**Tech Stack:** Astro 5 Content Layer（`src/content.config.ts` Zod schema）+ Svelte 5 runes、TypeScript strict（禁 `any`）、vitest（`tests/**/*.test.ts`，jsdom，`@testing-library/svelte`）、量表 YAML（`src/data/scales/`）。

設計來源：`docs/superpowers/specs/2026-05-29-dual-track-self-check-and-triage-redesign.md` §A（大方向層題庫）、§B（三層分層引擎、always-run）。

---

## 已定案的設計決策（spec §B 留待 plan 定案者；含第一輪審查修正）

1. **triage 量表機制＝方案 A（獨立 YAML）**：新增 18 個 `tier:'triage'` YAML，每個 1 題、`expandsTo` 指向對應 screen。三層鏈：`triage.expandsTo → screen.id`，`screen.expandsTo → full.id`（既有，不變）。理由：架構乾淨、每個可獨立測試、不污染既有 screen YAML。
2. **always-run 機制＝宣告式 YAML 旗標 `alwaysRun?: boolean`**（spec §B 列為首選；與既有 `requiresPatient`/`requiresInformant` 旗標一致）。**兩個病安域一律施測、不被任何 triage 守門**：
   - `4at.yaml`（譫妄，C-M1）設 `alwaysRun: true`、維持 `tier:'screen'`。
   - `cognition-screen.yaml`（AD8，C-S6 認知不可靜默跳過——專抓無病識感失智）設 `alwaysRun: true`、維持 `tier:'screen'`。**經使用者確認比照 4AT 一律施測**（既有系統對 cfs1-8 本就無條件施測認知篩；Phase 2 不得降級為 triage-gated）。
3. **delirium 與 cognition 無 triage 題**：兩者皆 always-run，於 triage 階段一律施測，不需大方向守門題。**triage 題共 18 個**＝DOMAIN_TREE 20 sub − delirium − cognition。
4. **always-run 的認知 C-M2 fallback**：`selectAlwaysRunScreens` 取得的 screen 集合需套用 `resolveCognitionScreen`——無知情者時 `cognition-screen`(AD8, requiresInformant) 換成 `mini-cog`(客觀題)，使無病識感且無知情者的個案仍被客觀篩檢（C-S6 + C-M2 既有）。
   - **前提（第二輪審查 major）**：`mini-cog` 的 `applicableCfs` 必須 ⊇ `cognition-screen` 的 `applicableCfs`，否則無知情者時某些 CFS 經 re-filter 後認知會消失（再次違反 C-S6）。Task 2 Step 1 測試含此 swap；Task 3 Step 4 coverage 加查核（見該步）；Task 5 個案 B 實測無知情者出 Mini-Cog。
   - **雙不可得為可接受降級（非 bug）**：無知情者 **且** 病人不能參與（patientAble=false）時，換成的 `mini-cog`(requiresPatient) 經 `applyAvailabilityGate` → incomplete。此時認知域顯示「未完成」破折號（AD8 與 Mini-Cog 兩條來源都不可得，確實無法施測）；always-run 保證「嘗試施測」，非保證「必得分數」。
5. **mobility 域的 triage 覆蓋取捨（誠實記錄）**：`mobility-screen` 既有僅 `applicableCfs: [cfs7]`；故 `mobility-triage` 亦僅 cfs7。**cfs2-6 的行動風險由 `falls-triage`(cfs2-8) → `steadi-falls` → `sit-to-stand`（mobility 域 timed 深評）路徑覆蓋**，非經獨立 mobility triage。這是既有 mobility-screen 設計的延續，非本計畫新引入的缺口；coverage 測試「每 CFS ≥1 triage」由其他 17-18 個 triage 通過（mobility cfs2-6 無獨立 triage 入口屬已知設計取捨）。

---

## 檔案結構

新增：
- `src/data/scales/*-triage.yaml` — 18 個 triage 量表（每域 1 題，見 Task 3 對照表）。
- `tests/scales/triage-tiering.test.ts` — triage 分層引擎單元測試。

修改：
- `src/lib/scales/scale.ts` — `ScaleDef.tier` 三值 + 新增 `alwaysRun?: boolean`（Task 1）。
- `src/content.config.ts:161` — `tier` enum 加 `'triage'` + schema 加 `alwaysRun`（Task 1）。
- `src/lib/scales/load-scales.ts` — `ScaleEntryData.tier` 三值 + `alwaysRun` 透傳（Task 1）。
- `tests/scales/scale-model.test.ts:47` — tier 型別斷言三值（Task 1）。
- `tests/data/questionnaire-coverage.test.ts` — 本地 `ScaleYaml.tier` 型別三值（**第一輪審查補抓的第 6 處**）+ 加 triage coverage gate（Task 1 + Task 3）。
- `src/lib/scales/tiering.ts` — `selectTriageScales`、`selectAlwaysRunScreens`、`expandFlagged` helper、`expandedScreenScales`（Task 2）。
- `src/data/scales/4at.yaml`、`src/data/scales/cognition-screen.yaml` — 各加 `alwaysRun: true`（Task 3）。
- `src/components/assess/QuestionnaireModule.svelte` — tier 三值 + 三階段展開 + resume 逐層重建（Task 4）。

---

## Task 1：tier 三值 + `alwaysRun` 旗標型別擴展

**問題**：`tier` 目前是 `'screen' | 'full'` 二值，散見 **6 處**（scale.ts:38、content.config.ts:161、load-scales.ts:9、scale-model.test.ts:47、questionnaire-coverage.test.ts:11、QuestionnaireModule.svelte:31）；無 always-run 機制。本 task 擴前 5 處型別/schema（QuestionnaireModule 留 Task 4）並新增 `alwaysRun?: boolean`。純型別/schema 擴展，無行為變更。

**Files:**
- Modify: `src/lib/scales/scale.ts`
- Modify: `src/content.config.ts:161`
- Modify: `src/lib/scales/load-scales.ts`
- Modify: `tests/scales/scale-model.test.ts`
- Modify: `tests/data/questionnaire-coverage.test.ts`

- [ ] **Step 1: 更新型別斷言測試（先對齊目標型別 → 失敗）**

In `tests/scales/scale-model.test.ts`，tier 型別斷言（約 line 47）：

```typescript
expectTypeOf(def.tier).toEqualTypeOf<'screen' | 'full'>();
```

改為，並在其後加 alwaysRun 斷言：

```typescript
expectTypeOf(def.tier).toEqualTypeOf<'triage' | 'screen' | 'full'>();
expectTypeOf(def.alwaysRun).toEqualTypeOf<boolean | undefined>();
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm exec vitest run tests/scales/scale-model.test.ts`
Expected: FAIL — tier 型別為 `'screen' | 'full'`、`alwaysRun` 不存在於 `ScaleDef`。

- [ ] **Step 3: 擴展 ScaleDef 型別**

In `src/lib/scales/scale.ts`，`ScaleDef.tier`（line 38）：

```typescript
  tier: 'screen' | 'full';
```

改為（連同新增 `alwaysRun`）：

```typescript
  /** 'triage' = 大方向層（每域 1 題，亮燈展開 screen）；'screen' = 短篩層
   *  （亮燈展開 full）；'full' = 深評層。 */
  tier: 'triage' | 'screen' | 'full';
  /** always-run：無論 triage 結果都一律施測（病安域：譫妄 4AT C-M1、認知 C-S6）。 */
  alwaysRun?: boolean;
```

- [ ] **Step 4: 擴展 Zod schema**

In `src/content.config.ts`，line 161：

```typescript
    tier: z.enum(['screen', 'full']).default('screen'),
```

改為（並在其後加 `alwaysRun`）：

```typescript
    tier: z.enum(['triage', 'screen', 'full']).default('screen'),
    alwaysRun: z.boolean().optional(),
```

- [ ] **Step 5: 透傳 alwaysRun + load-scales 型別**

In `src/lib/scales/load-scales.ts`，`ScaleEntryData.tier`（line 9）：

```typescript
  tier: 'screen' | 'full';
```

改為（其後加 `alwaysRun`）：

```typescript
  tier: 'triage' | 'screen' | 'full';
  alwaysRun?: boolean;
```

`toScaleDefs` 映射（line 31 `tier: data.tier,` 之後）加一行 `alwaysRun: data.alwaysRun,`。

- [ ] **Step 6: questionnaire-coverage 測試本地型別三值（第一輪審查補抓）**

In `tests/data/questionnaire-coverage.test.ts`，本地 `ScaleYaml` interface（約 line 11）的 tier：

```typescript
  tier?: 'screen' | 'full';
```

改為：

```typescript
  tier?: 'triage' | 'screen' | 'full';
```

（否則 Task 3 的 `s.tier === 'triage'` 過濾在 TS strict 下是「比較必為 false」型別錯誤，`pnpm check` 失敗。）

- [ ] **Step 7: 跑測試確認通過 + 型別檢查**

Run: `pnpm exec vitest run tests/scales/scale-model.test.ts`
Expected: PASS。

Run: `pnpm check`
Expected: 0 errors（既有 YAML 無 `tier:'triage'` 仍合法；`alwaysRun` optional 不影響既有）。

- [ ] **Step 8: Commit**

```bash
git add src/lib/scales/scale.ts src/content.config.ts src/lib/scales/load-scales.ts tests/scales/scale-model.test.ts tests/data/questionnaire-coverage.test.ts
git commit -m "feat(scales): tier 擴為 triage|screen|full 三值 + alwaysRun 旗標

為三層金字塔與病安域 always-run（4AT、認知）擴展型別與 schema（含 coverage 測試
本地型別）；純型別擴展、預設 'screen' 保留既有 YAML 相容、alwaysRun optional。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2：tiering 引擎三層分流

**問題**：`tiering.ts` 目前只有 screen→full 一段。本 task 新增 triage 層選取、always-run screen 選取（含認知 C-M2 fallback），並把「亮燈展開」邏輯抽成共用 helper，衍生 `expandedScreenScales`（triage concern → screen）與既有 `expandedFullScales`（行為不變）。

**Files:**
- Modify: `src/lib/scales/tiering.ts`
- Test: `tests/scales/triage-tiering.test.ts`

- [ ] **Step 1: 寫失敗測試**

Create `tests/scales/triage-tiering.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  selectTriageScales,
  selectAlwaysRunScreens,
  expandedScreenScales,
} from '../../src/lib/scales/tiering';
import type { ScaleDef, ScaleResult } from '../../src/lib/scales/scale';

const def = (over: Partial<ScaleDef>): ScaleDef => ({
  id: 'x', domain: { top: 'functional', sub: 'falls' }, tier: 'triage',
  applicableCfs: ['cfs5'], scoring: 'sum', inputType: 'option',
  maxScore: 1, items: [], bands: [], clinicallyReviewed: false, ...over,
});
const result = (scaleId: string, severity: ScaleResult['severity']): ScaleResult => ({
  scaleId, domain: { top: 'functional', sub: 'falls' }, rawScore: 0, maxScore: 1, severity, bandLabel: '',
});

describe('selectTriageScales', () => {
  it('returns only tier:triage scales applicable to the CFS level', () => {
    const all = [
      def({ id: 'falls-triage', tier: 'triage', applicableCfs: ['cfs2', 'cfs5'] }),
      def({ id: 'adl-triage', tier: 'triage', applicableCfs: ['cfs7'] }),
      def({ id: 'steadi-falls', tier: 'screen', applicableCfs: ['cfs5'] }),
    ];
    expect(selectTriageScales(all, 'cfs5').map(s => s.id)).toEqual(['falls-triage']);
  });
});

describe('selectAlwaysRunScreens', () => {
  it('returns tier:screen scales with alwaysRun applicable to the CFS level', () => {
    const all = [
      def({ id: '4at', tier: 'screen', alwaysRun: true, applicableCfs: ['cfs4', 'cfs5'] }),
      def({ id: 'mood-screen', tier: 'screen', applicableCfs: ['cfs5'] }),
      def({ id: '4at-other', tier: 'screen', alwaysRun: true, applicableCfs: ['cfs9'] }),
    ];
    expect(selectAlwaysRunScreens(all, 'cfs5').map(s => s.id)).toEqual(['4at']);
  });

  it('applies C-M2 cognition fallback: no informant → AD8 (cognition-screen) becomes mini-cog', () => {
    const all = [
      def({ id: 'cognition-screen', tier: 'screen', alwaysRun: true, requiresInformant: true,
        domain: { top: 'psychological', sub: 'cognition' }, applicableCfs: ['cfs5'] }),
      def({ id: 'mini-cog', tier: 'full', requiresPatient: true,
        domain: { top: 'psychological', sub: 'cognition' }, applicableCfs: ['cfs5'] }),
    ];
    // informant present → keep AD8
    expect(selectAlwaysRunScreens(all, 'cfs5', true).map(s => s.id)).toEqual(['cognition-screen']);
    // no informant → swap to mini-cog
    expect(selectAlwaysRunScreens(all, 'cfs5', false).map(s => s.id)).toEqual(['mini-cog']);
  });
});

describe('expandedScreenScales (triage concern → screen)', () => {
  it('expands the screen a flagged triage points to via expandsTo', () => {
    const all = [
      def({ id: 'falls-triage', tier: 'triage', expandsTo: 'steadi-falls' }),
      def({ id: 'steadi-falls', tier: 'screen', expandsTo: 'sit-to-stand' }),
    ];
    expect(expandedScreenScales(all, [result('falls-triage', 'monitor')]).map(s => s.id)).toEqual(['steadi-falls']);
  });

  it('does NOT expand when the triage result is normal', () => {
    const all = [
      def({ id: 'falls-triage', tier: 'triage', expandsTo: 'steadi-falls' }),
      def({ id: 'steadi-falls', tier: 'screen' }),
    ];
    expect(expandedScreenScales(all, [result('falls-triage', 'normal')])).toHaveLength(0);
  });

  it('does NOT expand on incomplete (only monitor/refer flag)', () => {
    const all = [
      def({ id: 'falls-triage', tier: 'triage', expandsTo: 'steadi-falls' }),
      def({ id: 'steadi-falls', tier: 'screen' }),
    ];
    expect(expandedScreenScales(all, [result('falls-triage', 'incomplete')])).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm exec vitest run tests/scales/triage-tiering.test.ts`
Expected: FAIL — 三個函式未匯出。

- [ ] **Step 3: 實作（重構 expandedFullScales 為共用 helper + 新增三函式）**

In `src/lib/scales/tiering.ts`，把既有 `expandedFullScales`（line 107-118）整段**替換**為共用 helper + 兩衍生：

```typescript
/**
 * Given a tier's results, return the next-tier ScaleDef objects to expand into.
 * Only flagged (severity ≥ monitor) results expand, via their scale's `expandsTo`.
 * Tier-agnostic: drives both triage→screen and screen→full expansion.
 */
function expandFlagged(all: ScaleDef[], results: ScaleResult[]): ScaleDef[] {
  const out: ScaleDef[] = [];
  for (const r of results) {
    if (!WORSE(r.severity)) continue;
    const source = all.find(s => s.id === r.scaleId);
    if (source?.expandsTo) {
      const target = all.find(s => s.id === source.expandsTo);
      if (target) out.push(target);
    }
  }
  return out;
}

/** triage concern (≥monitor) → expand into the screen each triage points to. */
export function expandedScreenScales(all: ScaleDef[], triageResults: ScaleResult[]): ScaleDef[] {
  return expandFlagged(all, triageResults);
}

/** screen flag (≥monitor) → expand into the full scale each screen points to. */
export function expandedFullScales(all: ScaleDef[], screenResults: ScaleResult[]): ScaleDef[] {
  return expandFlagged(all, screenResults);
}
```

在 `selectScreenScales` 之後新增 triage / always-run 選取（always-run 套 C-M2，與 `selectScreenScales` 同模式）：

```typescript
/** Select all tier:'triage' big-picture scales applicable to the given CFS level. */
export function selectTriageScales(all: ScaleDef[], cfs: CfsLevel): ScaleDef[] {
  return all.filter(s => s.tier === 'triage' && s.applicableCfs.includes(cfs));
}

/**
 * Select tier:'screen' scales flagged `alwaysRun` (病安域：4AT、認知) applicable
 * to the CFS level. These run unconditionally in the triage phase, never gated by
 * a triage result (C-M1 譫妄、C-S6 認知不可靜默跳過).
 *
 * When `informantAvailable` is supplied, the cognition always-run scale is resolved
 * through the C-M2 fallback (AD8 ↔ Mini-Cog) and re-filtered for CFS applicability,
 * exactly like `selectScreenScales`.
 */
export function selectAlwaysRunScreens(all: ScaleDef[], cfs: CfsLevel, informantAvailable?: boolean): ScaleDef[] {
  const screens = all.filter(s => s.tier === 'screen' && s.alwaysRun === true && s.applicableCfs.includes(cfs));
  if (informantAvailable === undefined) return screens;
  return resolveCognitionScreen(screens, informantAvailable, all).filter(s => s.applicableCfs.includes(cfs));
}
```

（`WORSE`(line 100)、`selectScreenScales`、`resolveCognitionScreen`、`applyAvailabilityGate` 既有，不動。）

- [ ] **Step 4: 跑測試確認通過 + 既有 tiering 測試不破**

Run: `pnpm exec vitest run tests/scales/triage-tiering.test.ts tests/scales/tiering.test.ts`
Expected: PASS（新測試全過；既有 `expandedFullScales` 測試因行為等價仍過）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/scales/tiering.ts tests/scales/triage-tiering.test.ts
git commit -m "feat(scales): tiering 三層分流 selectTriageScales/expandedScreenScales/alwaysRun

抽 expandFlagged 共用 helper（tier-agnostic 亮燈展開），衍生 expandedScreenScales
（triage→screen）與既有 expandedFullScales（行為等價）；selectTriageScales、
selectAlwaysRunScreens（4AT+認知一律施測、含認知 C-M2 fallback）。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3：18 個 triage 量表 + 4AT/認知 alwaysRun 旗標

**問題**：為 18 個 BGS 域（排除 always-run 病安域 delirium、cognition）各建 1 個 `tier:'triage'` 大方向題，亮燈展開對應 screen；`4at.yaml` 與 `cognition-screen.yaml` 設 `alwaysRun: true`。triage 題取材對應 screen 量表的代表題，band 二分 normal / concern(→monitor)。

**取材規則（每個 triage YAML 一致）：**
- `id: <sub>-triage`、`tier: triage`、`domain` 同對應 screen、`applicableCfs` 同對應 screen、`expandsTo: <screen id>`、`scoring: sum`、`inputType: option`、`clinicallyReviewed: false`。
- **單一 item**：複製對應 screen「代表 item」的 `prompt`/`text`/`mode`，options 簡化為二元（最佳選項 `score: 0`、其餘任一陽性 `score: 1`）。
- `maxScore: 1`。
- **bands**：`{ min: 0, max: 0, severity: normal, label: <正常語> }` + `{ min: 1, max: 1, severity: monitor, label: 建議進一步短篩 }`（triage 只分 normal/concern；concern=monitor 觸發 `expandedScreenScales`）。

- [ ] **Step 1: 兩個病安域 screen 設 alwaysRun**

In `src/data/scales/4at.yaml`，在 `tier: screen` 行下方加 `alwaysRun: true`（4AT 維持 tier:screen，applicableCfs 不變）。

In `src/data/scales/cognition-screen.yaml`，同樣在 `tier: screen` 行下方加 `alwaysRun: true`（AD8 維持 tier:screen + requiresInformant；無知情者由 `selectAlwaysRunScreens` 的 C-M2 換 mini-cog）。

- [ ] **Step 2: 建立 triage 量表範本（falls，完整範例）**

Create `src/data/scales/falls-triage.yaml`（取材 `steadi-falls` 代表題 `steadi_fell`）:

```yaml
# 大方向 triage 題（tier: triage）。取材 steadi-falls 代表題「過去一年是否跌倒」。
# concern → 展開 steadi-falls 短篩（screen），其再亮燈展開 sit-to-stand 深評。
# 註：falls triage 亦覆蓋低 CFS 的 mobility 行動風險（mobility-screen 僅 cfs7；
#     steadi-falls→sit-to-stand 是 mobility 域 timed 深評）。詳設計決策 5。
# clinicallyReviewed: false → 待臨床簽核。
id: falls-triage
domain:
  top: functional
  sub: falls
tier: triage
expandsTo: steadi-falls
applicableCfs: [cfs2, cfs3, cfs4, cfs5, cfs6, cfs7, cfs8]
scoring: sum
inputType: option
maxScore: 1
items:
  - id: falls_triage_q
    mode: ask-either
    prompt: 請向受測者或家屬詢問：過去一年內是否曾經跌倒，或站立/行走會不穩？
    text: 過去一年內是否曾經跌倒，或站立／行走會不穩？
    options:
      - { label: 否, score: 0 }
      - { label: 是, score: 1 }
bands:
  - { min: 0, max: 0, severity: normal, label: 無明顯跌倒風險徵兆 }
  - { min: 1, max: 1, severity: monitor, label: 有跌倒/不穩徵兆，建議進一步跌倒短篩 }
clinicallyReviewed: false
```

- [ ] **Step 3: 依對照表建立其餘 17 個 triage YAML**

對每列建 `src/data/scales/<id>.yaml`，套用上方範本與「取材規則」。`mode`/`prompt`/`text` 取材自「代表 item」欄（去對應 screen YAML 複製該題文字，二元化 options）。`applicableCfs` 複製對應 screen。

| triage id | domain top.sub | applicableCfs（同 screen） | expandsTo (screen) | 取材來源 screen | mode | 大方向題（text） |
|---|---|---|---|---|---|---|
| `comorbidity-triage` | physical.comorbidity | cfs2–9 | `comorbidity-screen` | comorbidity-screen 慢病數題 | ask-either | 是否有長期治療中的慢性疾病（如高血壓、糖尿病、心臟病等）？ |
| `polypharmacy-triage` | physical.polypharmacy | cfs2–9 | `polypharmacy` | polypharmacy 用藥數題 | ask-either | 每天是否規律服用 5 種以上處方藥？ |
| `nutrition-triage` | physical.nutrition | cfs1–9 | `nutrition-screen` | nutrition-screen 食慾/體重題 | ask-either | 最近是否食慾變差或體重明顯減輕？ |
| `continence-triage` | physical.continence | cfs3–9 | `continence-screen` | continence-screen 漏尿題 | ask-either | 是否曾有非自主漏尿或排尿困擾？ |
| `sensory-triage` | physical.sensory | cfs1–9 | `sensory-screen` | sensory-screen 視/聽題 | ask-either | 視力或聽力是否影響日常生活？ |
| `pain-triage` | physical.pain | cfs1–9 | `pain-screen` | pain-screen NRS 題 | ask-either | 最近是否有讓您困擾的疼痛？ |
| `mood-triage` | psychological.mood | cfs1–7 | `mood-screen` | mood-screen PHQ-2 核心題 | ask-either | 最近兩週是否常感到情緒低落，或做事提不起勁？ |
| `adl-triage` | functional.adl | cfs3–9 | `adl-screen` | adl-screen 自我照顧題 | ask-either | 洗澡、穿衣、如廁等基本自我照顧是否需要他人協助？ |
| `iadl-triage` | functional.iadl | cfs3–9 | `iadl-screen` | iadl-screen 工具性日常題 | ask-either | 購物、備餐、用藥或理財等事務是否需要協助？ |
| `mobility-triage` | functional.mobility | cfs7 | `mobility-screen` | mobility-screen 行走題 | ask-either | 平地行走或起身是否感到困難？ |
| `social-support-triage` | social.social_support | cfs2–9 | `social-support-screen` | social-support-screen 聯絡題 | ask-either | 是否覺得孤立，或缺少可求助的家人/朋友？ |
| `caregiver-triage` | social.caregiver | cfs4–9 | `caregiver-screen` | caregiver-screen 負荷題 | ask-informant | （向照顧者）照顧這位長者是否讓您感到沉重負擔？ |
| `financial-triage` | social.financial | cfs3–9 | `financial-screen` | financial-screen 收入題 | ask-either | 目前收入是否足以支應日常生活與醫療開銷？ |
| `home-safety-triage` | environmental.home_safety | cfs3–8 | `home-safety` | home-safety 居家危險題 | ask-either | 居家環境是否有讓您擔心跌倒或受傷的地方？ |
| `accessibility-triage` | environmental.accessibility | cfs4–9 | `accessibility-screen` | accessibility-screen 輔具題 | ask-either | 是否有需要但尚未取得的輔具，或外出有困難？ |
| `acp-triage` | future_wishes.advance_care_planning | cfs5–9 | `acp-status` | acp-status 簽署題 | ask-either | 是否想了解或討論預立醫療照護的相關安排？ |
| `treatment-pref-triage` | future_wishes.treatment_preferences | cfs5–9 | `treatment-pref` | treatment-pref 意願題 | ask-either | 是否想表達對未來醫療處置（如急救）的偏好？ |

（連同 Step 2 的 `falls-triage` 共 18 個。**無 cognition-triage、無 delirium triage**——兩域 always-run。）

**特例註記（寫入各 YAML comment）：**
- `caregiver-triage`：加 `requiresInformant: true`（對象是照顧者；無知情者 → `applyAvailabilityGate` 標 incomplete，incomplete 不 flag → 不展開 caregiver-screen。結果頁該域顯示「未完成」破折號，屬合理：無照顧者則無從評照顧者負荷）。

- [ ] **Step 4: coverage 測試 gate**

In `tests/data/questionnaire-coverage.test.ts`，仿照既有「每 CFS 至少一 screen」測試，新增：

```typescript
it('every CFS level has at least one tier:triage scale', () => {
  for (const cfs of CFS_LEVELS) {
    const triage = scales.filter(s => s.tier === 'triage' && s.applicableCfs.includes(cfs));
    expect(triage.length, `${cfs} has no triage scale`).toBeGreaterThan(0);
  }
});

it('every triage scale expandsTo an existing screen scale', () => {
  const screenIds = new Set(scales.filter(s => s.tier === 'screen').map(s => s.id));
  for (const t of scales.filter(s => s.tier === 'triage')) {
    expect(t.expandsTo, `${t.id} missing expandsTo`).toBeTruthy();
    expect(screenIds.has(t.expandsTo!), `${t.id}.expandsTo=${t.expandsTo} not a screen`).toBe(true);
  }
});

it('delirium and cognition are alwaysRun screens (no triage gate; C-M1/C-S6)', () => {
  const fourAt = scales.find(s => s.id === '4at');
  const cog = scales.find(s => s.id === 'cognition-screen');
  expect(fourAt?.alwaysRun).toBe(true);
  expect(cog?.alwaysRun).toBe(true);
  expect(scales.some(s => s.tier === 'triage' && s.domain.sub === 'delirium')).toBe(false);
  expect(scales.some(s => s.tier === 'triage' && s.domain.sub === 'cognition')).toBe(false);
});

it('mini-cog applicableCfs ⊇ cognition-screen (C-M2 fallback never drops cognition)', () => {
  const cog = scales.find(s => s.id === 'cognition-screen');
  const mini = scales.find(s => s.id === 'mini-cog');
  expect(cog && mini).toBeTruthy();
  for (const cfs of cog!.applicableCfs) {
    expect(mini!.applicableCfs.includes(cfs), `mini-cog missing ${cfs}`).toBe(true);
  }
});
```

**注意**：若此測試 FAIL（mini-cog 既有 applicableCfs 不含 cognition-screen 的全部 cfs），需擴 `mini-cog.yaml` 的 applicableCfs 至 ⊇ cognition-screen，否則無知情者時該 cfs 認知消失（C-S6）。此為本 task 的前置條件，在 Step 5 跑測試時一併確認。

（`scales`、`CFS_LEVELS` 沿用該測試檔既有的 YAML 載入與常數匯入。）

- [ ] **Step 5: 跑測試 + build（Content Layer 驗證）**

Run: `pnpm exec vitest run tests/data/questionnaire-coverage.test.ts`
Expected: PASS。

Run: `pnpm build 2>&1 | tail -5`
Expected: 成功（Content Layer Zod 驗證 18 個新 triage YAML + 2 個 alwaysRun screen）。

- [ ] **Step 6: Commit**

```bash
git add src/data/scales/
git commit -m "feat(scales): 18 個 triage 大方向題 + 4AT/認知 alwaysRun

每域 1 題、取材對應 screen 代表題、expandsTo 指向 screen、band 二分 normal/concern；
delirium 與 cognition 為病安 always-run 域（無 triage 題，一律施測，C-M1/C-S6）。
coverage gate：每 CFS ≥1 triage、triage.expandsTo 皆合法 screen、兩病安域 alwaysRun。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4：QuestionnaireModule 三階段展開 + resume 重建

**問題**：`QuestionnaireModule.svelte` 目前 tier 為 `'screen' | 'full'` 二值、起始即施測所有 screen、亮燈展 full（一段）。改為：起始 `'triage'`、施測 triage 題 + alwaysRun screen（4AT、認知）、triage concern 展開對應 screen、screen 亮燈再展 full（兩段）。**並補強 resume：依已答內容逐層重建 expandedScreens/fullScales/tier**（第一輪審查 blocker）。計分/結果頁不變。

**設計（三階段累加）：**
- 階段 `'triage'`：`triageScales` + `alwaysRunScreens`(4AT、認知)。
- 階段 `'screen'`：+ `expandedScreens`（triage concern 展開）。
- 階段 `'full'`：+ `fullScales`（screen flag 展開）。

**Files:**
- Modify: `src/components/assess/QuestionnaireModule.svelte`
- Test: `tests/components/QuestionnaireModule.test.ts`

- [ ] **Step 1: 寫失敗測試（三階段展開 + always-run + 不重問）**

In `tests/components/QuestionnaireModule.test.ts`，頂部新增 fixture（沿用既有 `ScaleDef` fixture 風格）：

```typescript
const fallsTriage: ScaleDef = {
  id: 'falls-triage', domain: { top: 'functional', sub: 'falls' }, tier: 'triage',
  expandsTo: 'falls-screen', applicableCfs: ['cfs5'], scoring: 'sum', inputType: 'option', maxScore: 1,
  items: [{ id: 'ft', mode: 'ask-either', prompt: 'FALLS_TRIAGE_Q', text: 'FALLS_TRIAGE_Q',
    options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] }],
  bands: [{ min: 0, max: 0, severity: 'normal', label: 'ok' }, { min: 1, max: 1, severity: 'monitor', label: 'concern' }],
  clinicallyReviewed: false,
};
const fallsScreen: ScaleDef = {
  id: 'falls-screen', domain: { top: 'functional', sub: 'falls' }, tier: 'screen', expandsTo: 'falls-full',
  applicableCfs: ['cfs5'], scoring: 'sum', inputType: 'option', maxScore: 1,
  items: [{ id: 'fs', mode: 'ask-either', prompt: 'FALLS_SCREEN_Q', text: 'FALLS_SCREEN_Q',
    options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] }],
  bands: [{ min: 0, max: 0, severity: 'normal', label: 'ok' }, { min: 1, max: 1, severity: 'monitor', label: 'flag' }],
  clinicallyReviewed: false,
};
const fallsFull: ScaleDef = {
  id: 'falls-full', domain: { top: 'functional', sub: 'falls' }, tier: 'full',
  applicableCfs: ['cfs5'], scoring: 'sum', inputType: 'option', maxScore: 1,
  items: [{ id: 'ff', mode: 'ask-either', prompt: 'FALLS_FULL_Q', text: 'FALLS_FULL_Q',
    options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] }],
  bands: [{ min: 0, max: 0, severity: 'normal', label: 'ok' }, { min: 1, max: 1, severity: 'monitor', label: 'x' }],
  clinicallyReviewed: false,
};
const alwaysRunScreen: ScaleDef = {
  id: 'delirium-always', domain: { top: 'psychological', sub: 'delirium' }, tier: 'screen', alwaysRun: true,
  applicableCfs: ['cfs5'], scoring: 'sum', inputType: 'option', maxScore: 1,
  items: [{ id: 'ar', mode: 'observe', prompt: 'ALWAYS_RUN_Q', text: 'ALWAYS_RUN_Q',
    options: [{ label: '正常', score: 0 }, { label: '異常', score: 1 }] }],
  bands: [{ min: 0, max: 0, severity: 'normal', label: 'ok' }, { min: 1, max: 1, severity: 'monitor', label: 'x' }],
  clinicallyReviewed: false,
};
```

新增測試（沿用既有 `clickOption`/`makeChild`/`makeAssessment`/store 設定）：

```typescript
it('triage normal → does NOT expand into the domain screen', async () => {
  assessmentStore.child = makeChild();
  assessmentStore.assessment = makeAssessment();
  assessmentStore.informantAvailable = true;
  assessmentStore.patientAble = true;
  assessmentStore.cfsLevel = 'cfs5';
  render(QuestionnaireModule, { scales: [fallsTriage, fallsScreen, fallsFull] });
  await clickOption('否');                                  // triage normal
  await waitFor(() => expect(screen.queryByText('FALLS_SCREEN_Q')).toBeNull());
});

it('triage concern → expands screen; screen flag → expands full', async () => {
  assessmentStore.child = makeChild();
  assessmentStore.assessment = makeAssessment();
  assessmentStore.informantAvailable = true;
  assessmentStore.patientAble = true;
  assessmentStore.cfsLevel = 'cfs5';
  render(QuestionnaireModule, { scales: [fallsTriage, fallsScreen, fallsFull] });
  await clickOption('是');                                  // triage concern
  await waitFor(() => expect(screen.getByText('FALLS_SCREEN_Q')).toBeInTheDocument());
  await clickOption('是');                                  // screen flag
  await waitFor(() => expect(screen.getByText('FALLS_FULL_Q')).toBeInTheDocument());
});

it('alwaysRun screen is asked in the triage phase and NOT re-asked after expansion', async () => {
  assessmentStore.child = makeChild();
  assessmentStore.assessment = makeAssessment();
  assessmentStore.informantAvailable = true;
  assessmentStore.patientAble = true;
  assessmentStore.cfsLevel = 'cfs5';
  render(QuestionnaireModule, { scales: [fallsTriage, fallsScreen, fallsFull, alwaysRunScreen] });
  // always-run question present from the triage phase
  await waitFor(() => expect(screen.getByText('ALWAYS_RUN_Q')).toBeInTheDocument());
  await clickOption('正常');                                // answer always-run (normal)
  await clickOption('是');                                  // falls triage concern → expand falls-screen
  await waitFor(() => expect(screen.getByText('FALLS_SCREEN_Q')).toBeInTheDocument());
  // always-run question must NOT reappear (already answered)
  expect(screen.queryByText('ALWAYS_RUN_Q')).toBeNull();
});

it('persists triage results so all-normal domains still get a score (blocker C)', async () => {
  assessmentStore.child = makeChild();
  assessmentStore.assessment = makeAssessment();
  assessmentStore.informantAvailable = true;
  assessmentStore.patientAble = true;
  assessmentStore.cfsLevel = 'cfs5';
  render(QuestionnaireModule, { scales: [fallsTriage, fallsScreen, fallsFull] });
  await clickOption('否');                                  // triage normal → no expansion → summary
  // triage result must be persisted (else the falls domain vanishes on the result page)
  await waitFor(() => {
    const stored = assessmentStore.partialAnalysis.scaleResults ?? {};
    expect(stored['falls-triage']).toBeTruthy();
    expect(stored['falls-triage'].severity).toBe('normal');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm exec vitest run tests/components/QuestionnaireModule.test.ts -t "triage|alwaysRun"`
Expected: FAIL — 目前無 triage 階段。

- [ ] **Step 3: import + tier 三值**

In `src/components/assess/QuestionnaireModule.svelte`，精確調整 import（第二輪審查 major：避免 unused）：
- **移除** `selectScreenScales`（`screenScales` 改為 `alwaysRunScreens + expandedScreens`，grep 確認元件內無其他用處）。
- **保留既有** `expandedFullScales`（`expandTier` 用）、`applyAvailabilityGate`（`computeGatedResult` line 460 用）。
- **新增** `selectTriageScales`、`selectAlwaysRunScreens`、`expandedScreenScales`、`resolveCognitionScreen`。

```typescript
import {
  selectTriageScales, selectAlwaysRunScreens, expandedScreenScales,
  expandedFullScales, resolveCognitionScreen, applyAvailabilityGate,
} from '../../lib/scales/tiering';
```

並新增 `tick` import（resume 重建 flush derived 用，Step 7b）：

```typescript
import { tick } from 'svelte';
```

tier 狀態（line 31）`let tier = $state<'screen' | 'full'>('screen');` 改為：

```typescript
let tier = $state<'triage' | 'screen' | 'full'>('triage');
```

- [ ] **Step 4: triage / always-run / expandedScreens 衍生狀態**

在 `screenScales`（line 43-45）**之前**插入：

```typescript
/** Tier-0 大方向題（每域 1 題；不含病安 always-run 域）。 */
const triageScales = $derived<ScaleDef[]>(cfsLevel ? selectTriageScales(scales, cfsLevel) : []);
/** 病安 always-run screen（4AT、認知，含 C-M2 fallback）：triage 階段一律施測。 */
const alwaysRunScreens = $derived<ScaleDef[]>(
  cfsLevel ? selectAlwaysRunScreens(scales, cfsLevel, informantAvailable ?? undefined) : [],
);
```

把既有 `screenScales`（line 43-45 的 `$derived(selectScreenScales(...))`）**替換**為「always-run + triage 展開」：

```typescript
/** Tier-1 screen scales = always-run screens (present from the triage phase) +
 *  expandedScreens (populated by expandTriageTier from flagged triage results). */
let expandedScreens = $state<ScaleDef[]>([]);
const screenScales = $derived<ScaleDef[]>([...alwaysRunScreens, ...expandedScreens]);
```

- [ ] **Step 5: timed / option 三階段（含 triage option，timedScales 自洽）**

`screenTimedScales`/`fullTimedScales`/`timedScales`（line 54-56）整段改為（**triage 題皆 option，無獨立 triage timed**；timedScales 涵蓋 screen+full timed，與展開銜接）：

```typescript
const screenTimedScales = $derived<ScaleDef[]>(screenScales.filter(s => s.inputType === 'timed-task'));
const fullTimedScales = $derived<ScaleDef[]>(fullScales.filter(s => s.inputType === 'timed-task'));
const timedScales = $derived<ScaleDef[]>([...screenTimedScales, ...fullTimedScales]);
```

（不引入 `triageTimedScales`——triage 題與病安 always-run（4AT option、認知 AD8/Mini-Cog option）皆非 timed-task；YAGNI，避免第一輪審查指出的索引基底不一致。）

option scales（line 59-66）：`screenOptionScales`/`fullOptionScales` 既有保留，新增 `triageOptionScales`，並改 `activeOptionScales` 為三階段累加：

```typescript
const triageOptionScales = $derived<ScaleDef[]>(triageScales.filter(s => s.inputType !== 'timed-task'));
// triage 階段：triage 題 + always-run screens；screen 階段：再加已展開 screens（已在 screenScales）；
// full 階段：再加 full。screenOptionScales 衍生自含 always-run+expandedScreens 的 screenScales。
const activeOptionScales = $derived<ScaleDef[]>(
  tier === 'full'
    ? [...triageOptionScales, ...screenOptionScales, ...fullOptionScales]
    : [...triageOptionScales, ...screenOptionScales],
);
```

- [ ] **Step 6: 展開邏輯 — expandTriageTier + 改 advanceAfterItem + maybeAdvanceFromTriage**

新增 `expandTriageTier()`（在 `expandTier` 之前）：

```typescript
/** Compute triage results → resolve which screens to expand into (expandsTo,
 *  C-M2 cognition fallback + CFS re-filter), set expandedScreens, flip tier→'screen'.
 *  Returns the newly expanded screens. Idempotent. */
function expandTriageTier(): ScaleDef[] {
  const triageResults: ScaleResult[] = [];
  for (const s of triageOptionScales) {
    const r = computeGatedResult(s);
    if (r) triageResults.push(r);
  }
  const targets = expandedScreenScales(scales, triageResults);
  const resolved = resolveCognitionScreen(targets, informantAvailable ?? true, scales)
    .filter(s => !!cfsLevel && s.applicableCfs.includes(cfsLevel));
  expandedScreens = resolved;
  tier = 'screen';
  return resolved;
}
```

改 `advanceAfterItem()` 的 tier 收尾（line 383-388）：

```typescript
  // All active questions resolved.
  if (tier === 'triage') {
    maybeAdvanceFromTriage();
  } else if (tier === 'screen') {
    maybeAdvanceTier();
  } else {
    persistScoresToStore();
    phase = 'summary';
  }
```

新增 `maybeAdvanceFromTriage()`（在 `maybeAdvanceTier` 之前），鏡像其 timed/asking 處理，無展開時 fall through 到 screen→full 邊界（always-run screen 結果仍可能 flag）：

```typescript
/** All triage + always-run-screen questions resolved → expand flagged screens.
 *  New screen questions → keep asking; else fall through to the screen→full
 *  boundary (always-run screen results may still flag a full scale). */
function maybeAdvanceFromTriage(): void {
  expandTriageTier();
  const stored = assessmentStore.partialAnalysis.scaleResults ?? {};
  const hasUnfinishedTimed = timedScales.some(s => !stored[s.id]);
  if (hasUnfinishedTimed) {
    const idx = timedScales.findIndex(s => !stored[s.id]);
    timedIndex = idx === -1 ? timedScales.length : idx;
    phase = 'timed';
    return;
  }
  const firstScreen = questions.findIndex(q => answers[q.item.id] === undefined && !unavailableScales.has(q.scaleId));
  if (firstScreen !== -1) {
    currentIndex = firstScreen;
    phase = 'asking';
  } else {
    maybeAdvanceTier();
  }
}
```

（`maybeAdvanceTier`/`expandTier`(line 426-441) 既有保留——`screenOptionScales`/`screenTimedScales` 現衍生自含 always-run+expandedScreens 的 `screenScales`，語意正確。`computeGatedResult`(445-461) 不動。`tier==='full'` summary 收尾不變。）

**同步改 `persistScoresToStore`（line 465-472）— 第二輪審查 blocker C：triage 結果必須進 partialAnalysis，否則冷啟動全正常時結果頁只剩 4AT+認知 2 域、其餘 18 域分數消失。** 將其遍歷集合由 `[...screenOptionScales, ...fullOptionScales]` 改為含 triage：

```typescript
function persistScoresToStore(): void {
  const results: ScaleResult[] = [];
  for (const s of [...triageOptionScales, ...screenOptionScales, ...fullOptionScales]) {
    const r = computeGatedResult(s);
    if (r) results.push(r);
  }
  assessmentStore.addAnalysis(results);
}
```

（同域 triage + 展開 screen 兩筆 ScaleResult 以各自 scaleId 為 key 並存於 `partialAnalysis.scaleResults`；結果頁 `computeDomainScores` 對每筆產一 DomainScore，`groupDomainScores` 已「取最嚴重」聚合同域——Phase 1 的聚合修正正為此鋪路，故安全、結果頁每域皆有分數。）

- [ ] **Step 7: 補強 initPhase（空守門 + resume 逐層重建）— 第一輪審查 blocker**

In `initPhase()`（line 117-158）：

(a) **空狀態守門**（line 120）由 `if (screenScales.length === 0)` 改為涵蓋 triage：

```typescript
    // No triage / always-run / screen scale applies → empty state.
    if (triageScales.length === 0 && screenScales.length === 0) {
      phase = 'asking';
      return;
    }
```

(b) **resume 逐層重建**：在 `await restoreAnswers();`（line 125）之後、既有 `if (screenOptionScales.length > 0 && ...expandTier())`（line 131-133）**之前**插入 triage→screen 重建；並把既有 line 131 的 screen→full 重建包進「triage 已展開」條件：

```typescript
    // Resume: rebuild tier state from prior answers, layer by layer.
    // (1) triage all resolved → expand screens (sets expandedScreens, tier='screen').
    if (triageOptionScales.length > 0 && triageOptionScales.every(isScaleResolved)) {
      expandTriageTier();
      // (2) screens all resolved → expand fulls (sets fullScales, tier='full').
      if (screenOptionScales.length > 0 && screenOptionScales.every(isScaleResolved)) {
        expandTier();
      }
      // CRITICAL (第二輪審查 blocker A-iv): expandTriageTier/expandTier just wrote
      // $state (expandedScreens/fullScales/tier); the questions/timedScales $derived
      // do NOT recompute within this synchronous block (cf. maybeAdvanceTier's note
      // at line 393). Flush with tick() before computing the resume point below,
      // else firstUnanswered runs on a stale `questions` that lacks expanded items.
      await tick();
      if (destroyed) return;
    }
```

（刪除原 line 131-133 的獨立 `if (screenOptionScales.every(isScaleResolved)) expandTier();`——其語意已併入上方第 (2) 層，且僅在 triage 已展開後才正確。`restoreAnswers`/`isScaleResolved` 不動。**關鍵**：timed-skip(line 137-140) 與 resume point(line 143-157) 依賴 `questions`/`timedScales` derived，須在上方 `await tick()` flush 後才正確反映展開的 screen/full 題——故 `await tick()` 必須置於重建之後、timed-skip 之前。`tick` 自 `svelte` import（見 Step 3）。）

- [ ] **Step 8: 進度提示加 tier 階段標籤**

進度文字（約 line 531 `第 {currentIndex + 1} 題，共 {totalQuestions} 題`）前加：

```svelte
<span class="tier-label">{tier === 'triage' ? '大方向' : tier === 'screen' ? '短篩' : '深評'}</span>
```

`<style>` 加：

```css
.tier-label { font-size: var(--text-sm); font-weight: var(--font-bold); color: var(--accent); margin-right: var(--space-2); }
```

- [ ] **Step 9: 跑新測試 + 修既有失配測試**

Run: `pnpm exec vitest run tests/components/QuestionnaireModule.test.ts -t "triage|alwaysRun"`
Expected: PASS。

Run: `pnpm exec vitest run tests/components/QuestionnaireModule.test.ts tests/components/QuestionnaireFlow.test.ts`
Expected: 部分既有測試 FAIL — 它們假設「起始即出 screen 題」。**已知受影響範圍（第二輪審查，逐一對齊；不得放寬測試意圖，只對齊新流程，與 Phase 1 同原則）：**
- **`QuestionnaireFlow.test.ts` 批量答題 flow**（最大宗）：fixture 用 fakeTimers 連續答 screen 題，三層後第一批是 triage 題；需在 flow 中先答 triage（concern 才出 screen）、重算題序與 `totalQuestions`。
- **`QuestionnaireModule.test.ts:435` resume 測試**：假設一開始出 `phq2_anhedonia`（mood screen 題）→ 改為先 mood-triage concern；並驗證 resume 重建（Step 7b）後正確回到 screen 階段。
- **任何斷言「第 1 題是某 screen 題」「totalQuestions = N」者**：題數因 triage 先行改變，重算。
- **mode-frame 相關測試（Phase 1 新增，`QuestionnaireModule.test.ts:158-214` 等）**：若以某 screen scale 觸發特定 mode header（如 caregiver ask-informant、adl ask-either），該 scale 現需先經 triage concern 展開才出現 → 測試需先答對應 triage concern，或改用 triage/always-run scale（其 mode header 在 triage 階段即可驗）。
逐項對齊後仍 FAIL 則回報具體案例。

- [ ] **Step 10: 全測試 + check + lint**

Run: `pnpm test`
Expected: PASS。
Run: `pnpm check` → 0 errors。
Run: `pnpm lint` → 0 errors（warning 不增加）。

- [ ] **Step 11: Commit**

```bash
git add src/components/assess/QuestionnaireModule.svelte tests/components/QuestionnaireModule.test.ts
git commit -m "feat(assess): QuestionnaireModule 三階段展開 triage→screen→full + resume 重建

tier 三值（起始 triage）；triage 題 + always-run screen(4AT/認知) 先施測，
triage concern 經 expandedScreenScales+C-M2 展開 screen，screen 亮燈再展 full。
補強 initPhase：空守門涵蓋 triage、resume 依已答內容逐層重建 expandedScreens/
fullScales/tier。進度提示加 tier 標籤。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5：端到端目視驗證（playwright，本機 preview）

**目的**：spec 教訓——抽象測試通過不代表真實流程正確（Phase 1 端到端揭露 each_key_duplicate、本輪審查揭露 cfs1-3 守門/resume 的前車之鑑）。**務必涵蓋 cfs1-3（無 4AT）與 resume**。

- [ ] **Step 1: build + preview**

Run: `pnpm build && pnpm preview --port 4321 &`
Expected: build 成功、preview 起在 4321。

- [ ] **Step 2: 個案 A — cfs2 冷啟動全正常（驗 cfs1-3 守門修正）**

playwright 開 `http://localhost:4321/assess/`，**cfs2**（無 4AT，但認知 cognition-screen alwaysRun 適用 cfs1-8）/ informant=是 / patientAble=是，所有 triage 題答最佳選項、認知題答正常。確認：
- triage 題正常出現（**不因 cfs2 無 4AT 而空狀態跳過**——驗 Step 7a 守門修正）。
- 認知（AD8）在 triage 階段一律出現（always-run）。
- 全正常 → 不展開任何 screen → 直達結果頁。console 無錯誤（特別 each_key_duplicate）。

- [ ] **Step 3: 個案 B — cfs5 單域亮燈 + 無知情者認知 fallback**

重開新評估 **cfs5 / informant=否 / patientAble=是**，僅「跌倒」triage 答「是」，其餘正常。確認：
- 跌倒 triage「是」→ 出現 steadi-falls screen；亮燈後出 sit-to-stand。
- 4AT 一律出題；認知因 informant=否 → **出現 Mini-Cog（非 AD8）**（驗 always-run C-M2）。
- 其他域 triage 正常 → 不展開。結果頁長條圖正確、console 無錯。

- [ ] **Step 4: 個案 C — resume 重建**

cfs5 評估答到 screen 階段一半 → 暫停 → 從評估紀錄「繼續」。確認：
- resume 回到正確 tier 階段（已展開的 screen 題重現、不要求重答已答題）。
- 完成後結果頁正確、console 無錯（特別 DataCloneError、each_key_duplicate）。

- [ ] **Step 5: 收掉 preview，回報目視結果**。若有問題回對應 Task 修正。

---

## Self-Review（計畫對照 spec）

- **§A 大方向層（每域 1 題、取材 screen、clinicallyReviewed:false）** → Task 3（18 triage YAML；delirium/cognition 為 always-run 例外，設計決策 2-3）✅
- **§B tier 三值 + triage→screen 分流** → Task 1 + Task 2 ✅
- **§B always-run 安全領域** → 4AT + 認知（使用者確認）alwaysRun：Task 1（旗標）+ Task 2（selectAlwaysRunScreens + C-M2）+ Task 3（兩 YAML）+ Task 4（triage 階段施測、不重問）✅
- **§B 冷啟動最短路徑** → Task 4 + Task 5（個案 A cfs2 驗證）✅
- **§B UI 三階段展開** → Task 4 ✅
- **§B/C-M2 認知 fallback** → Task 2 selectAlwaysRunScreens 套 resolveCognitionScreen + Task 5 個案 B 驗證 ✅
- **第一輪審查 blocker（resume tier 重建、cfs1-3 空守門）** → Task 4 Step 7 ✅
- **冷啟動題數（誠實，依 CFS 逐域核對 applicableCfs）**：題數 = 該 CFS 適用 triage 數 + always-run（4AT 4 題 cfs4+；認知 AD8/Mini-Cog）。**cfs2 適用 triage = 8**（comorbidity/polypharmacy/nutrition/sensory/pain/mood/social-support/falls；continence/adl/iadl/financial/home-safety 從 cfs3、caregiver/accessibility 從 cfs4、acp/treatment-pref 從 cfs5、mobility cfs7）→ cfs2 ≈ 8 triage + 認知（無 4AT）。**cfs5 適用 triage = 17**（除 mobility cfs7-only）→ ≈ 17 triage + 4AT(4) + 認知 ≈ 22-24 題。spec「18-20」為概數；實際依 CFS 分層，Task 5 個案 A 以 cfs2 實測題數。
- 型別一致：`tier` 三值跨 6 處；`expandedScreenScales`/`expandedFullScales` 同 `expandFlagged`；`selectAlwaysRunScreens(all, cfs, informantAvailable?)` 與 `selectScreenScales` 同簽名風格。
- 無 placeholder：型別/tiering/測試/UI 含完整 code；18 triage YAML 以「完整範本 + 完整對照表 + 取材規則」表達（DRY）。
- 範圍：Phase 2 僅專業層三層金字塔，不觸自評層（Phase 3）、不改計分/結果頁。

## 第一輪獨立審查（Opus）修正納入（2026-05-30）

- **[blocker] resume tier 重建缺席** → Task 4 Step 7(b) initPhase 逐層重建 expandedScreens/fullScales/tier。
- **[blocker] cfs1-3 空守門跳過 triage** → Task 4 Step 7(a) 守門改 `triageScales.length===0 && screenScales.length===0`；Task 5 個案 A 用 cfs2 驗證。
- **[major] coverage 測試本地 tier 二值（第 6 處）** → Task 1 Step 6。
- **[major] cognition 病安降級** → 使用者確認「比照 4AT 一律施測」：cognition-screen alwaysRun、移除 cognition-triage（triage 18 域）、selectAlwaysRunScreens 套 C-M2。
- **[major] timedScales 不自洽** → Task 4 Step 5 不引入 triageTimedScales（triage/always-run 皆 option），maybeAdvanceFromTriage 直接用 timedScales。
- **[major] 4AT 跨階段不重問/計分** → Task 4 Step 1 新增測試（always-run 答畢後展開不重現）。
- **[major] mobility cfs7 覆蓋取捨** → 設計決策 5 明文記錄（cfs2-6 經 falls 路徑）。
- **[minor] selectAlwaysRunScreens fixture/題數/Self-Review 誠實** → Task 2 fixture 用 cfs4-5、Self-Review 題數依 CFS。
- **[minor] caregiver 無知情者呈現** → Task 3 特例註記。
- 已查證成立：Task 1 行號、Task 2 `expandFlagged` 重構等價（既有 tiering.test 不破）、`expandedFullScales` 唯一呼叫端 QuestionnaireModule:437、對照表 screen id/expandsTo/applicableCfs 真實、19→18 域計數。

## 第二輪獨立審查（Opus）修正納入（2026-05-30）

- **[blocker C] triage 結果未 persist → 結果頁缺 18 域分數**：已查證 `persistScoresToStore`(line 465-472) 只遍歷 screen+full。修：Task 4 Step 6 改其遍歷含 `triageOptionScales`（同域兩筆由結果頁 `groupDomainScores` 聚合）+ Task 4 Step 1 新增 persist 測試（blocker C）。
- **[blocker A-iv] resume 重建踩 derived 未即時重算坑**：已查證 `maybeAdvanceTier` line 393 既有註解確認此坑。修：Task 4 Step 7b 重建後 `await tick()` + `destroyed` 檢查，再算 resume point；Step 3 加 `import { tick } from 'svelte'`。
- **[major] `selectScreenScales` import unused**：改版後無呼叫端。修：Task 4 Step 3 精確 import（移除 selectScreenScales、保留 expandedFullScales/applyAvailabilityGate、新增四函式）。
- **[major] 認知 C-M2 的 mini-cog CFS 覆蓋 + 雙不可得降級**：修：設計決策 4 補前提（mini-cog applicableCfs ⊇ cognition-screen）+ 雙不可得為可接受降級；Task 3 Step 4 加 coverage 查核。
- **[major] 既有測試破壞範圍低估**：修：Task 4 Step 9 明列 QuestionnaireFlow flow / resume:435 / 題數斷言 / mode-frame 測試四類受影響範圍與對齊策略。
- **[minor] 題數估算錯**：修：Self-Review 逐域核對（cfs2=8、cfs5=17 triage）。
- **[minor] caregiver 無知情者呈現**：Task 3 特例註記已述（incomplete → 結果頁破折號，合理）。
- 已查證成立（第二輪）：空守門修正邏輯正確、`expandFlagged` 重構複查一致、coverage 第 6 處補上、timedScales 不引入 triageTimed 自洽、對照表抽查一致、4AT 不重問測試涵蓋。

## 待 review 重點（給第三輪審查者）

1. Task 4 三階段狀態機（`maybeAdvanceFromTriage`→`maybeAdvanceTier` 串接、always-run screen 在 triage/screen 階段計分時機、`activeOptionScales` 三階段累加自洽）是否仍有 timed-task（sit-to-stand）邊界或重複計分遺漏。
2. initPhase resume 重建（Step 7b）對「triage 部分答、screen 未到」「screen 部分答」等中間態的還原正確性。
3. 既有 QuestionnaireModule/Flow 測試對齊「triage 先行」的範圍是否被低估。
4. 認知 always-run + C-M2 在 triage 階段的出題與 availability gate 互動（AD8 requiresInformant vs always-run）。
5. triage band 二分（normal/concern）是否足夠，或某些域需保留三級切分。
