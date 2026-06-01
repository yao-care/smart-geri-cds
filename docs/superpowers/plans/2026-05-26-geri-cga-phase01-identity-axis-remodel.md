# Geri CGA — Phase 0+1（識別 + 軸/引擎/schema 重模）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把老年醫學 CDS 的「年齡帶」核心軸整個換成 CFS 1-9 + 二層 BGS 領域 + per-scale 計分，移除感測模組，修正全部消費端與測試，得到 `pnpm check/lint/test/build` 全綠、可部署為 `smart-geri-cds` 的骨架。

**Architecture:** 雙軸模型（CFS 等級 × 二層領域 `top.sub`）。CFS 進入評估時由臨床判定（gate 型），持久化於 `Assessment.cfsLevel`。計分改為 data-driven 量表 cutoff（`scoreScale`），整體分流「取最嚴重領域」。trigger 文法 `cga.domain.<top>.<sub>.anomaly.<cfs>`。詳見 spec `docs/superpowers/specs/2026-05-26-geri-cga-axis-redesign-design.md`（含全消費端清單、各層去留、測試守門）。

**Tech Stack:** Astro 6 + Svelte 5 runes + Dexie + Zod(astro/zod) + Vitest + TypeScript strict。

**權威參考：** 本計畫的「受影響檔案總表」「各層去留」「測試守門」以 spec 為準；本計畫提供執行順序、新模組完整程式碼、與引擎 TDD。每個 Task 結束須 `pnpm check` 不可新增錯誤（容許因尚未改到的消費端暫時紅，於該 Phase 末轉綠）。

---

## 檔案結構（新增/重構）

- 新增 `src/lib/utils/cfs-levels.ts`（取代 `age-groups.ts`：CFS 常數/標籤/描述 + `ageInMonths` 保留供顯示）
- 新增 `src/lib/domain/domain-tree.ts`（`DOMAIN_TREE` 單一源 + 標籤 + 驗證 + `Severity`）
- 新增 `src/lib/scales/scale.ts`（`ScaleDef` 型別 + `scoreScale` + `aggregateSeverity`）
- 新增 `src/data/scales/`（Content Collection，Phase 1 先放 1 個煙霧測試用量表，內容歸 Plan 2）
- 重構 `src/engine/cdsa/triage.ts`、`radar-scoring.ts`、`assessment-analyzer.ts`
- 重構 `src/lib/education/{schemas.ts,trigger-derivation.ts,matrix-data.ts,cfs-fallback.ts(原 age-fallback),video-lookup.ts}`
- 重構 `scripts/{build-content-index.ts,build-questionnaire-applicability.ts}`
- 重構 `src/lib/db/{schema.ts,recommendations.ts,assessments.ts}`、`src/lib/stores/assessment.svelte.ts`
- 重構 `src/lib/fhir/cdsa-resources.ts → cga-resources.ts`
- 重構結果頁 `ResultView/ResultViewWrapper/ResultDetail`、`RadarChart`、`EducationMatch`、`ChildProfile→SubjectProfile`、`AssessmentShell`、`WorkspaceShell`
- 刪除 `src/engine/cdsa/{gross-motor-analysis,drawing-analysis,voice-analysis,behavior-analysis}.ts`、`src/components/assess/{GameModule,VoiceModule,VideoModule,DrawingModule}.svelte`、`src/engine/cdsa/card-selector.ts`

---

## Phase 0 — 專案識別改名（mechanical，build 應維持綠）

### Task 0.1: package.json
**Files:** Modify `package.json:2,5`
- [ ] 將 `"name": "cdss-geriatric"` → `"name": "smart-geri-cds"`；`"description"` 改為「開源高齡周全性評估決策系統 — SMART on FHIR 瀏覽器端 CDS」。
- [ ] Run `pnpm install --frozen-lockfile`（確認 lockfile 不因 name 變動而壞）。Expected: OK。
- [ ] Commit: `git add package.json && git commit -m "chore(geri): package name → smart-geri-cds"`

### Task 0.2: 網域與自訂網域
**Files:** Modify `astro.config.mjs:11`, `public/CNAME`
- [ ] `astro.config.mjs:11` `site: 'https://smart-geri-cds.yao.care'` → `'https://smart-geri-cds.yao.care'`
- [ ] `public/CNAME` 內容 `smart-geri-cds.yao.care` → `smart-geri-cds.yao.care`
- [ ] Commit: `git commit -am "chore(geri): site + CNAME → smart-geri-cds.yao.care"`

### Task 0.3: deploy.yml lychee --base
**Files:** Modify `.github/workflows/deploy.yml:34`
- [ ] 將 `--base https://smart-geri-cds.yao.care/` → `--base https://smart-geri-cds.yao.care/`（注意：這是 lychee link-check 參數，非 Pagefind）。
- [ ] Commit: `git commit -am "ci(geri): lychee base url → geri"`

### Task 0.4: PWA manifest + 站名/文案（最小 rebrand）
**Files:** Modify `scripts/templates/manifest.template.json`、`src/layouts/Base.astro`、`src/layouts/Assess.astro`、`src/components/blocks/Header.astro`
- [ ] manifest `name`/`short_name` → 「高齡周全性評估」。
- [ ] Base.astro 站名後綴、Assess.astro description+標題、Header.astro 導覽站名：將「長者發展智慧評估/長者發展評估」→「高齡周全性評估」。
- [ ] Run `pnpm build`（確認 manifest/SW 生成不壞）。Expected: build 成功。
- [ ] Commit: `git commit -am "feat(geri): rebrand 站名/PWA → 高齡周全性評估"`

### Task 0.5: IndexedDB DB 名
**Files:** Modify `src/lib/db/schema.ts`（Dexie `new Dexie('cdss-geriatric')` 字串）
- [ ] 找到 DB 名字串 `cdss-geriatric` → `smart-geri-cds`。（全新 DB，無遷移；既有 version 鏈在新 DB 名下視為新建。）
- [ ] Run `pnpm check`。Expected: 無新錯誤。
- [ ] Commit: `git commit -am "feat(geri): IndexedDB DB 名 → smart-geri-cds"`

> Phase 0 完成後 `pnpm build` 應仍綠（純字串）。若有測試斷言舊站名字串，於 Phase 1 測試重寫時一併處理。

---

## Phase 1 — 軸/領域/計分/消費端/測試 重模

### Task 1.1: CFS 常數模組（TDD）
**Files:** Create `src/lib/utils/cfs-levels.ts`, Test `tests/utils/cfs-levels.test.ts`；之後刪 `age-groups.ts`

- [ ] **Step 1: 寫測試** `tests/utils/cfs-levels.test.ts`：
```ts
import { describe, it, expect } from 'vitest';
import { CFS_LEVELS, CFS_LABELS, cfsFromScore, ageInMonths } from '$lib/utils/cfs-levels';

describe('cfs-levels', () => {
  it('has 9 levels cfs1..cfs9', () => {
    expect(CFS_LEVELS).toEqual(['cfs1','cfs2','cfs3','cfs4','cfs5','cfs6','cfs7','cfs8','cfs9']);
  });
  it('labels every level', () => {
    for (const l of CFS_LEVELS) expect(CFS_LABELS[l]).toBeTruthy();
  });
  it('cfsFromScore maps 1..9 and clamps', () => {
    expect(cfsFromScore(1)).toBe('cfs1');
    expect(cfsFromScore(9)).toBe('cfs9');
    expect(cfsFromScore(0)).toBe('cfs1');
    expect(cfsFromScore(99)).toBe('cfs9');
  });
  it('ageInMonths returns 0 for missing birthDate', () => {
    expect(ageInMonths(undefined)).toBe(0);
  });
});
```
- [ ] **Step 2: Run** `pnpm vitest run tests/utils/cfs-levels.test.ts` → FAIL（module 不存在）。
- [ ] **Step 3: 實作** `src/lib/utils/cfs-levels.ts`：
```ts
export const CFS_LEVELS = [
  'cfs1','cfs2','cfs3','cfs4','cfs5','cfs6','cfs7','cfs8','cfs9',
] as const;
export type CfsLevel = typeof CFS_LEVELS[number];

export const CFS_LABELS: Record<CfsLevel, string> = {
  cfs1: '非常健壯', cfs2: '健壯', cfs3: '大致良好',
  cfs4: '極輕度衰弱', cfs5: '輕度衰弱', cfs6: '中度衰弱',
  cfs7: '重度衰弱', cfs8: '極重度衰弱', cfs9: '末期',
};

/** 臨床判定用的較長描述（暫譯，clinicallyReviewed 待臨床確認） */
export const CFS_DESCRIPTIONS: Record<CfsLevel, string> = {
  cfs1: '規律運動，為同齡中最健壯者。',
  cfs2: '無活動性疾病症狀，偶爾運動。',
  cfs3: '健康問題控制良好，僅規律散步以外少運動。',
  cfs4: '症狀使活動受限，但尚能獨立（極輕度衰弱）。',
  cfs5: '工具性日常活動需協助（輕度衰弱）。',
  cfs6: '所有戶外活動與部分居家活動需協助（中度衰弱）。',
  cfs7: '個人照護完全依賴，但病情穩定（重度衰弱）。',
  cfs8: '完全依賴，接近生命終點（極重度衰弱）。',
  cfs9: '預期壽命 < 6 個月（末期）。',
};

/** 由 1..9 整數得 CFS 代碼，超界 clamp。 */
export function cfsFromScore(n: number): CfsLevel {
  const i = Math.min(9, Math.max(1, Math.round(n)));
  return (`cfs${i}`) as CfsLevel;
}

/** 月齡（DOB 選填；缺值回 0，供顯示用，呼叫端自行處理 0 的呈現）。 */
export function ageInMonths(birthDate: string | Date | undefined | null): number {
  if (!birthDate) return 0;
  const birth = typeof birthDate === 'string' ? new Date(birthDate) : birthDate;
  if (isNaN(birth.getTime())) return 0;
  const now = new Date();
  const months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
  const dayAdjust = now.getDate() < birth.getDate() ? -1 : 0;
  return Math.max(0, months + dayAdjust);
}
```
- [ ] **Step 4: Run** 同上 → PASS。
- [ ] **Step 5: Commit** `git add src/lib/utils/cfs-levels.ts tests/utils/cfs-levels.test.ts && git commit -m "feat(geri): CFS levels module (TDD)"`

### Task 1.2: 領域樹單一源（TDD）
**Files:** Create `src/lib/domain/domain-tree.ts`, Test `tests/domain/domain-tree.test.ts`
- [ ] **Step 1: 測試**：
```ts
import { describe, it, expect } from 'vitest';
import { DOMAIN_TREE, DOMAIN_TOPS, isValidDomain, domainLabel } from '$lib/domain/domain-tree';
describe('domain-tree', () => {
  it('has 6 tops', () => expect(DOMAIN_TOPS.length).toBe(6));
  it('validates legal combos', () => {
    expect(isValidDomain('psychological','cognition')).toBe(true);
    expect(isValidDomain('psychological','adl')).toBe(false);
    expect(isValidDomain('nope','x')).toBe(false);
  });
  it('labels top.sub', () => expect(domainLabel('psychological','cognition')).toContain('認知'));
});
```
- [ ] **Step 2: Run** → FAIL。
- [ ] **Step 3: 實作** `src/lib/domain/domain-tree.ts`：
```ts
export const DOMAIN_TREE = {
  physical: ['comorbidity','polypharmacy','nutrition','continence','sensory'],
  psychological: ['cognition','mood','delirium'],
  functional: ['adl','iadl','mobility','falls'],
  social: ['social_support','caregiver','financial'],
  environmental: ['home_safety','accessibility'],
  future_wishes: ['advance_care_planning','treatment_preferences'],
} as const;

export type DomainTop = keyof typeof DOMAIN_TREE;
export type DomainSub = typeof DOMAIN_TREE[DomainTop][number];
export const DOMAIN_TOPS = Object.keys(DOMAIN_TREE) as DomainTop[];
export const DOMAIN_SUBS = DOMAIN_TOPS.flatMap(t => DOMAIN_TREE[t]) as DomainSub[];

export function isValidDomain(top: string, sub: string): top is DomainTop {
  return top in DOMAIN_TREE && (DOMAIN_TREE[top as DomainTop] as readonly string[]).includes(sub);
}

export const DOMAIN_TOP_LABELS: Record<DomainTop, string> = {
  physical: '生理/醫療', psychological: '心理/精神', functional: '功能',
  social: '社會', environmental: '環境', future_wishes: '預立醫療',
};
const SUB_LABELS: Record<string, string> = {
  comorbidity:'多重共病', polypharmacy:'多重用藥', nutrition:'營養', continence:'失禁', sensory:'感官(視/聽)',
  cognition:'認知', mood:'情緒', delirium:'譫妄',
  adl:'基本日常', iadl:'工具性日常', mobility:'行動步態', falls:'平衡跌倒',
  social_support:'社會支持', caregiver:'照顧者負荷', financial:'經濟',
  home_safety:'居家安全', accessibility:'可及性/輔具',
  advance_care_planning:'預立照護諮商', treatment_preferences:'治療偏好',
};
export function domainLabel(top: string, sub: string): string {
  return SUB_LABELS[sub] ?? `${top}.${sub}`;
}
export function domainKey(top: string, sub: string): string { return `${top}.${sub}`; }
```
- [ ] **Step 4: Run** → PASS。
- [ ] **Step 5: Commit** `git commit -am "feat(geri): two-level domain tree single source (TDD)"`

### Task 1.3: 計分核心 scoreScale + aggregateSeverity（TDD）
**Files:** Create `src/lib/scales/scale.ts`, Test `tests/scales/scale.test.ts`
- [ ] **Step 1: 測試**：
```ts
import { describe, it, expect } from 'vitest';
import { scoreScale, aggregateSeverity, type ScaleDef } from '$lib/scales/scale';

const gds: ScaleDef = {
  id: 'gds-15', domain: { top: 'psychological', sub: 'mood' },
  applicableCfs: ['cfs3','cfs4','cfs5'], scoring: 'sum', inputType: 'option', maxScore: 15,
  items: [], clinicallyReviewed: false,
  bands: [
    { max: 4, severity: 'normal', label: '無憂鬱徵兆' },
    { min: 5, max: 9, severity: 'monitor', label: '疑似憂鬱' },
    { min: 10, severity: 'refer', label: '高度疑似' },
  ],
};
describe('scoreScale', () => {
  it('maps raw score to band severity', () => {
    expect(scoreScale(gds, 2).severity).toBe('normal');
    expect(scoreScale(gds, 7).severity).toBe('monitor');
    expect(scoreScale(gds, 12).severity).toBe('refer');
  });
  it('returns incomplete when raw is null', () => {
    expect(scoreScale(gds, null).severity).toBe('incomplete');
  });
});
describe('aggregateSeverity', () => {
  it('takes worst, ignoring incomplete', () => {
    expect(aggregateSeverity(['normal','monitor','incomplete'])).toBe('monitor');
    expect(aggregateSeverity(['normal','refer'])).toBe('refer');
    expect(aggregateSeverity(['incomplete','incomplete'])).toBe('incomplete');
    expect(aggregateSeverity([])).toBe('incomplete');
  });
});
```
- [ ] **Step 2: Run** → FAIL。
- [ ] **Step 3: 實作** `src/lib/scales/scale.ts`：
```ts
import type { CfsLevel } from '$lib/utils/cfs-levels';
import type { DomainTop, DomainSub } from '$lib/domain/domain-tree';

export type Severity = 'normal' | 'monitor' | 'refer' | 'incomplete';

export interface ScaleBand {
  min?: number; max?: number; severity: Exclude<Severity, 'incomplete'>; label: string;
}
export interface ScaleItem { id: string; text: string; options: { label: string; score: number }[]; }
export interface ScaleDef {
  id: string;
  domain: { top: DomainTop; sub: DomainSub };
  applicableCfs: CfsLevel[];
  scoring: 'sum' | 'weighted' | 'error-count' | 'measured-value';
  inputType: 'option' | 'numeric';
  maxScore: number;
  items: ScaleItem[];
  bands: ScaleBand[];
  clinicallyReviewed: boolean;
}

export interface ScaleResult {
  scaleId: string;
  domain: { top: DomainTop; sub: DomainSub };
  rawScore: number | null;
  maxScore: number;
  severity: Severity;
  bandLabel: string;
}

export function scoreScale(def: ScaleDef, rawScore: number | null): ScaleResult {
  if (rawScore === null || rawScore === undefined || Number.isNaN(rawScore)) {
    return { scaleId: def.id, domain: def.domain, rawScore: null, maxScore: def.maxScore, severity: 'incomplete', bandLabel: '未完成' };
  }
  const band = def.bands.find(b =>
    (b.min === undefined || rawScore >= b.min) && (b.max === undefined || rawScore <= b.max));
  if (!band) {
    return { scaleId: def.id, domain: def.domain, rawScore, maxScore: def.maxScore, severity: 'incomplete', bandLabel: '無對應分段' };
  }
  return { scaleId: def.id, domain: def.domain, rawScore, maxScore: def.maxScore, severity: band.severity, bandLabel: band.label };
}

const ORDER: Record<Severity, number> = { normal: 0, monitor: 1, refer: 2, incomplete: -1 };
/** 取最嚴重；忽略 incomplete；全 incomplete 或空 → incomplete。 */
export function aggregateSeverity(list: Severity[]): Severity {
  const valid = list.filter(s => s !== 'incomplete');
  if (valid.length === 0) return 'incomplete';
  return valid.reduce((a, b) => (ORDER[b] > ORDER[a] ? b : a), 'normal' as Severity);
}
```
- [ ] **Step 4: Run** → PASS。
- [ ] **Step 5: Commit** `git commit -am "feat(geri): per-scale scoring + severity aggregation (TDD)"`

### Task 1.4: schemas.ts — 二層域 enum + trigger refine + inapplicable(cfs)
**Files:** Modify `src/lib/education/schemas.ts`, Test `tests/lib/education/schemas.test.ts`（重寫）
- [ ] **Step 1: 重寫測試** 斷言：`cga.domain.psychological.cognition.anomaly.cfs5` 合法、非法 top/sub 組合被拒、`cga.triage.refer.cfs5` 合法、`inapplicable` 接受 `{'psychological.cognition': ['cfs1','cfs2']}`。（依下方新 schema 形狀寫斷言。）
- [ ] **Step 2: Run** → FAIL。
- [ ] **Step 3: 改 schema**：
  - import `CFS_LEVELS`（取代 `AGE_GROUPS_CDSA`）、`DOMAIN_TREE/DOMAIN_TOPS/DOMAIN_SUBS/isValidDomain`。
  - `cdsaDomainEntrySchema` → `cgaDomainEntrySchema`：新增 `top: z.enum(DOMAIN_TOPS as [string,...string[]])`、`sub: z.enum(DOMAIN_SUBS as [string,...string[]])`、`ageGroup`→`cfsLevel: z.enum(CFS_LEVELS)`；refine 兩條：(a) `isValidDomain(top,sub)`，(b) `trigger === \`cga.domain.${top}.${sub}.anomaly.${cfsLevel}\``。
  - `cdsaTriageEntrySchema`→`cgaTriageEntrySchema`：`cfsLevel`，refine `cga.triage.${triageCategory}.${cfsLevel}`。
  - `cdssVitalSignEntrySchema`：保留但 `ageGroup`→`cfsLevel`、trigger `cga.vital.${indicator}.${level}.${cfsLevel}`（Phase 2 內容可不使用）。
  - `contentRelevanceSchema.inapplicable`：`z.record(z.string().refine(k => { const [t,s]=k.split('.'); return isValidDomain(t,s); }), z.array(z.enum(CFS_LEVELS)))`。
  - 移除 `CDSA_DOMAIN_NAMES` export，改 export `DOMAIN_TREE` 衍生（或 re-export from domain-tree）。`CDSS_AGE_ENUM` 移除或改 cfs（Phase 2 vital 用）。
- [ ] **Step 4: Run** schema 測試 → PASS。
- [ ] **Step 5: Commit** `git commit -am "feat(geri): schemas two-level domain + cfs trigger refine (TDD)"`

### Task 1.5: triage.ts — scoreScale 驅動 + 取最嚴重 + 新 details（TDD）
**Files:** Modify `src/engine/cdsa/triage.ts`, Test `tests/engine/triage.test.ts`（重寫）
- [ ] **Step 1: 重寫測試**：輸入 `{ cfsLevel, scaleResults: ScaleResult[] }`，斷言整體 `category`＝取最嚴重、`details` 為 ScaleResult[]、incomplete 不影響彙整。
- [ ] **Step 2: Run** → FAIL。
- [ ] **Step 3: 改 triage.ts**：
  - 移除 `loadNorms`/z-score/`NormThreshold` 依賴與 `DOMAIN_LABELS`（改用 `domain-tree` 的 `domainLabel`）。
  - `TriageInput` = `{ cfsLevel: CfsLevel; scaleResults: ScaleResult[] }`。
  - `TriageResult` = `{ category: Severity; details: ScaleResult[]; summary: string }`（移除 zScore/directionalZ/normMean/normStd/metric）。
  - `computeTriage(input)`：`category = aggregateSeverity(details.map(d=>d.severity))`；`summary` 用 `domainLabel` 組各領域 severity 文字。
- [ ] **Step 4: Run** → PASS。
- [ ] **Step 5: Commit** `git commit -am "feat(geri): triage per-scale + worst-severity aggregation (TDD)"`

### Task 1.6: radar-scoring.ts — 純 raw/maxScore（TDD）
**Files:** Modify `src/engine/cdsa/radar-scoring.ts`, Test `tests/engine/radar-scoring.test.ts`（重寫）
- [ ] **Step 1: 重寫測試**：給 ScaleResult[]，斷言每 `top.sub` 的 score = round(100*rawScore/maxScore)，無 z 路徑、無 isHybrid。
- [ ] **Step 2: Run** → FAIL。
- [ ] **Step 3: 改**：`DomainScore = { domain: string; score: number; severity: Severity }`；`computeDomainScores(triageResult)` 依 `details` 每 `top.sub` 取 `rawScore/maxScore`（incomplete→score 省略或 0 並標記）。移除 `zToPercentile`/`directionalZ`/hybrid。
- [ ] **Step 4: Run** → PASS。
- [ ] **Step 5: Commit** `git commit -am "feat(geri): radar scoring raw/maxScore only (TDD)"`

### Task 1.7: 移除感測模組（引擎 + svelte + card-selector）
**Files:** Delete `src/engine/cdsa/{gross-motor-analysis,drawing-analysis,voice-analysis,behavior-analysis,card-selector}.ts`、`src/components/assess/{GameModule,VoiceModule,VideoModule,DrawingModule}.svelte`；Delete tests `tests/engine/{gross-motor-analysis?,drawing-analysis,voice-analysis,behavior-analysis,card-selector}.test.ts`
- [ ] 刪除上述檔案（用 `git rm`）。
- [ ] 移除 `triage.ts`、`assessment-analyzer.ts`、store 對這些檔的 import（下一 Task 處理 store/analyzer）。
- [ ] Commit: `git rm ... && git commit -m "chore(geri): remove sensor modules (Phase 3 deferred)"`

### Task 1.8: store — cfsLevel state + STEPS 縮減 + 移除 skip/forceFull + assessment-analyzer
**Files:** Modify `src/lib/stores/assessment.svelte.ts`, `src/engine/cdsa/assessment-analyzer.ts`, `src/lib/db/assessments.ts`; Delete `tests/lib/stores/assessment-force-full.test.ts`; rewrite `tests/engine/assessment-analyzer.test.ts`
- [ ] store：移除 `ageGroup` derived；新增 `cfsLevel = $state<CfsLevel|null>(null)`；`STEPS = ['profile','questionnaire','result']`；移除 `SkippableModule/skippedModules/effectiveSteps/effectiveStepIndex/forceFullAssessment/setForceFullAssessment`，`nextStep/prevStep` 改簡單 ±1；`startNew(childData, cfsLevel)` 寫入；`resume` 還原 `this.cfsLevel = assessment.cfsLevel`；移除 sensor 型別 import 與 `PartialAnalysis` sensor 欄位（只留 `questionnaireScores/questionnaireMaxScores`）。
- [ ] `assessments.ts`：`createAssessment(childId, cfsLevel)` 寫 `cfsLevel`；移除 `updateAssessmentForceFull`。
- [ ] `assessment-analyzer.ts`：簽章改 `(assessmentId, cfsLevel)`，只跑問卷→ScaleResult[]→`computeTriage`；移除 sensor 呼叫。重寫其測試。
- [ ] 刪 `assessment-force-full.test.ts`。
- [ ] Run `pnpm vitest run tests/engine/assessment-analyzer.test.ts` → PASS。
- [ ] Commit: `git commit -am "feat(geri): store cfsLevel state + 3-step flow + drop skip/forceFull (TDD)"`

### Task 1.9: db/schema.ts — Assessment.cfsLevel、移除 NormThreshold/forceFull、details 型別
**Files:** Modify `src/lib/db/schema.ts`, `src/components/settings/{NormsManager,SystemGuide}.svelte`
- [ ] `Assessment` 介面新增 `cfsLevel: CfsLevel`；移除 `forceFullAssessment`；`triageResult.details` 改 `ScaleResult[]`。移除 `NormThreshold` 介面與 Dexie `normThresholds` index（store schema 字串）。`AssessmentStatus` 維持。
- [ ] `NormsManager.svelte`：Phase 2 停用 — 從設定頁移除其入口/或元件改為「Phase 3 再啟用」佔位（不得引用已移除的 NormThreshold）。`SystemGuide.svelte`：移除/改寫提到 NormThreshold/常模 的說明段。
- [ ] Run `pnpm check` → 確認 schema 無型別錯（消費端錯誤留待後續 Task）。
- [ ] Commit: `git commit -am "feat(geri): Assessment.cfsLevel + remove NormThreshold/forceFull"`

### Task 1.10: education 投影層 — trigger-derivation / matrix-data / cfs-fallback / video-lookup
**Files:** Modify `src/lib/education/trigger-derivation.ts`、`matrix-data.ts`；Rename `age-fallback.ts`→`cfs-fallback.ts`；Modify `video-lookup.ts`；rewrite tests `tests/lib/education/{trigger-derivation,video-lookup}.test.ts`、`tests/education/matrix-data.test.ts`
- [ ] `trigger-derivation.ts`：`deriveCdsaTriggers`→`deriveCgaTriggers(triageResult, cfsLevel)`，emit `cga.triage.${cat}.${cfs}` 與每域 `cga.domain.${top}.${sub}.anomaly.${cfs}`。`deriveCdssTriggers` 暫保留（CDSS 停用，不呼叫）。
- [ ] `matrix-data.ts`：`CDSA_DOMAINS` 改 from `domain-tree`；`MatrixKey=${top}.${sub}:${cfsLevel}`；解析 `parts[2]=top,parts[3]=sub,parts[4]==='anomaly',parts[5]=cfs`；初始化 `DOMAIN_SUBS × CFS_LEVELS`。
- [ ] `age-fallback.ts`→`cfs-fallback.ts`：`CFS_FALLBACK_CHAIN`（cfsN→相鄰級）。
- [ ] `video-lookup.ts`：`AGE_GROUPS_CDSA` regex/fallback → CFS。
- [ ] 重寫對應測試 → PASS。
- [ ] Commit: `git commit -am "feat(geri): education projection layer → cga two-level × cfs (TDD)"`

### Task 1.11: build scripts — build-content-index / build-questionnaire-applicability
**Files:** Modify `scripts/build-content-index.ts`、`scripts/build-questionnaire-applicability.ts`
- [ ] `build-content-index.ts`：inapplicable 展開讀二層域×cfs（`cga.domain.${top}.${sub}.anomaly.${cfs}`）；domain regex `^cga\.domain\.([^.]+)\.([^.]+)\.anomaly\.([^.]+)$`；`recommendations` key `${sev}::${top}.${sub}::${cfs}`；`clinicalEducation` 來源 `clinicalAlertEducation`（Phase 2 可空）；仍生成 `clinical-education.generated.ts`（空物件 OK）。
- [ ] `build-questionnaire-applicability.ts`：`QUESTIONNAIRE_DOMAINS`→`DOMAIN_SUBS`（或全 top.sub）、`AGE_GROUPS_CDSA`→`CFS_LEVELS`，讀二層 `inapplicable`，輸出 `Record<cfsLevel, string[]>`（適用 top.sub）。
- [ ] 需要一份最小 `content-relevance.yaml`（新格式）讓 build 通過：Task 1.14 提供。
- [ ] Run `pnpm tsx scripts/build-content-index.ts`（待 1.14 yaml 就緒後）→ 成功。
- [ ] Commit: `git commit -am "feat(geri): build scripts → cga axis"`

### Task 1.12: recommendations.ts — per-domain severity + cfs/top.sub key
**Files:** Modify `src/lib/db/recommendations.ts`, `src/components/settings/RecommendationsManager.svelte`; rewrite `tests/db/recommendations-age.test.ts`、`tests/lib/db/recommendations.test.ts`
- [ ] `DOMAINS` 改 `DOMAIN_SUBS`（或 top.sub 全集）；`getDefaultRecommendations(severity, domainTopSub, cfsLevel)` key `${severity}::${top.sub}::${cfs}`；overlay key `${tenant}::${severity}::${top.sub}`（不含 cfs）；新增/改 `mergeRecommendationsForContext(tenant, perDomain: {domain, severity}[], cfsLevel)` 逐域查、排除 incomplete。
- [ ] `RecommendationsManager.svelte`：domain 選項改二層、cfs 維度。
- [ ] 重寫兩支測試 → PASS。
- [ ] Commit: `git commit -am "feat(geri): recommendations per-domain severity × cfs (TDD)"`

### Task 1.13: FHIR cga-resources + CDSS path 隱藏
**Files:** Rename `src/lib/fhir/cdsa-resources.ts`→`cga-resources.ts`; Modify importers; Modify `src/components/workspace/WorkspaceShell.svelte`、`AssessmentPdfReport.svelte`、`fhir/assessment-fetch.ts`
- [ ] `cga-resources.ts`：常數 URL/display geri；`buildAssessmentObservations` 一 ScaleResult 一筆（value=rawScore，interpretation normal=N/其餘=A，incomplete→不發或 status=preliminary+dataAbsentReason，**不可用 IE**）；新增 CFS Observation（本地 code system `clinical-frailty-scale`）；`buildTriageDiagnosticReport` conclusion=整體+各域 severity。
- [ ] `WorkspaceShell.svelte`：隱藏 patient/alerts 分頁（PatientList/PatientView/RiskSummary/AlertFeed/AlertManager）。
- [ ] `AssessmentPdfReport.svelte`：標題/頁尾/filename → CGA；修 `statusLabelsCn` 對齊 `AssessmentStatus`；`ageInMonths` null-guard。`assessment-fetch.ts:87` 修 status cast。
- [ ] Run `pnpm check`。Commit: `git commit -am "feat(geri): FHIR cga-resources per-scale + hide CDSS workspace tabs"`

### Task 1.14: 結果頁三件 + EducationMatch + SubjectProfile + 最小 content-relevance
**Files:** Modify `ResultView.svelte`、`ResultViewWrapper.svelte`、`patient/ResultDetail.svelte`、`RadarChart.svelte`、`EducationMatch.svelte`、`ChildProfile.svelte`(→`SubjectProfile`)、`AssessmentHistory.svelte`; Create 最小 `src/data/education/content-relevance.yaml`（新格式）+ 1 個 `src/data/scales/gds-15.yaml` 煙霧樣本; rewrite tests `tests/components/{ResultView,ChildProfile,RadarChart,QuestionnaireModule}.test.ts`
- [ ] `ChildProfile→SubjectProfile`：DOB 選填（null-safe）、新增 **CFS 選擇器（必填 gate，9 級含描述）**，送出條件＝CFS 已選；移除 `isEligible`。
- [ ] `EducationMatch.svelte`：props `{ perDomain: {domain, severity}[]; cfsLevel }`。
- [ ] `ResultView/ResultViewWrapper/ResultDetail`：讀 `assessment.cfsLevel`、`deriveCgaTriggers`、新 `details`、`computeDomainScores` 新形狀、EducationMatch 新 props；ResultDetail 移除 normMean±normStd/zScore/directionalZ/METRIC_LABELS 渲染。`RadarChart`：二層域標籤、移除 isHybrid。
- [ ] `AssessmentHistory.svelte`：`ageInMonths` null-guard。
- [ ] 建最小 `content-relevance.yaml`（新格式：`inapplicable: {}`、`triggers: []`、`clinicalAlertEducation: {}`），與 1 個 `src/data/scales/gds-15.yaml`（題目可少量、`clinicallyReviewed: false`，內容歸 Plan 2），並在 `content.config.ts` 註冊 `scales` collection。
- [ ] 重寫對應測試 → PASS。
- [ ] Commit: `git commit -am "feat(geri): result pages + SubjectProfile CFS gate + scales collection (TDD)"`

### Task 1.15: parity 測試重寫 + 全綠收尾
**Files:** Rewrite `tests/education/content-index-parity.test.ts`、`tests/data/questionnaire-coverage.test.ts`、`tests/components/QuestionnaireFlow.test.ts`、`workers/education-contribution/*`（trigger/VALID_AGES→cfs、issue-formatter yamlHint）
- [ ] parity test：key regex `^(normal|monitor|refer)::[a-z_]+\.[a-z_]+::cfs[1-9]$`；`EXPECTED_SLUGS`/coverage 改新軸（最小 content 下允許空 applicable cell＝contributable，斷言放寬為「有 trigger 者格式正確」）。
- [ ] worker：`index.ts` `VALID_AGES`→`VALID_CFS`、payload `{top,sub,cfsLevel}`；`issue-formatter.ts:154` trigger `cga.domain.${top}.${sub}.anomaly.${cfs}`、yamlHint→`content-relevance.yaml`、「發展領域」用語；重寫 worker 測試。
- [ ] 矩陣頁 `education/index.astro` + ContributionModal：`data-domain/data-age`→`top.sub`/`cfsLevel`；列=18 子項分組、欄=cfs1-9。
- [ ] **Run 全套**：`pnpm check && pnpm lint --max-warnings 10 && pnpm vitest run && pnpm build` → 全綠。
- [ ] Commit: `git commit -am "feat(geri): rewrite parity/coverage/worker → cga axis; green build"`

---

## Self-Review（spec 覆蓋核對）

- 軸/領域/計分/trigger/matrix/recommendations/FHIR/store/DB：Task 1.1–1.14 覆蓋 spec「各層去留」與「結果頁取用」。
- 全消費端：spec〈受影響檔案總表〉的 18 分層軸消費端、結果頁三件、感測移除、NormThreshold(含 SystemGuide)、CDSS 第二軸隱藏、DOB null-guard、DAO — 對應 Task 1.7–1.14。
- 測試守門：spec 清單（含刪除 force-full/感測、重寫 radar/analyzer/closed-loop/schemas/recommendations×2/ResultView/ChildProfile/video-lookup/QuestionnaireModule/RadarChart、parity 重寫）— 對應 Task 1.5–1.15。
- closed-loop-education.test.ts：Task 1.11 使 `clinicalEducation` 為空，該測試於 1.15 收尾改/刪（parity→空）。
- Phase 0 識別 + CNAME：Task 0.1–0.5。

## 非本計畫（Plan 2）
- 量表完整題目/cutoff（臨床審）、衛教文章重寫、影片 curate、適用表細格、矩陣填滿內容、CDSS 老年化、measured-value 數值輸入元件、貢獻 Worker/GitHub App 部署 secrets。
