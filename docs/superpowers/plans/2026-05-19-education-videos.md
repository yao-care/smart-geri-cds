# 依檢測結果配衛教影片 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 為 CDSA 兒童發展評估 + CDSS 生理警示兩條結果線，建立 123 個 trigger → YouTube 衛教影片的多對多映射，含自動 curate 腳本（yt-dlp + heuristics + Claude Code 複審）與前端整合。

**Architecture:** YAML（catalog + trigger mapping，git tracked）→ build script 用 `tsx` + `fast-glob` + 共用 zod schemas（astro/zod = zod v4）serialize 成 `public/data/video-index.json` → client island 透過 `fetch` 載入 → Svelte 5 runes UI 顯示。Curate 工具是獨立 CLI（`pnpm curate:videos`），分階段跑（CDSS critical → CDSA refer → ...），每階段 report 由 Claude Code 依 10 項 checklist 複審後寫回 yaml。

**Tech Stack:** TypeScript strict, Astro 6.3 + Svelte 5 runes, astro/zod (zod v4), js-yaml, fast-glob, tsx, yt-dlp (system bin), vitest + @testing-library/svelte, GitHub Actions, @lhci/cli.

**Spec reference:** `docs/superpowers/specs/2026-05-19-education-videos-design.md` (v12). 任何決策衝突以 spec 為準。

---

## File Structure

新增檔案：

```
src/lib/education/
├── schemas.ts                    # 共用 zod schemas + types
├── age-fallback.ts               # CDSA_FALLBACK_CHAIN 常數表
├── trigger-derivation.ts         # CDSA/CDSS trigger 產生函式
├── video-lookup.ts               # async lookup + tryAgeGroupFallback
└── merge-custom-videos.ts        # mergeCustomVideos 合約實作

src/data/video-catalog/
├── official-tw.yaml              # 影片元資料（sharded by tier）
├── international.yaml
└── pro-kol.yaml

src/data/education-videos/
├── cdsa-triage.yaml              # trigger 映射（sharded by category）
├── cdsa-domains.yaml
├── cdss-vital-signs.yaml
└── README.md

src/components/education/
├── VideoCard.svelte              # 兩變體：with/without thumbnail
├── VideoGrid.svelte              # 多支顯示
└── TriggerVideoList.svelte       # 依 triggers 渲染

public/data/
└── video-index.json              # build 產出（git tracked）

scripts/
├── build-video-index.ts          # tsx 執行
├── curate-videos.ts              # tsx 執行
└── curate/
    ├── channel-seeds.json        # 人工維護
    ├── keywords.json             # 人工/AI 產出
    ├── inapplicable-matrix.json  # 臨床顧問 sign-off
    └── lib/
        ├── yt-dlp.ts             # yt-dlp wrapper
        ├── heuristics.ts         # 評分公式
        ├── simplified-detector.ts # 簡體偵測
        └── report-writer.ts      # report.md 產生器

tests/
├── lib/education/
│   ├── schemas.test.ts
│   ├── trigger-derivation.test.ts
│   ├── video-lookup.test.ts
│   ├── merge-custom-videos.test.ts
│   └── i18n-fallback.test.ts
├── components/education/
│   ├── VideoCard.test.ts
│   ├── VideoGrid.test.ts
│   └── TriggerVideoList.test.ts
├── data/
│   ├── education-slug-integrity.test.ts
│   ├── trigger-uniqueness.test.ts
│   ├── inapplicable-consistency.test.ts
│   └── index-consistency.test.ts
└── scripts/
    ├── build-video-index.test.ts
    ├── curate-heuristics.test.ts
    └── simplified-detector.test.ts

.github/workflows/
├── ci.yml                        # 新建
└── validate-videos.yml           # 新建

修改檔案：
- src/lib/utils/age-groups.ts     # AGE_GROUPS_CDSA 改 as const tuple
- package.json                    # 新增 devDeps + scripts
- .gitignore                      # scripts/curate/cache, reports, .last-build.json
```

---

## Phase 0: Baseline 量測（plan 第一步）

依 spec §10 開頭要求：先量目前 `/result/` 與 `/workspace/result/` 的 island bundle gzip baseline。

- [ ] **Step 1: build + preview**

Run: `pnpm build && pnpm preview &`

- [ ] **Step 2: 抓 island bundle size**

Run: `ls -lh dist/_astro/*.js | sort -k5 -h | tail -10`

記下 `ResultViewWrapper.*.js` 與 `ResultDetail.*.js` 的 gzip 大小（用 `gzip -c file | wc -c`）。

- [ ] **Step 3: 跑 Lighthouse 取 Performance 數字**

Run:
```bash
npx @lhci/cli collect --url=http://localhost:4321/smart-pedi-cds/result/ --numberOfRuns=3
```

- [ ] **Step 4: 寫回 spec §7.6**

把 baseline 數字寫入 `docs/superpowers/specs/2026-05-19-education-videos-design.md` §7.6（「島 bundle ≤ baseline + 20 KB gzip」的 baseline 具體值）並 commit。

```bash
git add docs/superpowers/specs/2026-05-19-education-videos-design.md
git commit -m "docs(spec): record bundle/lighthouse baseline before education-videos impl"
```

完成後再進入 Phase 1。

---

## Phase 1: Schemas & 基礎資料

### Task 1: 新增依賴 + AGE_GROUPS_CDSA tuple 改動

**Files:**
- Modify: `package.json`（新增 devDeps + scripts）
- Modify: `src/lib/utils/age-groups.ts`（line 1-9）
- Modify: `.gitignore`

- [ ] **Step 1: 確認 grep 沒有把 AGE_GROUPS_CDSA 當 mutable array 使用**

Run: `grep -rn "AGE_GROUPS_CDSA" src/`
Expected: 只在 age-groups.ts 定義處 + `NormsManager.svelte` 等的 `{#each}` 迭代處出現。若有 `.push`/`.splice` 則需先處理。

- [ ] **Step 2: 改 age-groups.ts 為 as const tuple**

修改 `src/lib/utils/age-groups.ts`：

```typescript
export const AGE_GROUPS_CDSA = [
  '2-6m', '7-12m', '13-24m', '25-36m', '37-48m', '49-60m', '61-72m',
] as const;
export type AgeGroupCDSA = typeof AGE_GROUPS_CDSA[number];

export const AGE_GROUP_LABELS: Record<AgeGroupCDSA, string> = {
  '2-6m': '2-6 個月',
  '7-12m': '7-12 個月',
  '13-24m': '13-24 個月',
  '25-36m': '25-36 個月',
  '37-48m': '37-48 個月',
  '49-60m': '49-60 個月',
  '61-72m': '61-72 個月',
};
```

（其餘原檔函式照舊）

- [ ] **Step 3: 跑 pnpm check 驗證型別**

Run: `pnpm check`
Expected: 0 errors。若 `NormsManager.svelte` 或其他 consumer 報錯（如 `Type 'readonly ["2-6m", ...]' is not assignable to AgeGroupCDSA[]`），改用 `[...AGE_GROUPS_CDSA]` spread 取得 mutable copy。

- [ ] **Step 4: 新增 devDeps**

Run:
```bash
pnpm add -D tsx fast-glob @lhci/cli
```

- [ ] **Step 5: 新增 package.json scripts**

Modify `package.json`，在 `scripts` 區塊新增（保留既有 keys）：

```json
{
  "scripts": {
    "build:video-index": "tsx scripts/build-video-index.ts",
    "curate:videos":     "tsx scripts/curate-videos.ts",
    "curate:clean":      "tsx scripts/curate-videos.ts --clean",
    "prebuild":          "tsx scripts/build-video-index.ts && pagefind --site dist",
    "predev":            "tsx scripts/build-video-index.ts"
  }
}
```

> 注意：原 `postbuild` 含 pagefind；若已有 `prebuild` 須合併，不要覆蓋。

- [ ] **Step 6: 修改 .gitignore**

Append to `.gitignore`：

```
# Education videos curate runtime artifacts
scripts/curate/cache/
scripts/curate/reports/
scripts/curate/channel-whitelist.json
scripts/curate/.last-build.json
```

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml src/lib/utils/age-groups.ts .gitignore
git commit -m "chore(education-videos): bootstrap deps + AGE_GROUPS_CDSA tuple"
```

---

### Task 2: schemas.ts — 共用 zod schemas

**Files:**
- Create: `src/lib/education/schemas.ts`

- [ ] **Step 1: 確認 astro/zod 為 zod v4（已於 spec v10 驗過）**

Run: `grep "zod" node_modules/astro/dist/zod.js | head -2`
Expected: `import * as mod from "zod/v4"; export * from "zod/v4";`

- [ ] **Step 2: 寫 schemas.ts**

Create `src/lib/education/schemas.ts`:

```typescript
import { z } from 'astro/zod';   // = zod v4
import { AGE_GROUPS_CDSA } from '../utils/age-groups';

// --- 影片元資料 ---
export const videoCatalogItemSchema = z.object({
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  title: z.string().min(1),
  channel: z.string().min(1),
  channelId: z.string().regex(/^UC[A-Za-z0-9_-]{22}$/),
  duration: z.number().int().positive(),
  publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  language: z.enum(['zh-Hant', 'en']),
  subtitleType: z.enum(['human', 'auto', 'none']),
  sourceTier: z.enum(['official-tw', 'international', 'pro-kol']),
  viewCount: z.number().int().nonnegative(),
  curatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lastValidatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  verifiedBy: z.enum(['claude-code', 'manual']),
  verificationStatus: z.enum(['verified', 'rejected']),
  score: z.number().min(0).max(1),
  notes: z.string().optional(),
});

// --- Trigger 映射（discriminatedUnion + cross-field refine）---
const KNOWN_DOMAIN_ENUM = z.enum([
  'behavior', 'gross_motor', 'fine_motor', 'language',
  'cognition', 'language_comprehension', 'language_expression', 'social_emotional',
]);
const CDSS_INDICATOR_ENUM = z.enum([
  'heart_rate', 'spo2', 'respiratory_rate', 'temperature',
  'sleep_quality', 'activity_level', 'sugar_intake',
]);
const CDSS_LEVEL_ENUM = z.enum(['advisory', 'warning', 'critical']);
const CDSS_AGE_ENUM = z.enum(['infant', 'toddler', 'preschool']);
const videoIdsField = z.array(z.string().regex(/^[A-Za-z0-9_-]{11}$/)).default([]);

export const cdsaTriageEntrySchema = z.object({
  trigger: z.string(),
  category: z.literal('triage'),
  triageCategory: z.enum(['monitor', 'refer']),
  ageGroup: z.enum(AGE_GROUPS_CDSA),
  educationSlug: z.string().optional(),
  inapplicable: z.literal(true).optional(),
  videoIds: videoIdsField,
}).refine(
  d => d.trigger === `cdsa.triage.${d.triageCategory}.${d.ageGroup}`,
  { message: 'trigger 字串與 triageCategory + ageGroup 不一致', path: ['trigger'] },
);

export const cdsaDomainEntrySchema = z.object({
  trigger: z.string(),
  category: z.literal('domain'),
  domain: KNOWN_DOMAIN_ENUM,
  ageGroup: z.enum(AGE_GROUPS_CDSA),
  educationSlug: z.string().optional(),
  inapplicable: z.literal(true).optional(),
  videoIds: videoIdsField,
}).refine(
  d => d.trigger === `cdsa.domain.${d.domain}.anomaly.${d.ageGroup}`,
  { message: 'trigger 字串與 domain + ageGroup 不一致', path: ['trigger'] },
);

export const cdssVitalSignEntrySchema = z.object({
  trigger: z.string(),
  category: z.literal('vital-sign'),
  indicator: CDSS_INDICATOR_ENUM,
  level: CDSS_LEVEL_ENUM,
  ageGroup: CDSS_AGE_ENUM,
  educationSlug: z.string().optional(),
  inapplicable: z.literal(true).optional(),
  videoIds: videoIdsField,
}).refine(
  d => d.trigger === `cdss.${d.indicator}.${d.level}.${d.ageGroup}`,
  { message: 'trigger 字串與 indicator + level + ageGroup 不一致', path: ['trigger'] },
);

export const triggerEntrySchema = z.discriminatedUnion('category', [
  cdsaTriageEntrySchema,
  cdsaDomainEntrySchema,
  cdssVitalSignEntrySchema,
]);

// --- Runtime slim shape（reproducible JSON）---
export const runtimeVideoSchema = videoCatalogItemSchema.pick({
  videoId: true,
  title: true,
  channel: true,
  duration: true,
  language: true,
  sourceTier: true,
  score: true,
});

export const runtimeIndexSchema = z.object({
  catalog: z.record(z.string(), runtimeVideoSchema),
  triggers: z.record(z.string(), z.object({
    videoIds: z.array(z.string()),
    inapplicable: z.boolean(),
  })),
});

// --- Types ---
export type VideoCatalogItem = z.infer<typeof videoCatalogItemSchema>;
export type TriggerEntry = z.infer<typeof triggerEntrySchema>;
export type RuntimeVideo = z.infer<typeof runtimeVideoSchema>;
export type RuntimeIndex = z.infer<typeof runtimeIndexSchema>;
export type CustomVideo = RuntimeVideo & { triggers: string[] | '*' };
```

- [ ] **Step 3: 跑 pnpm check 驗證**

Run: `pnpm check`
Expected: 0 errors。

- [ ] **Step 4: Commit**

```bash
git add src/lib/education/schemas.ts
git commit -m "feat(education-videos): add shared zod schemas (catalog + trigger mapping + runtime index)"
```

---

### Task 3: schemas.test.ts — 正面 / 負面 case

**Files:**
- Create: `tests/lib/education/schemas.test.ts`

- [ ] **Step 1: 寫測試**

Create `tests/lib/education/schemas.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  videoCatalogItemSchema, triggerEntrySchema,
  cdsaTriageEntrySchema, cdsaDomainEntrySchema, cdssVitalSignEntrySchema,
} from '../../../src/lib/education/schemas';

const validVideo = {
  videoId: 'abc123XYZ45',
  title: '範例衛教',
  channel: '台大兒醫',
  channelId: 'UC' + 'a'.repeat(22),
  duration: 245,
  publishedAt: '2024-03-15',
  language: 'zh-Hant' as const,
  subtitleType: 'human' as const,
  sourceTier: 'official-tw' as const,
  viewCount: 12500,
  curatedAt: '2026-05-19',
  verifiedBy: 'claude-code' as const,
  verificationStatus: 'verified' as const,
  score: 0.92,
};

describe('videoCatalogItemSchema', () => {
  it('accepts a valid catalog item', () => {
    expect(videoCatalogItemSchema.parse(validVideo)).toBeDefined();
  });

  it('rejects invalid videoId regex (10 chars)', () => {
    expect(() => videoCatalogItemSchema.parse({ ...validVideo, videoId: 'abc123XYZ4' })).toThrow();
  });

  it('rejects invalid videoId regex (12 chars)', () => {
    expect(() => videoCatalogItemSchema.parse({ ...validVideo, videoId: 'abc123XYZ455' })).toThrow();
  });

  it('rejects invalid channelId regex', () => {
    expect(() => videoCatalogItemSchema.parse({ ...validVideo, channelId: 'NotAChannelId' })).toThrow();
  });

  it('rejects score > 1', () => {
    expect(() => videoCatalogItemSchema.parse({ ...validVideo, score: 1.5 })).toThrow();
  });

  it('strips unknown extra fields (zod v4 default)', () => {
    const parsed = videoCatalogItemSchema.parse({ ...validVideo, foo: 'bar' });
    expect('foo' in parsed).toBe(false);
  });
});

describe('triggerEntrySchema discriminatedUnion', () => {
  it('accepts valid cdsa.triage entry', () => {
    expect(triggerEntrySchema.parse({
      trigger: 'cdsa.triage.refer.13-24m',
      category: 'triage',
      triageCategory: 'refer',
      ageGroup: '13-24m',
      videoIds: ['abc123XYZ45'],
    })).toBeDefined();
  });

  it('rejects cross-field mismatch (trigger ≠ fields)', () => {
    expect(() => cdsaTriageEntrySchema.parse({
      trigger: 'cdsa.triage.refer.25-36m',     // age mismatch
      category: 'triage',
      triageCategory: 'refer',
      ageGroup: '13-24m',
      videoIds: [],
    })).toThrow();
  });

  it('accepts cdsa.domain with inapplicable: true', () => {
    expect(triggerEntrySchema.parse({
      trigger: 'cdsa.domain.fine_motor.anomaly.2-6m',
      category: 'domain',
      domain: 'fine_motor',
      ageGroup: '2-6m',
      inapplicable: true,
      videoIds: [],
    })).toBeDefined();
  });

  it('rejects cdsa.domain with unknown domain', () => {
    expect(() => cdsaDomainEntrySchema.parse({
      trigger: 'cdsa.domain.unknown.anomaly.13-24m',
      category: 'domain',
      domain: 'unknown',
      ageGroup: '13-24m',
      videoIds: [],
    })).toThrow();
  });

  it('accepts cdss.vital-sign with critical', () => {
    expect(triggerEntrySchema.parse({
      trigger: 'cdss.spo2.critical.infant',
      category: 'vital-sign',
      indicator: 'spo2',
      level: 'critical',
      ageGroup: 'infant',
      videoIds: [],
    })).toBeDefined();
  });

  it('rejects cdss with normal level (not in enum)', () => {
    expect(() => cdssVitalSignEntrySchema.parse({
      trigger: 'cdss.spo2.normal.infant',
      category: 'vital-sign',
      indicator: 'spo2',
      level: 'normal',
      ageGroup: 'infant',
      videoIds: [],
    })).toThrow();
  });

  it('rejects videoIds with invalid regex', () => {
    expect(() => cdsaTriageEntrySchema.parse({
      trigger: 'cdsa.triage.monitor.13-24m',
      category: 'triage',
      triageCategory: 'monitor',
      ageGroup: '13-24m',
      videoIds: ['SHORT'],
    })).toThrow();
  });

  it('strips extra indicator field on category=domain (zod default strip)', () => {
    const parsed = cdsaDomainEntrySchema.parse({
      trigger: 'cdsa.domain.behavior.anomaly.13-24m',
      category: 'domain',
      domain: 'behavior',
      ageGroup: '13-24m',
      indicator: 'spo2',     // extra
      videoIds: [],
    });
    expect('indicator' in parsed).toBe(false);
  });
});
```

- [ ] **Step 2: 跑測試確認全部通過**

Run: `pnpm test tests/lib/education/schemas.test.ts`
Expected: 全部 pass。

- [ ] **Step 3: Commit**

```bash
git add tests/lib/education/schemas.test.ts
git commit -m "test(education-videos): schemas positive + negative cases"
```

---

### Task 4: age-fallback.ts — CDSA_FALLBACK_CHAIN

**Files:**
- Create: `src/lib/education/age-fallback.ts`

- [ ] **Step 1: 寫 age-fallback.ts**

Create `src/lib/education/age-fallback.ts`:

```typescript
import type { AgeGroupCDSA } from '../utils/age-groups';

/** §3.6 chain：先試最鄰近年齡 bin，衛教鄰近性 > 發展階段相同性。
 *  Fallback 永遠不跨越 inapplicable: true（由 tryAgeGroupFallback 實施）。 */
export const CDSA_FALLBACK_CHAIN: Record<AgeGroupCDSA, AgeGroupCDSA[]> = {
  '2-6m':   ['7-12m'],
  '7-12m':  ['2-6m', '13-24m'],
  '13-24m': ['7-12m', '25-36m'],
  '25-36m': ['13-24m', '37-48m'],
  '37-48m': ['25-36m', '49-60m'],
  '49-60m': ['37-48m', '61-72m'],
  '61-72m': ['49-60m'],
};
```

- [ ] **Step 2: 跑 pnpm check**

Run: `pnpm check`
Expected: 0 errors。

- [ ] **Step 3: Commit**

```bash
git add src/lib/education/age-fallback.ts
git commit -m "feat(education-videos): add CDSA_FALLBACK_CHAIN"
```

---

### Task 5: inapplicable-matrix.json + 空 yaml 骨架

**Files:**
- Create: `scripts/curate/inapplicable-matrix.json`
- Create: `src/data/video-catalog/official-tw.yaml`
- Create: `src/data/video-catalog/international.yaml`
- Create: `src/data/video-catalog/pro-kol.yaml`
- Create: `src/data/education-videos/cdsa-triage.yaml`
- Create: `src/data/education-videos/cdsa-domains.yaml`
- Create: `src/data/education-videos/cdss-vital-signs.yaml`
- Create: `src/data/education-videos/README.md`

- [ ] **Step 1: 寫 inapplicable-matrix.json**

Create `scripts/curate/inapplicable-matrix.json`:

```json
{
  "version": 1,
  "rationale": "依 src/data/questionnaire/questions.json 的 ageGroups 欄位與 z-score 路徑可用性決定；matrix 為 source of truth，yaml 的 inapplicable flag 須與此完全一致。",
  "cdsa.domain": {
    "behavior":               { "inapplicable": ["2-6m", "7-12m"] },
    "gross_motor":            { "inapplicable": [] },
    "fine_motor":             { "inapplicable": ["2-6m"] },
    "language":               { "inapplicable": ["2-6m"] },
    "cognition":              { "inapplicable": ["2-6m", "7-12m"] },
    "language_comprehension": { "inapplicable": ["2-6m"] },
    "language_expression":    { "inapplicable": ["2-6m", "7-12m"] },
    "social_emotional":       { "inapplicable": ["2-6m"] }
  },
  "cdsa.triage": { "inapplicable": [] },
  "cdss":        { "inapplicable": [] }
}
```

> **Phase-1 gate**：本檔需臨床顧問 sign-off（git commit `Signed-off-by:` 行）後才可進入 Task 16（產 keywords.json）。若 sign-off 時調整數值，必須同步更新 spec §3.5、§4.8、§7、§10。

- [ ] **Step 2: 寫三個 video-catalog 空 yaml**

Create `src/data/video-catalog/official-tw.yaml`:

```yaml
# Tier 1: 台灣官方醫療頻道（國健署、衛福部、各醫學中心兒科部門、學會）
# 影片在此檔以 array 頂層展開，每筆需通過 videoCatalogItemSchema
[]
```

Create `src/data/video-catalog/international.yaml`:

```yaml
# Tier 2: 國際認證頻道（AAP, CDC, NHS, WHO, Cleveland Clinic, etc.）
[]
```

Create `src/data/video-catalog/pro-kol.yaml`:

```yaml
# Tier 3: 醫療專業 KOL（個人可驗證身分的醫師頻道）
[]
```

- [ ] **Step 3: 寫三個 education-videos 空 yaml**

Create `src/data/education-videos/cdsa-triage.yaml`:

```yaml
# CDSA 分流結果 trigger map（14 個 trigger）
# trigger key 格式：cdsa.triage.<monitor|refer>.<ageGroupCDSA>
[]
```

Create `src/data/education-videos/cdsa-domains.yaml`:

```yaml
# CDSA domain anomaly trigger map（56 - 10 inapplicable = 46 reachable）
# trigger key 格式：cdsa.domain.<domain>.anomaly.<ageGroupCDSA>
[]
```

Create `src/data/education-videos/cdss-vital-signs.yaml`:

```yaml
# CDSS 生理警示 trigger map（63 個 trigger）
# trigger key 格式：cdss.<indicator>.<level>.<ageGroupCDSS>
[]
```

- [ ] **Step 4: 寫 README**

Create `src/data/education-videos/README.md`:

```markdown
# Education Videos Data

兩類 YAML：

1. `../video-catalog/<tier>.yaml`：影片元資料（去重池）
2. `./cdsa-triage.yaml` / `./cdsa-domains.yaml` / `./cdss-vital-signs.yaml`：trigger → videoIds 映射

維護規則：

- 所有變動需通過 `scripts/build-video-index.ts` 重 generate `public/data/video-index.json`，CI 端 `pnpm build:video-index && git diff --exit-code` 守 hash 一致
- `inapplicable: true` 的 trigger 必須與 `scripts/curate/inapplicable-matrix.json` 完全一致（matrix 為 source of truth）
- 影片新增/移除走 `pnpm curate:videos` → Claude Code 複審 → 寫回；不建議手改
- 詳見 `docs/superpowers/specs/2026-05-19-education-videos-design.md`
```

- [ ] **Step 5: Commit**

```bash
git add scripts/curate/inapplicable-matrix.json src/data/video-catalog/ src/data/education-videos/
git commit -m "feat(education-videos): add inapplicable matrix v1 + empty yaml skeleton"
```

> **Sign-off required**：本 commit 內含 `inapplicable-matrix.json` v1 估計值。Phase 2 之後步驟（特別是 Task 16 keywords.json）需此檔 sign-off 完成後才能啟動。

---

## Phase 2: Derivation 與 Lookup

### Task 6: trigger-derivation.ts + tests

**Files:**
- Create: `src/lib/education/trigger-derivation.ts`
- Create: `tests/lib/education/trigger-derivation.test.ts`

- [ ] **Step 1: 寫失敗測試**

Create `tests/lib/education/trigger-derivation.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { deriveCdsaTriggers, deriveCdssTriggers } from '../../../src/lib/education/trigger-derivation';
import type { TriageResult } from '../../../src/engine/cdsa/triage';
import type { IndicatorResult } from '../../../src/engine/workers/rule-engine.worker';

function makeTriage(category: 'normal' | 'monitor' | 'refer', anomalyDomains: string[]): TriageResult {
  return {
    category,
    confidence: 0.8,
    summary: 'test',
    anomalyCount: anomalyDomains.length,
    details: anomalyDomains.map(domain => ({
      domain, metric: 'x', value: 0, zScore: -2, directionalZ: -2,
      normMean: null, normStd: null, maxScore: null, isAnomaly: true,
    })),
  };
}

describe('deriveCdsaTriggers', () => {
  it('returns triage trigger for refer', () => {
    expect(deriveCdsaTriggers(makeTriage('refer', []), '13-24m')).toEqual([
      'cdsa.triage.refer.13-24m',
    ]);
  });

  it('skips triage when normal', () => {
    expect(deriveCdsaTriggers(makeTriage('normal', []), '13-24m')).toEqual([]);
  });

  it('emits both triage + domain triggers', () => {
    const triggers = deriveCdsaTriggers(makeTriage('monitor', ['fine_motor']), '25-36m');
    expect(triggers).toContain('cdsa.triage.monitor.25-36m');
    expect(triggers).toContain('cdsa.domain.fine_motor.anomaly.25-36m');
  });

  it('dedups fine_motor when both z-score and questionnaire emit', () => {
    const triage = makeTriage('monitor', ['fine_motor', 'fine_motor']);
    const triggers = deriveCdsaTriggers(triage, '13-24m');
    const domainTriggers = triggers.filter(t => t.startsWith('cdsa.domain.'));
    expect(domainTriggers).toHaveLength(1);
  });

  it('throws on unknown domain in DEV mode', () => {
    vi.stubEnv('DEV', true);
    expect(() => deriveCdsaTriggers(makeTriage('monitor', ['unknown_domain']), '13-24m')).toThrow(/Unknown CDSA domain/);
    vi.unstubAllEnvs();
  });

  it('warns and skips unknown domain in prod mode', () => {
    vi.stubEnv('DEV', false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const triggers = deriveCdsaTriggers(makeTriage('monitor', ['unknown_domain', 'fine_motor']), '13-24m');
    expect(triggers).not.toContain('cdsa.domain.unknown_domain.anomaly.13-24m');
    expect(triggers).toContain('cdsa.domain.fine_motor.anomaly.13-24m');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unknown domain'));
    warn.mockRestore();
    vi.unstubAllEnvs();
  });
});

describe('deriveCdssTriggers', () => {
  const mk = (indicator: string, level: IndicatorResult['level']): IndicatorResult => ({
    indicator, value: 0, level, range: [0, 0],
    rationale: 'test',
  });

  it('skips normal-level indicators', () => {
    expect(deriveCdssTriggers([mk('spo2', 'normal')], 'infant')).toEqual([]);
  });

  it('emits trigger for critical', () => {
    expect(deriveCdssTriggers([mk('spo2', 'critical')], 'infant')).toEqual([
      'cdss.spo2.critical.infant',
    ]);
  });

  it('emits multiple triggers from multiple indicators', () => {
    const triggers = deriveCdssTriggers([
      mk('spo2', 'warning'),
      mk('heart_rate', 'advisory'),
    ], 'toddler');
    expect(triggers).toContain('cdss.spo2.warning.toddler');
    expect(triggers).toContain('cdss.heart_rate.advisory.toddler');
  });

  it('throws on unknown indicator in DEV', () => {
    vi.stubEnv('DEV', true);
    expect(() => deriveCdssTriggers([mk('unknown', 'warning')], 'infant')).toThrow(/Unknown CDSS indicator/);
    vi.unstubAllEnvs();
  });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `pnpm test tests/lib/education/trigger-derivation.test.ts`
Expected: FAIL，找不到 `trigger-derivation` 模組。

- [ ] **Step 3: 寫實作**

Create `src/lib/education/trigger-derivation.ts`:

```typescript
import type { TriageResult } from '../../engine/cdsa/triage';
import type { AgeGroupCDSA } from '../utils/age-groups';
import type { IndicatorResult } from '../../engine/workers/rule-engine.worker';

type AgeGroupCDSS = 'infant' | 'toddler' | 'preschool';

const KNOWN_DOMAINS = new Set([
  'behavior', 'gross_motor', 'fine_motor', 'language',
  'cognition', 'language_comprehension', 'language_expression', 'social_emotional',
]);

const KNOWN_INDICATORS = new Set([
  'heart_rate', 'spo2', 'respiratory_rate', 'temperature',
  'sleep_quality', 'activity_level', 'sugar_intake',
]);

export function deriveCdsaTriggers(
  triage: TriageResult,
  ageGroup: AgeGroupCDSA,
): string[] {
  const triggers: string[] = [];
  if (triage.category !== 'normal') {
    triggers.push(`cdsa.triage.${triage.category}.${ageGroup}`);
  }
  const anomalyDomains = new Set(
    triage.details.filter(d => d.isAnomaly).map(d => d.domain),
  );
  for (const domain of anomalyDomains) {
    if (!KNOWN_DOMAINS.has(domain)) {
      if (import.meta.env.DEV) {
        throw new Error(`Unknown CDSA domain: ${domain}. Update KNOWN_DOMAINS + yaml.`);
      }
      console.warn(`[trigger-derivation] Unknown domain: ${domain}, skipping`);
      continue;
    }
    triggers.push(`cdsa.domain.${domain}.anomaly.${ageGroup}`);
  }
  return triggers;
}

export function deriveCdssTriggers(
  indicators: IndicatorResult[],
  ageGroup: AgeGroupCDSS,
): string[] {
  const triggers: string[] = [];
  for (const ir of indicators) {
    if (ir.level === 'normal') continue;
    if (!KNOWN_INDICATORS.has(ir.indicator)) {
      if (import.meta.env.DEV) {
        throw new Error(`Unknown CDSS indicator: ${ir.indicator}`);
      }
      console.warn(`[trigger-derivation] Unknown indicator: ${ir.indicator}, skipping`);
      continue;
    }
    triggers.push(`cdss.${ir.indicator}.${ir.level}.${ageGroup}`);
  }
  return triggers;
}
```

- [ ] **Step 4: 跑測試確認 pass**

Run: `pnpm test tests/lib/education/trigger-derivation.test.ts`
Expected: 全部 pass。

- [ ] **Step 5: Commit**

```bash
git add src/lib/education/trigger-derivation.ts tests/lib/education/trigger-derivation.test.ts
git commit -m "feat(education-videos): trigger-derivation for CDSA + CDSS"
```

---

### Task 7: build-video-index.ts + tests

**Files:**
- Create: `scripts/build-video-index.ts`
- Create: `tests/scripts/build-video-index.test.ts`
- Create: `tests/fixtures/video-yaml/`（fixture dir，下含 minimal yaml + matrix）

- [ ] **Step 1: 建 fixture**

Create `tests/fixtures/video-yaml/src/data/video-catalog/official-tw.yaml`:

```yaml
- videoId: "abc123XYZ45"
  title: "範例衛教"
  channel: "台大兒醫"
  channelId: "UCxxxxxxxxxxxxxxxxxxxxxx"
  duration: 245
  publishedAt: "2024-03-15"
  language: "zh-Hant"
  subtitleType: "human"
  sourceTier: "official-tw"
  viewCount: 12500
  curatedAt: "2026-05-19"
  verifiedBy: "claude-code"
  verificationStatus: "verified"
  score: 0.92
- videoId: "def456ABC78"
  title: "已下架影片"
  channel: "其他"
  channelId: "UCyyyyyyyyyyyyyyyyyyyyyy"
  duration: 120
  publishedAt: "2023-01-01"
  language: "zh-Hant"
  subtitleType: "auto"
  sourceTier: "pro-kol"
  viewCount: 100
  curatedAt: "2026-01-01"
  verifiedBy: "claude-code"
  verificationStatus: "rejected"
  score: 0.20
```

Create `tests/fixtures/video-yaml/src/data/education-videos/cdsa-triage.yaml`:

```yaml
- trigger: cdsa.triage.refer.13-24m
  category: triage
  triageCategory: refer
  ageGroup: 13-24m
  educationSlug: when-to-seek-help
  videoIds:
    - abc123XYZ45
    - def456ABC78
```

Create `tests/fixtures/video-yaml/src/data/education-videos/cdsa-domains.yaml`:

```yaml
- trigger: cdsa.domain.fine_motor.anomaly.2-6m
  category: domain
  domain: fine_motor
  ageGroup: 2-6m
  inapplicable: true
  videoIds: []
```

Create `tests/fixtures/video-yaml/src/data/education-videos/cdss-vital-signs.yaml`:

```yaml
[]
```

Create `tests/fixtures/video-yaml/scripts/curate/inapplicable-matrix.json`:

```json
{
  "version": 1,
  "rationale": "fixture",
  "cdsa.domain": {
    "behavior":               { "inapplicable": [] },
    "gross_motor":            { "inapplicable": [] },
    "fine_motor":             { "inapplicable": ["2-6m"] },
    "language":               { "inapplicable": [] },
    "cognition":              { "inapplicable": [] },
    "language_comprehension": { "inapplicable": [] },
    "language_expression":    { "inapplicable": [] },
    "social_emotional":       { "inapplicable": [] }
  },
  "cdsa.triage": { "inapplicable": [] },
  "cdss":        { "inapplicable": [] }
}
```

Create `tests/fixtures/video-yaml/src/data/education/when-to-seek-help.md`:

```markdown
---
title: "何時就醫"
summary: "範例"
category: general
ageGroup: [toddler]
format: article
publishedAt: 2024-01-01
---
fixture
```

- [ ] **Step 2: 寫失敗測試**

Create `tests/scripts/build-video-index.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildVideoIndex } from '../../scripts/build-video-index';

let tmpDir: string;

async function copyFixture(): Promise<string> {
  const dest = await fs.mkdtemp(path.join(os.tmpdir(), 'video-idx-'));
  await fs.cp('tests/fixtures/video-yaml', dest, { recursive: true });
  return dest;
}

describe('buildVideoIndex', () => {
  beforeEach(async () => { tmpDir = await copyFixture(); });

  it('emits public/data/video-index.json with verified videos only', async () => {
    await buildVideoIndex({ cwd: tmpDir });
    const idx = JSON.parse(await fs.readFile(`${tmpDir}/public/data/video-index.json`, 'utf8'));
    expect(idx.catalog).toHaveProperty('abc123XYZ45');
    expect(idx.catalog).not.toHaveProperty('def456ABC78');  // rejected, stripped
  });

  it('filters rejected videoIds from trigger entries', async () => {
    await buildVideoIndex({ cwd: tmpDir });
    const idx = JSON.parse(await fs.readFile(`${tmpDir}/public/data/video-index.json`, 'utf8'));
    expect(idx.triggers['cdsa.triage.refer.13-24m'].videoIds).toEqual(['abc123XYZ45']);
  });

  it('produces byte-identical output across runs (reproducible)', async () => {
    await buildVideoIndex({ cwd: tmpDir });
    const a = await fs.readFile(`${tmpDir}/public/data/video-index.json`);
    await buildVideoIndex({ cwd: tmpDir });
    const b = await fs.readFile(`${tmpDir}/public/data/video-index.json`);
    expect(a.equals(b)).toBe(true);
  });

  it('hard-fails on inapplicable matrix ↔ yaml mismatch', async () => {
    const yamlPath = `${tmpDir}/src/data/education-videos/cdsa-domains.yaml`;
    await fs.writeFile(yamlPath, `
- trigger: cdsa.domain.fine_motor.anomaly.7-12m
  category: domain
  domain: fine_motor
  ageGroup: 7-12m
  inapplicable: true
  videoIds: []
`);
    await expect(buildVideoIndex({ cwd: tmpDir })).rejects.toThrow(/inapplicable/);
  });

  it('hard-fails on trigger referencing missing videoId', async () => {
    const yamlPath = `${tmpDir}/src/data/education-videos/cdsa-triage.yaml`;
    await fs.writeFile(yamlPath, `
- trigger: cdsa.triage.refer.13-24m
  category: triage
  triageCategory: refer
  ageGroup: 13-24m
  videoIds: [zzzzzzzzzzz]
`);
    await expect(buildVideoIndex({ cwd: tmpDir })).rejects.toThrow(/unknown videoId/);
  });

  it('hard-fails on missing educationSlug', async () => {
    const yamlPath = `${tmpDir}/src/data/education-videos/cdsa-triage.yaml`;
    await fs.writeFile(yamlPath, `
- trigger: cdsa.triage.refer.13-24m
  category: triage
  triageCategory: refer
  ageGroup: 13-24m
  educationSlug: nonexistent-slug
  videoIds: [abc123XYZ45]
`);
    await expect(buildVideoIndex({ cwd: tmpDir })).rejects.toThrow(/educationSlug/);
  });

  it('detects duplicate videoId across catalog files', async () => {
    await fs.writeFile(`${tmpDir}/src/data/video-catalog/international.yaml`, `
- videoId: "abc123XYZ45"
  title: "重複"
  channel: "X"
  channelId: "UCzzzzzzzzzzzzzzzzzzzzzz"
  duration: 60
  publishedAt: "2024-01-01"
  language: "en"
  subtitleType: "auto"
  sourceTier: "international"
  viewCount: 0
  curatedAt: "2026-01-01"
  verifiedBy: "claude-code"
  verificationStatus: "verified"
  score: 0.5
`);
    await expect(buildVideoIndex({ cwd: tmpDir })).rejects.toThrow(/Duplicate videoId/);
  });
});
```

- [ ] **Step 3: 跑測試確認 fail**

Run: `pnpm test tests/scripts/build-video-index.test.ts`
Expected: FAIL — 找不到 `buildVideoIndex` export。

- [ ] **Step 4: 寫實作**

Create `scripts/build-video-index.ts`:

```typescript
#!/usr/bin/env tsx
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import fg from 'fast-glob';
import { z } from 'astro/zod';
import {
  videoCatalogItemSchema, triggerEntrySchema, runtimeIndexSchema,
  type VideoCatalogItem, type TriggerEntry,
} from '../src/lib/education/schemas';

interface InapplicableMatrix {
  version: number;
  rationale: string;
  'cdsa.domain': Record<string, { inapplicable: string[] }>;
  'cdsa.triage': { inapplicable: string[] };
  cdss: { inapplicable: string[] };
}

function sortObjectDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(k => [k, sortObjectDeep((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

export interface BuildOptions {
  cwd?: string;
}

export async function buildVideoIndex(opts: BuildOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const resolve = (rel: string) => path.join(cwd, rel);

  // Load matrix
  const matrixRaw = await fs.readFile(resolve('scripts/curate/inapplicable-matrix.json'), 'utf8');
  const matrix: InapplicableMatrix = JSON.parse(matrixRaw);

  // 1. read yamls
  const catalogFiles = await fg('src/data/video-catalog/*.yaml', { cwd });
  const triggerFiles = await fg('src/data/education-videos/*.yaml', { cwd });

  // 2. parse + validate
  const catalog: Record<string, VideoCatalogItem> = {};
  for (const rel of catalogFiles) {
    const arr = yaml.load(await fs.readFile(resolve(rel), 'utf8'));
    const validated = z.array(videoCatalogItemSchema).parse(arr ?? []);
    for (const v of validated) {
      if (catalog[v.videoId]) throw new Error(`Duplicate videoId: ${v.videoId} in ${rel}`);
      catalog[v.videoId] = v;
    }
  }

  const triggers: Record<string, TriggerEntry> = {};
  for (const rel of triggerFiles) {
    const arr = yaml.load(await fs.readFile(resolve(rel), 'utf8'));
    const validated = z.array(triggerEntrySchema).parse(arr ?? []);
    for (const t of validated) {
      if (triggers[t.trigger]) throw new Error(`Duplicate trigger: ${t.trigger} in ${rel}`);
      triggers[t.trigger] = t;
    }
  }

  // 3. cross-check: yaml inapplicable ↔ matrix
  const matrixInapplicable = new Set<string>();
  for (const [domain, def] of Object.entries(matrix['cdsa.domain'] ?? {})) {
    for (const age of def.inapplicable) {
      matrixInapplicable.add(`cdsa.domain.${domain}.anomaly.${age}`);
    }
  }
  for (const t of matrix['cdsa.triage']?.inapplicable ?? []) matrixInapplicable.add(t);
  for (const t of matrix.cdss?.inapplicable ?? []) matrixInapplicable.add(t);

  const yamlInapplicable = new Set(
    Object.values(triggers).filter(t => t.inapplicable === true).map(t => t.trigger),
  );
  const onlyInMatrix = [...matrixInapplicable].filter(k => !yamlInapplicable.has(k));
  const onlyInYaml = [...yamlInapplicable].filter(k => !matrixInapplicable.has(k));
  if (onlyInMatrix.length || onlyInYaml.length) {
    throw new Error(
      `inapplicable mismatch — matrix is source of truth.\n  missing in yaml: ${JSON.stringify(onlyInMatrix)}\n  extra in yaml: ${JSON.stringify(onlyInYaml)}`,
    );
  }

  // 4. cross-check: videoId 存在
  for (const t of Object.values(triggers)) {
    for (const id of t.videoIds) {
      if (!catalog[id]) throw new Error(`Trigger ${t.trigger} references unknown videoId: ${id}`);
    }
  }

  // 5. cross-check: educationSlug 對應 md 檔
  for (const t of Object.values(triggers)) {
    if (!t.educationSlug) continue;
    const mdPath = resolve(`src/data/education/${t.educationSlug}.md`);
    try { await fs.access(mdPath); }
    catch { throw new Error(`Trigger ${t.trigger} educationSlug not found: ${mdPath}`); }
  }

  // 6. emit slim runtime；只含 verified
  const verifiedCatalog = Object.fromEntries(
    Object.entries(catalog).filter(([, v]) => v.verificationStatus === 'verified'),
  );

  const runtime = {
    catalog: Object.fromEntries(
      Object.entries(verifiedCatalog).map(([id, v]) => [id, {
        videoId: v.videoId, title: v.title, channel: v.channel,
        duration: v.duration, language: v.language,
        sourceTier: v.sourceTier, score: v.score,
      }]),
    ),
    triggers: Object.fromEntries(
      Object.entries(triggers).map(([k, t]) => [k, {
        videoIds: t.inapplicable
          ? []
          : t.videoIds.filter(id => verifiedCatalog[id] != null),
        inapplicable: t.inapplicable === true,
      }]),
    ),
  };

  runtimeIndexSchema.parse(runtime);

  const stable = JSON.stringify(sortObjectDeep(runtime), null, 2) + '\n';
  await fs.mkdir(resolve('public/data'), { recursive: true });
  await fs.writeFile(resolve('public/data/video-index.json'), stable);

  await fs.mkdir(resolve('scripts/curate'), { recursive: true });
  await fs.writeFile(
    resolve('scripts/curate/.last-build.json'),
    JSON.stringify({ builtAt: new Date().toISOString() }, null, 2) + '\n',
  );
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  buildVideoIndex().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
```

- [ ] **Step 5: 跑測試確認 pass**

Run: `pnpm test tests/scripts/build-video-index.test.ts`
Expected: 全部 pass。

- [ ] **Step 6: 跑一次真實 build 確認 emit 空 index**

Run: `pnpm build:video-index`
Expected: 產出 `public/data/video-index.json` 內容為 `{"catalog":{},"triggers":{}}\n`（因 yaml 都空）。

- [ ] **Step 7: Commit**

```bash
git add scripts/build-video-index.ts tests/scripts/build-video-index.test.ts tests/fixtures/video-yaml/ public/data/video-index.json
git commit -m "feat(education-videos): build-video-index with cross-checks + reproducible emit"
```

---

### Task 8: video-lookup.ts + tryAgeGroupFallback + tests

**Files:**
- Create: `src/lib/education/video-lookup.ts`
- Create: `tests/lib/education/video-lookup.test.ts`

- [ ] **Step 1: 寫失敗測試**

Create `tests/lib/education/video-lookup.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RuntimeIndex, RuntimeVideo } from '../../../src/lib/education/schemas';

const mockVideo = (id: string, score: number, sourceTier: RuntimeVideo['sourceTier'] = 'official-tw'): RuntimeVideo => ({
  videoId: id, title: `t-${id}`, channel: 'c', duration: 200,
  language: 'zh-Hant', sourceTier, score,
});

const mockIndex: RuntimeIndex = {
  catalog: {
    v1: mockVideo('v1', 0.9),
    v2: mockVideo('v2', 0.7),
    v3: mockVideo('v3', 0.5),
  },
  triggers: {
    'cdsa.triage.refer.13-24m': { videoIds: ['v1', 'v2'], inapplicable: false },
    'cdsa.domain.fine_motor.anomaly.2-6m': { videoIds: [], inapplicable: true },
    'cdsa.domain.fine_motor.anomaly.7-12m': { videoIds: ['v3'], inapplicable: false },
    'cdsa.domain.fine_motor.anomaly.13-24m': { videoIds: [], inapplicable: false },
  },
};

beforeEach(() => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => mockIndex,
  } as Response);
  // reset module singleton
  vi.resetModules();
});

describe('video-lookup', () => {
  it('returns sorted videos for matched trigger', async () => {
    const { getVideosForTrigger } = await import('../../../src/lib/education/video-lookup');
    const videos = await getVideosForTrigger('cdsa.triage.refer.13-24m');
    expect(videos.map(v => v.videoId)).toEqual(['v1', 'v2']);
  });

  it('returns empty for inapplicable trigger (custom ignored)', async () => {
    const { getVideosForTrigger } = await import('../../../src/lib/education/video-lookup');
    const custom = [{ ...mockVideo('vCustom', 1.0), triggers: '*' as const }];
    const videos = await getVideosForTrigger('cdsa.domain.fine_motor.anomaly.2-6m', custom);
    expect(videos).toEqual([]);
  });

  it('ageGroupFallback returns videos from 7-12m when 13-24m empty', async () => {
    const { getVideosForTrigger } = await import('../../../src/lib/education/video-lookup');
    const videos = await getVideosForTrigger('cdsa.domain.fine_motor.anomaly.13-24m', [], {
      ageGroupFallback: true,
    });
    expect(videos.map(v => v.videoId)).toEqual(['v3']);
  });

  it('ageGroupFallback skips inapplicable chain entries', async () => {
    const { getVideosForTrigger } = await import('../../../src/lib/education/video-lookup');
    const videos = await getVideosForTrigger('cdsa.domain.fine_motor.anomaly.7-12m', [], {
      ageGroupFallback: true,
    });
    expect(videos.map(v => v.videoId)).toEqual(['v3']);
  });

  it('retries after fetch failure', async () => {
    let attempt = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      attempt++;
      if (attempt === 1) throw new Error('network');
      return { ok: true, json: async () => mockIndex } as Response;
    });

    const { getVideosForTrigger } = await import('../../../src/lib/education/video-lookup');
    await expect(getVideosForTrigger('cdsa.triage.refer.13-24m')).rejects.toThrow();
    const videos = await getVideosForTrigger('cdsa.triage.refer.13-24m');
    expect(videos).toHaveLength(2);
  });

  it('regex correctly parses cdsa.domain.<dom>.anomaly.<age>', async () => {
    const { tryAgeGroupFallback } = await import('../../../src/lib/education/video-lookup');
    const ids = tryAgeGroupFallback('cdsa.domain.fine_motor.anomaly.13-24m', mockIndex);
    expect(ids).toEqual(['v3']);
  });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `pnpm test tests/lib/education/video-lookup.test.ts`
Expected: FAIL — 模組不存在。

- [ ] **Step 3: 寫實作**

Create `src/lib/education/video-lookup.ts`:

```typescript
import type { CustomVideo, RuntimeIndex, RuntimeVideo } from './schemas';
import { AGE_GROUPS_CDSA, type AgeGroupCDSA } from '../utils/age-groups';
import { mergeCustomVideos } from './merge-custom-videos';
import { CDSA_FALLBACK_CHAIN } from './age-fallback';

const CDSA_TRIGGER_REGEX = new RegExp(
  `^(cdsa\\.(?:triage|domain)\\..+)\\.(${AGE_GROUPS_CDSA.join('|')})$`,
);

let indexPromise: Promise<RuntimeIndex> | null = null;

function loadIndex(): Promise<RuntimeIndex> {
  if (!indexPromise) {
    indexPromise = fetch(`${import.meta.env.BASE_URL}data/video-index.json`)
      .then(r => {
        if (!r.ok) throw new Error(`video-index.json fetch failed: ${r.status}`);
        return r.json() as Promise<RuntimeIndex>;
      })
      .catch(err => {
        indexPromise = null;
        throw err;
      });
  }
  return indexPromise;
}

export interface VideoLookupOptions {
  maxResults?: number;
  ageGroupFallback?: boolean;
}

export function tryAgeGroupFallback(trigger: string, idx: RuntimeIndex): string[] {
  const m = trigger.match(CDSA_TRIGGER_REGEX);
  if (!m) return [];
  const [, prefix, currentAge] = m;
  const chain = CDSA_FALLBACK_CHAIN[currentAge as AgeGroupCDSA] ?? [];
  for (const altAge of chain) {
    const altTrigger = `${prefix}.${altAge}`;
    const altEntry = idx.triggers[altTrigger];
    if (!altEntry || altEntry.inapplicable) continue;
    if (altEntry.videoIds.length === 0) continue;
    return altEntry.videoIds;
  }
  return [];
}

export async function getVideosForTrigger(
  trigger: string,
  customVideos: CustomVideo[] = [],
  options: VideoLookupOptions = {},
): Promise<RuntimeVideo[]> {
  const idx = await loadIndex();
  const entry = idx.triggers[trigger];

  if (entry?.inapplicable) return [];   // custom ignored

  const opts = { maxResults: 3, ageGroupFallback: false, ...options };
  let ids = entry?.videoIds ?? [];
  if (ids.length === 0 && opts.ageGroupFallback) {
    ids = tryAgeGroupFallback(trigger, idx);
  }

  const staticVideos = ids
    .map(id => idx.catalog[id])
    .filter((v): v is RuntimeVideo => v != null)
    .sort((a, b) => b.score - a.score);

  return mergeCustomVideos(staticVideos, customVideos, trigger, opts);
}

export async function getVideosForTriggers(
  triggerList: string[],
  customVideos: CustomVideo[] = [],
  options?: VideoLookupOptions,
): Promise<Record<string, RuntimeVideo[]>> {
  const results = await Promise.all(
    triggerList.map(async t => [t, await getVideosForTrigger(t, customVideos, options)] as const),
  );
  return Object.fromEntries(results);
}
```

- [ ] **Step 4: 跑測試確認 pass（merge-custom-videos 尚未寫，會 fail，先跳過）**

Run: `pnpm test tests/lib/education/video-lookup.test.ts`
Expected: FAIL — `merge-custom-videos` 找不到。下一個 task 補。

- [ ] **Step 5: Commit（pre-merge）**

```bash
git add src/lib/education/video-lookup.ts tests/lib/education/video-lookup.test.ts
git commit -m "feat(education-videos): video-lookup + tryAgeGroupFallback (merge stub pending)"
```

---

### Task 9: merge-custom-videos.ts + 合約 tests

**Files:**
- Create: `src/lib/education/merge-custom-videos.ts`
- Create: `tests/lib/education/merge-custom-videos.test.ts`

- [ ] **Step 1: 寫合約測試**

Create `tests/lib/education/merge-custom-videos.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mergeCustomVideos } from '../../../src/lib/education/merge-custom-videos';
import type { CustomVideo, RuntimeVideo } from '../../../src/lib/education/schemas';

const mk = (id: string, score: number): RuntimeVideo => ({
  videoId: id, title: `t-${id}`, channel: 'c', duration: 200,
  language: 'zh-Hant', sourceTier: 'official-tw', score,
});

const mkCustom = (id: string, score: number, triggers: string[] | '*' = '*'): CustomVideo => ({
  ...mk(id, score), triggers,
});

describe('mergeCustomVideos', () => {
  it('returns static videos when no custom', () => {
    const merged = mergeCustomVideos([mk('v1', 0.9), mk('v2', 0.7)], [], 'cdsa.triage.refer.13-24m', {});
    expect(merged.map(v => v.videoId)).toEqual(['v1', 'v2']);
  });

  it('prepends custom videos before static', () => {
    const merged = mergeCustomVideos(
      [mk('v1', 0.9)],
      [mkCustom('vCustom', 0.5)],
      'cdsa.triage.refer.13-24m',
      {},
    );
    expect(merged.map(v => v.videoId)).toEqual(['vCustom', 'v1']);
  });

  it('dedupes by videoId, keeping custom version', () => {
    const merged = mergeCustomVideos(
      [mk('v1', 0.9)],
      [mkCustom('v1', 0.3)],   // same id, lower score
      'cdsa.triage.refer.13-24m',
      {},
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].score).toBe(0.3);  // custom won
  });

  it('filters custom videos by trigger when triggers is array', () => {
    const merged = mergeCustomVideos(
      [mk('v1', 0.9)],
      [
        mkCustom('vA', 0.5, ['cdsa.triage.refer.13-24m']),
        mkCustom('vB', 0.5, ['cdss.spo2.critical.infant']),
      ],
      'cdsa.triage.refer.13-24m',
      {},
    );
    expect(merged.map(v => v.videoId)).toEqual(['vA', 'v1']);
  });

  it('passes all custom when triggers is "*"', () => {
    const merged = mergeCustomVideos(
      [mk('v1', 0.9)],
      [mkCustom('vAll', 0.5, '*')],
      'cdsa.triage.refer.13-24m',
      {},
    );
    expect(merged.map(v => v.videoId)).toEqual(['vAll', 'v1']);
  });

  it('applies maxResults AFTER merge', () => {
    const merged = mergeCustomVideos(
      [mk('v1', 0.9), mk('v2', 0.7)],
      [mkCustom('vA', 0.5)],
      'cdsa.triage.refer.13-24m',
      { maxResults: 2 },
    );
    expect(merged.map(v => v.videoId)).toEqual(['vA', 'v1']);
  });

  it('sorts each segment by score descending internally', () => {
    const merged = mergeCustomVideos(
      [mk('v1', 0.7), mk('v2', 0.9)],
      [mkCustom('vA', 0.4), mkCustom('vB', 0.6)],
      'cdsa.triage.refer.13-24m',
      {},
    );
    expect(merged.map(v => v.videoId)).toEqual(['vB', 'vA', 'v2', 'v1']);
  });
});
```

- [ ] **Step 2: 跑測試 fail**

Run: `pnpm test tests/lib/education/merge-custom-videos.test.ts`
Expected: FAIL.

- [ ] **Step 3: 寫實作**

Create `src/lib/education/merge-custom-videos.ts`:

```typescript
import type { CustomVideo, RuntimeVideo } from './schemas';

/**
 * 合約：
 *  - inapplicable trigger 已在 caller 端過濾，本函式不收 inapplicable 情境
 *  - dedupe by videoId（custom 版本取代 static）
 *  - custom 整段 prepend（自訂優先顯示）
 *  - 雙端各自按 score 降冪排
 *  - maxResults 在 merge 後套用
 *  - custom 端 triggers='*' 通用，或 triggers 陣列含當前 trigger 才適用
 */
export function mergeCustomVideos(
  staticVideos: RuntimeVideo[],
  customVideos: CustomVideo[],
  trigger: string,
  options: { maxResults?: number },
): RuntimeVideo[] {
  const filteredCustom = customVideos.filter(c =>
    c.triggers === '*' || c.triggers.includes(trigger),
  );

  const customIds = new Set(filteredCustom.map(c => c.videoId));
  const dedupedStatic = staticVideos.filter(v => !customIds.has(v.videoId));

  const sortedCustom = [...filteredCustom].sort((a, b) => b.score - a.score);
  const sortedStatic = [...dedupedStatic].sort((a, b) => b.score - a.score);

  const merged: RuntimeVideo[] = [...sortedCustom, ...sortedStatic];
  return options.maxResults ? merged.slice(0, options.maxResults) : merged;
}
```

- [ ] **Step 4: 跑測試 pass**

Run: `pnpm test tests/lib/education/merge-custom-videos.test.ts tests/lib/education/video-lookup.test.ts`
Expected: 全部 pass。

- [ ] **Step 5: Commit**

```bash
git add src/lib/education/merge-custom-videos.ts tests/lib/education/merge-custom-videos.test.ts
git commit -m "feat(education-videos): mergeCustomVideos contract impl + tests"
```

---

### Phase 2 Milestone

至此 schemas、derivation、lookup、build script 全部測試通過。下一步進入 curate 工具實作。

---

## Phase 3: Curate 工具

### Task 10: yt-dlp wrapper

**Files:**
- Create: `scripts/curate/lib/yt-dlp.ts`
- Create: `tests/scripts/yt-dlp.test.ts`

- [ ] **Step 1: 寫測試（mock child_process）**

Create `tests/scripts/yt-dlp.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { searchYtDlp, fetchMetadata, detectRateLimit } from '../../scripts/curate/lib/yt-dlp';
import * as cp from 'node:child_process';

describe('yt-dlp wrapper', () => {
  it('searchYtDlp returns parsed array of {id, title, duration}', async () => {
    vi.mocked(cp.execFile).mockImplementation(((_cmd: any, _args: any, _opts: any, cb: any) => {
      cb(null, '{"id":"abc","title":"A","duration":120}\n{"id":"def","title":"B","duration":90}', '');
      return {} as any;
    }) as any);

    const results = await searchYtDlp('test query', 30);
    expect(results).toEqual([
      { id: 'abc', title: 'A', duration: 120 },
      { id: 'def', title: 'B', duration: 90 },
    ]);
  });

  it('detectRateLimit returns true on HTTP 429', () => {
    expect(detectRateLimit('ERROR: HTTP Error 429: Too Many Requests')).toBe(true);
  });

  it('detectRateLimit returns true on Sign in to confirm', () => {
    expect(detectRateLimit('ERROR: Sign in to confirm your age')).toBe(true);
  });

  it('detectRateLimit returns false for normal stderr', () => {
    expect(detectRateLimit('some normal warning')).toBe(false);
  });
});
```

- [ ] **Step 2: 跑測試 fail**

Run: `pnpm test tests/scripts/yt-dlp.test.ts`
Expected: FAIL — 模組不存在。

- [ ] **Step 3: 寫實作**

Create `scripts/curate/lib/yt-dlp.ts`:

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface SearchResult {
  id: string;
  title: string;
  duration: number;
}

export interface FullMetadata extends SearchResult {
  channel: string;
  channel_id: string;
  upload_date: string;     // YYYYMMDD
  view_count: number;
  description: string;
  subtitles?: Record<string, unknown>;
  automatic_captions?: Record<string, unknown>;
}

export function detectRateLimit(stderr: string): boolean {
  return /HTTP Error 429|Too Many Requests|Sign in to confirm/i.test(stderr);
}

const BACKOFFS_SECONDS = [30, 60, 120, 240];

async function runYtDlp(args: string[]): Promise<string> {
  for (let attempt = 0; attempt < BACKOFFS_SECONDS.length; attempt++) {
    try {
      const { stdout } = await exec('yt-dlp', args, { maxBuffer: 50 * 1024 * 1024 });
      return stdout;
    } catch (err) {
      const e = err as { stderr?: string };
      if (e.stderr && detectRateLimit(e.stderr)) {
        const wait = BACKOFFS_SECONDS[attempt] * 1000;
        console.warn(`[yt-dlp] rate-limited, backing off ${wait / 1000}s...`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }
      throw err;
    }
  }
  throw new Error('yt-dlp rate-limit retries exhausted');
}

export async function searchYtDlp(query: string, n: number = 30): Promise<SearchResult[]> {
  const stdout = await runYtDlp([
    '--flat-playlist', '--print-json',
    '--sleep-requests', '1.5', '--retries', '3', '--no-warnings',
    `ytsearch${n}:${query}`,
  ]);
  return stdout
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const obj = JSON.parse(line) as Record<string, unknown>;
      return {
        id: String(obj.id),
        title: String(obj.title ?? ''),
        duration: Number(obj.duration ?? 0),
      };
    });
}

export async function fetchMetadata(videoId: string): Promise<FullMetadata> {
  const stdout = await runYtDlp([
    '--skip-download', '--print-json', '--no-warnings',
    `https://www.youtube.com/watch?v=${videoId}`,
  ]);
  return JSON.parse(stdout) as FullMetadata;
}

export async function downloadSubtitle(videoId: string, cacheDir: string): Promise<void> {
  await runYtDlp([
    '--skip-download',
    '--write-subs', '--write-auto-subs',
    '--sub-langs', 'zh-Hant,zh-TW,zh,en',
    '--sub-format', 'vtt',
    '--output', `${cacheDir}/%(id)s.%(ext)s`,
    '--no-warnings',
    `https://www.youtube.com/watch?v=${videoId}`,
  ]);
}

export async function resolveChannelId(handle: string): Promise<string> {
  const stdout = await runYtDlp([
    '-J', '--playlist-end', '1', '--no-warnings',
    `https://www.youtube.com/${handle}/videos`,
  ]);
  const obj = JSON.parse(stdout) as { channel_id?: string };
  if (!obj.channel_id) throw new Error(`Cannot resolve channelId for ${handle}`);
  return obj.channel_id;
}
```

- [ ] **Step 4: 跑測試 pass**

Run: `pnpm test tests/scripts/yt-dlp.test.ts`
Expected: 全 pass。

- [ ] **Step 5: Commit**

```bash
git add scripts/curate/lib/yt-dlp.ts tests/scripts/yt-dlp.test.ts
git commit -m "feat(education-videos): yt-dlp wrapper with 429 backoff + handle resolution"
```

---

### Task 11: 簡體偵測模組

**Files:**
- Create: `scripts/curate/lib/simplified-detector.ts`
- Create: `tests/scripts/simplified-detector.test.ts`

- [ ] **Step 1: 寫測試**

Create `tests/scripts/simplified-detector.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { simplifiedRatio } from '../../scripts/curate/lib/simplified-detector';

describe('simplifiedRatio', () => {
  it('returns 0 for pure traditional', () => {
    expect(simplifiedRatio('兒童體重發展')).toBeLessThan(0.1);
  });

  it('returns > 0.3 for simplified content', () => {
    expect(simplifiedRatio('儿童体重发展评估')).toBeGreaterThan(0.3);
  });

  it('returns 0 for empty input', () => {
    expect(simplifiedRatio('')).toBe(0);
  });

  it('returns 0 for non-Chinese text', () => {
    expect(simplifiedRatio('Hello world 123')).toBe(0);
  });
});
```

- [ ] **Step 2: 跑測試 fail**

Run: `pnpm test tests/scripts/simplified-detector.test.ts`
Expected: FAIL.

- [ ] **Step 3: 寫實作**

Create `scripts/curate/lib/simplified-detector.ts`:

```typescript
// 高頻簡↔繁字對照表（簡體字 → 對應繁體字）
const SIMPLIFIED_TO_TRADITIONAL: Record<string, string> = {
  '儿': '兒', '体': '體', '语': '語', '过': '過', '关': '關', '门': '門',
  '问': '問', '间': '間', '时': '時', '会': '會', '说': '說', '话': '話',
  '听': '聽', '见': '見', '车': '車', '电': '電', '脑': '腦', '医': '醫',
  '药': '藥', '疗': '療', '诊': '診', '断': '斷', '症': '症', '状': '狀',
  '发': '發', '热': '熱', '冷': '冷', '动': '動', '运': '運', '游': '遊',
  '戏': '戲', '学': '學', '习': '習', '读': '讀', '书': '書', '写': '寫',
  '画': '畫', '图': '圖', '声': '聲', '响': '響', '应': '應', '认': '認',
  '识': '識', '议': '議', '论': '論', '设': '設', '计': '計', '产': '產',
  '业': '業', '务': '務', '员': '員', '团': '團', '队': '隊', '组': '組',
  '织': '織', '后': '後', '从': '從', '众': '眾', '们': '們',
};

const TRADITIONAL_SET = new Set(Object.values(SIMPLIFIED_TO_TRADITIONAL));
const SIMPLIFIED_SET = new Set(Object.keys(SIMPLIFIED_TO_TRADITIONAL));

const CJK_REGEX = /[一-鿿]/;

/** 對中文字符統計簡體比例。非中文（英文、數字、符號）不算分母。 */
export function simplifiedRatio(text: string): number {
  let cjkCount = 0;
  let simplifiedCount = 0;
  let traditionalCount = 0;
  for (const ch of text) {
    if (!CJK_REGEX.test(ch)) continue;
    cjkCount++;
    if (SIMPLIFIED_SET.has(ch)) simplifiedCount++;
    else if (TRADITIONAL_SET.has(ch)) traditionalCount++;
  }
  if (cjkCount === 0) return 0;
  const decisive = simplifiedCount + traditionalCount;
  if (decisive === 0) return 0;
  return simplifiedCount / decisive;
}
```

- [ ] **Step 4: 跑測試 pass**

Run: `pnpm test tests/scripts/simplified-detector.test.ts`
Expected: pass。

- [ ] **Step 5: Commit**

```bash
git add scripts/curate/lib/simplified-detector.ts tests/scripts/simplified-detector.test.ts
git commit -m "feat(education-videos): simplified Chinese detector (60-pair table)"
```

---

### Task 12: Heuristics 評分

**Files:**
- Create: `scripts/curate/lib/heuristics.ts`
- Create: `tests/scripts/curate-heuristics.test.ts`

- [ ] **Step 1: 寫測試**

Create `tests/scripts/curate-heuristics.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { computeScore, classifyVerdict, type ScoreInput } from '../../scripts/curate/lib/heuristics';

const base: ScoreInput = {
  channelTier: 'pro-kol',
  subtitleType: 'auto',
  medicalTermDensity: 0.05,
  viewCount: 1000,
  dangerKeywordHits: 0,
  publishedAt: '2025-01-01',
  duration: 300,
  minDuration: 60,
  maxDuration: 600,
  timeSensitive: false,
  todayIsoDate: '2026-05-19',
};

describe('computeScore', () => {
  it('official-tw + human subs gets high score', () => {
    expect(computeScore({ ...base, channelTier: 'official-tw', subtitleType: 'human' })).toBeGreaterThan(0.75);
  });

  it('clamps at [0, 1]', () => {
    const s = computeScore({ ...base, dangerKeywordHits: 10 });
    expect(s).toBe(0);
  });

  it('viewCountSignal caps at 0.10', () => {
    expect(computeScore({ ...base, viewCount: 1_000_000_000 })).toBeLessThan(
      computeScore({ ...base, viewCount: 1_000_000 }) + 0.05,
    );
  });

  it('age decay applies linear penalty 3-8 years', () => {
    const recent = computeScore({ ...base, publishedAt: '2025-01-01' });
    const aged = computeScore({ ...base, publishedAt: '2021-01-01' });
    expect(aged).toBeLessThan(recent);
  });

  it('hard reject when > 8y AND timeSensitive', () => {
    expect(computeScore({ ...base, publishedAt: '2017-01-01', timeSensitive: true })).toBe(0);
  });

  it('does not hard reject > 8y when not timeSensitive', () => {
    expect(computeScore({ ...base, publishedAt: '2017-01-01', timeSensitive: false })).toBeGreaterThan(0);
  });
});

describe('classifyVerdict', () => {
  it('auto-verified when score >= 0.80, no danger, human, white channel', () => {
    expect(classifyVerdict({ ...base, channelTier: 'official-tw', subtitleType: 'human' }, 0.85)).toBe('auto-verified');
  });

  it('auto-rejected when score < 0.30', () => {
    expect(classifyVerdict(base, 0.2)).toBe('auto-rejected');
  });

  it('auto-rejected when danger hits', () => {
    expect(classifyVerdict({ ...base, dangerKeywordHits: 1 }, 0.85)).toBe('auto-rejected');
  });

  it('needs-review for the rest', () => {
    expect(classifyVerdict(base, 0.6)).toBe('needs-review');
  });
});
```

- [ ] **Step 2: 跑測試 fail**

Run: `pnpm test tests/scripts/curate-heuristics.test.ts`
Expected: FAIL.

- [ ] **Step 3: 寫實作**

Create `scripts/curate/lib/heuristics.ts`:

```typescript
export interface ScoreInput {
  channelTier: 'official-tw' | 'international' | 'pro-kol';
  subtitleType: 'human' | 'auto' | 'none';
  medicalTermDensity: number;     // 0..1
  viewCount: number;
  dangerKeywordHits: number;
  publishedAt: string;             // YYYY-MM-DD
  duration: number;                // seconds
  minDuration: number;
  maxDuration: number;
  timeSensitive: boolean;
  todayIsoDate: string;            // YYYY-MM-DD（測試可注入）
}

function yearsBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / (365.25 * 24 * 3600 * 1000);
}

export function computeScore(i: ScoreInput): number {
  // hard reject: > 8y + timeSensitive
  const ageY = yearsBetween(i.publishedAt, i.todayIsoDate);
  if (ageY > 8 && i.timeSensitive) return 0;

  // hard reject: danger
  if (i.dangerKeywordHits > 0) return 0;

  let score = 0.20;
  score += { 'official-tw': 0.40, international: 0.35, 'pro-kol': 0.20 }[i.channelTier];
  score += { human: 0.15, auto: 0.05, none: 0 }[i.subtitleType];
  score += Math.max(0, Math.min(0.15, i.medicalTermDensity));
  score += Math.max(0, Math.min(0.10, Math.log10(i.viewCount + 1) * 0.02));

  // age decay
  if (ageY > 3 && ageY <= 8) score -= ((ageY - 3) / 5) * 0.15;

  // duration penalty
  if (i.duration < i.minDuration || i.duration > i.maxDuration) {
    const factor = i.duration < i.minDuration
      ? i.minDuration / Math.max(1, i.duration)
      : i.duration / i.maxDuration;
    score -= Math.min(0.20, 0.05 * factor);
  }

  return Math.max(0, Math.min(1, score));
}

export type Verdict = 'auto-verified' | 'auto-rejected' | 'needs-review';

export function classifyVerdict(i: ScoreInput, score: number): Verdict {
  if (i.dangerKeywordHits > 0) return 'auto-rejected';
  if (score < 0.30) return 'auto-rejected';
  if (
    score >= 0.80 &&
    i.subtitleType === 'human' &&
    (i.channelTier === 'official-tw' || i.channelTier === 'international')
  ) {
    return 'auto-verified';
  }
  return 'needs-review';
}
```

- [ ] **Step 4: 跑測試 pass**

Run: `pnpm test tests/scripts/curate-heuristics.test.ts`
Expected: pass。

- [ ] **Step 5: Commit**

```bash
git add scripts/curate/lib/heuristics.ts tests/scripts/curate-heuristics.test.ts
git commit -m "feat(education-videos): heuristics scoring + three-state verdict"
```

---

### Task 13: Report writer

**Files:**
- Create: `scripts/curate/lib/report-writer.ts`

- [ ] **Step 1: 寫實作（無 unit test — 純字串組裝，靠 integration test 覆蓋）**

Create `scripts/curate/lib/report-writer.ts`:

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Verdict } from './heuristics';

export interface ReportCandidate {
  videoId: string;
  title: string;
  channel: string;
  sourceTier: string;
  duration: number;
  subtitleType: 'human' | 'auto' | 'none';
  score: number;
  subtitleHead: string;     // 字幕前 200 字
  subtitleTail: string;
  verdict: Verdict;
  notes?: string;
}

export interface ReportData {
  trigger: string;
  generatedAt: string;
  candidates: ReportCandidate[];
  pipelineNotes: string[];   // e.g. 'NO_CANDIDATES', 'ALL_FILTERED_OUT'
}

const CHECKLIST = [
  '臨床正確性',
  '年齡適配',
  '症狀 vs 診斷區隔',
  '無商業推銷',
  '無偽科學',
  '家長語氣',
  '資訊密度',
  '無 PII 暴露',
  '頻道身分驗證',
  '時效性',
];

export async function writeReport(data: ReportData, reportsDir: string): Promise<string> {
  const lines: string[] = [];
  lines.push(`# Curate Report: ${data.trigger}`);
  lines.push('');
  lines.push(`- generated: ${data.generatedAt}`);
  if (data.pipelineNotes.length) {
    lines.push(`- pipeline: ${data.pipelineNotes.join(', ')}`);
  }
  lines.push('');

  if (data.candidates.length === 0) {
    lines.push('**No candidates remained after heuristics.**');
  }

  for (const c of data.candidates) {
    lines.push(`## Candidate: ${c.videoId} — ${c.title}`);
    lines.push(`- channel: ${c.channel} (${c.sourceTier})`);
    lines.push(`- duration: ${c.duration}s | subtitleType: ${c.subtitleType} | score: ${c.score.toFixed(2)}`);
    lines.push(`- Auto verdict: **${c.verdict}**`);
    lines.push('');
    lines.push('subtitle head (≤ 200 chars):');
    lines.push('```');
    lines.push(c.subtitleHead);
    lines.push('```');
    lines.push('');
    lines.push('subtitle tail (≤ 200 chars):');
    lines.push('```');
    lines.push(c.subtitleTail);
    lines.push('```');
    lines.push('');
    lines.push('### Claude Code 複審 Checklist');
    for (let i = 0; i < CHECKLIST.length; i++) {
      lines.push(`- [ ] ${i + 1}. ${CHECKLIST[i]}`);
    }
    lines.push('');
    lines.push('**Final Verdict**: <verified|rejected|needs-review>');
    lines.push('');
    lines.push(`**Notes**: ${c.notes ?? ''}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  await fs.mkdir(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `${data.trigger}.md`);
  await fs.writeFile(reportPath, lines.join('\n'));
  return reportPath;
}
```

- [ ] **Step 2: Commit**

```bash
git add scripts/curate/lib/report-writer.ts
git commit -m "feat(education-videos): report writer with 10-item Claude Code checklist"
```

---

### Task 14: Channel seeds + curate-videos main

**Files:**
- Create: `scripts/curate/channel-seeds.json`
- Create: `scripts/curate-videos.ts`

- [ ] **Step 1: 寫 channel-seeds.json**

Create `scripts/curate/channel-seeds.json`:

```json
{
  "official-tw": [
    { "tag": "@MOHWtaiwan", "channelId": null },
    { "tag": "@HPATaiwan",  "channelId": null },
    { "tag": "@NTUHchildren", "channelId": null },
    { "tag": "@TWPedSoc",   "channelId": null }
  ],
  "international": [
    { "tag": "@AmericanAcademyofPediatrics", "channelId": null },
    { "tag": "@CDC", "channelId": null },
    { "tag": "@nhs", "channelId": null },
    { "tag": "@WHO", "channelId": null },
    { "tag": "@ClevelandClinic", "channelId": null }
  ],
  "pro-kol": []
}
```

> **首次跑 curate 時**腳本會 resolve null 並寫進 `scripts/curate/channel-whitelist.json`（gitignored）。Tag 為佔位符；首次執行報錯可改填 raw `UCxxxx` channelId。

- [ ] **Step 2: 寫 curate-videos.ts 主入口**

Create `scripts/curate-videos.ts`:

```typescript
#!/usr/bin/env tsx
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { searchYtDlp, fetchMetadata, downloadSubtitle, resolveChannelId } from './curate/lib/yt-dlp';
import { computeScore, classifyVerdict, type ScoreInput } from './curate/lib/heuristics';
import { simplifiedRatio } from './curate/lib/simplified-detector';
import { writeReport, type ReportCandidate } from './curate/lib/report-writer';

const TODAY = new Date().toISOString().slice(0, 10);

const BLACKLIST = {
  channelDescriptionContains: ['简体', '简介', '简化', '中国大陆', 'CCTV'],
  titleKeywords: ['偏方', '神奇療法', '保健食品推薦', '代購', '微商'],
};

interface KeywordSpec {
  primary: string[];
  secondary?: string[];
  educationSlug?: string;
  minDuration: number;
  maxDuration: number;
  timeSensitive: boolean;
}

interface ChannelWhitelist {
  'official-tw': Record<string, string>;   // channelId → tag
  'international': Record<string, string>;
  'pro-kol': Record<string, string>;
}

async function resolveChannels(): Promise<ChannelWhitelist> {
  const seeds = JSON.parse(await fs.readFile('scripts/curate/channel-seeds.json', 'utf8'));
  const out: ChannelWhitelist = { 'official-tw': {}, 'international': {}, 'pro-kol': {} };
  for (const tier of Object.keys(out) as Array<keyof ChannelWhitelist>) {
    for (const seed of seeds[tier] ?? []) {
      const channelId = seed.channelId ?? await resolveChannelId(seed.tag);
      out[tier][channelId] = seed.tag;
    }
  }
  await fs.writeFile('scripts/curate/channel-whitelist.json', JSON.stringify(out, null, 2));
  return out;
}

function channelTierOf(channelId: string, w: ChannelWhitelist): ScoreInput['channelTier'] {
  if (channelId in w['official-tw']) return 'official-tw';
  if (channelId in w['international']) return 'international';
  if (channelId in w['pro-kol']) return 'pro-kol';
  return 'pro-kol';
}

async function processTrigger(
  trigger: string,
  kw: KeywordSpec,
  whitelist: ChannelWhitelist,
): Promise<void> {
  const cacheDir = 'scripts/curate/cache';
  const reportsDir = 'scripts/curate/reports';
  await fs.mkdir(cacheDir, { recursive: true });

  // Stage 1: search
  const seen = new Set<string>();
  const candidates: Array<{ id: string; title: string; duration: number }> = [];
  for (const q of [...kw.primary, ...(kw.secondary ?? [])]) {
    const results = await searchYtDlp(q, 30);
    for (const r of results) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      candidates.push(r);
    }
  }

  // Heuristics A: duration + title blacklist
  const stageA = candidates.filter(c => {
    if (c.duration < 30 || c.duration > 1800) return false;
    if (BLACKLIST.titleKeywords.some(kw => c.title.includes(kw))) return false;
    return true;
  }).slice(0, 8);

  // Stage 2: full metadata for top 8
  const enriched: Array<ScoreInput & { id: string; title: string; channel: string; description: string }> = [];
  for (const c of stageA) {
    let meta;
    try { meta = await fetchMetadata(c.id); }
    catch (e) { console.warn(`metadata fail for ${c.id}: ${(e as Error).message}`); continue; }

    if (BLACKLIST.channelDescriptionContains.some(s => meta.description?.includes(s))) continue;

    const tier = channelTierOf(meta.channel_id, whitelist);
    enriched.push({
      id: c.id, title: c.title, channel: meta.channel, description: meta.description ?? '',
      channelTier: tier,
      subtitleType: meta.subtitles && Object.keys(meta.subtitles).length > 0 ? 'human'
                   : meta.automatic_captions && Object.keys(meta.automatic_captions).length > 0 ? 'auto' : 'none',
      medicalTermDensity: 0,    // 字幕階段填
      viewCount: meta.view_count ?? 0,
      dangerKeywordHits: 0,
      publishedAt: `${meta.upload_date?.slice(0, 4)}-${meta.upload_date?.slice(4, 6)}-${meta.upload_date?.slice(6, 8)}`,
      duration: c.duration,
      minDuration: kw.minDuration,
      maxDuration: kw.maxDuration,
      timeSensitive: kw.timeSensitive,
      todayIsoDate: TODAY,
    });
  }

  // Heuristics B: rank + take top 5
  const scored = enriched
    .map(e => ({ ...e, score: computeScore(e) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  // Stage 3: subtitles for top 5
  const reportCandidates: ReportCandidate[] = [];
  for (const c of scored) {
    try { await downloadSubtitle(c.id, cacheDir); }
    catch (e) { console.warn(`subtitle fail ${c.id}: ${(e as Error).message}`); continue; }

    // Read first available subtitle file
    const subPath = (await fs.readdir(cacheDir))
      .map(f => path.join(cacheDir, f))
      .find(p => p.includes(c.id) && p.endsWith('.vtt'));
    if (!subPath) continue;

    const subContent = await fs.readFile(subPath, 'utf8');
    // Strip vtt cue timing lines, keep text
    const text = subContent
      .split('\n')
      .filter(l => !l.includes('-->') && !/^\d+$/.test(l) && !l.startsWith('WEBVTT'))
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .trim();

    // Heuristics C: simplified ratio
    if (simplifiedRatio(text) > 0.3) {
      console.warn(`${c.id} rejected: simplified Chinese ratio > 0.3`);
      continue;
    }

    const score = computeScore(c);
    const verdict = classifyVerdict(c, score);

    reportCandidates.push({
      videoId: c.id, title: c.title, channel: c.channel,
      sourceTier: c.channelTier, duration: c.duration,
      subtitleType: c.subtitleType, score,
      subtitleHead: text.slice(0, 200),
      subtitleTail: text.slice(-200),
      verdict,
    });
  }

  await writeReport({
    trigger,
    generatedAt: TODAY,
    candidates: reportCandidates,
    pipelineNotes: reportCandidates.length === 0 ? ['NO_CANDIDATES'] : [],
  }, reportsDir);
  console.log(`✓ ${trigger}: ${reportCandidates.length} candidates`);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      trigger: { type: 'string' },
      category: { type: 'string' },
      'redo-rejected': { type: 'boolean' },
      'validate-only': { type: 'boolean' },
      batch: { type: 'string' },
      clean: { type: 'boolean' },
    },
  });

  if (values.clean) {
    // TTL cleanup: cache/* > 30d, reports/* > 90d
    const now = Date.now();
    for (const [dir, days] of [['scripts/curate/cache', 30], ['scripts/curate/reports', 90]] as const) {
      try {
        for (const f of await fs.readdir(dir)) {
          const fp = path.join(dir, f);
          const stat = await fs.stat(fp);
          if (now - stat.mtimeMs > days * 86400_000) await fs.unlink(fp);
        }
      } catch {}
    }
    return;
  }

  if (values['validate-only']) {
    // implemented in Task 22
    throw new Error('validate-only not yet implemented in this task — see Task 22');
  }

  const whitelist = await resolveChannels();
  const keywords = JSON.parse(await fs.readFile('scripts/curate/keywords.json', 'utf8')) as Record<string, KeywordSpec>;

  const all = Object.entries(keywords).filter(([trigger]) =>
    !values.trigger || trigger === values.trigger,
  ).filter(([trigger]) =>
    !values.category || trigger.startsWith(values.category),
  );

  for (const [trigger, kw] of all) {
    await processTrigger(trigger, kw, whitelist);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 3: Commit**

```bash
git add scripts/curate/channel-seeds.json scripts/curate-videos.ts
git commit -m "feat(education-videos): curate-videos.ts main pipeline (search → metadata → subs → score → report)"
```

---

### Phase 3 Milestone

至此 curate 工具完備。下一步進入內容階段：產 keywords.json + 跑 curate + Claude Code 複審。

---

## Phase 4: 內容 Curate（執行階段）

> **本 phase 為長時間人工/AI 迭代執行，非單純 TDD。**
> 預估執行週數：2-4 週。每完成一個 trigger 階段（如 CDSS critical 全部），跑一次 `pnpm build:video-index` 並 commit。

### Task 15: 產 keywords.json 初版

- [ ] **Step 1: Claude Code 依 §4.8 設計準則產出 keywords.json**

依 spec §4.8 對 123 reachable trigger 各寫一組 keywords：
- 視角分層（家長 + 衛教）
- 中英並用（primary 至少 2 組繁中、secondary 1 組英文）
- 語意涵蓋（症狀 + 處置）
- 年齡限定詞
- 禁用關鍵字
- timeSensitive 條件
- 跨 trigger 重複避免

產出檔：`scripts/curate/keywords.json`

- [ ] **Step 2: 跑 dry-run 確認 keywords.json schema OK**

Run: `pnpm curate:videos --trigger cdss.spo2.critical.infant`
Expected: 完整 pipeline 跑通 → 產出 `scripts/curate/reports/cdss.spo2.critical.infant.md`

- [ ] **Step 3: Commit**

```bash
git add scripts/curate/keywords.json
git commit -m "feat(education-videos): keywords.json v1 for 123 reachable triggers"
```

### Task 16: 跑 CDSS critical 階段 + 複審

- [ ] **Step 1: Run curate**

Run: `pnpm curate:videos --category cdss`（先全 CDSS 跑，過濾 advisory 改後續手動跳）

或精確版：對 critical 列表逐一跑

- [ ] **Step 2: Claude Code 逐 report 複審**

依 §4.11 10 項 checklist，對每個 `scripts/curate/reports/cdss.*.critical.*.md` 內每支候選 影片：

1. 讀字幕 head + tail
2. 依 checklist 勾選
3. 全 pass → verified；任一 fail → rejected
4. 寫回 `src/data/video-catalog/<tier>.yaml`（影片元資料）+ `src/data/education-videos/cdss-vital-signs.yaml`（trigger 對應）

- [ ] **Step 3: rebuild + commit**

```bash
pnpm build:video-index
git add src/data/video-catalog/ src/data/education-videos/cdss-vital-signs.yaml public/data/video-index.json
git commit -m "feat(education-videos): curate CDSS critical phase (n videos verified)"
```

### Task 17: 跑 CDSA refer 階段

對所有 `cdsa.triage.refer.*`（7 個 trigger，每 ageGroup 一個）：

- [ ] **Step 1**: `pnpm curate:videos --trigger cdsa.triage.refer.2-6m`（逐一跑 7 個 trigger，或寫 shell loop）
- [ ] **Step 2**: Claude Code 依 §4.11 checklist 複審 reports，寫回 yaml
- [ ] **Step 3**: `pnpm build:video-index && git add ... && git commit -m "feat(education-videos): curate CDSA refer phase"`

### Task 18: 跑 CDSS warning 階段

對所有 `cdss.*.warning.*`（7 indicator × 3 ageGroup = 21 trigger）。執行步驟同 Task 16。

### Task 19: 跑 CDSA monitor 階段

對所有 `cdsa.triage.monitor.*`（7 個 trigger）。執行步驟同 Task 16。

### Task 20: 跑 CDSA domain anomaly 階段

對所有 `cdsa.domain.*.anomaly.*`（46 reachable trigger，扣除 inapplicable）。建議分批 `--category cdsa` 跑，每 batch ~15 個 trigger。執行步驟同 Task 16。

### Task 21: 跑 CDSS advisory 階段

對所有 `cdss.*.advisory.*`（21 個 trigger）。執行步驟同 Task 16。

> **每階段完成後**：跑 `pnpm build:video-index` 並 commit；驗收覆蓋率（§7 分組目標）達標即停。Low-stakes 階段（Task 21）允許 40% 即可。

---

## Phase 5: UI 元件

### Task 22: VideoCard.svelte（兩變體）+ tests

**Files:**
- Create: `src/components/education/VideoCard.svelte`
- Create: `tests/components/education/VideoCard.test.ts`

- [ ] **Step 1: 寫測試**

Create `tests/components/education/VideoCard.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import VideoCard from '../../../src/components/education/VideoCard.svelte';
import type { RuntimeVideo } from '../../../src/lib/education/schemas';

const video: RuntimeVideo = {
  videoId: 'abc123XYZ45',
  title: '範例衛教',
  channel: '台大兒醫',
  duration: 245,
  language: 'zh-Hant',
  sourceTier: 'official-tw',
  score: 0.92,
};

describe('VideoCard', () => {
  it('renders thumbnail variant by default', () => {
    render(VideoCard, { video });
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toContain('i.ytimg.com');
    expect(img.getAttribute('src')).toContain('abc123XYZ45');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('shows duration in minutes', () => {
    render(VideoCard, { video });
    expect(screen.getByText(/4 分.*5/)).toBeTruthy();   // 245s ≈ 4分05秒
  });

  it('shows sourceTier badge', () => {
    render(VideoCard, { video });
    expect(screen.getByText(/官方/)).toBeTruthy();
  });

  it('inserts iframe with nocookie URL on click', async () => {
    render(VideoCard, { video });
    await fireEvent.click(screen.getByRole('button'));
    const iframe = document.querySelector('iframe');
    expect(iframe?.src).toContain('youtube-nocookie.com');
    expect(iframe?.src).toContain('abc123XYZ45');
    expect(iframe?.src).toContain('cc_load_policy=1');
    expect(iframe?.getAttribute('title')).toBe('範例衛教');
  });

  it('switches to no-thumbnail variant on img error', async () => {
    render(VideoCard, { video });
    const img = screen.getByRole('img');
    await fireEvent.error(img);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('button')).toBeTruthy();
  });
});
```

- [ ] **Step 2: 跑測試 fail**

Run: `pnpm test tests/components/education/VideoCard.test.ts`
Expected: FAIL.

- [ ] **Step 3: 寫元件**

Create `src/components/education/VideoCard.svelte`:

```svelte
<script lang="ts">
import type { RuntimeVideo } from '$lib/education/schemas';

interface Props { video: RuntimeVideo; }
const { video }: Props = $props();

let showIframe = $state(false);
let thumbFailed = $state(false);

const tierLabel: Record<RuntimeVideo['sourceTier'], string> = {
  'official-tw': '官方',
  international: '國際',
  'pro-kol': '專業',
};

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  return `${m} 分 ${s} 秒`;
}

function isSessionFailed(id: string): boolean {
  if (typeof window === 'undefined' || !('sessionStorage' in window)) return false;
  try {
    const set = sessionStorage.getItem('failed-thumbnails');
    return set ? set.split(',').includes(id) : false;
  } catch { return false; }
}

function markSessionFailed(id: string): void {
  if (typeof window === 'undefined' || !('sessionStorage' in window)) return;
  try {
    const cur = sessionStorage.getItem('failed-thumbnails') ?? '';
    sessionStorage.setItem('failed-thumbnails', cur ? `${cur},${id}` : id);
  } catch {}
}

$effect(() => { if (isSessionFailed(video.videoId)) thumbFailed = true; });

function onPlay() { showIframe = true; }
function onImgError() { markSessionFailed(video.videoId); thumbFailed = true; }
</script>

<article class="video-card">
  {#if !showIframe}
    {#if !thumbFailed}
      <button
        type="button"
        onclick={onPlay}
        aria-label={`播放影片：${video.title}（${fmtDuration(video.duration)}）`}
      >
        <img
          src={`https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`}
          alt={video.title}
          loading="lazy"
          referrerpolicy="no-referrer"
          onerror={onImgError}
        />
        <span class="play-icon" aria-hidden="true">▶</span>
      </button>
    {:else}
      <button
        type="button"
        onclick={onPlay}
        class="no-thumbnail"
        aria-label={`播放影片：${video.title}（${fmtDuration(video.duration)}）`}
      >
        <span class="big-title">{video.title}</span>
        <span class="play-icon" aria-hidden="true">▶ 觀看</span>
      </button>
    {/if}
  {:else}
    <iframe
      src={`https://www.youtube-nocookie.com/embed/${video.videoId}?cc_load_policy=1&hl=zh-Hant&modestbranding=1&autoplay=1`}
      title={video.title}
      loading="lazy"
      allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
      referrerpolicy="no-referrer"
      allowfullscreen
    ></iframe>
  {/if}
  <div class="meta">
    <span class="badge">{tierLabel[video.sourceTier]}</span>
    <span class="title">{video.title}</span>
    <span class="duration">{fmtDuration(video.duration)}</span>
  </div>
</article>

<style>
.video-card { display: flex; flex-direction: column; min-width: 280px; }
.video-card button { min-height: 44px; padding: 0; border: 0; background: transparent; cursor: pointer; }
.video-card img { width: 100%; aspect-ratio: 16/9; object-fit: cover; border-radius: var(--radius-md, 8px); }
.video-card iframe { width: 100%; aspect-ratio: 16/9; border: 0; border-radius: var(--radius-md, 8px); }
.no-thumbnail { aspect-ratio: 16/9; background: var(--color-bg-muted, #eaeaea); display: flex; flex-direction: column; justify-content: center; align-items: center; padding: var(--space-md, 16px); }
.no-thumbnail .big-title { font-size: var(--text-lg, 22px); font-weight: 600; line-height: 1.3; }
.play-icon { font-size: var(--text-base, 18px); margin-top: var(--space-sm, 8px); }
.meta { padding: var(--space-sm, 8px) 0; display: flex; gap: var(--space-sm, 8px); align-items: center; flex-wrap: wrap; }
.badge { background: var(--color-bg-accent, #ddd); padding: 2px 8px; border-radius: 12px; font-size: var(--text-sm, 16px); }
.title { font-size: var(--text-base, 18px); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; flex: 1; }
.duration { font-size: var(--text-sm, 16px); color: var(--color-text-muted, #666); }
</style>
```

- [ ] **Step 4: 跑測試 pass**

Run: `pnpm test tests/components/education/VideoCard.test.ts`
Expected: pass。

- [ ] **Step 5: Commit**

```bash
git add src/components/education/VideoCard.svelte tests/components/education/VideoCard.test.ts
git commit -m "feat(education-videos): VideoCard with thumbnail/no-thumbnail variants"
```

---

### Task 23: VideoGrid.svelte + tests

**Files:**
- Create: `src/components/education/VideoGrid.svelte`
- Create: `tests/components/education/VideoGrid.test.ts`

- [ ] **Step 1: 寫測試**

Create `tests/components/education/VideoGrid.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import VideoGrid from '../../../src/components/education/VideoGrid.svelte';
import type { RuntimeVideo } from '../../../src/lib/education/schemas';

const mk = (id: string, score: number, tier: RuntimeVideo['sourceTier'] = 'official-tw'): RuntimeVideo => ({
  videoId: id, title: `t-${id}`, channel: 'c', duration: 200, language: 'zh-Hant', sourceTier: tier, score,
});

describe('VideoGrid', () => {
  it('renders top-3 by default when > 3', () => {
    const videos = ['a', 'b', 'c', 'd', 'e'].map((id, i) => mk(`vid${id}aaa1234`.slice(0, 11), 0.9 - i * 0.1));
    render(VideoGrid, { videos });
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('renders all when ≤ 3', () => {
    const videos = [mk('vid1aaaaa11', 0.9), mk('vid2aaaaa22', 0.7)];
    render(VideoGrid, { videos });
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('sorts by score descending', () => {
    const videos = [mk('vid1aaaaa11', 0.5), mk('vid2aaaaa22', 0.9)];
    render(VideoGrid, { videos });
    const articles = screen.getAllByRole('article');
    expect(articles[0].textContent).toContain('vid2aaaaa22'.slice(0, 8));
  });

  it('promotes official-tw on tie (score diff < 0.05)', () => {
    const videos = [mk('vid1aaaaa11', 0.81, 'international'), mk('vid2aaaaa22', 0.78, 'official-tw')];
    render(VideoGrid, { videos });
    const articles = screen.getAllByRole('article');
    expect(articles[0].textContent).toContain('vid2aaaaa22'.slice(0, 8));
  });
});
```

- [ ] **Step 2: 跑測試 fail**

Run: `pnpm test tests/components/education/VideoGrid.test.ts`
Expected: FAIL。

- [ ] **Step 3: 寫元件**

Create `src/components/education/VideoGrid.svelte`:

```svelte
<script lang="ts">
import type { RuntimeVideo } from '$lib/education/schemas';
import VideoCard from './VideoCard.svelte';

interface Props { videos: RuntimeVideo[]; maxResults?: number; }
const { videos, maxResults = 3 }: Props = $props();

let expanded = $state(false);

const sorted = $derived([...videos].sort((a, b) => {
  const diff = b.score - a.score;
  if (Math.abs(diff) < 0.05) {
    const rank = { 'official-tw': 0, international: 1, 'pro-kol': 2 };
    return rank[a.sourceTier] - rank[b.sourceTier];
  }
  return diff;
}));

const display = $derived(expanded ? sorted : sorted.slice(0, maxResults));
const hasMore = $derived(sorted.length > maxResults);
</script>

<div class="video-grid">
  {#each display as v (v.videoId)}
    <VideoCard video={v} />
  {/each}
  {#if hasMore && !expanded}
    <button class="expand-btn" type="button" onclick={() => expanded = true}>
      展開其餘 {sorted.length - maxResults} 支影片
    </button>
  {/if}
</div>

<style>
.video-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: var(--space-md, 16px); }
.expand-btn { min-height: 44px; background: transparent; border: 1px dashed var(--color-border, #ccc); border-radius: var(--radius-md, 8px); padding: var(--space-md, 16px); font-size: var(--text-base, 18px); cursor: pointer; grid-column: 1 / -1; }
</style>
```

- [ ] **Step 4: 跑測試 pass**

Run: `pnpm test tests/components/education/VideoGrid.test.ts`
Expected: pass。

- [ ] **Step 5: Commit**

```bash
git add src/components/education/VideoGrid.svelte tests/components/education/VideoGrid.test.ts
git commit -m "feat(education-videos): VideoGrid with sort + tie-breaker + expand"
```

---

### Task 24: TriggerVideoList.svelte + tests

**Files:**
- Create: `src/components/education/TriggerVideoList.svelte`
- Create: `tests/components/education/TriggerVideoList.test.ts`

- [ ] **Step 1: 寫測試**

Create `tests/components/education/TriggerVideoList.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import TriggerVideoList from '../../../src/components/education/TriggerVideoList.svelte';
import type { RuntimeIndex } from '../../../src/lib/education/schemas';

const mockIndex: RuntimeIndex = {
  catalog: {
    v1aaaaaaaa1: {
      videoId: 'v1aaaaaaaa1', title: '範例', channel: 'c',
      duration: 200, language: 'zh-Hant', sourceTier: 'official-tw', score: 0.9,
    },
  },
  triggers: {
    'cdsa.triage.refer.13-24m': { videoIds: ['v1aaaaaaaa1'], inapplicable: false },
  },
};

describe('TriggerVideoList', () => {
  it('fetches and renders videos for triggers', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => mockIndex,
    } as Response);

    render(TriggerVideoList, { triggers: ['cdsa.triage.refer.13-24m'] });
    await waitFor(() => expect(screen.getByText('範例')).toBeTruthy());
  });

  it('shows nothing when no triggers', () => {
    const { container } = render(TriggerVideoList, { triggers: [] });
    expect(container.textContent).toBe('');
  });
});
```

- [ ] **Step 2: 跑測試 fail**

Run: `pnpm test tests/components/education/TriggerVideoList.test.ts`
Expected: FAIL.

- [ ] **Step 3: 寫元件**

Create `src/components/education/TriggerVideoList.svelte`:

```svelte
<script lang="ts">
import { getVideosForTriggers } from '$lib/education/video-lookup';
import type { RuntimeVideo } from '$lib/education/schemas';
import VideoGrid from './VideoGrid.svelte';

interface Props { triggers: string[]; }
const { triggers }: Props = $props();

let videosByTrigger = $state<Record<string, RuntimeVideo[]>>({});

$effect(() => {
  if (triggers.length === 0) { videosByTrigger = {}; return; }
  getVideosForTriggers(triggers, [], { maxResults: 3, ageGroupFallback: true })
    .then(result => { videosByTrigger = result; })
    .catch(err => { console.error('[TriggerVideoList] lookup failed', err); });
});
</script>

{#each Object.entries(videosByTrigger) as [trigger, videos] (trigger)}
  {#if videos.length > 0}
    <section class="trigger-videos" data-trigger={trigger}>
      <VideoGrid {videos} />
    </section>
  {/if}
{/each}

<style>
.trigger-videos { margin: var(--space-lg, 24px) 0; }
</style>
```

- [ ] **Step 4: 跑測試 pass**

Run: `pnpm test tests/components/education/TriggerVideoList.test.ts`
Expected: pass。

- [ ] **Step 5: Commit**

```bash
git add src/components/education/TriggerVideoList.svelte tests/components/education/TriggerVideoList.test.ts
git commit -m "feat(education-videos): TriggerVideoList with async lookup + fallback"
```

---

## Phase 6: 頁面整合

### Task 25: 整合進 `/result/`（CDSA 評估結果）

**Files:**
- Modify: `src/components/assess/ResultViewWrapper.svelte`（或既有 result 組件）

- [ ] **Step 1: 找到 result 元件並讀取**

Run: `cat src/components/assess/ResultViewWrapper.svelte | head -60`

確認 triageResult + ageGroup 變數的存取點。

- [ ] **Step 2: 在 result 元件加入 trigger derivation + TriggerVideoList**

在 result 元件 script 加：

```svelte
<script lang="ts">
import { deriveCdsaTriggers } from '$lib/education/trigger-derivation';
import TriggerVideoList from '$components/education/TriggerVideoList.svelte';

// triageResult 與 ageGroup 變數已存在於既有 component
let triggers = $derived(
  triageResult ? deriveCdsaTriggers(triageResult, ageGroup) : [],
);
</script>
```

在「推薦衛教」section 下方加：

```svelte
{#if triggers.length > 0}
  <section class="recommended-videos">
    <h2>建議參考影片</h2>
    <TriggerVideoList {triggers} />
  </section>
{/if}
```

- [ ] **Step 3: 跑 dev server 手動驗證**

Run: `pnpm dev`
Expected: 開 `http://localhost:4321/smart-pedi-cds/result/`，完成假評估後底部顯示影片區塊。

- [ ] **Step 4: Commit**

```bash
git add src/components/assess/ResultViewWrapper.svelte
git commit -m "feat(education-videos): integrate videos into /result/ page"
```

---

### Task 26: 整合進 `/workspace/result/`（醫師工作台病患結果）

**Files:**
- Modify: `src/components/patient/ResultDetail.svelte`

- [ ] **Step 1: 找到 ResultDetail 元件**

Run: `cat src/components/patient/ResultDetail.svelte | head -80`

- [ ] **Step 2: 加 CDSA + CDSS 雙路 trigger derivation**

在 script 加：

```svelte
<script lang="ts">
import { deriveCdsaTriggers, deriveCdssTriggers } from '$lib/education/trigger-derivation';
import TriggerVideoList from '$components/education/TriggerVideoList.svelte';

let triggers = $derived([
  ...(triageResult ? deriveCdsaTriggers(triageResult, ageGroup) : []),
  ...(riskAnalysisResult ? deriveCdssTriggers(
      riskAnalysisResult.ruleResult.indicators,
      patient.ageGroup,
    ) : []),
]);
</script>
```

在風險詳情區塊下方加：

```svelte
{#if triggers.length > 0}
  <section class="recommended-videos">
    <h2>建議分享給家長的衛教影片</h2>
    <TriggerVideoList {triggers} />
  </section>
{/if}
```

- [ ] **Step 3: 手動驗證 + Commit**

```bash
pnpm dev
# 開 /workspace/result/?patientId=xxx 確認影片區塊
git add src/components/patient/ResultDetail.svelte
git commit -m "feat(education-videos): integrate videos into /workspace/result/"
```

---

### Task 27: 整合進 `/education/`（衛教首頁）

**Files:**
- Modify: `src/pages/education/index.astro`（或對應 markdown layout）

- [ ] **Step 1: 找衛教首頁的 markdown loader**

Run: `cat src/pages/education/index.astro`

- [ ] **Step 2: 在衛教文末加 TriggerVideoList**

對每篇 education markdown，渲染時讀其 `slug`，找所有以該 slug 為 `educationSlug` 的 trigger，呼叫 TriggerVideoList。

```svelte
<script lang="ts">
import TriggerVideoList from '$components/education/TriggerVideoList.svelte';
import indexData from '/data/video-index.json';   // 編譯時靜態載入

interface Props { educationSlug: string; }
const { educationSlug }: Props = $props();

// 從 runtime index 反查所有 trigger
const relatedTriggers = Object.entries(indexData.triggers)
  .filter(([, t]) => !t.inapplicable && t.videoIds.length > 0)
  // educationSlug 在 runtime index 已被 strip，須改從 yaml 來查 — 走 build-time 預計算
  .map(([key]) => key);
</script>
```

> 註：因 runtime slim 沒帶 `educationSlug`，需在 `build-video-index.ts` 額外 emit 一個反查 map（slug → triggers），或在頁面 frontmatter 直接列出相關 trigger。建議後者較簡單；在每篇 education markdown 加 `relatedTriggers: [...]` 欄位，由 build-video-index 自動產出。

實作改為：

```yaml
# src/data/education/<slug>.md frontmatter
---
title: ...
relatedTriggers: [cdss.spo2.critical.infant, cdss.spo2.warning.infant]
---
```

然後在 layout 直接讀 `relatedTriggers` 並餵 TriggerVideoList。

> **Plan 簡化決定**：本 Task 改為「在 build-video-index.ts 增寫 emit `educationSlugToTriggers` map 進 runtime index，元件讀此 map 反查」。詳見 Task 27a。

- [ ] **Step 3: 補 build-video-index.ts 多 emit `educationSlugToTriggers`**

修改 `scripts/build-video-index.ts` 在 runtime emit 加：

```typescript
const educationSlugToTriggers: Record<string, string[]> = {};
for (const t of Object.values(triggers)) {
  if (t.educationSlug && !t.inapplicable && t.videoIds.length > 0) {
    (educationSlugToTriggers[t.educationSlug] ??= []).push(t.trigger);
  }
}
// 加入 runtime object：
const runtime = {
  catalog: ...,
  triggers: ...,
  educationSlugToTriggers,    // 新增
};
```

同時更新 `runtimeIndexSchema` 加 `educationSlugToTriggers: z.record(z.string(), z.array(z.string()))`。

- [ ] **Step 4: 在 education layout 反查**

```svelte
<script lang="ts">
import TriggerVideoList from '$components/education/TriggerVideoList.svelte';
import { onMount } from 'svelte';

interface Props { slug: string; }
const { slug }: Props = $props();

let triggers = $state<string[]>([]);
onMount(async () => {
  const idx = await (await fetch(`${import.meta.env.BASE_URL}data/video-index.json`)).json();
  triggers = idx.educationSlugToTriggers?.[slug] ?? [];
});
</script>

{#if triggers.length > 0}
  <TriggerVideoList {triggers} />
{/if}
```

- [ ] **Step 5: 跑測試確認 schema 變更**

Run: `pnpm test tests/lib/education/schemas.test.ts tests/scripts/build-video-index.test.ts`
Expected: 全 pass（fixture 預期更新）。

- [ ] **Step 6: Commit**

```bash
git add scripts/build-video-index.ts src/lib/education/schemas.ts src/pages/education/ public/data/video-index.json
git commit -m "feat(education-videos): emit educationSlugToTriggers + integrate into /education/"
```

---

### Task 28: 整合進 `/workspace/` 病患卡 hover

**Files:**
- Modify: `src/pages/workspace/index.astro` 對應病患列表元件

- [ ] **Step 1: 找病患卡元件**

Run: `find src/components -name "*Patient*.svelte"`

- [ ] **Step 2: 在病患卡 hover/expand 區加 TriggerVideoList**

對展開區（hover 預覽或詳細區）加：

```svelte
<script lang="ts">
import { deriveCdssTriggers } from '$lib/education/trigger-derivation';
import TriggerVideoList from '$components/education/TriggerVideoList.svelte';

let triggers = $derived(
  patient.latestRiskResult
    ? deriveCdssTriggers(patient.latestRiskResult.indicators, patient.ageGroup).slice(0, 3)
    : [],
);
</script>

{#if triggers.length > 0}
  <details class="hover-preview">
    <summary>相關衛教影片</summary>
    <TriggerVideoList {triggers} />
  </details>
{/if}
```

- [ ] **Step 3: 手動驗證 + Commit**

```bash
pnpm dev
# 進 /workspace/ 確認病患卡展開時顯示影片
git add src/components/patient/
git commit -m "feat(education-videos): integrate videos into workspace patient cards"
```

---

### Phase 6 Milestone

至此四個頁面整合完成。下一步進入 CI workflows。

---

## Phase 7: CI Workflows

### Task 29: 建 `.github/workflows/ci.yml`

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: 寫 workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  index-consistency:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build:video-index
      - name: Fail if generated index drifted
        run: |
          if ! git diff --exit-code public/data/video-index.json; then
            echo "::error::video-index.json out of sync. Run 'pnpm build:video-index' and commit."
            exit 1
          fi
      - run: pnpm test
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(education-videos): add ci.yml for index-consistency + pnpm test"
```

---

### Task 30: 建 `.github/workflows/validate-videos.yml` + 實作 `--validate-only`

**Files:**
- Create: `.github/workflows/validate-videos.yml`
- Modify: `scripts/curate-videos.ts`（補 validate-only 邏輯）

- [ ] **Step 1: 補 validate-only 實作**

修改 `scripts/curate-videos.ts` 的 `main()` 中 `validate-only` 分支：

```typescript
if (values['validate-only']) {
  const batchSize = values.batch ? parseInt(values.batch, 10) : 50;
  // load catalog yamls
  const tiers = ['official-tw', 'international', 'pro-kol'] as const;
  for (const tier of tiers) {
    const fp = `src/data/video-catalog/${tier}.yaml`;
    const yaml = await import('js-yaml');
    const catalog = (yaml.load(await fs.readFile(fp, 'utf8')) as any[]) ?? [];
    // sort by lastValidatedAt asc (undefined = oldest)
    catalog.sort((a, b) => (a.lastValidatedAt ?? '0000-01-01').localeCompare(b.lastValidatedAt ?? '0000-01-01'));
    let changed = 0;
    for (const v of catalog.slice(0, batchSize)) {
      try {
        await fetchMetadata(v.videoId);     // 仍可拿到 metadata = 影片存活
        v.lastValidatedAt = TODAY;
      } catch (e) {
        const msg = (e as Error).message;
        if (/Video unavailable|Private video|Deleted/i.test(msg)) {
          v.verificationStatus = 'rejected';
          v.lastValidatedAt = TODAY;
          v.notes = `auto-rejected ${TODAY}: ${msg}`;
          changed++;
        } else {
          console.warn(`validate check fail for ${v.videoId}: ${msg}`);
        }
      }
    }
    await fs.writeFile(fp, yaml.dump(catalog));
    console.log(`validate-only ${tier}: ${changed} rejected`);
  }
  return;
}
```

- [ ] **Step 2: 寫 workflow**

Create `.github/workflows/validate-videos.yml`:

```yaml
name: Validate Videos
on:
  schedule:
    - cron: '0 3 * * 0'
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

jobs:
  validate:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: pip install 'yt-dlp>=2026.03.17,<2027'
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - name: Validate (batch 50, rotated by lastValidatedAt asc)
        run: pnpm curate:videos --validate-only --batch 50
      - name: Rebuild index
        run: pnpm build:video-index
      - name: Diff scope sanity check
        run: |
          git diff --stat
          git diff --exit-code -- ':!src/data/video-catalog' ':!public/data/video-index.json'
      - uses: peter-evans/create-pull-request@v6
        with:
          title: "chore(videos): mark unavailable videos"
          body: |
            Auto-detected unavailable videos this run.
            Inspect changed files in `src/data/video-catalog/*.yaml` and `public/data/video-index.json`.
          branch: bot/video-validate
          commit-message: "chore(videos): validate sweep"
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/validate-videos.yml scripts/curate-videos.ts
git commit -m "feat(education-videos): validate-only workflow + impl"
```

> 需在 repo Settings → Actions → Workflow permissions 啟用「Allow GitHub Actions to create and approve pull requests」。

---

## Phase 8: 額外資料測試 + Lighthouse 驗收

### Task 31: data integrity tests

**Files:**
- Create: `tests/data/education-slug-integrity.test.ts`
- Create: `tests/data/trigger-uniqueness.test.ts`
- Create: `tests/data/inapplicable-consistency.test.ts`
- Create: `tests/data/index-consistency.test.ts`

- [ ] **Step 1: 寫 education-slug-integrity test**

Create `tests/data/education-slug-integrity.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import fg from 'fast-glob';
import yaml from 'js-yaml';

describe('educationSlug integrity', () => {
  it('every educationSlug in yaml has corresponding markdown', async () => {
    const yamlFiles = await fg('src/data/education-videos/*.yaml');
    const slugs = new Set<string>();
    for (const f of yamlFiles) {
      const arr = (yaml.load(await fs.readFile(f, 'utf8')) as Array<{ educationSlug?: string }>) ?? [];
      for (const t of arr) if (t.educationSlug) slugs.add(t.educationSlug);
    }
    for (const slug of slugs) {
      const mdPath = `src/data/education/${slug}.md`;
      await expect(fs.access(mdPath)).resolves.toBeUndefined();
    }
  });
});
```

- [ ] **Step 2: 寫 trigger-uniqueness test**

Create `tests/data/trigger-uniqueness.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import fg from 'fast-glob';
import yaml from 'js-yaml';

describe('trigger key uniqueness across yaml files', () => {
  it('no duplicate trigger across cdsa-triage / cdsa-domains / cdss-vital-signs', async () => {
    const files = await fg('src/data/education-videos/*.yaml');
    const all = new Map<string, string>();   // trigger → file
    for (const f of files) {
      const arr = (yaml.load(await fs.readFile(f, 'utf8')) as Array<{ trigger: string }>) ?? [];
      for (const t of arr) {
        if (all.has(t.trigger)) {
          throw new Error(`Duplicate trigger ${t.trigger} in ${all.get(t.trigger)} and ${f}`);
        }
        all.set(t.trigger, f);
      }
    }
    expect(all.size).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 3: 寫 inapplicable-consistency test**

Create `tests/data/inapplicable-consistency.test.ts`:

```typescript
import { describe, it } from 'vitest';
import { buildVideoIndex } from '../../scripts/build-video-index';

describe('inapplicable matrix consistency', () => {
  it('build-video-index passes (matrix ↔ yaml in sync)', async () => {
    await buildVideoIndex();
  });
});
```

- [ ] **Step 4: 寫 index-consistency test**

Create `tests/data/index-consistency.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { buildVideoIndex } from '../../scripts/build-video-index';

describe('generated index in sync', () => {
  it('public/data/video-index.json matches build output', async () => {
    const before = await fs.readFile('public/data/video-index.json');
    await buildVideoIndex();
    const after = await fs.readFile('public/data/video-index.json');
    expect(before.equals(after)).toBe(true);
  });
});
```

- [ ] **Step 5: 跑全測試**

Run: `pnpm test`
Expected: 全 pass。

- [ ] **Step 6: Commit**

```bash
git add tests/data/
git commit -m "test(education-videos): data integrity (slug, uniqueness, inapplicable, index)"
```

---

### Task 32: Lighthouse-CI baseline + budget

**Files:**
- Create: `.lighthouserc.json`
- Modify: `.github/workflows/ci.yml`（加 Lighthouse job）

- [ ] **Step 1: 量目前 baseline**

Run:
```bash
pnpm build
pnpm preview &
sleep 3
npx @lhci/cli collect --url=http://localhost:4321/smart-pedi-cds/result/ --numberOfRuns=3
```

記下 Performance 分數與 island bundle gzip size，更新 spec §7.6 的數字（plan 第一步要求）。

- [ ] **Step 2: 寫 .lighthouserc.json**

Create `.lighthouserc.json`:

```json
{
  "ci": {
    "collect": {
      "url": [
        "http://localhost:4321/smart-pedi-cds/result/",
        "http://localhost:4321/smart-pedi-cds/workspace/result/"
      ],
      "numberOfRuns": 3,
      "startServerCommand": "pnpm preview",
      "startServerReadyPattern": "Local"
    },
    "assert": {
      "preset": "lighthouse:recommended",
      "assertions": {
        "categories:performance": ["error", { "minScore": 0.85 }],
        "third-party-summary": "off"
      }
    },
    "upload": { "target": "temporary-public-storage" }
  }
}
```

- [ ] **Step 3: 加 Lighthouse job 到 ci.yml**

修改 `.github/workflows/ci.yml`，新增 job：

```yaml
  lighthouse:
    runs-on: ubuntu-latest
    needs: index-consistency
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: npx @lhci/cli autorun
```

- [ ] **Step 4: 跑 Lighthouse 確認通過**

Run: `npx @lhci/cli autorun`
Expected: Performance ≥ 85 on both URLs。

- [ ] **Step 5: Commit**

```bash
git add .lighthouserc.json .github/workflows/ci.yml
git commit -m "ci(education-videos): Lighthouse-CI budget (perf >= 85)"
```

---

### Phase 8 Milestone — 驗收標準

依 spec §7 完成驗收：

- [ ] `pnpm curate:videos` 跑完 123 reachable trigger 無 crash（Task 16-21）
- [ ] 分組覆蓋率：
  - High-stakes (refer / critical) ≥ 90%
  - Mid-stakes (monitor / warning / domain anomaly) ≥ 70%
  - Low-stakes (advisory) ≥ 40%
- [ ] 所有 embed 走 nocookie + no-referrer + 點擊才嵌入
- [ ] `pnpm check` / `pnpm test` / `pnpm build` 全綠
- [ ] Lighthouse Performance ≥ 85
- [ ] PR `index-consistency` job 必綠

完成後 close 整個 plan。

---

## 後續維護

- 每週日 `validate-videos.yml` 自動跑，產 PR 標下架影片
- 新增 trigger 或 inapplicable 矩陣變更須先改 `inapplicable-matrix.json`（source of truth），跑 `pnpm build:video-index` 同步
- 新增頻道至白名單：改 `scripts/curate/channel-seeds.json`，刪 `channel-whitelist.json` 重 resolve
- keywords 調整：直接改 `scripts/curate/keywords.json`，下次跑 curate 生效
