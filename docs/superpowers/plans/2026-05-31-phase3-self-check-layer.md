# Phase 3 自評層 /self-check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增民眾自評層 `/self-check`：TTS 朗讀的 18 題白話自我檢視，輸出白話紅黃綠結果、自傷紅旗就醫提示與可帶去門診的 PDF 摘要，與專業層 `/assess` 完全解耦。

**Architecture:** 獨立題庫 `src/data/self-check/*.yaml`（題目取材自既有 triage 代表題，不動專業層）→ 新 `selfChecks` content collection（簡化 schema，無 CFS/mode/tier）→ 純函式計分（`scoreSelfCheck` + `summariseSelfCheck`）→ Svelte 5 runes store（`intro → screening → summary`，純記憶體不持久化）→ 4 個 Svelte 元件 + Web Speech API TTS 封裝 → Astro 頁面 + jsPDF 摘要。

**Tech Stack:** Astro 5 SSG、Svelte 5 runes、Astro Content Layer + Zod、Web Speech API (`SpeechSynthesis`)、jsPDF (Noto Sans TC subset)、Vitest、Playwright。

**設計決策（已與使用者確認）：**
1. 題庫架構＝**獨立** `src/data/self-check/*.yaml`（專業層 `*-triage.yaml` 完全不動）。
2. 補兩題自我檢視新題：cognition「自覺記憶/思考變差」、mood「自傷念頭」紅旗題。全部 `clinicallyReviewed: false`，定位自我檢視非診斷。
3. 自評層**不持久化到 IndexedDB**（一次性 2–3 分鐘快測，YAGNI；重整即重來）。
4. 自評層**不顯示 0–100 分數**，只給白話紅黃綠 + 建議關注清單（spec C-3）。
5. 字級/觸控**高於** CLAUDE.md 下限（18px/44px）：選項按鈕用 `--text-lg`(24px) + `min-height: 64px`。

**非目標（YAGNI，承 spec）：** 不做帳號/登入/雲端同步、不做 FHIR 上傳、不自創新臨床量表內容（題目取材既有 triage）、QR 摘要延後（初版 PDF/列印為主）、不對自評層宣稱任何診斷效度。

---

## File Structure

新增：
- `src/lib/self-check/self-check.ts` — `SelfCheckScale` 型別 + `scoreSelfCheck()` 純函式（單域→light）。
- `src/lib/self-check/summarise.ts` — `summariseSelfCheck()`：所有作答 → 結果模型（亮燈領域清單 + 紅旗 + awareness 命中）。
- `src/lib/self-check/load-self-checks.ts` — `toSelfCheckScales()`：collection entry → `SelfCheckScale[]`。
- `src/lib/tts/speak.ts` — Web Speech API 封裝（朗讀/取消/查 zh-TW 語音）。
- `src/lib/stores/self-check.svelte.ts` — runes store（步驟機 + 作答狀態，純記憶體）。
- `src/data/self-check/*.yaml` — 18 個自評題（16 scored + 2 awareness）。
- `src/components/self-check/SelfCheckShell.svelte` — 步驟容器（依 store.step 切換）。
- `src/components/self-check/SelfCheckIntro.svelte` — 白話開場 + 免責 + 開始鈕。
- `src/components/self-check/SelfCheckQuestionnaire.svelte` — 逐題作答 + TTS + redFlag 安全提示。
- `src/components/self-check/SelfCheckResult.svelte` — 紅黃綠 + 建議關注清單 + 紅旗就醫 + PDF 鈕。
- `src/lib/self-check/self-check-pdf.ts` — `buildSelfCheckPdf()`：亮燈領域摘要 PDF。
- `src/pages/self-check.astro` — 頁面路由。

修改：
- `src/content.config.ts` — 新增 `selfChecks` collection 與其 Zod schema、export。
- `src/components/blocks/Header.astro` 或 `src/pages/index.astro` — 加「民眾自我檢視」入口連結（Task 11）。

測試：
- `tests/self-check/score.test.ts`、`tests/self-check/summarise.test.ts`、`tests/self-check/load-self-checks.test.ts`、`tests/tts/speak.test.ts`、`tests/self-check/store.test.ts`、`tests/data/self-check-yaml.test.ts`。

---

## Task 1: SelfCheckScale 型別 + scoreSelfCheck 純函式

**Files:**
- Create: `src/lib/self-check/self-check.ts`
- Test: `tests/self-check/score.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/self-check/score.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { scoreSelfCheck, type SelfCheckScale } from '../../src/lib/self-check/self-check';

function mkScored(overrides: Partial<SelfCheckScale> = {}): SelfCheckScale {
  return {
    id: 'sc-falls',
    domain: { top: 'functional', sub: 'falls' },
    category: 'scored',
    maxScore: 1,
    items: [
      { id: 'q', text: '過去一年是否跌倒過？', options: [
        { label: '否', score: 0 }, { label: '是', score: 1 },
      ] },
    ],
    bands: [
      { min: 0, max: 0, light: 'green', advice: '目前沒有跌倒徵兆。' },
      { min: 1, max: 1, light: 'amber', advice: '建議找醫療人員評估跌倒風險。' },
    ],
    clinicallyReviewed: false,
    ...overrides,
  };
}

describe('scoreSelfCheck', () => {
  it('green band when total score 0', () => {
    const r = scoreSelfCheck(mkScored(), { q: 0 });
    expect(r.light).toBe('green');
    expect(r.advice).toContain('沒有跌倒');
  });

  it('amber band when total score 1', () => {
    const r = scoreSelfCheck(mkScored(), { q: 1 });
    expect(r.light).toBe('amber');
  });

  it('sums multiple item scores before banding (mood 2 items)', () => {
    const mood = mkScored({
      id: 'sc-mood', domain: { top: 'psychological', sub: 'mood' }, maxScore: 2,
      items: [
        { id: 'low', text: '情緒低落？', options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] },
        { id: 'sh', text: '自傷念頭？', redFlag: 'self-harm', options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] },
      ],
      bands: [
        { min: 0, max: 0, light: 'green', advice: '情緒狀態看起來還好。' },
        { min: 1, max: 2, light: 'amber', advice: '建議找醫療人員談談情緒。' },
      ],
    });
    expect(scoreSelfCheck(mood, { low: 1, sh: 0 }).light).toBe('amber');
    expect(scoreSelfCheck(mood, { low: 0, sh: 0 }).light).toBe('green');
  });

  it('unanswered item → light null (incomplete, not scored)', () => {
    const r = scoreSelfCheck(mkScored(), {});
    expect(r.light).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/self-check/score.test.ts`
Expected: FAIL — `Cannot find module '../../src/lib/self-check/self-check'`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/self-check/self-check.ts`:

```typescript
import type { DomainTop, DomainSub } from '$lib/domain/domain-tree';

/** 民眾白話紅黃綠燈。red 不由 band 決定（自評不宣稱嚴重度），僅由 redFlag 在 summarise 階段覆寫。 */
export type SelfLight = 'green' | 'amber';

export interface SelfCheckItem {
  id: string;
  /** 白話、第二人稱題幹；同時作為 TTS 朗讀文字。 */
  text: string;
  options: { label: string; score: number }[];
  /** 觸發自傷安全提示（與專業層共用語意）。 */
  redFlag?: 'self-harm';
}

export interface SelfCheckBand {
  min?: number;
  max?: number;
  light: SelfLight;
  /** 該燈號對民眾顯示的白話建議。 */
  advice: string;
}

export interface SelfCheckScale {
  id: string;
  domain: { top: DomainTop; sub: DomainSub };
  /** 'scored' 計入紅黃綠；'awareness' 為 ACP/治療偏好覺察題，不計風險、只在結尾提示。 */
  category: 'scored' | 'awareness';
  maxScore: number;
  items: SelfCheckItem[];
  bands: SelfCheckBand[];
  clinicallyReviewed: boolean;
}

export interface SelfCheckScaleResult {
  scaleId: string;
  domain: { top: DomainTop; sub: DomainSub };
  /** null = 該域尚有未答題（incomplete，不納入結果統計）。 */
  light: SelfLight | null;
  advice: string;
  rawScore: number | null;
}

/** Answers map：itemId → 選到的 score。 */
export type SelfCheckAnswers = Record<string, number>;

/**
 * 計一個自評領域的紅黃綠。所有 item 必須都已作答才計分（任一未答 → light null）。
 * 分數加總後落入 bands；無對應 band → light null。
 */
export function scoreSelfCheck(scale: SelfCheckScale, answers: SelfCheckAnswers): SelfCheckScaleResult {
  const unanswered = scale.items.some(it => answers[it.id] === undefined);
  if (unanswered) {
    return { scaleId: scale.id, domain: scale.domain, light: null, advice: '', rawScore: null };
  }
  const rawScore = scale.items.reduce((sum, it) => sum + (answers[it.id] ?? 0), 0);
  const band = scale.bands.find(b =>
    (b.min === undefined || rawScore >= b.min) && (b.max === undefined || rawScore <= b.max));
  if (!band) {
    return { scaleId: scale.id, domain: scale.domain, light: null, advice: '', rawScore };
  }
  return { scaleId: scale.id, domain: scale.domain, light: band.light, advice: band.advice, rawScore };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/self-check/score.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/self-check/self-check.ts tests/self-check/score.test.ts
git commit -m "feat(self-check): SelfCheckScale 型別 + scoreSelfCheck 純函式"
```

---

## Task 2: summariseSelfCheck — 作答彙整為結果模型

**Files:**
- Create: `src/lib/self-check/summarise.ts`
- Test: `tests/self-check/summarise.test.ts`

結果模型驅動 `SelfCheckResult.svelte`：亮燈領域清單（amber，依 DOMAIN_TREE 排序）、是否觸發自傷紅旗、awareness 命中清單、整體燈號（red 若紅旗、amber 若任一 amber、否則 green）。

- [ ] **Step 1: Write the failing test**

`tests/self-check/summarise.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { summariseSelfCheck } from '../../src/lib/self-check/summarise';
import type { SelfCheckScale } from '../../src/lib/self-check/self-check';

const falls: SelfCheckScale = {
  id: 'sc-falls', domain: { top: 'functional', sub: 'falls' }, category: 'scored', maxScore: 1,
  items: [{ id: 'f', text: '跌倒？', options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] }],
  bands: [
    { min: 0, max: 0, light: 'green', advice: '沒有跌倒徵兆。' },
    { min: 1, max: 1, light: 'amber', advice: '建議評估跌倒風險。' },
  ],
  clinicallyReviewed: false,
};
const mood: SelfCheckScale = {
  id: 'sc-mood', domain: { top: 'psychological', sub: 'mood' }, category: 'scored', maxScore: 2,
  items: [
    { id: 'low', text: '情緒低落？', options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] },
    { id: 'sh', text: '自傷念頭？', redFlag: 'self-harm', options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] },
  ],
  bands: [
    { min: 0, max: 0, light: 'green', advice: '情緒還好。' },
    { min: 1, max: 2, light: 'amber', advice: '建議談談情緒。' },
  ],
  clinicallyReviewed: false,
};
const acp: SelfCheckScale = {
  id: 'sc-acp', domain: { top: 'future_wishes', sub: 'advance_care_planning' }, category: 'awareness', maxScore: 1,
  items: [{ id: 'a', text: '想了解預立醫療？', options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] }],
  bands: [], clinicallyReviewed: false,
};

describe('summariseSelfCheck', () => {
  it('all green → overall green, no concerns, no red flag', () => {
    const s = summariseSelfCheck([falls, mood], { f: 0, low: 0, sh: 0 });
    expect(s.overall).toBe('green');
    expect(s.concerns).toHaveLength(0);
    expect(s.redFlag).toBe(false);
  });

  it('one amber → overall amber, concern listed with label + advice', () => {
    const s = summariseSelfCheck([falls, mood], { f: 1, low: 0, sh: 0 });
    expect(s.overall).toBe('amber');
    expect(s.concerns).toHaveLength(1);
    expect(s.concerns[0].label).toBe('平衡跌倒');
    expect(s.concerns[0].advice).toContain('跌倒');
  });

  it('self-harm answered positive → redFlag true and overall red', () => {
    const s = summariseSelfCheck([falls, mood], { f: 0, low: 1, sh: 1 });
    expect(s.redFlag).toBe(true);
    expect(s.overall).toBe('red');
  });

  it('awareness positive → listed under awareness, not in concerns', () => {
    const s = summariseSelfCheck([falls, acp], { f: 0, a: 1 });
    expect(s.concerns).toHaveLength(0);
    expect(s.awareness.map(a => a.sub)).toContain('advance_care_planning');
  });

  it('concerns sorted by DOMAIN_TREE order (physical before functional)', () => {
    const pain: SelfCheckScale = {
      ...falls, id: 'sc-pain', domain: { top: 'physical', sub: 'pain' },
    };
    const s = summariseSelfCheck([falls, pain], { f: 1, [pain.items[0].id]: 1 });
    expect(s.concerns.map(c => c.sub)).toEqual(['pain', 'falls']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/self-check/summarise.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/lib/self-check/summarise.ts`:

```typescript
import { scoreSelfCheck, type SelfCheckScale, type SelfCheckAnswers } from './self-check';
import { DOMAIN_TREE, DOMAIN_TOPS, domainLabel, type DomainTop, type DomainSub } from '$lib/domain/domain-tree';

export type SelfOverall = 'green' | 'amber' | 'red';

export interface SelfConcern {
  top: DomainTop;
  sub: DomainSub;
  label: string;
  advice: string;
}
export interface SelfAwareness {
  top: DomainTop;
  sub: DomainSub;
  label: string;
}

export interface SelfCheckSummary {
  overall: SelfOverall;
  /** 紅旗：任一 redFlag item 被選為正分（自傷念頭）。 */
  redFlag: boolean;
  /** amber 的 scored 領域，依 DOMAIN_TREE 順序。 */
  concerns: SelfConcern[];
  /** awareness 域被選「是」者（ACP/治療偏好）。 */
  awareness: SelfAwareness[];
}

/** DOMAIN_TREE 的全域 top.sub 線性順序，用於排序 concerns。 */
function domainOrderIndex(top: DomainTop, sub: string): number {
  let idx = 0;
  for (const t of DOMAIN_TOPS) {
    for (const s of DOMAIN_TREE[t] as readonly string[]) {
      if (t === top && s === sub) return idx;
      idx++;
    }
  }
  return Number.MAX_SAFE_INTEGER;
}

/** 任一 scale 的任一 redFlag item 被選正分 → 觸發自傷紅旗。 */
function hasRedFlag(scales: SelfCheckScale[], answers: SelfCheckAnswers): boolean {
  return scales.some(sc =>
    sc.items.some(it => it.redFlag === 'self-harm' && (answers[it.id] ?? 0) > 0));
}

export function summariseSelfCheck(scales: SelfCheckScale[], answers: SelfCheckAnswers): SelfCheckSummary {
  const redFlag = hasRedFlag(scales, answers);

  const concerns: SelfConcern[] = [];
  const awareness: SelfAwareness[] = [];

  for (const sc of scales) {
    if (sc.category === 'awareness') {
      const positive = sc.items.some(it => (answers[it.id] ?? 0) > 0);
      if (positive) {
        awareness.push({ top: sc.domain.top, sub: sc.domain.sub, label: domainLabel(sc.domain.top, sc.domain.sub) });
      }
      continue;
    }
    const r = scoreSelfCheck(sc, answers);
    if (r.light === 'amber') {
      concerns.push({
        top: sc.domain.top, sub: sc.domain.sub,
        label: domainLabel(sc.domain.top, sc.domain.sub), advice: r.advice,
      });
    }
  }

  concerns.sort((a, b) => domainOrderIndex(a.top, a.sub) - domainOrderIndex(b.top, b.sub));

  const overall: SelfOverall = redFlag ? 'red' : concerns.length > 0 ? 'amber' : 'green';
  return { overall, redFlag, concerns, awareness };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/self-check/summarise.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/self-check/summarise.ts tests/self-check/summarise.test.ts
git commit -m "feat(self-check): summariseSelfCheck 彙整紅黃綠 + 紅旗 + 覺察題"
```

---

## Task 3: selfChecks content collection + loader

**Files:**
- Modify: `src/content.config.ts`
- Create: `src/lib/self-check/load-self-checks.ts`
- Test: `tests/self-check/load-self-checks.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/self-check/load-self-checks.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { toSelfCheckScales, type SelfCheckEntry } from '../../src/lib/self-check/load-self-checks';

const entry: SelfCheckEntry = {
  data: {
    id: 'sc-falls',
    domain: { top: 'functional', sub: 'falls' },
    category: 'scored',
    maxScore: 1,
    items: [{ id: 'q', text: '跌倒？', options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] }],
    bands: [
      { min: 0, max: 0, light: 'green', advice: '沒有跌倒徵兆。' },
      { min: 1, max: 1, light: 'amber', advice: '建議評估。' },
    ],
    clinicallyReviewed: false,
  },
};

describe('toSelfCheckScales', () => {
  it('maps collection entries to SelfCheckScale[]', () => {
    const scales = toSelfCheckScales([entry]);
    expect(scales).toHaveLength(1);
    expect(scales[0].id).toBe('sc-falls');
    expect(scales[0].category).toBe('scored');
    expect(scales[0].items[0].options[1].score).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/self-check/load-self-checks.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3a: Add the selfChecks collection to `src/content.config.ts`**

Insert after the `scalesCollection` definition (after line 174), before `// ---------- export ----------`:

```typescript
// ---------- self-check collection (glob loader, YAML) ----------
// 民眾自評層題庫。獨立於 scales（專業層）：無 CFS/mode/tier/expandsTo。
// 題目取材自既有 triage 代表題，全 clinicallyReviewed:false（自我檢視非診斷）。
const selfCheckItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  options: z.array(z.object({ label: z.string(), score: z.number() })),
  redFlag: z.literal('self-harm').optional(),
});

const selfCheckBandSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  light: z.enum(['green', 'amber']),
  advice: z.string(),
});

const selfChecksCollection = defineCollection({
  loader: glob({ pattern: ['**/*.yaml', '!**/README.md'], base: './src/data/self-check' }),
  schema: z.object({
    id: z.string(),
    domain: z.object({
      top: z.enum(DOMAIN_TOPS as [string, ...string[]]),
      sub: z.enum(DOMAIN_SUBS as [string, ...string[]]),
    }).refine(d => isValidDomain(d.top, d.sub), {
      message: 'domain.top/domain.sub 不是合法的二層域組合',
    }),
    category: z.enum(['scored', 'awareness']),
    maxScore: z.number(),
    items: z.array(selfCheckItemSchema),
    bands: z.array(selfCheckBandSchema),
    clinicallyReviewed: z.boolean(),
  }),
});
```

Then change the `export const collections` block to register it:

```typescript
export const collections = {
  rules: rulesCollection,
  baselines: baselinesCollection,
  education: educationCollection,
  cards: cardsCollection,
  scales: scalesCollection,
  selfChecks: selfChecksCollection,
};
```

- [ ] **Step 3b: Write the loader `src/lib/self-check/load-self-checks.ts`**

```typescript
import type { DomainTop, DomainSub } from '$lib/domain/domain-tree';
import type { SelfCheckScale, SelfCheckItem, SelfCheckBand } from './self-check';

/** Shape of one `selfChecks` collection entry (mirrors the Zod schema). */
export interface SelfCheckEntry {
  data: {
    id: string;
    domain: { top: string; sub: string };
    category: 'scored' | 'awareness';
    maxScore: number;
    items: SelfCheckItem[];
    bands: SelfCheckBand[];
    clinicallyReviewed: boolean;
  };
}

export function toSelfCheckScales(entries: SelfCheckEntry[]): SelfCheckScale[] {
  return entries.map(({ data }) => ({
    id: data.id,
    domain: { top: data.domain.top as DomainTop, sub: data.domain.sub as DomainSub },
    category: data.category,
    maxScore: data.maxScore,
    items: data.items,
    bands: data.bands,
    clinicallyReviewed: data.clinicallyReviewed,
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/self-check/load-self-checks.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/content.config.ts src/lib/self-check/load-self-checks.ts tests/self-check/load-self-checks.test.ts
git commit -m "feat(self-check): selfChecks content collection + loader"
```

---

## Task 4: 18 個自評題庫 YAML

**Files:**
- Create: `src/data/self-check/*.yaml`（18 檔）
- Test: `tests/data/self-check-yaml.test.ts`

題目文字取材自既有 `*-triage.yaml` 的 `text`（已是第二人稱白話），改 advice 為民眾白話。新增 `cognition.yaml`（自覺記憶）與 mood 第二題（自傷紅旗）。awareness 域（acp/tp）`bands: []`、`category: awareness`。

- [ ] **Step 1: Write the failing test (data contract)**

`tests/data/self-check-yaml.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';

const DIR = join(process.cwd(), 'src/data/self-check');
const files = readdirSync(DIR).filter(f => f.endsWith('.yaml'));
const docs = files.map(f => ({ f, d: parse(readFileSync(join(DIR, f), 'utf8')) }));

describe('self-check YAML 題庫', () => {
  it('有 18 個題目檔（16 scored + 2 awareness）', () => {
    expect(files).toHaveLength(18);
  });

  it('scored 域 16、awareness 域 2', () => {
    const scored = docs.filter(x => x.d.category === 'scored');
    const aware = docs.filter(x => x.d.category === 'awareness');
    expect(scored).toHaveLength(16);
    expect(aware).toHaveLength(2);
  });

  it('每個 scored 域至少有 green 與 amber 兩段；awareness 域 bands 為空', () => {
    for (const { f, d } of docs) {
      if (d.category === 'scored') {
        const lights = new Set(d.bands.map((b: { light: string }) => b.light));
        expect(lights.has('green'), `${f} 缺 green`).toBe(true);
        expect(lights.has('amber'), `${f} 缺 amber`).toBe(true);
      } else {
        expect(d.bands, `${f} awareness 應無 bands`).toHaveLength(0);
      }
    }
  });

  it('全部 clinicallyReviewed:false（自我檢視非診斷）', () => {
    for (const { f, d } of docs) {
      expect(d.clinicallyReviewed, `${f}`).toBe(false);
    }
  });

  it('mood 含一題 redFlag:self-harm', () => {
    const mood = docs.find(x => x.d.id === 'sc-mood')!.d;
    const flagged = mood.items.filter((it: { redFlag?: string }) => it.redFlag === 'self-harm');
    expect(flagged).toHaveLength(1);
  });

  it('每題每選項 score 為數字、每題至少 2 選項', () => {
    for (const { f, d } of docs) {
      for (const it of d.items) {
        expect(it.options.length, `${f}/${it.id}`).toBeGreaterThanOrEqual(2);
        for (const o of it.options) expect(typeof o.score).toBe('number');
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/data/self-check-yaml.test.ts`
Expected: FAIL — directory empty / 0 files (`toHaveLength(18)` fails).

- [ ] **Step 3: Create the 18 YAML files**

> 燈號規則：單題 scored 域 `score 0 → green`、`score 1 → amber`。mood 為兩題（maxScore 2）：`0 → green`、`1–2 → amber`（自傷紅旗另由 redFlag 觸發 red 安全提示，不靠 band）。`financial` 沿用 triage 的反向計分（「足夠」=0、「不足」=1）。awareness 域 `bands: []`。

`src/data/self-check/comorbidity.yaml`:
```yaml
# 自評題，取材 comorbidity-triage。自我檢視非診斷，clinicallyReviewed:false。
id: sc-comorbidity
domain: { top: physical, sub: comorbidity }
category: scored
maxScore: 1
items:
  - id: q
    text: 您是否有長期治療中的慢性病（像高血壓、糖尿病、心臟病）？
    options:
      - { label: 沒有, score: 0 }
      - { label: 有, score: 1 }
bands:
  - { min: 0, max: 0, light: green, advice: 目前沒有慢性病困擾，請持續定期健康檢查。 }
  - { min: 1, max: 1, light: amber, advice: 有慢性病時建議規律回診、按時服藥，並請醫療人員整體評估。 }
clinicallyReviewed: false
```

`src/data/self-check/polypharmacy.yaml`:
```yaml
id: sc-polypharmacy
domain: { top: physical, sub: polypharmacy }
category: scored
maxScore: 1
items:
  - id: q
    text: 您每天是否固定服用 5 種以上的藥（含醫師開的處方）？
    options:
      - { label: 沒有（少於 5 種）, score: 0 }
      - { label: 有（5 種以上）, score: 1 }
bands:
  - { min: 0, max: 0, light: green, advice: 用藥種類不多，仍請定期請醫師或藥師檢視。 }
  - { min: 1, max: 1, light: amber, advice: 同時吃多種藥較易交互作用，建議帶所有藥請醫師或藥師整理。 }
clinicallyReviewed: false
```

`src/data/self-check/nutrition.yaml`:
```yaml
id: sc-nutrition
domain: { top: physical, sub: nutrition }
category: scored
maxScore: 1
items:
  - id: q
    text: 您最近是否食慾變差，或體重明顯減輕？
    options:
      - { label: 沒有, score: 0 }
      - { label: 有, score: 1 }
bands:
  - { min: 0, max: 0, light: green, advice: 目前食慾與體重穩定，請維持均衡飲食。 }
  - { min: 1, max: 1, light: amber, advice: 食慾變差或體重減輕可能是健康警訊，建議找醫療人員檢查。 }
clinicallyReviewed: false
```

`src/data/self-check/continence.yaml`:
```yaml
id: sc-continence
domain: { top: physical, sub: continence }
category: scored
maxScore: 1
items:
  - id: q
    text: 您是否曾有忍不住漏尿，或排尿方面的困擾？
    options:
      - { label: 沒有, score: 0 }
      - { label: 有, score: 1 }
bands:
  - { min: 0, max: 0, light: green, advice: 目前沒有排尿困擾。 }
  - { min: 1, max: 1, light: amber, advice: 漏尿或排尿困擾大多可以改善，建議找醫療人員評估，不需難為情。 }
clinicallyReviewed: false
```

`src/data/self-check/sensory.yaml`:
```yaml
id: sc-sensory
domain: { top: physical, sub: sensory }
category: scored
maxScore: 1
items:
  - id: q
    text: 您的視力或聽力，是否影響到日常生活（像看電視、和人交談）？
    options:
      - { label: 沒有, score: 0 }
      - { label: 有, score: 1 }
bands:
  - { min: 0, max: 0, light: green, advice: 視力與聽力目前沒有明顯影響。 }
  - { min: 1, max: 1, light: amber, advice: 視聽困難會影響安全與社交，建議檢查視力／聽力或調整輔具。 }
clinicallyReviewed: false
```

`src/data/self-check/pain.yaml`:
```yaml
id: sc-pain
domain: { top: physical, sub: pain }
category: scored
maxScore: 1
items:
  - id: q
    text: 您最近是否有讓您困擾的疼痛？
    options:
      - { label: 沒有, score: 0 }
      - { label: 有, score: 1 }
bands:
  - { min: 0, max: 0, light: green, advice: 目前沒有困擾的疼痛。 }
  - { min: 1, max: 1, light: amber, advice: 持續疼痛不必忍耐，建議找醫療人員評估與處理。 }
clinicallyReviewed: false
```

`src/data/self-check/cognition.yaml`（**新題：自覺記憶**）:
```yaml
# 新增自我檢視題（spec C-1：cognition 自覺記憶）。僅主觀篩檢、非認知診斷。
id: sc-cognition
domain: { top: psychological, sub: cognition }
category: scored
maxScore: 1
items:
  - id: q
    text: 您是否覺得自己的記憶或思考，比以前差，而且影響到日常生活？
    options:
      - { label: 沒有, score: 0 }
      - { label: 有, score: 1 }
bands:
  - { min: 0, max: 0, light: green, advice: 目前沒有自覺的記憶困擾。這只是主觀感受，不是診斷。 }
  - { min: 1, max: 1, light: amber, advice: 自覺記憶變差建議找醫療人員做完整評估；這只是初步檢視，不是診斷。 }
clinicallyReviewed: false
```

`src/data/self-check/mood.yaml`（**兩題：情緒低落 + 自傷紅旗**）:
```yaml
# 取材 mood-triage（情緒低落）+ 新增自傷紅旗題（spec C-1：含自傷紅旗）。
id: sc-mood
domain: { top: psychological, sub: mood }
category: scored
maxScore: 2
items:
  - id: low
    text: 最近兩週，您是否常感到情緒低落，或對事情提不起勁？
    options:
      - { label: 沒有, score: 0 }
      - { label: 有, score: 1 }
  - id: self_harm
    text: 最近兩週，您是否有不想活下去，或想傷害自己的念頭？
    redFlag: self-harm
    options:
      - { label: 沒有, score: 0 }
      - { label: 有, score: 1 }
bands:
  - { min: 0, max: 0, light: green, advice: 情緒狀態目前看起來還好。 }
  - { min: 1, max: 2, light: amber, advice: 情緒低落建議找人談談或尋求醫療人員協助。 }
clinicallyReviewed: false
```

`src/data/self-check/adl.yaml`:
```yaml
id: sc-adl
domain: { top: functional, sub: adl }
category: scored
maxScore: 1
items:
  - id: q
    text: 洗澡、穿衣、上廁所這些基本的事，您是否需要別人幫忙？
    options:
      - { label: 不需要（自己可以）, score: 0 }
      - { label: 需要幫忙, score: 1 }
bands:
  - { min: 0, max: 0, light: green, advice: 基本日常生活大致能自理。 }
  - { min: 1, max: 1, light: amber, advice: 基本生活需要協助時，建議找醫療人員評估復能與照顧資源。 }
clinicallyReviewed: false
```

`src/data/self-check/iadl.yaml`:
```yaml
id: sc-iadl
domain: { top: functional, sub: iadl }
category: scored
maxScore: 1
items:
  - id: q
    text: 買東西、煮飯、管理藥物或金錢這些事，您是否需要別人幫忙？
    options:
      - { label: 不需要（自己可以）, score: 0 }
      - { label: 需要幫忙, score: 1 }
bands:
  - { min: 0, max: 0, light: green, advice: 日常事務大致能自理。 }
  - { min: 1, max: 1, light: amber, advice: 較複雜的事務需要協助時，建議了解社區或長照支援。 }
clinicallyReviewed: false
```

`src/data/self-check/mobility.yaml`:
```yaml
id: sc-mobility
domain: { top: functional, sub: mobility }
category: scored
maxScore: 1
items:
  - id: q
    text: 走平路或從椅子上站起來，您是否感到困難？
    options:
      - { label: 沒有, score: 0 }
      - { label: 有, score: 1 }
bands:
  - { min: 0, max: 0, light: green, advice: 目前行動沒有明顯困難。 }
  - { min: 1, max: 1, light: amber, advice: 行動變慢或不穩建議評估，並留意居家防跌。 }
clinicallyReviewed: false
```

`src/data/self-check/falls.yaml`:
```yaml
id: sc-falls
domain: { top: functional, sub: falls }
category: scored
maxScore: 1
items:
  - id: q
    text: 過去一年內，您是否曾經跌倒，或站立、走路時會不穩？
    options:
      - { label: 沒有, score: 0 }
      - { label: 有, score: 1 }
bands:
  - { min: 0, max: 0, light: green, advice: 目前沒有明顯跌倒風險。 }
  - { min: 1, max: 1, light: amber, advice: 有跌倒或不穩建議找醫療人員評估，並檢視居家環境。 }
clinicallyReviewed: false
```

`src/data/self-check/social-support.yaml`:
```yaml
id: sc-social-support
domain: { top: social, sub: social_support }
category: scored
maxScore: 1
items:
  - id: q
    text: 您是否覺得孤單，或缺少需要時可以求助的家人、朋友？
    options:
      - { label: 沒有, score: 0 }
      - { label: 有, score: 1 }
bands:
  - { min: 0, max: 0, light: green, advice: 目前有可依靠的支持。 }
  - { min: 1, max: 1, light: amber, advice: 感到孤立時建議多與親友連結，或了解社區關懷資源。 }
clinicallyReviewed: false
```

`src/data/self-check/financial.yaml`:
```yaml
id: sc-financial
domain: { top: social, sub: financial }
category: scored
maxScore: 1
items:
  - id: q
    text: 您目前的收入，是否足夠支應日常生活與看病的花費？
    options:
      - { label: 足夠, score: 0 }
      - { label: 不太夠或勉強, score: 1 }
bands:
  - { min: 0, max: 0, light: green, advice: 目前經濟狀況尚可支應。 }
  - { min: 1, max: 1, light: amber, advice: 經濟有壓力時，建議了解政府補助與長照經濟支援。 }
clinicallyReviewed: false
```

`src/data/self-check/home-safety.yaml`:
```yaml
id: sc-home-safety
domain: { top: environmental, sub: home_safety }
category: scored
maxScore: 1
items:
  - id: q
    text: 您的住家是否有讓您擔心跌倒或受傷的地方（像地板濕滑、燈光不夠、沒有扶手）？
    options:
      - { label: 沒有, score: 0 }
      - { label: 有, score: 1 }
bands:
  - { min: 0, max: 0, light: green, advice: 居家環境目前沒有明顯危險。 }
  - { min: 1, max: 1, light: amber, advice: 建議改善照明、加裝扶手、移除絆腳物，可諮詢居家安全評估。 }
clinicallyReviewed: false
```

`src/data/self-check/accessibility.yaml`:
```yaml
id: sc-accessibility
domain: { top: environmental, sub: accessibility }
category: scored
maxScore: 1
items:
  - id: q
    text: 您是否有需要但還沒拿到的輔具，或外出時會遇到困難？
    options:
      - { label: 沒有, score: 0 }
      - { label: 有, score: 1 }
bands:
  - { min: 0, max: 0, light: green, advice: 目前沒有輔具或外出方面的困難。 }
  - { min: 1, max: 1, light: amber, advice: 建議了解輔具補助與無障礙交通資源。 }
clinicallyReviewed: false
```

`src/data/self-check/acp.yaml`（**awareness**）:
```yaml
# 覺察題（awareness）：不計風險、不亮黃燈；選「是」只在結尾提示可與醫療團隊討論。
id: sc-acp
domain: { top: future_wishes, sub: advance_care_planning }
category: awareness
maxScore: 1
items:
  - id: q
    text: 您是否想了解或安排「預立醫療照護」（先想好將來的醫療方向）？
    options:
      - { label: 還沒考慮, score: 0 }
      - { label: 想了解, score: 1 }
bands: []
clinicallyReviewed: false
```

`src/data/self-check/treatment-pref.yaml`（**awareness**）:
```yaml
id: sc-treatment-pref
domain: { top: future_wishes, sub: treatment_preferences }
category: awareness
maxScore: 1
items:
  - id: q
    text: 您是否想表達自己對未來醫療（像要不要急救）的想法？
    options:
      - { label: 還沒考慮, score: 0 }
      - { label: 想表達, score: 1 }
bands: []
clinicallyReviewed: false
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/data/self-check-yaml.test.ts`
Expected: PASS (6 tests).

Also run the Content Layer validation to confirm the Zod schema accepts every file:
Run: `pnpm build 2>&1 | grep -i "self-check\|error" | head` — expect no schema errors (build proceeds past content sync).

- [ ] **Step 5: Commit**

```bash
git add src/data/self-check/ tests/data/self-check-yaml.test.ts
git commit -m "feat(self-check): 18 個自評題庫 YAML（16 scored + 2 awareness）"
```

---

## Task 5: TTS 封裝 speak.ts

**Files:**
- Create: `src/lib/tts/speak.ts`
- Test: `tests/tts/speak.test.ts`

封裝 Web Speech API：`speak(text)` 朗讀、`cancelSpeech()` 取消、`hasZhTwVoice()` 偵測可用語音供降級判斷。所有函式對 `globalThis.speechSynthesis` 不存在時安全 no-op。

- [ ] **Step 1: Write the failing test**

`tests/tts/speak.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { speak, cancelSpeech, hasZhTwVoice } from '../../src/lib/tts/speak';

function installMockSynth(voices: { lang: string }[]) {
  const utterances: unknown[] = [];
  const synth = {
    speak: vi.fn((u: unknown) => utterances.push(u)),
    cancel: vi.fn(),
    getVoices: vi.fn(() => voices),
  };
  // @ts-expect-error test shim
  globalThis.speechSynthesis = synth;
  // @ts-expect-error test shim — constructor capturing text
  globalThis.SpeechSynthesisUtterance = class { text: string; lang = ''; rate = 1;
    constructor(t: string) { this.text = t; } };
  return { synth, utterances };
}

describe('tts/speak', () => {
  afterEach(() => {
    // @ts-expect-error cleanup
    delete globalThis.speechSynthesis;
    // @ts-expect-error cleanup
    delete globalThis.SpeechSynthesisUtterance;
    vi.restoreAllMocks();
  });

  it('hasZhTwVoice true when a zh-TW voice exists', () => {
    installMockSynth([{ lang: 'en-US' }, { lang: 'zh-TW' }]);
    expect(hasZhTwVoice()).toBe(true);
  });

  it('hasZhTwVoice false when no zh voice', () => {
    installMockSynth([{ lang: 'en-US' }]);
    expect(hasZhTwVoice()).toBe(false);
  });

  it('hasZhTwVoice false when speechSynthesis missing', () => {
    expect(hasZhTwVoice()).toBe(false);
  });

  it('speak cancels in-flight speech then speaks the text', () => {
    const { synth, utterances } = installMockSynth([{ lang: 'zh-TW' }]);
    speak('過去一年是否跌倒過？');
    expect(synth.cancel).toHaveBeenCalled();
    expect(synth.speak).toHaveBeenCalledTimes(1);
    expect((utterances[0] as { text: string }).text).toBe('過去一年是否跌倒過？');
    expect((utterances[0] as { lang: string }).lang).toBe('zh-TW');
  });

  it('speak is a safe no-op when speechSynthesis missing', () => {
    expect(() => speak('hi')).not.toThrow();
  });

  it('cancelSpeech is a safe no-op when speechSynthesis missing', () => {
    expect(() => cancelSpeech()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/tts/speak.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/lib/tts/speak.ts`:

```typescript
/**
 * 民眾自評層 TTS（Web Speech API / SpeechSynthesis），語言 zh-TW。
 * 零後端、本機合成、無音檔資產，符合「不使用大陸廠牌 AI 服務」（用 OS/瀏覽器本機語音）。
 * 所有函式在 speechSynthesis 不存在（SSR、舊瀏覽器）時安全 no-op，呼叫端據 hasZhTwVoice() 降級。
 */

function synth(): SpeechSynthesis | null {
  return typeof globalThis !== 'undefined' && 'speechSynthesis' in globalThis
    ? (globalThis.speechSynthesis as SpeechSynthesis)
    : null;
}

/** 是否有可朗讀中文（zh 開頭，優先 zh-TW）的本機語音。供降級判斷。 */
export function hasZhTwVoice(): boolean {
  const s = synth();
  if (!s) return false;
  const voices = s.getVoices();
  return voices.some(v => v.lang === 'zh-TW') || voices.some(v => v.lang.startsWith('zh'));
}

/** 取消當前朗讀。 */
export function cancelSpeech(): void {
  synth()?.cancel();
}

/** 朗讀一段文字（先取消在途語音避免疊音）。無 speechSynthesis 時 no-op。 */
export function speak(text: string): void {
  const s = synth();
  if (!s || typeof globalThis.SpeechSynthesisUtterance === 'undefined') return;
  s.cancel();
  const u = new globalThis.SpeechSynthesisUtterance(text);
  u.lang = 'zh-TW';
  u.rate = 0.9; // 略慢，長者較易聽清楚
  s.speak(u);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/tts/speak.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tts/speak.ts tests/tts/speak.test.ts
git commit -m "feat(self-check): Web Speech API TTS 封裝（zh-TW + 降級偵測）"
```

---

## Task 6: self-check store（runes，純記憶體步驟機）

**Files:**
- Create: `src/lib/stores/self-check.svelte.ts`
- Test: `tests/self-check/store.test.ts`

步驟 `intro → screening → summary`，扁平題目佇列（所有 scale 的 items 串成一列），逐題前進/後退，記錄 answers，計算 summary。不寫 IndexedDB。

- [ ] **Step 1: Write the failing test**

`tests/self-check/store.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { SelfCheckStore } from '../../src/lib/stores/self-check.svelte';
import type { SelfCheckScale } from '../../src/lib/self-check/self-check';

const falls: SelfCheckScale = {
  id: 'sc-falls', domain: { top: 'functional', sub: 'falls' }, category: 'scored', maxScore: 1,
  items: [{ id: 'f', text: '跌倒？', options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] }],
  bands: [
    { min: 0, max: 0, light: 'green', advice: '沒事。' },
    { min: 1, max: 1, light: 'amber', advice: '評估。' },
  ],
  clinicallyReviewed: false,
};
const mood: SelfCheckScale = {
  id: 'sc-mood', domain: { top: 'psychological', sub: 'mood' }, category: 'scored', maxScore: 2,
  items: [
    { id: 'low', text: '低落？', options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] },
    { id: 'sh', text: '自傷？', redFlag: 'self-harm', options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] },
  ],
  bands: [
    { min: 0, max: 0, light: 'green', advice: '還好。' },
    { min: 1, max: 2, light: 'amber', advice: '談談。' },
  ],
  clinicallyReviewed: false,
};

describe('SelfCheckStore', () => {
  let store: SelfCheckStore;
  beforeEach(() => { store = new SelfCheckStore([falls, mood]); });

  it('starts at intro', () => {
    expect(store.step).toBe('intro');
  });

  it('start() moves to screening at first question', () => {
    store.start();
    expect(store.step).toBe('screening');
    expect(store.currentItem?.id).toBe('f');
    expect(store.totalQuestions).toBe(3);
  });

  it('answer() records score and advances; last answer → summary', () => {
    store.start();
    store.answer(0);            // f
    expect(store.currentItem?.id).toBe('low');
    store.answer(1);            // low
    expect(store.currentItem?.id).toBe('sh');
    store.answer(0);            // sh (last)
    expect(store.step).toBe('summary');
  });

  it('summary reflects answers (amber from mood low)', () => {
    store.start();
    store.answer(0); store.answer(1); store.answer(0);
    expect(store.summary.overall).toBe('amber');
    expect(store.summary.concerns.map(c => c.sub)).toContain('mood');
  });

  it('redFlagActive becomes true once self-harm answered positive', () => {
    store.start();
    store.answer(0); store.answer(0);
    expect(store.redFlagActive).toBe(false);
    store.answer(1);            // sh = 是
    expect(store.redFlagActive).toBe(true);
  });

  it('back() returns to previous question keeping its answer', () => {
    store.start();
    store.answer(1);            // f = 1
    store.back();
    expect(store.currentItem?.id).toBe('f');
    expect(store.answers['f']).toBe(1);
  });

  it('reset() returns to intro and clears answers', () => {
    store.start(); store.answer(1);
    store.reset();
    expect(store.step).toBe('intro');
    expect(Object.keys(store.answers)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/self-check/store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/lib/stores/self-check.svelte.ts`:

```typescript
import type { SelfCheckScale, SelfCheckItem, SelfCheckAnswers } from '$lib/self-check/self-check';
import { summariseSelfCheck, type SelfCheckSummary } from '$lib/self-check/summarise';

export type SelfCheckStep = 'intro' | 'screening' | 'summary';

interface QueueEntry { item: SelfCheckItem; scaleId: string; }

/**
 * 民眾自評步驟機（Svelte 5 runes）。純記憶體：不寫 IndexedDB
 * （一次性 2–3 分鐘快測，重整即重來，承 spec 非目標）。
 */
export class SelfCheckStore {
  readonly scales: SelfCheckScale[];
  private readonly queue: QueueEntry[];

  step = $state<SelfCheckStep>('intro');
  index = $state(0);
  answers = $state<SelfCheckAnswers>({});

  constructor(scales: SelfCheckScale[]) {
    this.scales = scales;
    this.queue = scales.flatMap(sc => sc.items.map(item => ({ item, scaleId: sc.id })));
  }

  get totalQuestions(): number { return this.queue.length; }
  currentItem = $derived(this.queue[this.index]?.item ?? null);
  progress = $derived(this.totalQuestions > 0 ? this.index / this.totalQuestions : 0);

  /** 已答之 redFlag 題是否有正分（自傷念頭）。驅動作答頁安全提示。 */
  redFlagActive = $derived(
    this.queue.some(q => q.item.redFlag === 'self-harm' && (this.answers[q.item.id] ?? 0) > 0),
  );

  summary = $derived<SelfCheckSummary>(summariseSelfCheck(this.scales, this.answers));

  start(): void {
    this.step = 'screening';
    this.index = 0;
  }

  /** 記錄當前題分數並前進；最後一題後 → summary。 */
  answer(score: number): void {
    const entry = this.queue[this.index];
    if (!entry) return;
    this.answers = { ...this.answers, [entry.item.id]: score };
    if (this.index < this.queue.length - 1) {
      this.index++;
    } else {
      this.step = 'summary';
    }
  }

  back(): void {
    if (this.index > 0) this.index--;
  }

  reset(): void {
    this.step = 'intro';
    this.index = 0;
    this.answers = {};
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/self-check/store.test.ts`
Expected: PASS (7 tests).

> Note: `.svelte.ts` runes (`$state`/`$derived`) compile under the project's Vitest config (it already tests `assessment.svelte.ts`-style stores). If a class-field `$derived` ordering issue arises, keep `$derived` declarations after the `$state` they read — as written.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/self-check.svelte.ts tests/self-check/store.test.ts
git commit -m "feat(self-check): runes 步驟機 store（intro→screening→summary）"
```

---

## Task 7: 自評 PDF 摘要 buildSelfCheckPdf

**Files:**
- Create: `src/lib/self-check/self-check-pdf.ts`
- Test: `tests/self-check/self-check-pdf.test.ts`

簡化 jsPDF：標題 + 日期 + 整體燈號 + 建議關注領域清單 + 免責。沿用 `loadChineseFontInto`。回傳 jsPDF doc（呼叫端 `.save()`）。

- [ ] **Step 1: Write the failing test**

`tests/self-check/self-check-pdf.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

// 隔離字體載入（避免測試 fetch public/fonts）。
vi.mock('../../src/lib/pdf/font-loader', () => ({
  loadChineseFontInto: vi.fn(async () => {}),
}));

import { buildSelfCheckPdf } from '../../src/lib/self-check/self-check-pdf';
import type { SelfCheckSummary } from '../../src/lib/self-check/summarise';

const summary: SelfCheckSummary = {
  overall: 'amber',
  redFlag: false,
  concerns: [
    { top: 'physical', sub: 'pain', label: '疼痛', advice: '持續疼痛建議就醫。' },
    { top: 'functional', sub: 'falls', label: '平衡跌倒', advice: '建議評估跌倒風險。' },
  ],
  awareness: [],
};

describe('buildSelfCheckPdf', () => {
  it('returns a jsPDF doc with the concern labels rendered', async () => {
    const doc = await buildSelfCheckPdf(summary, '2026-05-31');
    expect(doc).toBeTruthy();
    // jsPDF 內部累積文字可由 output('datauristring') 長度間接驗證非空白頁
    const data = doc.output('datauristring');
    expect(typeof data).toBe('string');
    expect(data.length).toBeGreaterThan(1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/self-check/self-check-pdf.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/lib/self-check/self-check-pdf.ts`:

```typescript
import { jsPDF } from 'jspdf';
import { loadChineseFontInto } from '$lib/pdf/font-loader';
import type { SelfCheckSummary } from './summarise';

const OVERALL_LABEL: Record<SelfCheckSummary['overall'], string> = {
  green: '綠燈：目前看起來都還好',
  amber: '黃燈：有幾項建議多留意',
  red: '紅燈：建議盡快尋求協助',
};

/**
 * 產生可帶去門診的自我檢視摘要 PDF。中文以 Noto Sans TC subset 渲染。
 * 不含任何臨床分數（民眾版），只列整體燈號、建議關注領域與免責。
 * @param dateText 由呼叫端傳入（scripts 不可用 Date.now，UI 端以 new Date().toLocaleDateString 傳入）。
 */
export async function buildSelfCheckPdf(summary: SelfCheckSummary, dateText: string): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  await loadChineseFontInto(doc);

  const left = 56;
  let y = 72;

  doc.setFont('NotoSansTC', 'bold');
  doc.setFontSize(20);
  doc.text('高齡自我檢視摘要', left, y);
  y += 28;

  doc.setFont('NotoSansTC', 'normal');
  doc.setFontSize(12);
  doc.text(`檢視日期：${dateText}`, left, y);
  y += 28;

  doc.setFont('NotoSansTC', 'bold');
  doc.setFontSize(14);
  doc.text(OVERALL_LABEL[summary.overall], left, y);
  y += 26;

  doc.setFont('NotoSansTC', 'normal');
  doc.setFontSize(12);
  if (summary.redFlag) {
    doc.text('※ 您在情緒題目提到不想活下去或想傷害自己——請立即聯絡 1925 安心專線或就醫。', left, y, { maxWidth: 480 });
    y += 30;
  }

  if (summary.concerns.length > 0) {
    doc.setFont('NotoSansTC', 'bold');
    doc.text('建議多留意的方面：', left, y);
    y += 22;
    doc.setFont('NotoSansTC', 'normal');
    for (const c of summary.concerns) {
      doc.text(`• ${c.label}：${c.advice}`, left + 12, y, { maxWidth: 468 });
      y += 24;
    }
  } else {
    doc.text('各方面目前都沒有需要特別留意的地方。', left, y);
    y += 24;
  }

  if (summary.awareness.length > 0) {
    y += 6;
    doc.setFont('NotoSansTC', 'bold');
    doc.text('您表示有興趣進一步了解：', left, y);
    y += 22;
    doc.setFont('NotoSansTC', 'normal');
    for (const a of summary.awareness) {
      doc.text(`• ${a.label}（可與醫療團隊討論）`, left + 12, y, { maxWidth: 468 });
      y += 24;
    }
  }

  y += 12;
  doc.setFontSize(10);
  doc.text('本工具為自我檢視，非醫療診斷。建議攜此摘要找醫療人員做完整評估。', left, y, { maxWidth: 480 });

  return doc;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/self-check/self-check-pdf.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/lib/self-check/self-check-pdf.ts tests/self-check/self-check-pdf.test.ts
git commit -m "feat(self-check): 自我檢視摘要 PDF（jsPDF + Noto Sans TC）"
```

---

## Task 8: Svelte 元件 — Intro / Questionnaire / Result / Shell

**Files:**
- Create: `src/components/self-check/SelfCheckIntro.svelte`
- Create: `src/components/self-check/SelfCheckQuestionnaire.svelte`
- Create: `src/components/self-check/SelfCheckResult.svelte`
- Create: `src/components/self-check/SelfCheckShell.svelte`

無 runes 純函式邏輯已測；元件層在 Task 10 由 Playwright 端到端驗證。每步先實作再目視。

- [ ] **Step 1: SelfCheckIntro.svelte**

```svelte
<script lang="ts">
interface Props { onStart: () => void; }
const { onStart }: Props = $props();
</script>

<section class="intro">
  <h1>高齡自我檢視</h1>
  <p class="lead">這是一份簡單的自我檢視，大約 2–3 分鐘。會用語音唸出問題，您只要點「有」或「沒有」。</p>
  <div class="disclaimer" role="note">
    <strong>請注意</strong>
    <p>這只是幫您看看哪些方面需要多留意，<u>不是醫療診斷</u>。檢視完會建議您找醫療人員做完整評估。</p>
  </div>
  <button class="start-btn" onclick={onStart}>開始檢視</button>
</section>

<style>
.intro { max-width: 620px; margin: 0 auto; text-align: center; padding: var(--space-6) var(--space-4); }
.intro h1 { font-size: var(--text-2xl); margin-bottom: var(--space-4); }
.lead { font-size: var(--text-lg); line-height: var(--lh-lg); margin-bottom: var(--space-5); }
.disclaimer { text-align: left; border: 2px solid var(--line); border-radius: var(--radius-md);
  padding: var(--space-4); margin-bottom: var(--space-6); background: var(--surface); }
.disclaimer p { font-size: var(--text-base); margin-top: var(--space-2); }
.start-btn { min-height: 64px; padding: 0 var(--space-8); font-size: var(--text-xl); font-weight: var(--font-bold);
  color: white; background: var(--accent); border: none; border-radius: var(--radius-md); cursor: pointer; }
</style>
```

- [ ] **Step 2: SelfCheckQuestionnaire.svelte**

朗讀當前題（`$effect` 監看 `currentItem`）、大按鈕作答、紅旗安全提示、TTS 重播鈕、上一題鈕、無語音降級提示。

```svelte
<script lang="ts">
import type { SelfCheckStore } from '$lib/stores/self-check.svelte';
import type { SelfCheckItem } from '$lib/self-check/self-check';
import { speak, cancelSpeech, hasZhTwVoice } from '$lib/tts/speak';

interface Props { store: SelfCheckStore; }
const { store }: Props = $props();

let ttsAvailable = $state(true);

$effect(() => {
  // 首次掛載後查詢語音（getVoices 在某些瀏覽器需稍候，但降級僅影響是否顯示提示）。
  ttsAvailable = hasZhTwVoice();
});

// 進新題自動朗讀；元件卸載/換題前取消在途語音。
$effect(() => {
  const item: SelfCheckItem | null = store.currentItem;
  if (item) speak(item.text);
  return () => cancelSpeech();
});

function choose(score: number): void {
  cancelSpeech();
  store.answer(score);
}
</script>

{#if store.currentItem}
  <section class="q" aria-live="polite">
    <div class="progress" aria-hidden="true">
      <div class="progress-fill" style="width:{Math.round(store.progress * 100)}%"></div>
    </div>

    {#if store.redFlagActive}
      <div class="safety" role="alert">
        <strong>請立即尋求協助</strong>
        <p>如果您有不想活下去或傷害自己的念頭，請馬上聯絡：</p>
        <ul>
          <li>安心專線 <a href="tel:1925">1925</a>（24 小時）</li>
          <li>生命線 <a href="tel:1995">1995</a></li>
        </ul>
      </div>
    {/if}

    <h2 class="stem">{store.currentItem.text}</h2>

    <button type="button" class="replay" onclick={() => speak(store.currentItem!.text)}>🔊 再唸一次</button>
    {#if !ttsAvailable}
      <p class="no-tts">（此裝置沒有中文語音，請直接閱讀題目）</p>
    {/if}

    <div class="options">
      {#each store.currentItem.options as opt (opt.label)}
        <button type="button" class="opt-btn" onclick={() => choose(opt.score)}>{opt.label}</button>
      {/each}
    </div>

    {#if store.index > 0}
      <button type="button" class="back" onclick={() => store.back()}>← 上一題</button>
    {/if}
  </section>
{/if}

<style>
.q { max-width: 620px; margin: 0 auto; padding: var(--space-5) var(--space-4); text-align: center; }
.progress { height: 8px; background: var(--surface); border-radius: 4px; overflow: hidden; margin-bottom: var(--space-6); }
.progress-fill { height: 100%; background: var(--accent); }
.stem { font-size: var(--text-xl); line-height: var(--lh-xl); margin-bottom: var(--space-4); }
.replay { min-height: 44px; padding: 0 var(--space-4); font-size: var(--text-base); background: var(--surface);
  border: 1px solid var(--line); border-radius: var(--radius-md); cursor: pointer; margin-bottom: var(--space-2); }
.no-tts { font-size: var(--text-sm); color: var(--text); opacity: 0.7; margin-bottom: var(--space-4); }
.options { display: flex; flex-direction: column; gap: var(--space-3); margin: var(--space-5) 0; }
.opt-btn { min-height: 64px; font-size: var(--text-lg); font-weight: var(--font-bold); color: var(--text);
  background: var(--bg); border: 2px solid var(--accent); border-radius: var(--radius-md); cursor: pointer; }
.opt-btn:active { background: color-mix(in srgb, var(--accent) 15%, var(--bg)); }
.back { min-height: 44px; font-size: var(--text-base); background: none; border: none; color: var(--text);
  opacity: 0.7; cursor: pointer; }
.safety { text-align: left; border: 2px solid var(--danger); border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--danger) 10%, var(--bg)); padding: var(--space-4); margin-bottom: var(--space-5); }
.safety a { font-weight: var(--font-bold); }
</style>
```

- [ ] **Step 3: SelfCheckResult.svelte**

```svelte
<script lang="ts">
import type { SelfCheckStore } from '$lib/stores/self-check.svelte';
import { buildSelfCheckPdf } from '$lib/self-check/self-check-pdf';

interface Props { store: SelfCheckStore; }
const { store }: Props = $props();

const s = $derived(store.summary);

const HEADLINE: Record<typeof s.overall, string> = {
  green: '目前看起來都還好 🟢',
  amber: '有幾項建議多留意 🟡',
  red: '建議盡快尋求協助 🔴',
};

let saving = $state(false);
async function downloadPdf(): Promise<void> {
  saving = true;
  try {
    const dateText = new Date().toLocaleDateString('zh-TW');
    const doc = await buildSelfCheckPdf(s, dateText);
    doc.save('高齡自我檢視摘要.pdf');
  } finally {
    saving = false;
  }
}
</script>

<section class="result">
  <h1 class="headline" data-overall={s.overall}>{HEADLINE[s.overall]}</h1>

  {#if s.redFlag}
    <div class="safety" role="alert">
      <strong>請立即尋求協助</strong>
      <p>您提到有不想活下去或傷害自己的念頭，請馬上聯絡安心專線 <a href="tel:1925">1925</a>（24 小時）或就醫。</p>
    </div>
  {/if}

  {#if s.concerns.length > 0}
    <h2>建議多留意的方面</h2>
    <ul class="concerns">
      {#each s.concerns as c (c.sub)}
        <li><span class="dot amber" aria-hidden="true"></span><strong>{c.label}</strong>：{c.advice}</li>
      {/each}
    </ul>
  {:else}
    <p class="all-clear">各方面目前都沒有需要特別留意的地方，請繼續保持。</p>
  {/if}

  {#if s.awareness.length > 0}
    <h2>您有興趣進一步了解</h2>
    <ul class="awareness">
      {#each s.awareness as a (a.sub)}
        <li>{a.label}（可與醫療團隊討論）</li>
      {/each}
    </ul>
  {/if}

  <p class="disclaimer">本工具為自我檢視，非醫療診斷。建議攜此結果找醫療人員做完整評估。</p>

  <div class="actions">
    <button class="pdf-btn" onclick={downloadPdf} disabled={saving}>
      {saving ? '產生中…' : '下載摘要（PDF）'}
    </button>
    <button class="restart-btn" onclick={() => store.reset()}>重新檢視</button>
  </div>
</section>

<style>
.result { max-width: 640px; margin: 0 auto; padding: var(--space-6) var(--space-4); }
.headline { font-size: var(--text-2xl); text-align: center; margin-bottom: var(--space-5); }
.headline[data-overall='red'] { color: var(--danger); }
h2 { font-size: var(--text-lg); margin: var(--space-5) 0 var(--space-2); }
.concerns, .awareness { list-style: none; padding: 0; }
.concerns li, .awareness li { font-size: var(--text-base); line-height: var(--lh-base); margin-bottom: var(--space-3);
  display: flex; gap: var(--space-2); align-items: baseline; }
.dot { flex: 0 0 12px; width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
.dot.amber { background: var(--warn); }
.all-clear { font-size: var(--text-lg); text-align: center; color: var(--accent); }
.safety { border: 2px solid var(--danger); border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--danger) 10%, var(--bg)); padding: var(--space-4); margin-bottom: var(--space-5); }
.disclaimer { font-size: var(--text-sm); opacity: 0.75; margin-top: var(--space-6); }
.actions { display: flex; flex-direction: column; gap: var(--space-3); margin-top: var(--space-5); }
.pdf-btn { min-height: 56px; font-size: var(--text-lg); font-weight: var(--font-bold); color: white;
  background: var(--accent); border: none; border-radius: var(--radius-md); cursor: pointer; }
.restart-btn { min-height: 48px; font-size: var(--text-base); background: var(--surface);
  border: 1px solid var(--line); border-radius: var(--radius-md); cursor: pointer; }
</style>
```

- [ ] **Step 4: SelfCheckShell.svelte**

```svelte
<script lang="ts">
import { SelfCheckStore } from '$lib/stores/self-check.svelte';
import type { SelfCheckScale } from '$lib/self-check/self-check';
import SelfCheckIntro from './SelfCheckIntro.svelte';
import SelfCheckQuestionnaire from './SelfCheckQuestionnaire.svelte';
import SelfCheckResult from './SelfCheckResult.svelte';

interface Props { scales: SelfCheckScale[]; }
const { scales }: Props = $props();

const store = new SelfCheckStore(scales);
</script>

{#if store.step === 'intro'}
  <SelfCheckIntro onStart={() => store.start()} />
{:else if store.step === 'screening'}
  <SelfCheckQuestionnaire {store} />
{:else}
  <SelfCheckResult {store} />
{/if}
```

- [ ] **Step 5: Type-check then commit**

Run: `pnpm check`
Expected: 0 errors.

```bash
git add src/components/self-check/
git commit -m "feat(self-check): Intro/Questionnaire/Result/Shell 元件 + TTS 朗讀 + 紅旗提示"
```

---

## Task 9: self-check.astro 頁面

**Files:**
- Create: `src/pages/self-check.astro`

- [ ] **Step 1: Create the page (mirrors `assess.astro`)**

```astro
---
import Base from '../layouts/Base.astro';
import Header from '../components/blocks/Header.astro';
import SelfCheckShell from '../components/self-check/SelfCheckShell.svelte';
import { getCollection } from 'astro:content';
import { toSelfCheckScales } from '../lib/self-check/load-self-checks';

const entries = await getCollection('selfChecks');
const scales = toSelfCheckScales(entries);
---

<Base title="高齡自我檢視" description="2–3 分鐘的高齡自我檢視，語音唸題、白話結果，建議找醫療人員做完整評估。">
  <div class="app-layout">
    <Header />
    <main id="main-content" class="app-main" data-pagefind-body>
      <SelfCheckShell client:load {scales} />
    </main>
  </div>
</Base>

<style>
  .app-layout { min-height: 100dvh; display: flex; flex-direction: column; }
  .app-main { flex: 1; padding: var(--space-6) var(--space-4); max-width: 720px; width: 100%; margin: 0 auto; }
</style>
```

- [ ] **Step 2: Build to verify the route compiles and collection resolves**

Run: `pnpm build 2>&1 | tail -20`
Expected: build succeeds; `dist/self-check/index.html` produced.
Verify: `ls dist/self-check/index.html` → file exists.

- [ ] **Step 3: Commit**

```bash
git add src/pages/self-check.astro
git commit -m "feat(self-check): /self-check 頁面路由"
```

---

## Task 10: Playwright 端到端驗證

**Files:**
- (no source change — verification task)

- [ ] **Step 1: Start preview server**

```bash
pnpm build && pnpm preview --port 4321 &
```

- [ ] **Step 2: 全綠路徑（所有「沒有」→ green）**

用 Playwright MCP 導向 `http://localhost:4321/self-check`：
1. 點「開始檢視」→ 進第一題。
2. 連續點每題第一個選項（「沒有」/「足夠」/「不需要」/「還沒考慮」）直到結果頁。
3. 斷言結果頁標題含「都還好 🟢」、無「建議多留意」清單、無紅旗 alert。

- [ ] **Step 3: 自傷紅旗路徑**

1. 重新檢視，前進到 mood 自傷題（`最近兩週，您是否有不想活下去…`），點「有」。
2. 斷言作答頁立即出現 `role="alert"` 安全提示含 `1925`。
3. 完成剩餘題到結果頁，斷言標題含「盡快尋求協助 🔴」且結果頁亦有 1925 安全提示。

- [ ] **Step 4: 黃燈 + PDF**

1. 重新檢視，falls 題點「有」、其餘「沒有」。
2. 斷言結果頁「建議多留意的方面」含「平衡跌倒」。
3. 點「下載摘要（PDF）」，斷言觸發下載（Playwright `download` 事件）。

- [ ] **Step 5: TTS 煙測（不阻斷）**

於 Playwright console 執行 `window.speechSynthesis?.getVoices().length` 記錄；若 0，確認作答頁顯示「此裝置沒有中文語音」降級提示而非報錯。

- [ ] **Step 6: Record results, stop server**

```bash
kill %1
```

記錄三條路徑結果於 commit message。

```bash
git commit --allow-empty -m "test(self-check): playwright 端到端三路徑（全綠/自傷紅旗/黃燈+PDF）通過"
```

---

## Task 11: 首頁入口連結

**Files:**
- Modify: `src/pages/index.astro`（或 `src/components/blocks/Header.astro`，依現有導覽結構擇一）

- [ ] **Step 1: 先確認首頁結構**

Run: `grep -n "assess\|開始評估\|href" src/pages/index.astro | head -20`
找到既有「開始評估」CTA 區塊的位置與 class。

- [ ] **Step 2: 在「開始評估」CTA 旁加一個次要 CTA**

在既有 `<a href="/assess">…開始評估…</a>`（或其 base-aware 寫法）後加入：

```astro
<a href="/self-check" class="cta-secondary">民眾自我檢視（2–3 分鐘）</a>
```

> 若首頁的連結使用 `import.meta.env.BASE_URL` 前綴，沿用相同寫法：`href={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/self-check`}`。實作時比照同檔既有 `/assess` 連結的寫法，保持一致。

加上對應樣式（比照 `.cta-secondary` 既有樣式；若無則新增最小樣式，沿用 tokens）。

- [ ] **Step 3: Build + 目視確認首頁兩個入口**

Run: `pnpm build 2>&1 | tail -5`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/pages/index.astro
git commit -m "feat(self-check): 首頁加民眾自我檢視入口"
```

---

## Task 12: 全綠驗證 + 收尾

- [ ] **Step 1: 全套關卡**

```bash
pnpm check && pnpm lint && pnpm exec vitest run && pnpm build
```

Expected: check 0 errors、lint 0 errors、vitest 全綠（既有 400 + 新增約 24 ≈ 424 pass）、build 成功（含 self-check 路由 + Pagefind 索引）。

- [ ] **Step 2: 確認 self-check 路由與題庫數**

```bash
ls dist/self-check/index.html && ls src/data/self-check/*.yaml | wc -l
```

Expected: 檔案存在、18。

- [ ] **Step 3: 更新 memory**

更新 `~/.claude/.../memory/geri-repurpose-state.md`：Phase 3 ✅ 上線、self-check 路由、18 題庫、TTS、PDF；並更新 `MEMORY.md` 索引一行。

- [ ] **Step 4: Final commit（若 memory 在 repo 外則略）**

```bash
git log --oneline -13
```

確認 12 個 task commit 完整。

---

## Self-Review

**1. Spec coverage（對 `2026-05-29-dual-track-self-check-and-triage-redesign.md` §C 自評層）：**
- C 頁面 `/self-check` + island client:load → Task 9 ✅
- C self-check store（intro→screening→summary，不重用 assessment）→ Task 6 ✅
- C 元件 Shell/Intro/Questionnaire/Result → Task 8 ✅
- C 無 CFS、無問家屬 → store 無 CFS/informant 欄位 ✅
- C 無障礙字級/觸控高於 18px/44px → 選項 `--text-lg`(24px)/`min-height:64px` ✅
- C-1 收錄 16 計分域 + 排除 delirium/caregiver + acp/tp 覺察題 → Task 4（16 scored + 2 awareness）✅
- C-1 cognition 自覺題、mood 自傷紅旗 → Task 4 新題 ✅
- C-2 Web Speech API zh-TW + 無語音降級 → Task 5 + Task 8 Questionnaire ✅
- C-3 白話紅黃綠、不顯示 0–100、紅旗就醫、免責、PDF 摘要 → Task 2/7/8 ✅
- 非目標：無帳號/雲端/FHIR、不自創臨床內容（取材 triage）、QR 延後 → 遵守 ✅

**2. Placeholder scan：** 無 TBD/TODO；每個 code 步驟均含完整程式碼；18 個 yaml 全列；測試含實際斷言。Task 11 因首頁結構需現場確認，已標明「比照既有 /assess 連結寫法」並給 grep 步驟，非空泛佔位。

**3. Type consistency：**
- `SelfCheckScale`/`SelfCheckItem`/`SelfCheckBand`/`SelfCheckAnswers`/`SelfCheckScaleResult`（Task 1）→ summarise（Task 2）、loader（Task 3）、store（Task 6）、pdf（Task 7）一致引用。
- `SelfLight = 'green'|'amber'`（band 層）vs `SelfOverall = 'green'|'amber'|'red'`（summary 層，red 僅來自 redFlag）— 命名刻意區分，已於 Task 1/2 註解說明。
- `summariseSelfCheck(scales, answers)` 簽名於 Task 2 定義、Task 6 store `summary` $derived 一致。
- TTS `speak`/`cancelSpeech`/`hasZhTwVoice`（Task 5）→ Questionnaire（Task 8）一致。
- collection 名 `selfChecks`（Task 3 content.config + Task 9 getCollection）一致。

無不一致。計分方向特例（financial「足夠」=0）已於 Task 4 註解標明。

---

## Execution Handoff

（由 plan 撰寫者於儲存後向使用者提供執行選項。）
