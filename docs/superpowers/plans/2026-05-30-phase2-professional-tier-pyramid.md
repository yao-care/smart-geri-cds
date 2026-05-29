# Phase 2：專業層三層金字塔（triage → screen → full）實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在現有 screen/full 兩層之上新增「大方向 triage 層」——每域 1 題快速分流，全正常即結束（冷啟動約 20 題），亮燈才逐層展開 screen→full，並讓譫妄 4AT 一律施測（always-run，不被 triage 守門）。

**Architecture:** 三層分流純函式化於 `tiering.ts`（`selectTriageScales`、`selectAlwaysRunScreens`、共用 `expandFlagged` helper 衍生 `expandedScreenScales`/`expandedFullScales`）。新增 19 個 `tier:'triage'` 量表 YAML（排除 delirium——4AT 改 `alwaysRun:true` 直接施測），每個 1 題、`expandsTo` 指向對應 screen。`QuestionnaireModule.svelte` 的 tier 狀態由二值擴為三值，展開邏輯由「screen→full 一段」改為「triage→screen→full 兩段」。計分與結果頁不變。

**Tech Stack:** Astro 5 Content Layer（`src/content.config.ts` Zod schema）+ Svelte 5 runes、TypeScript strict（禁 `any`）、vitest（`tests/**/*.test.ts`，jsdom，`@testing-library/svelte`）、量表 YAML（`src/data/scales/`）。

設計來源：`docs/superpowers/specs/2026-05-29-dual-track-self-check-and-triage-redesign.md` §A（大方向層題庫）、§B（三層分層引擎、always-run）。

---

## 已定案的設計決策（spec §B 留待 plan 定案者）

1. **triage 量表機制＝方案 A（獨立 YAML）**：新增 19 個 `tier:'triage'` YAML，每個 1 題、`expandsTo` 指向對應 screen。三層鏈：`triage.expandsTo → screen.id`，`screen.expandsTo → full.id`（既有，不變）。理由：架構乾淨、每個可獨立測試、不污染既有 screen YAML。
2. **always-run 機制＝宣告式 YAML 旗標 `alwaysRun?: boolean`**（spec §B 列為首選；與既有 `requiresPatient`/`requiresInformant` 旗標風格一致）。`4at.yaml` 設 `alwaysRun: true` 並維持 `tier:'screen'`。triage 階段同時施測 triage 題 + alwaysRun screen 量表（4AT），4AT 不被任何 triage 題守門。
3. **delirium 無 triage 題**：4AT 既是 always-run，譫妄一律施測，不需大方向守門題（共 19 個 triage 題覆蓋其餘 19 域）。
4. **cognition triage 題用 `ask-either` 記憶大方向題**（非取材 AD8 的 ask-informant 題）：AD8 是知情者題、不適合無條件大方向篩。triage 用「最近記憶/判斷力是否明顯變差？」（向受測者或家屬問），concern → 展開 `cognition-screen`，C-M2 無知情者 AD8↔Mini-Cog 切換仍在 screen 層（既有 `resolveCognitionScreen`）。
5. **展開時對 expanded screens 套用 C-M2**：triage concern 展開的 screen 集合，沿用 `resolveCognitionScreen` 處理 cognition 無知情者 fallback。

---

## 檔案結構

新增：
- `src/data/scales/*-triage.yaml` — 19 個 triage 量表（每域 1 題，見 Task 3 對照表）。
- `tests/scales/triage-tiering.test.ts` — triage 分層引擎單元測試。

修改：
- `src/lib/scales/scale.ts` — `ScaleDef.tier` 三值 + 新增 `alwaysRun?: boolean`（Task 1）。
- `src/content.config.ts:161` — `tier` enum 加 `'triage'` + schema 加 `alwaysRun`（Task 1）。
- `src/lib/scales/load-scales.ts` — `ScaleEntryData.tier` 三值 + `alwaysRun` 透傳（Task 1）。
- `tests/scales/scale-model.test.ts:47` — tier 型別斷言三值（Task 1）。
- `src/lib/scales/tiering.ts` — `selectTriageScales`、`selectAlwaysRunScreens`、`expandFlagged` helper、`expandedScreenScales`（Task 2）。
- `src/data/scales/4at.yaml` — 加 `alwaysRun: true`（Task 3）。
- `tests/data/questionnaire-coverage.test.ts` — 加「每 CFS 至少一 triage 量表」gate（Task 3）。
- `src/components/assess/QuestionnaireModule.svelte` — tier 三值 + 三階段展開（Task 4）。

---

## Task 1：tier 三值 + `alwaysRun` 旗標型別擴展

**問題**：`tier` 目前是 `'screen' | 'full'` 二值（scale.ts:38、content.config.ts:161、load-scales.ts:9、scale-model.test.ts:47），且無 always-run 機制。本 task 擴為三值並新增 `alwaysRun?: boolean`，使 triage 量表與 4AT always-run 旗標合法解析。純型別/schema 擴展，無行為變更。

**Files:**
- Modify: `src/lib/scales/scale.ts`
- Modify: `src/content.config.ts:161`
- Modify: `src/lib/scales/load-scales.ts`
- Modify: `tests/scales/scale-model.test.ts`

- [ ] **Step 1: 更新型別斷言測試（先讓它對齊目標型別 → 失敗）**

In `tests/scales/scale-model.test.ts`，把 tier 型別斷言（約 line 47）：

```typescript
expectTypeOf(def.tier).toEqualTypeOf<'screen' | 'full'>();
```

改為：

```typescript
expectTypeOf(def.tier).toEqualTypeOf<'triage' | 'screen' | 'full'>();
```

在同一 describe 內新增 alwaysRun 型別斷言（緊接 tier 斷言之後）：

```typescript
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

改為（連同新增 `alwaysRun`，置於 `tier` 與 `expandsTo` 之間）：

```typescript
  /** 'triage' = 大方向層（每域 1 題，亮燈展開 screen）；'screen' = 短篩層
   *  （亮燈展開 full）；'full' = 深評層。 */
  tier: 'triage' | 'screen' | 'full';
  /** always-run：無論 triage 結果都一律施測（如譫妄 4AT，C-M1 不守門）。 */
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

- [ ] **Step 5: 透傳 alwaysRun 並擴展 ScaleEntryData**

In `src/lib/scales/load-scales.ts`：

`ScaleEntryData.tier`（line 9）：

```typescript
  tier: 'screen' | 'full';
```

改為（並在其後加 `alwaysRun`）：

```typescript
  tier: 'triage' | 'screen' | 'full';
  alwaysRun?: boolean;
```

`toScaleDefs` 的映射（line 31 `tier: data.tier,` 之後）加一行：

```typescript
    tier: data.tier,
    alwaysRun: data.alwaysRun,
```

- [ ] **Step 6: 跑測試確認通過 + 型別檢查**

Run: `pnpm exec vitest run tests/scales/scale-model.test.ts`
Expected: PASS。

Run: `pnpm check`
Expected: 0 errors（既有 YAML 無 `tier:'triage'` 仍合法；`alwaysRun` optional 不影響既有）。

- [ ] **Step 7: Commit**

```bash
git add src/lib/scales/scale.ts src/content.config.ts src/lib/scales/load-scales.ts tests/scales/scale-model.test.ts
git commit -m "feat(scales): tier 擴為 triage|screen|full 三值 + alwaysRun 旗標

為三層金字塔（triage→screen→full）與 4AT always-run 擴展型別與 schema；
純型別擴展、預設 'screen' 保留既有 YAML 相容、alwaysRun optional 不影響既有。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2：tiering 引擎三層分流

**問題**：`tiering.ts` 目前只有 screen→full 一段（`selectScreenScales`、`expandedFullScales`）。本 task 新增 triage 層選取、always-run screen 選取，並把「亮燈展開」邏輯抽成共用 helper，衍生 `expandedScreenScales`（triage concern → screen）與既有 `expandedFullScales`（行為不變）。

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
      def({ id: '4at', tier: 'screen', alwaysRun: true, applicableCfs: ['cfs5'] }),
      def({ id: 'mood-screen', tier: 'screen', applicableCfs: ['cfs5'] }),
      def({ id: '4at-other', tier: 'screen', alwaysRun: true, applicableCfs: ['cfs9'] }),
    ];
    expect(selectAlwaysRunScreens(all, 'cfs5').map(s => s.id)).toEqual(['4at']);
  });
});

describe('expandedScreenScales (triage concern → screen)', () => {
  it('expands the screen a flagged triage points to via expandsTo', () => {
    const all = [
      def({ id: 'falls-triage', tier: 'triage', expandsTo: 'steadi-falls' }),
      def({ id: 'steadi-falls', tier: 'screen', expandsTo: 'sit-to-stand' }),
    ];
    const out = expandedScreenScales(all, [result('falls-triage', 'monitor')]);
    expect(out.map(s => s.id)).toEqual(['steadi-falls']);
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

In `src/lib/scales/tiering.ts`：

把既有 `expandedFullScales`（line 107-118）整段**替換**為共用 helper + 兩個衍生：

```typescript
/**
 * Given a tier's results, return the next-tier ScaleDef objects to expand into.
 * Only flagged (severity ≥ monitor) results expand, via their scale's `expandsTo`.
 * Results with no matching scale / no `expandsTo` / missing target are skipped.
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

在檔案內（`selectScreenScales` 之後、`WORSE` 之前或之後皆可）新增 triage / always-run 選取：

```typescript
/** Select all tier:'triage' big-picture scales applicable to the given CFS level. */
export function selectTriageScales(all: ScaleDef[], cfs: CfsLevel): ScaleDef[] {
  return all.filter(s => s.tier === 'triage' && s.applicableCfs.includes(cfs));
}

/** Select tier:'screen' scales flagged alwaysRun (e.g. 4AT) applicable to the CFS
 *  level. These run unconditionally in the triage phase, never gated by a triage
 *  result (C-M1: delirium is always assessed). */
export function selectAlwaysRunScreens(all: ScaleDef[], cfs: CfsLevel): ScaleDef[] {
  return all.filter(s => s.tier === 'screen' && s.alwaysRun === true && s.applicableCfs.includes(cfs));
}
```

（`WORSE` 既有於 line 100，保留。既有 `selectScreenScales`/`resolveCognitionScreen`/`applyAvailabilityGate` 不動。）

- [ ] **Step 4: 跑測試確認通過 + 既有 tiering 測試不破**

Run: `pnpm exec vitest run tests/scales/triage-tiering.test.ts tests/scales/tiering.test.ts`
Expected: PASS（新測試全過；既有 `expandedFullScales` 測試因行為等價仍過）。

- [ ] **Step 5: Commit**

```bash
git add src/lib/scales/tiering.ts tests/scales/triage-tiering.test.ts
git commit -m "feat(scales): tiering 三層分流 selectTriageScales/expandedScreenScales/alwaysRun

抽 expandFlagged 共用 helper（tier-agnostic 亮燈展開），衍生 expandedScreenScales
（triage→screen）與既有 expandedFullScales（行為等價）；新增 selectTriageScales、
selectAlwaysRunScreens（4AT 一律施測，不被 triage 守門）。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3：19 個 triage 量表 + 4AT alwaysRun 旗標

**問題**：需為 19 個 BGS 域各建 1 個 `tier:'triage'` 大方向題，亮燈展開對應 screen；4AT 設 `alwaysRun: true`。triage 題取材對應 screen 量表的代表題（cognition 例外，見決策 4），band 簡化為 normal / concern(→monitor)。

**取材規則（每個 triage YAML 一致）：**
- `id: <sub>-triage`、`tier: triage`、`domain` 同對應 screen、`applicableCfs` 同對應 screen、`expandsTo: <screen id>`、`scoring: sum`、`inputType: option`、`clinicallyReviewed: false`。
- **單一 item**：複製對應 screen「代表 item」的 `prompt`/`text`/`mode`，options 簡化為二元（最佳選項 `score: 0`、其餘任一陽性 `score: 1`）。
- `maxScore: 1`。
- **bands**：`{ min: 0, max: 0, severity: normal, label: <正常語> }` + `{ min: 1, max: 1, severity: monitor, label: 建議進一步短篩 }`（triage 只分 normal/concern；concern=monitor 即觸發 `expandedScreenScales`）。

- [ ] **Step 1: 4AT 設 alwaysRun**

In `src/data/scales/4at.yaml`，在 `tier: screen` 行下方加：

```yaml
tier: screen
alwaysRun: true
```

（4AT 維持 tier:screen；alwaysRun 使其在 triage 階段一律施測、不被守門。其 `applicableCfs: [cfs4..cfs9]` 不變。）

- [ ] **Step 2: 建立 triage 量表範本（falls，完整範例）**

Create `src/data/scales/falls-triage.yaml`（取材 `steadi-falls` 的代表題 `steadi_fell`）:

```yaml
# 大方向 triage 題（tier: triage）。取材 steadi-falls 代表題「過去一年是否跌倒」。
# concern → 展開 steadi-falls 短篩（screen），其再亮燈展開 sit-to-stand 深評。
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

- [ ] **Step 3: 依對照表建立其餘 18 個 triage YAML**

對每列建 `src/data/scales/<id>.yaml`，套用上方範本與「取材規則」。`mode`/`prompt`/`text` 取材自「代表 item」欄（去對應 screen YAML 複製該題文字，二元化 options）。`applicableCfs` 複製對應 screen。

| triage id | domain top.sub | applicableCfs（同 screen） | expandsTo (screen) | 代表 item（取材來源 screen） | mode | 大方向題（text） |
|---|---|---|---|---|---|---|
| `comorbidity-triage` | physical.comorbidity | cfs2–9 | `comorbidity-screen` | comorbidity-screen 慢病數題 | ask-either | 是否有長期治療中的慢性疾病（如高血壓、糖尿病、心臟病等）？ |
| `polypharmacy-triage` | physical.polypharmacy | cfs2–9 | `polypharmacy` | polypharmacy 用藥數題 | ask-either | 每天是否規律服用 5 種以上處方藥？ |
| `nutrition-triage` | physical.nutrition | cfs1–9 | `nutrition-screen` | nutrition-screen 食慾/體重題 | ask-either | 最近是否食慾變差或體重明顯減輕？ |
| `continence-triage` | physical.continence | cfs3–9 | `continence-screen` | continence-screen 漏尿題 | ask-either | 是否曾有非自主漏尿或排尿困擾？ |
| `sensory-triage` | physical.sensory | cfs1–9 | `sensory-screen` | sensory-screen 視/聽題 | ask-either | 視力或聽力是否影響日常生活？ |
| `pain-triage` | physical.pain | cfs1–9 | `pain-screen` | pain-screen NRS 題 | ask-either | 最近是否有讓您困擾的疼痛？ |
| `cognition-triage` | psychological.cognition | cfs1–8 | `cognition-screen` | （決策 4：不取材 AD8，用記憶大方向題） | ask-either | 最近記憶力或判斷力是否比以前明顯變差？ |
| `mood-triage` | psychological.mood | cfs1–7 | `mood-screen` | mood-screen PHQ-2 核心題 | ask-either | 最近兩週是否常感到情緒低落，或做事提不起勁？ |
| `adl-triage` | functional.adl | cfs3–9 | `adl-screen` | adl-screen 自我照顧題 | ask-either | 洗澡、穿衣、如廁等基本自我照顧是否需要他人協助？ |
| `iadl-triage` | functional.iadl | cfs3–9 | `iadl-screen` | iadl-screen 工具性日常題 | ask-either | 購物、備餐、用藥或理財等事務是否需要協助？ |
| `mobility-triage` | functional.mobility | cfs7 | `mobility-screen` | mobility-screen 行走題 | ask-either | 平地行走或起身是否感到困難？ |
| `social-support-triage` | social.social_support | cfs2–9 | `social-support-screen` | social-support-screen 聯絡題 | ask-either | 是否覺得孤立，或缺少可求助的家人/朋友？ |
| `caregiver-triage` | social.caregiver | cfs4–9 | `caregiver-screen` | caregiver-screen 負荷題（requiresInformant） | ask-informant | （向照顧者）照顧這位長者是否讓您感到沉重負擔？ |
| `financial-triage` | social.financial | cfs3–9 | `financial-screen` | financial-screen 收入題 | ask-either | 目前收入是否足以支應日常生活與醫療開銷？ |
| `home-safety-triage` | environmental.home_safety | cfs3–8 | `home-safety` | home-safety 居家危險題 | ask-either | 居家環境是否有讓您擔心跌倒或受傷的地方？ |
| `accessibility-triage` | environmental.accessibility | cfs4–9 | `accessibility-screen` | accessibility-screen 輔具題 | ask-either | 是否有需要但尚未取得的輔具，或外出有困難？ |
| `acp-triage` | future_wishes.advance_care_planning | cfs5–9 | `acp-status` | acp-status 簽署題 | ask-either | 是否想了解或討論預立醫療照護的相關安排？ |
| `treatment-pref-triage` | future_wishes.treatment_preferences | cfs5–9 | `treatment-pref` | treatment-pref 意願題 | ask-either | 是否想表達對未來醫療處置（如急救）的偏好？ |

**特例註記（寫入各 YAML comment）：**
- `cognition-triage`：`mode: ask-either`，不取材 AD8（ask-informant）；concern → 展開 `cognition-screen`，無知情者時 screen 層由 `resolveCognitionScreen` 切換 Mini-Cog（C-M2，既有）。
- `caregiver-triage`：`mode: ask-informant` + `requiresInformant: true`（對象是照顧者；無知情者 → 由 availability gate 標 incomplete，不展開）。在此 YAML 加 `requiresInformant: true`。

- [ ] **Step 4: coverage 測試 gate**

In `tests/data/questionnaire-coverage.test.ts`，仿照既有「每 CFS 至少一 screen」測試（約 line 85-90），新增：

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
```

（`scales`、`CFS_LEVELS` 沿用該測試檔既有的 YAML 載入與常數匯入方式。）

- [ ] **Step 5: 跑測試 + build（Content Layer 驗證 triage YAML）**

Run: `pnpm exec vitest run tests/data/questionnaire-coverage.test.ts`
Expected: PASS（19 triage 覆蓋所有 CFS；expandsTo 皆指向既有 screen）。

Run: `pnpm build 2>&1 | tail -5`
Expected: 成功（Content Layer Zod 驗證通過 19 個新 triage YAML）。

- [ ] **Step 6: Commit**

```bash
git add src/data/scales/
git commit -m "feat(scales): 19 個 triage 大方向題 + 4AT alwaysRun

每域 1 題、取材對應 screen 代表題（cognition 用 ask-either 記憶題、非 AD8）、
expandsTo 指向 screen、band 二分 normal/concern；4AT alwaysRun:true 一律施測。
coverage 測試 gate：每 CFS ≥1 triage、triage.expandsTo 皆為合法 screen。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4：QuestionnaireModule 三階段展開 UI

**問題**：`QuestionnaireModule.svelte` 目前 tier 為 `'screen' | 'full'` 二值、一開始施測所有 screen、亮燈展開 full（一段）。改為：起始 `'triage'`、施測 triage 題 + alwaysRun screen（4AT）、triage concern 展開對應 screen、screen 亮燈再展開 full（兩段）。計分/結果頁不變。

**設計（三階段累加）：**
- 階段 `'triage'`：`triageScales` + `alwaysRunScreenScales`(4AT)。
- 階段 `'screen'`：+ `expandedScreens`（triage concern 展開，經 C-M2）。
- 階段 `'full'`：+ `expandedFulls`（screen flag 展開）。

**Files:**
- Modify: `src/components/assess/QuestionnaireModule.svelte`
- Test: `tests/components/QuestionnaireModule.test.ts`

- [ ] **Step 1: 寫失敗測試（三階段展開行為）**

In `tests/components/QuestionnaireModule.test.ts`，新增（沿用該檔既有 `clickOption`、`makeChild`、`makeAssessment`、store 設定慣例；fixture scale 用該檔既有風格）：

```typescript
it('triage normal → does NOT expand into the domain screen', async () => {
  assessmentStore.child = makeChild();
  assessmentStore.assessment = makeAssessment();
  assessmentStore.informantAvailable = true;
  assessmentStore.patientAble = true;
  assessmentStore.cfsLevel = 'cfs5';
  // fallsTriage(expandsTo fallsScreen) + fallsScreen + fallsFull
  render(QuestionnaireModule, { scales: [fallsTriage, fallsScreen, fallsFull] });
  // triage 題答「否」(normal) → 不展開 screen
  await clickOption('否');
  await waitFor(() => expect(screen.getByText(/已完成|評估結果|沒有/)).toBeInTheDocument());
  expect(screen.queryByText('FALLS_SCREEN_Q')).toBeNull();
});

it('triage concern → expands the screen; screen flag → expands full', async () => {
  assessmentStore.child = makeChild();
  assessmentStore.assessment = makeAssessment();
  assessmentStore.informantAvailable = true;
  assessmentStore.patientAble = true;
  assessmentStore.cfsLevel = 'cfs5';
  render(QuestionnaireModule, { scales: [fallsTriage, fallsScreen, fallsFull] });
  await clickOption('是');                                   // triage concern
  await waitFor(() => expect(screen.getByText('FALLS_SCREEN_Q')).toBeInTheDocument());
  await clickOption('是');                                   // screen flag
  await waitFor(() => expect(screen.getByText('FALLS_FULL_Q')).toBeInTheDocument());
});

it('alwaysRun screen (4AT-like) is asked in the triage phase regardless of triage results', async () => {
  assessmentStore.child = makeChild();
  assessmentStore.assessment = makeAssessment();
  assessmentStore.informantAvailable = true;
  assessmentStore.patientAble = true;
  assessmentStore.cfsLevel = 'cfs5';
  render(QuestionnaireModule, { scales: [fallsTriage, alwaysRunScreen] });
  // alwaysRunScreen 的題目應在 triage 階段即出現（不需任何 triage concern）
  await waitFor(() => expect(screen.getByText('ALWAYS_RUN_Q')).toBeInTheDocument());
});
```

在該檔測試頂部新增 fixture（沿用既有 `ScaleDef` fixture 風格）：

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
  id: 'falls-screen', domain: { top: 'functional', sub: 'falls' }, tier: 'screen',
  expandsTo: 'falls-full', applicableCfs: ['cfs5'], scoring: 'sum', inputType: 'option', maxScore: 1,
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

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm exec vitest run tests/components/QuestionnaireModule.test.ts -t "triage"`
Expected: FAIL — 目前無 triage 階段（一開始就出所有 screen，triage 題不被特別處理）。

- [ ] **Step 3: 改 import + tier 狀態三值**

In `src/components/assess/QuestionnaireModule.svelte`：

import 區（既有 `selectScreenScales, expandedFullScales` 那行）加入新函式：

```typescript
import {
  selectScreenScales, selectTriageScales, selectAlwaysRunScreens,
  expandedScreenScales, expandedFullScales, resolveCognitionScreen,
  applyAvailabilityGate,
} from '../../lib/scales/tiering';
```

（保留既有自該模組的其他 import；`resolveCognitionScreen`/`applyAvailabilityGate` 若已 import 則勿重複。）

tier 狀態（line 31）：

```typescript
let tier = $state<'screen' | 'full'>('screen');
```

改為：

```typescript
let tier = $state<'triage' | 'screen' | 'full'>('triage');
```

- [ ] **Step 4: 新增 triage / always-run / expandedScreens 衍生狀態**

在 `screenScales`（line 43-45）**之前**插入 triage 與 always-run 衍生：

```typescript
/** Tier-0 大方向題（每域 1 題）。 */
const triageScales = $derived<ScaleDef[]>(cfsLevel ? selectTriageScales(scales, cfsLevel) : []);
/** always-run screen（如 4AT）：triage 階段一律施測，不被守門（C-M1）。 */
const alwaysRunScreens = $derived<ScaleDef[]>(cfsLevel ? selectAlwaysRunScreens(scales, cfsLevel) : []);
```

把既有 `screenScales`（line 43-45）由「一開始全選」改為「triage concern 展開 + always-run」。將其改為 `$state` 並由展開填充（與 `fullScales` 同模式）：

```typescript
/** Tier-1 screen scales — populated by expandTriageTier() from flagged triage
 *  results (via expandsTo, C-M2 cognition fallback applied), PLUS the always-run
 *  screens which are present from the triage phase onward. Empty until expansion. */
let expandedScreens = $state<ScaleDef[]>([]);
const screenScales = $derived<ScaleDef[]>([...alwaysRunScreens, ...expandedScreens]);
```

（刪除原 `screenScales` 的 `selectScreenScales(...)` derived；`selectScreenScales`/`resolveCognitionScreen` 改於 `expandTriageTier` 內使用——見 Step 6。）

- [ ] **Step 5: activeOptionScales / timed 三階段累加**

`screenTimedScales`/`fullTimedScales`/`timedScales`（line 54-56）前加 triage timed（triage 題皆 option，無 timed，但為一致性與 always-run 可能的 timed）：

```typescript
const triageTimedScales = $derived<ScaleDef[]>(triageScales.filter(s => s.inputType === 'timed-task'));
```

`activeOptionScales`（line 64-66）：

```typescript
const activeOptionScales = $derived<ScaleDef[]>(
  tier === 'screen' ? screenOptionScales : [...screenOptionScales, ...fullOptionScales],
);
```

改為三階段累加（triage 題 + 各階段已展開者）：

```typescript
const triageOptionScales = $derived<ScaleDef[]>(triageScales.filter(s => s.inputType !== 'timed-task'));
const activeOptionScales = $derived<ScaleDef[]>(
  tier === 'triage'
    ? [...triageOptionScales, ...screenOptionScales]                          // triage + always-run screens
    : tier === 'screen'
      ? [...triageOptionScales, ...screenOptionScales]                        // + expanded screens (in screenScales)
      : [...triageOptionScales, ...screenOptionScales, ...fullOptionScales],  // + expanded fulls
);
```

（`screenOptionScales` 既有 derived 自 `screenScales`；因 `screenScales` 現含 alwaysRun + expandedScreens，triage 階段它只有 alwaysRun screens、screen 階段含 expanded screens。`fullOptionScales` 不變。）

- [ ] **Step 6: 展開邏輯 — expandTriageTier + 改寫 expandTier/maybeAdvanceTier/advanceAfterItem**

新增 `expandTriageTier()`（在 `expandTier` 之前）：

```typescript
/** Compute triage results (option + any stored timed) → resolve which screens to
 *  expand into (via expandsTo), apply C-M2 cognition fallback + availability gate,
 *  set expandedScreens, flip tier→'screen'. Returns the expanded screens. */
function expandTriageTier(): ScaleDef[] {
  const triageResults: ScaleResult[] = [];
  for (const s of triageOptionScales) {
    const r = computeGatedResult(s);
    if (r) triageResults.push(r);
  }
  const targets = expandedScreenScales(scales, triageResults);
  // C-M2: a flagged cognition triage expands to AD8; with no informant, swap to Mini-Cog.
  const resolved = resolveCognitionScreen(targets, informantAvailable ?? true, scales)
    .filter(s => cfsLevel && s.applicableCfs.includes(cfsLevel));
  expandedScreens = resolved;
  tier = 'screen';
  return resolved;
}
```

改 `expandTier()`（line 426-441）— 它現在從 `screenScales`（alwaysRun + expandedScreens）算 screen 結果並展開 full：

```typescript
function expandTier(): ScaleDef[] {
  const screenResults: ScaleResult[] = [];
  for (const s of screenOptionScales) {
    const r = computeGatedResult(s);
    if (r) screenResults.push(r);
  }
  const stored = assessmentStore.partialAnalysis.scaleResults ?? {};
  for (const s of screenTimedScales) {
    if (stored[s.id]) screenResults.push(stored[s.id]);
  }
  const expanded = expandedFullScales(scales, screenResults);
  fullScales = expanded;
  tier = 'full';
  return expanded;
}
```

（`expandTier` body 大致不變——`screenOptionScales`/`screenTimedScales` 現衍生自含 alwaysRun+expanded 的 `screenScales`，語意正確：screen 階段所有已出題的 screen 都被計分並嘗試展開 full。）

改 `advanceAfterItem()`（line 383-388）的 tier 收尾：

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

新增 `maybeAdvanceFromTriage()`（在 `maybeAdvanceTier` 之前），鏡像 `maybeAdvanceTier` 的 timed/asking/summary 處理，但用 `expandTriageTier` 並在無展開時直接進 screen 收尾（screen 集合 = alwaysRun，仍可能需展 full）：

```typescript
/** All triage + always-run-screen questions resolved → expand flagged screens.
 *  If new screen questions appeared, keep asking; else fall through to the
 *  screen→full boundary (always-run screens may still expand a full scale). */
function maybeAdvanceFromTriage(): void {
  const expandedScreensNow = expandTriageTier();
  const expandedTimed = expandedScreensNow.filter(s => s.inputType === 'timed-task');
  const stored = assessmentStore.partialAnalysis.scaleResults ?? {};
  const hasUnfinishedTimed = expandedTimed.some(s => !stored[s.id]);
  if (hasUnfinishedTimed) {
    const allTimed = [...triageTimedScales, ...screenTimedScales];
    const idx = allTimed.findIndex(s => !stored[s.id]);
    timedIndex = idx === -1 ? allTimed.length : idx;
    phase = 'timed';
    return;
  }
  const firstScreen = questions.findIndex(q => answers[q.item.id] === undefined && !unavailableScales.has(q.scaleId));
  if (firstScreen !== -1) {
    currentIndex = firstScreen;
    phase = 'asking';
  } else {
    // No screen questions to ask (no concern + no always-run option items left) →
    // still try the screen→full expansion (always-run screen results may flag).
    maybeAdvanceTier();
  }
}
```

（`maybeAdvanceTier`/`expandTier` 既有結構保留；`computeGatedResult`、`persistScoresToStore`、`questions`、`currentIndex` 等既有不動。`tier === 'full'` 的 summary 收尾不變。）

- [ ] **Step 7: 進度提示加 tier 階段標示（可讀性）**

進度文字（約 line 531 `第 {currentIndex + 1} 題，共 {totalQuestions} 題`）前加 tier 標籤：

```svelte
<span class="tier-label">{tier === 'triage' ? '大方向' : tier === 'screen' ? '短篩' : '深評'}</span>
第 {currentIndex + 1} 題，共 {totalQuestions} 題
```

在 `<style>` 加：

```css
.tier-label { font-size: var(--text-sm); font-weight: var(--font-bold); color: var(--accent); margin-right: var(--space-2); }
```

- [ ] **Step 8: 跑測試確認通過 + 既有問卷測試不破**

Run: `pnpm exec vitest run tests/components/QuestionnaireModule.test.ts tests/components/QuestionnaireFlow.test.ts`
Expected: PASS。**注意**：既有測試若假設「一開始就出所有 screen 題」，現在改為 triage 先行——這類既有測試需更新為先答 triage concern 才出 screen。逐一修正失配的既有斷言（與 Phase 1 同樣「改測試對齊新流程」原則），不得放寬測試意圖。

- [ ] **Step 9: 全測試 + check + lint**

Run: `pnpm test`
Expected: PASS（總數＝既有基線 + 新增 triage-tiering、coverage、QuestionnaireModule 三階段測試）。

Run: `pnpm check` → 0 errors。
Run: `pnpm lint` → 0 errors（warning 不增加）。

- [ ] **Step 10: Commit**

```bash
git add src/components/assess/QuestionnaireModule.svelte tests/components/QuestionnaireModule.test.ts
git commit -m "feat(assess): QuestionnaireModule 三階段展開 triage→screen→full

tier 擴為三值（起始 triage）；triage 題 + alwaysRun screen(4AT) 先施測，
triage concern 經 expandedScreenScales+C-M2 展開 screen，screen 亮燈再展 full。
進度提示加 tier 階段標籤。冷啟動全正常 → 約 20 題結束。

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5：端到端目視驗證（playwright，本機 preview）

**目的**：spec 教訓——抽象測試通過不代表真實流程正確；需真的走完三階段（Phase 1 端到端揭露 each_key_duplicate 的前車之鑑）。

- [ ] **Step 1: build + preview**

Run: `pnpm build && pnpm preview --port 4321 &`
Expected: build 成功（Content Layer 驗證 19 triage YAML）、preview 起在 4321。

- [ ] **Step 2: 個案 A — 冷啟動全正常（最短路徑）**

playwright 開 `http://localhost:4321/assess/`，cfs5 / informant=是 / patientAble=是，所有 triage 題答最佳選項 + 4AT 答正常。確認：
- 題數約 20（19 triage 多為 1 題 + 4AT 4 題），**不展開任何 screen**。
- 直達結果頁，console 無錯誤（特別是 `each_key_duplicate`）。

- [ ] **Step 3: 個案 B — 單域亮燈展開**

重開新評估 cfs5，僅「跌倒」triage 答「是」（concern），其餘正常。確認：
- 答跌倒 triage「是」後，**出現跌倒 screen 題**（steadi-falls）；screen 亮燈後出現 sit-to-stand 深評。
- 其他域 triage 正常 → 不展開。
- 4AT（always-run）無論如何都出題。
- 結果頁長條圖：falls 域有對應 severity，其餘正常。console 無錯。

- [ ] **Step 4: 收掉 preview，回報目視結果**

Run: 結束背景 preview。若有問題回對應 Task 修正。

---

## Self-Review（計畫對照 spec）

- **§A 大方向層題庫（每域 1 題、取自 screen 代表題、clinicallyReviewed:false）** → Task 3（19 triage YAML + 取材對照表）✅
- **§B tier 三值 + triage→screen 分流** → Task 1（型別）+ Task 2（tiering）✅
- **§B always-run 安全領域（4AT 不被守門）** → Task 1（alwaysRun 旗標）+ Task 2（selectAlwaysRunScreens）+ Task 3（4at.yaml）+ Task 4（triage 階段施測）✅
- **§B 冷啟動最短路徑（全正常約 18-20 題）** → Task 4 + Task 5 個案 A 驗證 ✅
- **§B UI 三階段展開** → Task 4 ✅
- **§B cognition C-M2 仍生效** → 決策 5 + Task 4 expandTriageTier 套 resolveCognitionScreen ✅
- 型別一致：`tier` 三值跨 scale.ts/schema/load-scales/QuestionnaireModule 一致；`expandedScreenScales`/`expandedFullScales` 同共用 `expandFlagged`；`selectTriageScales`/`selectAlwaysRunScreens` 簽名 `(all, cfs)`。
- 無 placeholder：型別/tiering/測試含完整 code；19 triage YAML 以「完整範本 + 完整對照表 + 取材規則」表達（DRY；每域 screen/item/cfs/band 精確指定）。
- 範圍：Phase 2 僅專業層三層金字塔，不觸自評層（Phase 3）、不改計分/結果頁。

## 待 review 重點（給審查者）

1. triage 題的 band 二分（normal/concern）是否足夠，或某些域需保留 screen 代表題的三級切分。
2. `cognition-triage` 用 ask-either 記憶題（非 AD8）的臨床妥適性；`caregiver-triage` requiresInformant 的 incomplete 行為。
3. Task 4 三階段狀態機重構（`maybeAdvanceFromTriage` → `maybeAdvanceTier` 串接、always-run screen 在 triage 階段與 screen 階段的計分時機）是否有 timed-task（sit-to-stand）邊界遺漏。
4. 既有 QuestionnaireModule/Flow 測試需配合「triage 先行」更新的範圍。
5. triage 題集（19 域）的 `applicableCfs` 是否與對應 screen 完全一致為正確設計（低 CFS 某些域不適用）。
