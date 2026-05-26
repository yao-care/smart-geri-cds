# 統一衛教內容關聯系統 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把散在 6 處的「衛教內容 ↔ 情境」對應收斂成單一真相源 `content-relevance.yaml`，三視圖（矩陣 / 評估後推薦 / 觸發影片）全部從它投影，並刪除所有重複與死代碼。

**Architecture:** build 期把 `content-relevance.yaml`（含 `inapplicable` + 每筆內容的 `cdsa`/`clinical` 關聯）編譯成 `public/data/video-index.json`。**關鍵去風險策略：新 index 是現有 index 的嚴格超集** —— `catalog`/`triggers`/`educationSlugToTriggers` 三個鍵維持位元等價（既有 matrix/trigger/video-lookup 消費端零改動、可 parity 驗證），另加 `recommendations`（年齡感知）與 `clinicalEducation`（給 closed-loop）。消費端每階段只切換一個，old 檔逐階段刪除。

**Tech Stack:** Astro 5 SSG, TypeScript strict, zod (astro/zod), js-yaml, Dexie 4 (IndexedDB), vitest, pnpm。

**分類法單一源原則：** 關聯 → `content-relevance.yaml`；領域/年齡/嚴重度/指標 enum → `schemas.ts`；內容自身事實 → `.md` / `video-catalog/*.yaml`。

---

## 規模與分階段

本計畫**分 4 階段循序**，每階段獨立可測、可上線、不破壞線上：

| 階段 | 目標 | 行為改變？ | 風險 |
|------|------|-----------|------|
| Phase 0 | enum 單一源 + 刪死代碼 | 無 | 低 |
| Phase 1 | `content-relevance.yaml` + 新 build（超集 index）+ parity；刪 3 yaml + inapplicable-matrix | 無 | 中 |
| Phase 2 | closed-loop ④ 改讀投影（移除硬寫 map） | 無（等價對應） | 中 |
| Phase 3 | 推薦年齡感知 + overlay 加 ageGroup（Dexie 遷移）+ RecommendationsManager 讀 index + 合併 custom-education；刪 `default.json` | **有**（推薦看年齡） | 高 |

> Phase 3 是唯一行為改變與 DB 遷移所在，最後做、最謹慎。

---

## 既有資料事實（執行者必讀）

- `AGE_GROUPS_CDSA` = `['2-6m','7-12m','13-24m','25-36m','37-48m','49-60m','61-72m']`（`src/lib/utils/age-groups.ts`）。
- CDSS 粗年齡 ↔ CDSA 細年齡：`infant`→`2-6m,7-12m`；`toddler`→`13-24m,25-36m`；`preschool`→`37-48m,49-60m,61-72m`。
- **不適用 10 格**（source：`scripts/curate/inapplicable-matrix.json`）：behavior[2-6m,7-12m]、fine_motor[2-6m]、language[2-6m]、cognition[2-6m,7-12m]、language_comprehension[2-6m]、language_expression[2-6m,7-12m]、social_emotional[2-6m]。gross_motor 無。
- **領域命名不一致（必須正規化）**：`recommendations`/`default.json` 用 `language_comp`、`language_expr`、`diet`；CDSA/schemas 用 `language_comprehension`、`language_expression`，且**無 `diet` 領域**。
  - 正規化決定：採 **CDSA 命名**為 canonical（`language_comprehension`/`language_expression`）。
  - `diet` 不是發展領域 → 不進矩陣；它對應 `cdss.sugar_intake.*` 臨床情境。`default.json` 的 `diet` 格內容（`diet-control`、`nutrition-grow-tall`）改用 `clinical: [cdss.sugar_intake.*]` 表達。
- 現有 8 篇文章關聯（遷移依據）：`default.json` matrix + 3 份 education-videos yaml + `closed-loop` map（見 spec 背景表）。

---

## 目標資料模型

### `src/data/education/content-relevance.yaml`（唯一關聯源）

```yaml
inapplicable:                    # 取代 inapplicable-matrix.json
  behavior: [2-6m, 7-12m]
  fine_motor: [2-6m]
  language: [2-6m]
  cognition: [2-6m, 7-12m]
  language_comprehension: [2-6m]
  language_expression: [2-6m, 7-12m]
  social_emotional: [2-6m]

relevance:
  - ref: { type: article, slug: gross-motor-activities }
    cdsa: { domains: [gross_motor], ageGroups: all, severities: [monitor, refer] }
  - ref: { type: video, videoId: yzRi9GlSptM }
    cdsa: { domains: [language], ageGroups: [13-24m] }
  - ref: { type: article, slug: when-to-seek-help }
    cdsa: { domains: all, severities: [refer] }
    clinical: ["cdsa.triage.refer.*", "cdss.heart_rate.critical.infant", "cdss.temperature.critical.*"]
  - ref: { type: article, slug: diet-control }
    cdsa: { domains: [], severities: [monitor, refer] }   # diet 非發展領域 → 不進矩陣
    clinical: ["cdss.sugar_intake.critical.*"]
```

- `ageGroups`: 陣列或字面 `all`（= 該 domain 所有適用年齡）。
- `severities`: 預設 `[normal, monitor, refer]`。
- `clinical`: trigger glob 字串清單；`*` 在「年齡」或「層級」段萬用展開。

### `public/data/video-index.json`（編譯產物，超集）

```ts
// 既有三鍵：位元等價，不可變動（back-compat / parity）
{
  catalog: Record<videoId, RuntimeVideo>;
  triggers: Record<trigger, { videoIds: string[]; inapplicable: boolean; educationSlug?: string }>;
  educationSlugToTriggers: Record<slug, string[]>;
  // 新增鍵：
  recommendations: Record<`${category}::${domain}::${ageGroup}`, RecommendationItem[]>; // 年齡感知預設推薦
  clinicalEducation: Record<indicator, string[]>; // 取代 closed-loop 硬寫 map（indicator → slug[]）
}
```

---

# Phase 0 — enum 單一源 + 刪死代碼

### Task 0.1: 匯出 schemas.ts 的 enum 常數陣列

**Files:**
- Modify: `src/lib/education/schemas.ts`

- [ ] **Step 1: 新增可重用的常數陣列並由 enum 引用**

在 `schemas.ts` 頂部（`AGE_GROUPS_CDSA` import 後）加入並改寫既有 enum 來引用它們：

```ts
export const CDSA_DOMAIN_NAMES = [
  'behavior', 'gross_motor', 'fine_motor', 'language',
  'cognition', 'language_comprehension', 'language_expression', 'social_emotional',
] as const;
export const CDSS_INDICATOR_NAMES = [
  'heart_rate', 'spo2', 'respiratory_rate', 'temperature',
  'sleep_quality', 'activity_level', 'sugar_intake',
] as const;
```

把既有 `KNOWN_DOMAIN_ENUM` 改為 `z.enum(CDSA_DOMAIN_NAMES)`，`CDSS_INDICATOR_ENUM` 改為 `z.enum(CDSS_INDICATOR_NAMES)`（值不變，只改成引用常數）。

- [ ] **Step 2: 型別檢查**

Run: `pnpm check`
Expected: 0 errors。

- [ ] **Step 3: Commit**

```bash
git add src/lib/education/schemas.ts
git commit -m "refactor(schemas): 抽出 CDSA_DOMAIN_NAMES / CDSS_INDICATOR_NAMES 常數供單一源引用"
```

### Task 0.2: trigger-derivation.ts 改用單一 enum 源

**Files:**
- Modify: `src/lib/education/trigger-derivation.ts`

- [ ] **Step 1: 移除硬寫的 KNOWN_DOMAINS / KNOWN_INDICATORS，改 import**

把 `trigger-derivation.ts` 內的兩個本地 `Set` 改為由 schemas 匯入：

```ts
import { CDSA_DOMAIN_NAMES, CDSS_INDICATOR_NAMES } from './schemas';

const KNOWN_DOMAINS = new Set<string>(CDSA_DOMAIN_NAMES);
const KNOWN_INDICATORS = new Set<string>(CDSS_INDICATOR_NAMES);
```

其餘 `deriveCdsaTriggers` / `deriveCdssTriggers` 邏輯不變。

- [ ] **Step 2: 既有測試 + check**

Run: `pnpm test --run && pnpm check`
Expected: 全綠（既有 trigger-derivation 測試若存在須通過）。

- [ ] **Step 3: Commit**

```bash
git add src/lib/education/trigger-derivation.ts
git commit -m "refactor(trigger-derivation): 領域/指標清單改用 schemas 單一 enum 源"
```

### Task 0.3: 刪除死代碼 EducationRecommend.svelte

**Files:**
- Delete: `src/components/education/EducationRecommend.svelte`

- [ ] **Step 1: 確認無 import（排除 `educationRecommended` 子字串誤判）**

Run: `grep -rn "EducationRecommend\b" src --include="*.astro" --include="*.svelte" --include="*.ts" | grep -v "educationRecommended"`
Expected: 無輸出（只有檔案自身或無）。

- [ ] **Step 2: 刪除並驗證 build**

```bash
git rm src/components/education/EducationRecommend.svelte
pnpm build
```
Expected: build 成功。

- [ ] **Step 3: Commit**

```bash
git commit -m "chore: 刪除死代碼 EducationRecommend.svelte（無 import、指向不存在 slug）"
```

---

# Phase 1 — content-relevance.yaml + 新 build + parity

> ⚠️ **結構更正（2026-05-26，用戶確認）**：採 **cell / 情境導向**（每個 trigger 列 `videoIds` + `articles`，文章帶 `severities`），非以下片段的「內容導向（ref/relevance）」。理由：內容導向在 (領域×嚴重度) 配對、空 trigger、diet 死格上破壞 parity。**以 spec `2026-05-26-unified-content-relevance-design.md` 的 cell 導向結構為準**；Task 1.1 schema 區塊已下修為 cell 導向，Task 1.2/1.3 的「relevance/ref」字樣一律改讀 cell 導向（`triggers[]`）。parity = 與「重構前真相對照表」逐格行為等價（缺 key == 空清單）。

### Task 1.1: 定義 content-relevance schema + 新 runtime 鍵

**Files:**
- Modify: `src/lib/education/schemas.ts`

- [ ] **Step 1: 加入 contentRelevanceSchema 與擴充 runtimeIndexSchema**

```ts
export const SEVERITY_NAMES = ['normal', 'monitor', 'refer'] as const;

// cell / 情境導向：每個 trigger 列該格內容
const articleRefSchema = z.object({
  slug: z.string(),
  // 只有 cdsa.domain 格的文章需要；省略時投影端預設視為 [monitor, refer]
  severities: z.array(z.enum(SEVERITY_NAMES)).optional(),
});

export const triggerRelevanceSchema = z.object({
  trigger: z.string(),
  videoIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{11}$/)).default([]),
  articles: z.array(articleRefSchema).default([]),
});

export const contentRelevanceSchema = z.object({
  inapplicable: z.record(z.enum(CDSA_DOMAIN_NAMES), z.array(z.enum(AGE_GROUPS_CDSA))),
  triggers: z.array(triggerRelevanceSchema),
});

// 擴充 runtimeIndexSchema：加 recommendations + clinicalEducation
// （在既有 runtimeIndexSchema 的 z.object({...}) 內補兩鍵）
//   recommendations: z.record(z.string(), z.array(/* RecommendationItem 形狀 */ z.object({
//     source: z.enum(['internal','custom','external']),
//     slug: z.string().optional(), customId: z.string().optional(),
//     url: z.string().optional(), title: z.string().optional(), summary: z.string().optional(),
//   }))),
//   clinicalEducation: z.record(z.string(), z.array(z.string())),

export type ContentRelevance = z.infer<typeof contentRelevanceSchema>;
export type TriggerRelevance = z.infer<typeof triggerRelevanceSchema>;
```

把上面註解的兩鍵實際加進 `runtimeIndexSchema`。

- [ ] **Step 2: check**

Run: `pnpm check`
Expected: 0 errors。

- [ ] **Step 3: Commit**

```bash
git add src/lib/education/schemas.ts
git commit -m "feat(schemas): content-relevance schema + runtime recommendations/clinicalEducation 鍵"
```

### Task 1.2: 一次性遷移腳本 — 由舊源產生 content-relevance.yaml

**Files:**
- Create: `scripts/migrate/build-content-relevance.ts`
- Create (產物): `src/data/education/content-relevance.yaml`

> **理由：手抄 39 triggers + default.json 易錯。用腳本機械讀舊源、產生 yaml，再由 parity test 保證等價。**

- [ ] **Step 1: 撰寫遷移腳本**

腳本讀取：`scripts/curate/inapplicable-matrix.json`、`src/data/education-videos/*.yaml`、`src/data/recommendations/default.json`、`src/engine/closed-loop.ts` 的 indicator map（以常數複製於腳本內，見下），合併成內容導向 `relevance` 清單，輸出 `src/data/education/content-relevance.yaml`。

合併規則：
- `inapplicable` 區直接複製 `inapplicable-matrix.json['cdsa.domain']`。
- 每個 `cdsa.domain.<d>.anomaly.<age>` trigger：把其 `videoIds` 各自轉成 `{ref:{type:video,videoId}, cdsa:{domains:[d], ageGroups:[age]}}`；其 `educationSlug` 轉成 article 條目並把 `(d, age)` 併入該 article 的 `cdsa.domains/ageGroups`（同 slug 合併）。
- 每個 `cdss.*` / `cdsa.triage.*` trigger：`videoIds`/`educationSlug` 轉成條目，trigger 字串放入 `clinical`（同 indicator/category 用 `*` 壓縮年齡/層級）。
- `default.json`：每筆 `{category,domain,item}` → 把 `severities` 併入對應 article 條目；domain 經正規化映射：`language_comp→language_comprehension`、`language_expr→language_expression`、`diet→（不設 cdsa.domains，改 clinical: cdss.sugar_intake.*）`。
- closed-loop map `{sugar_intake:diet-control, sleep_quality:sleep-hygiene, spo2:respiratory-care, activity_level:exercise-guide}`：併入對應 article 的 `clinical`（`cdss.<indicator>.*`）。
- milestones：`milestones/*.md` 依檔名年齡（0-6m→2-6m... 對照表於腳本內）設 `cdsa:{domains:all? }`——**預設只設 `clinical:[]` 且不進矩陣**，避免臆測；於腳本標記 TODO 註解供人工補（見 Task 3.x 決策）。

```ts
// scripts/migrate/build-content-relevance.ts — 骨架
import fs from 'node:fs/promises';
import yaml from 'js-yaml';
import fg from 'fast-glob';
// 讀舊源 → 建 byContent: Map<refKey, entry> → 合併 → 排序 → 寫 yaml
// refKey = `article:${slug}` | `video:${videoId}`
// 完整實作於本 task 撰寫；輸出需通過 contentRelevanceSchema.parse()
```

- [ ] **Step 2: 執行腳本並用 schema 驗證產物**

```bash
pnpm tsx scripts/migrate/build-content-relevance.ts
pnpm tsx -e "import {contentRelevanceSchema} from './src/lib/education/schemas'; import yaml from 'js-yaml'; import fs from 'fs'; contentRelevanceSchema.parse(yaml.load(fs.readFileSync('src/data/education/content-relevance.yaml','utf8'))); console.log('OK')"
```
Expected: `OK`。

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate/build-content-relevance.ts src/data/education/content-relevance.yaml
git commit -m "feat(migrate): 由舊四源產生單一 content-relevance.yaml"
```

### Task 1.3: build-content-index — 由 content-relevance.yaml 產出超集 index

**Files:**
- Create: `scripts/build-content-index.ts`
- Modify: `package.json`（`prebuild`/`predev` 改呼叫新腳本）
- Test: `tests/education/content-index-parity.test.ts`

- [ ] **Step 1: 先寫 parity 失敗測試**

```ts
// tests/education/content-index-parity.test.ts
import { describe, it, expect, beforeAll } from 'vitest';
import { buildContentIndex } from '../../scripts/build-content-index';
import oldIndex from '../../public/data/video-index.json'; // 遷移前 committed 版本
import defaultRecs from '../../src/data/recommendations/default.json';

let neu: any;
beforeAll(async () => { neu = await buildContentIndex({ write: false }); });

it('catalog 位元等價', () => {
  expect(neu.catalog).toEqual(oldIndex.catalog);
});
it('triggers 位元等價（含 educationSlug）', () => {
  expect(neu.triggers).toEqual(oldIndex.triggers);
});
it('educationSlugToTriggers 位元等價', () => {
  expect(neu.educationSlugToTriggers).toEqual(oldIndex.educationSlugToTriggers);
});
it('recommendations 投影涵蓋 default.json 所有 (category×domain) 關聯', () => {
  // 對 default.json 每筆 (category, normalizedDomain, slug)，
  // 需存在某 ageGroup 使 recommendations[`${category}::${domain}::${age}`] 含該 slug
  for (const [cat, byDom] of Object.entries(defaultRecs.matrix)) {
    for (const [dom, items] of Object.entries(byDom as any)) {
      for (const it of items as any[]) {
        const hit = Object.entries(neu.recommendations)
          .some(([k, v]: any) => k.startsWith(`${cat}::`) && (v as any[]).some(r => r.slug === it.slug));
        expect(hit, `${cat}/${dom}/${it.slug}`).toBe(true);
      }
    }
  }
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test --run tests/education/content-index-parity.test.ts`
Expected: FAIL（`buildContentIndex` 不存在）。

- [ ] **Step 3: 實作 build-content-index.ts**

讀 `content-relevance.yaml` + `video-catalog/*.yaml`，產出超集 index：
- `catalog`：同現行（只收 `verificationStatus==='verified'`，slim 欄位）。
- `triggers`：對每個 `cdsa.domain.<d>.anomaly.<age>` cell，`inapplicable` 來自 `content-relevance.inapplicable`；`videoIds`=該 cell 命中的 verified 影片；`educationSlug`=該 cell 命中的 article（若多篇取第一，與現行單一 educationSlug 相容）。cdss/triage triggers 由 `clinical` glob 展開還原。
- `educationSlugToTriggers`：**沿用現行語意（僅含「有 verified 影片」的 cdsa.domain trigger）**以維持 parity（related-videos 行為不變）。
- `recommendations`：對每個 `(category, domain, age)`，收集 `cdsa.domains∋domain && ageGroups∋age && severities∋category` 的 article → `RecommendationItem{source:internal, slug, title, summary}`（title/summary 由 article frontmatter 或保留 default.json 原文，見 Step 注）。
- `clinicalEducation`：`indicator → slug[]`（由 `clinical` 含 `cdss.<indicator>.*` 的 article 收集）。
- 交叉驗證：沿用現行「matrix inapplicable 必須與資料一致」檢查（改讀 content-relevance.inapplicable）。

> title/summary 來源：本階段為 parity，沿用 `default.json` 既有 title/summary 字串（遷移腳本已保留於 content-relevance 或由 article frontmatter 取）。確保 parity test 的 slug 比對通過即可（title 非 parity 斷言項）。

`buildContentIndex({write})`：`write:false` 回傳物件供測試；`write:true` 寫 `public/data/video-index.json`（**檔名不變**以免動消費端 import）。

- [ ] **Step 4: 跑測試確認通過 + 改 package.json**

把 `package.json` 的 `predev`/`prebuild` 內 `tsx scripts/build-video-index.ts` 改為 `tsx scripts/build-content-index.ts`。

Run: `pnpm test --run tests/education/content-index-parity.test.ts && pnpm build`
Expected: PASS + build 成功。

- [ ] **Step 5: Commit**

```bash
git add scripts/build-content-index.ts package.json tests/education/content-index-parity.test.ts public/data/video-index.json
git commit -m "feat(build): build-content-index 由 content-relevance.yaml 產出超集 index + parity test"
```

### Task 1.4: 刪除已被取代的舊資料源

**Files:**
- Delete: `src/data/education-videos/cdsa-domains.yaml`, `cdsa-triage.yaml`, `cdss-vital-signs.yaml`
- Delete: `scripts/curate/inapplicable-matrix.json`
- Delete: `scripts/build-video-index.ts`
- Modify: `scripts/build-questionnaire-applicability.ts`（若讀 inapplicable-matrix.json，改讀 content-relevance.yaml 的 inapplicable）

- [ ] **Step 1: 改 build-questionnaire-applicability 來源**

`build-questionnaire-applicability.ts` 目前讀 `scripts/curate/inapplicable-matrix.json`。改為讀 `src/data/education/content-relevance.yaml` 的 `inapplicable` 區（結構相同：domain→ages）。

- [ ] **Step 2: 刪除舊檔並全量 build + 測試**

```bash
git rm src/data/education-videos/cdsa-domains.yaml src/data/education-videos/cdsa-triage.yaml src/data/education-videos/cdss-vital-signs.yaml scripts/curate/inapplicable-matrix.json scripts/build-video-index.ts
pnpm build && pnpm test --run
```
Expected: build 成功、測試全綠（parity 仍過，因 index 由 content-relevance 產生）。

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: 刪除已併入 content-relevance.yaml 的舊資料源（3 yaml + inapplicable-matrix + 舊 build）"
```

---

# Phase 2 — closed-loop 改讀投影

### Task 2.1: closed-loop.ts 移除硬寫 indicator→slug map

**Files:**
- Modify: `src/engine/closed-loop.ts`
- Create: `src/lib/education/clinical-education.ts`（同步讀取 `clinicalEducation`）
- Test: `tests/engine/closed-loop-education.test.ts`

- [ ] **Step 1: 寫測試鎖定等價**

```ts
// 斷言：給 ['sugar_intake','sleep_quality','spo2','activity_level']
// getEducationRecommendations 仍回 ['diet-control','sleep-hygiene','respiratory-care','exercise-guide']
// （順序以 indicator 順序）
```

- [ ] **Step 2: 跑測試確認失敗 → 實作**

`clinicalEducation` 已在 index。closed-loop 在 worker/engine 同步環境：build 另輸出 `src/lib/education/clinical-education.generated.ts`（`export const CLINICAL_EDUCATION: Record<string,string[]> = {...}`）供同步 import（避免在 engine 內 async fetch）。`closed-loop.getEducationRecommendations` 改 `indicators.flatMap(i => CLINICAL_EDUCATION[i] ?? [])` 去重。
build-content-index 增加輸出該 generated.ts。

- [ ] **Step 3: 測試通過 + check + build**

Run: `pnpm test --run tests/engine/closed-loop-education.test.ts && pnpm check && pnpm build`
Expected: 全綠。

- [ ] **Step 4: Commit**

```bash
git add src/engine/closed-loop.ts src/lib/education/clinical-education.ts src/lib/education/clinical-education.generated.ts scripts/build-content-index.ts tests/engine/closed-loop-education.test.ts
git commit -m "refactor(closed-loop): 移除硬寫 indicator→slug map，改讀 build 產生的 clinicalEducation"
```

---

# Phase 3 — 推薦年齡感知 + overlay 遷移 + 刪 default.json（行為改變）

### Task 3.1: RecommendationItem 投影 + 年齡感知合併（讀 index.recommendations）

**Files:**
- Modify: `src/lib/db/recommendations.ts`
- Modify: `src/lib/db/schema.ts`（overlay id 加 ageGroup；Dexie 版本 +1 與遷移）
- Test: `tests/db/recommendations-age.test.ts`

- [ ] **Step 1: 寫測試**

```ts
// getDefaultRecommendations(category, normalizedDomain, ageGroup) 從 index.recommendations 取對應清單
// mergeRecommendationsForContext(tenantId, category, [{domain, ageGroup}], ) 合併 default + overlay(含ageGroup) + custom-education
// 斷言：13-24m 與 49-60m 對同一 domain 可得不同清單（年齡感知）
```

- [ ] **Step 2: 實作**

- `recommendations.ts` 不再 import `default.json`；改 `import index from 'public/data/video-index.json'`（或經既有 loader）取 `recommendations`。
- 新簽章帶 `ageGroup: AgeGroupCDSA`；`buildId` → `${tenantId}::${category}::${domain}::${ageGroup}`。
- `mergeRecommendationsForDomains` → `mergeRecommendationsForContext(tenantId, category, domainAgePairs)`：對每對 `(domain, ageGroup)` 取 default + overlay，合併 custom-education（依 `category` + `ageGroup`(粗→細展開) + `triggerIndicators` 命中），去重。
- Dexie：`schema.ts` 版本 +1，`recommendationOverlays` 仍 keyPath `id`；寫 `upgrade` 將舊 `tenant::cat::domain` overlay 展開成各 ageGroup（套到該 domain 所有適用年齡）以保留既有自訂。

- [ ] **Step 3: 測試 + check**

Run: `pnpm test --run tests/db/recommendations-age.test.ts && pnpm check`
Expected: 全綠。

- [ ] **Step 4: Commit**

```bash
git add src/lib/db/recommendations.ts src/lib/db/schema.ts tests/db/recommendations-age.test.ts
git commit -m "feat(recommendations): 年齡感知投影自 index + overlay 加 ageGroup（Dexie 遷移）"
```

### Task 3.2: 消費端接新簽章（ResultView / EducationMatch / RecommendationsManager）

**Files:**
- Modify: `src/components/assess/ResultView.svelte`, `ResultViewWrapper.svelte`, `EducationMatch.svelte`
- Modify: `src/components/settings/RecommendationsManager.svelte`
- Modify: `src/components/patient/ResultDetail.svelte`, `src/components/dashboard/PatientList.svelte`（若呼叫推薦 API）

- [ ] **Step 1: ResultView/EducationMatch 傳入年齡**

`ResultView` 已有 `assessmentStore.ageGroup`；把 `(category, domains)` 改成 `(category, domains × ageGroup)` 傳給 `EducationMatch`，後者呼叫 `mergeRecommendationsForContext`。

- [ ] **Step 2: RecommendationsManager 移除硬寫 15-slug 清單**

第 45-49 行硬寫的 slug 陣列改為從 index（或 `getCollection('education')` 的 slug 列表）動態取得「可選內容」。

- [ ] **Step 3: check + build + 既有元件測試**

Run: `pnpm check && pnpm build && pnpm test --run`
Expected: 全綠。

- [ ] **Step 4: Commit**

```bash
git add src/components
git commit -m "feat(education): 推薦消費端接年齡感知投影；RecommendationsManager 動態取可選內容"
```

### Task 3.3: 刪除 default.json + 收尾驗證

**Files:**
- Delete: `src/data/recommendations/default.json`
- Modify: 移除所有殘留 import

- [ ] **Step 1: 確認無殘留 import**

Run: `grep -rn "recommendations/default" src scripts`
Expected: 無輸出。

- [ ] **Step 2: 刪除 + 全量驗證**

```bash
git rm src/data/recommendations/default.json
pnpm check && pnpm lint --max-warnings 10 && pnpm test --run && pnpm build
```
Expected: 全綠 + build 成功。

- [ ] **Step 3: 線上煙測前置（本機 preview 矩陣 + 一次評估流程）**

```bash
pnpm preview
```
人工確認：`/education/` 矩陣內容如舊；做一次評估，結果頁推薦依年齡顯示。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: 刪除 default.json（推薦已改投影自 content-relevance.yaml）— 單一真相源達成"
```

---

## Self-Review（撰寫者已執行）

**Spec coverage：**
- ①②③ 收斂 + 刪除 → Task 1.2/1.3/1.4 ✓
- ④ closed-loop → Task 2.1 ✓
- ⑤ RecommendationsManager → Task 3.2 ✓
- ⑥ trigger-derivation enum → Task 0.2 ✓
- 死代碼 EducationRecommend → Task 0.3 ✓
- 孤兒 milestones → Task 1.2 Step 1（標記、預設不進矩陣，待人工決策）⚠️ 見下
- custom-education + overlay → Task 3.1 ✓
- 年齡感知（D3）→ Task 3.1/3.2 ✓
- 租戶自訂只在推薦（D2）→ overlay 維持只在 recommendations ✓
- 單一檔（content-relevance.yaml）→ Phase 1 ✓
- migration parity test → Task 1.3 ✓

**已知待人工決策（非阻擋）：** milestones 5 篇是否進矩陣／推薦，需內容判斷；Task 1.2 預設保守不進，執行時若用戶有指示再補 `cdsa` 關聯。

**型別一致性：** `RecommendationItem`/`RecommendationCategory` 沿用 `schema.ts` 既有定義；新 `recommendations` index 鍵 `${category}::${domain}::${ageGroup}` 與 `mergeRecommendationsForContext` 一致；domain 一律 canonical（CDSA 命名）。
