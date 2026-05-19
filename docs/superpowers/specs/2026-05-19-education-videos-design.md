# 依檢測結果配衛教影片 — Design Spec

- **日期**: 2026-05-19
- **作者**: Light + Claude Code
- **狀態**: v13（**設計策略變更：link-out 取代 in-site embed**，依 2026-05-20 用戶反饋）

**v13 設計變更摘要**：原本 §5.3 採「縮圖點擊 → 在站內嵌入 youtube-nocookie iframe」。實作後考量：(1) 兒童面孔展示 PII 風險（spec §4.11 #8）；(2) YouTube ToS embed 灰色地帶；(3) 字幕字串落地 i18n / a11y 複雜度。**改為 link-out**：縮圖點擊 → 開新分頁跳轉 YouTube 原站（`<a target="_blank" rel="noopener noreferrer">`）。我們只負責推薦該影片並顯示縮圖，所有播放、字幕、合規由 YouTube 自行處理。`youtube-nocookie embed` 相關段落（§5.3 iframe、§5.4 cc_load_policy、§6 iframe 測試）作廢；§8 風險表中「ToS embed 灰色」「字幕版權」「PII embed」全條移除。
- **範圍**: 為 CDSA 兒童發展評估 + CDSS 生理警示兩條結果線，建立 trigger → YouTube 衛教影片的映射，包含自動 curate 腳本與前端整合

---

## 1. 目標與動機

目前系統已具備：

- **CDSA 評估結果**：`src/engine/cdsa/triage.ts` 產生 `normal / monitor / refer` 分類 + domain 異常標記
- **CDSS 警示**：`src/engine/risk-analyzer.ts` + `pediatric-default.yaml` 規則引擎，產生 7 項生理指標 × 4 級警示
- `src/data/education/*.md` 已有 15 篇衛教文

缺失：(1) 沒有評估結果 → 衛教影片的多對多映射 (2) 沒有自動 curate + 人工複審工作流 (3) 沒有保護隱私的 embed 策略。

---

## 2. Trigger Taxonomy

### 2.1 Ground-Truth 型別（取自 codebase）

```typescript
// src/lib/utils/age-groups.ts
export type AgeGroupCDSA =
  | '2-6m' | '7-12m' | '13-24m' | '25-36m'
  | '37-48m' | '49-60m' | '61-72m';

// src/lib/db/schema.ts — Patient.ageGroup（CDSS 用）
type AgeGroupCDSS = 'infant' | 'toddler' | 'preschool';

// src/lib/utils/risk-levels.ts
export type RiskLevel = 'normal' | 'advisory' | 'warning' | 'critical';

// src/engine/cdsa/triage.ts
type TriageCategory = 'normal' | 'monitor' | 'refer';
type TriageDomain = string;   // 開放型別，由 runtime guard 收斂（§2.7）
```

CDSA 7 bin 與 CDSS 3 bin 不強制對齊。

### 2.2 CDSA Domain 來源說明

`TriageResult.details[].domain` 是開放 `string`，實際由兩條路徑產生：

**路徑 A — z-score metric**（`triage.ts` L86–167）：

| domain | z-score 來源 metric |
|--------|---------------------|
| `behavior` | completionRate, operationConsistency, reactionLatency, interactionRhythm |
| `fine_motor` | drawingScore |
| `language` | voiceDuration |
| `gross_motor` | grossMotorAnomaly |

**路徑 B — questionnaire score**（`triage.ts` L146–151 + `questions.json`）：

從 `Object.entries(questionnaireScores)` 動態帶出，目前 `questions.json` 實際 emit 6 個：

```
cognition, fine_motor, gross_motor,
language_comprehension, language_expression, social_emotional
```

（fine_motor 與 gross_motor 兩條路徑都會 emit，下游 set-dedup 後合一）

**Known Domain 聯集 = 8 個**：
```
behavior, gross_motor, fine_motor, language,
cognition, language_comprehension, language_expression, social_emotional
```

`diet` 不在 known domain 內。未來若 questionnaire 新增 domain，必須先更新 `KNOWN_DOMAINS` + 對應 yaml + inapplicable matrix（§3.5），不然 runtime guard 會擋下（§2.7）。

### 2.3 CDSA Triage（14 個）

```
cdsa.triage.<monitor|refer>.<ageGroupCDSA>
```
2 × 7 = **14**

### 2.4 CDSA Domain Anomaly（56 個理論值）

```
cdsa.domain.<domain>.anomaly.<ageGroupCDSA>
```
8 × 7 = **56**。實際可達數量依 inapplicable matrix 定（§3.5）。

### 2.5 CDSS Vital-Sign Alerts（63 個）

```
cdss.<indicator>.<level>.<ageGroupCDSS>
  indicator ∈ { heart_rate, spo2, respiratory_rate, temperature,
                sleep_quality, activity_level, sugar_intake }
  level     ∈ { advisory, warning, critical }
```

`critical` 在 `rule-engine.worker.ts:evaluateIndicator` 直接判定（value 落在 warning range 外），不需 escalation。

7 × 3 × 3 = **63**

### 2.6 Trigger 總計

| 類別 | 公式 | 理論 |
|------|------|------|
| CDSA triage | 2 × 7 | 14 |
| CDSA domain | 8 × 7 | 56 |
| CDSS vital-sign | 7 × 3 × 3 | 63 |
| **理論總計** | | **133** |

「可達 trigger 數」= 133 − inapplicable 數，由 §3.5 矩陣定案後得到單一精確值。Spec 不再使用 `~123` 估算字眼，覆蓋率分母在 §7 採分組目標。

### 2.7 Trigger Derivation 函式

`src/lib/education/trigger-derivation.ts`：

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

> **注意**：`import.meta.env.DEV` 在 Vite 編譯的 bundle（browser islands、workers、SSR）會正確替換；在 build / curate script（透過 `tsx` 執行的 `.ts`）中**未定義且不會被呼叫到**（這些路徑不 import trigger-derivation）。
>
> **重要**：`import type { IndicatorResult } from '../../engine/workers/rule-engine.worker'` **必須維持 `import type`**。若日後改為值 import，worker 檔案的 `self.onmessage` side effect 會在主執行緒被觸發，造成 worker 錯誤註冊。`pnpm check` 與 `eslint-plugin-import` 規則 `import/no-restricted-paths` 應守護此邊界。

---

## 3. 資料結構

### 3.1 整體流向

```
YAML 真實檔（src/data/）
       ↓ js-yaml + shared zod schemas (src/lib/education/schemas.ts)
build-video-index.ts（tsx）
       ↓
public/data/video-index.json          ← 從 client 端 fetch
src/lib/education/_runtime-types.ts   ← 純 type，無資料
       ↓ fetch + parse + cache
video-lookup.ts（async API）
       ↓
Svelte islands (/result/, /workspace/)
```

> **關鍵架構變更（修自 v3 reviewer）**：
> - **不註冊 Astro Content Collection** for video-catalog / education-videos（既不需要 Astro 編譯時參與，又會踩到「array 頂層 schema」非慣用語法）
> - **不在 build script import `astro:content`**（virtual module 在 node 環境不可用）
> - **改用共用 `schemas.ts`**：build script、tests、runtime types 都從同一處引用
> - **runtime index 走 fetch**：不 inline JSON 進 bundle，避免首屏 bundle 膨脹

### 3.2 共用 Schemas

`src/lib/education/schemas.ts`：

```typescript
import { z } from 'astro/zod';   // Astro 內建 zod re-export（subpath 已驗證存在於 Astro 6.3.1）
import { AGE_GROUPS_CDSA } from '../utils/age-groups';
// astro/zod 在 Astro 6.3.1 = zod v4（已驗證 `export * from "zod/v4"`），
// 故所有 schema 須遵循 v4 API（如 z.record 需兩個 arg、不可用 v3 single-arg form）。
// AGE_GROUPS_CDSA 現宣告為 `as const` 但顯式 annotation 為 `readonly AgeGroupCDSA[]`，
// 兩者餵 z.enum 都通過。建議拆掉 annotation 讓 tuple literal 元素型別暴露出來，
// z.enum 推得 literal union 而非 string union，inference 更精確。
// step 1 同時改 src/lib/utils/age-groups.ts：
//   export const AGE_GROUPS_CDSA = [
//     '2-6m', '7-12m', '13-24m', '25-36m', '37-48m', '49-60m', '61-72m',
//   ] as const;
//   export type AgeGroupCDSA = typeof AGE_GROUPS_CDSA[number];
// 既有 NormsManager.svelte 用 {#each ... as} 迭代不受影響。

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

/** Slim runtime shape — 只包含元件實際顯示用欄位，curate-only 欄位不打包 */
export const runtimeVideoSchema = videoCatalogItemSchema.pick({
  videoId: true,
  title: true,
  channel: true,
  duration: true,
  language: true,
  sourceTier: true,
  score: true,
});

/** Runtime index 必須 reproducible — 不含時間戳、不含隨機 ID，否則 §4.11
 *  `git diff --exit-code` PR gate 會結構性必敗。time-stamp 寫到 sidecar。 */
export const runtimeIndexSchema = z.object({
  // zod v4 z.record 需兩個 arg（key, value）；v3 single-arg form 已移除
  catalog: z.record(z.string(), runtimeVideoSchema),
  triggers: z.record(z.string(), z.object({
    videoIds: z.array(z.string()),
    inapplicable: z.boolean(),
  })),
});

export type VideoCatalogItem = z.infer<typeof videoCatalogItemSchema>;
export type RuntimeVideo = z.infer<typeof runtimeVideoSchema>;
export type RuntimeIndex = z.infer<typeof runtimeIndexSchema>;

/** 多租戶自訂影片：與 RuntimeVideo 同形，多帶 triggers 範圍欄位。
 *  放 schemas.ts 而非 video-lookup.ts，避免 lookup ↔ merge 循環 import。 */
export type CustomVideo = RuntimeVideo & { triggers: string[] | '*' };
```

### 3.3 目錄

```
src/data/video-catalog/                # sharded by tier
├── official-tw.yaml                   # 頂層 array
├── international.yaml
└── pro-kol.yaml

src/data/education-videos/             # trigger 映射，sharded by category
├── cdsa-triage.yaml                   # 頂層 array
├── cdsa-domains.yaml
├── cdss-vital-signs.yaml
└── README.md

src/lib/education/
├── schemas.ts                         # 共用 zod + types（含 CustomVideo）
├── age-fallback.ts                    # CDSA_FALLBACK_CHAIN 常數表
├── trigger-derivation.ts
├── video-lookup.ts                    # async API + tryAgeGroupFallback
└── merge-custom-videos.ts             # §3.9 合約實作

public/data/
└── video-index.json                   # build 產出，fetch 來源（git tracked）

scripts/
├── curate-videos.ts
├── build-video-index.ts               # tsx 執行；共用 src/lib/education/schemas.ts
└── curate/
    ├── channel-seeds.json             # tracked
    ├── channel-whitelist.json         # gitignore，runtime cache
    ├── keywords.json                  # tracked
    ├── inapplicable-matrix.json       # tracked，§3.5 來源
    ├── cache/                         # gitignore
    └── reports/                       # gitignore
```

### 3.4 YAML 範例

**`src/data/video-catalog/official-tw.yaml`**（array 頂層）：
```yaml
- videoId: "abc123XYZ45"
  title: "幼兒發展遲緩何時該就醫"
  channel: "台大兒醫"
  channelId: "UCxxxxxxxxx"
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
  notes: "明確指出何時轉介、家長語氣親切"
```

**`src/data/education-videos/cdsa-triage.yaml`**：
```yaml
- trigger: cdsa.triage.refer.13-24m
  category: triage
  triageCategory: refer
  ageGroup: 13-24m
  educationSlug: when-to-seek-help
  videoIds:
    - abc123XYZ45
```

**`src/data/education-videos/cdsa-domains.yaml`**：
```yaml
- trigger: cdsa.domain.fine_motor.anomaly.2-6m
  category: domain
  domain: fine_motor
  ageGroup: 2-6m
  inapplicable: true
  videoIds: []
- trigger: cdsa.domain.fine_motor.anomaly.25-36m
  category: domain
  domain: fine_motor
  ageGroup: 25-36m
  educationSlug: fine-motor-activities
  videoIds:
    - abc123XYZ45
```

**`src/data/education-videos/cdss-vital-signs.yaml`**：
```yaml
- trigger: cdss.spo2.critical.infant
  category: vital-sign         # 注意：hyphen，與 schema discriminator 一致
  indicator: spo2              # snake_case
  level: critical
  ageGroup: infant
  educationSlug: respiratory-care
  videoIds:
    - abc123XYZ45
```

**命名 convention**：`category` 值用 hyphen（`vital-sign`），其它 enum（`indicator` / `domain` / `level` / `ageGroup`）一律 snake_case 或 kebab-case 不混用。

### 3.5 Inapplicable Matrix

`scripts/curate/inapplicable-matrix.json`（**tracked**，是 yaml 的權威來源；`build-video-index.ts` 跑 schema check 確保兩者一致）：

```json
{
  "version": 1,
  "rationale": "依 src/data/questionnaire/questions.json 的 ageGroups 欄位與 z-score 路徑可用性決定",
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

**Phase-1 sign-off gate**：上述 matrix 數值為初版估計，須在 plan 執行階段 1 與臨床顧問確認後 commit；keywords.json 在矩陣 sign-off 之後才產出。

**Sign-off 認定**：commit message body 含 `Signed-off-by:` 行（git built-in `-s` flag）且 committer 為已知臨床顧問身分（plan 階段先決定 reviewer email allowlist 並寫進 `.github/CODEOWNERS` 的 `scripts/curate/inapplicable-matrix.json` 規則）。Plan 執行前必先決定該 allowlist。

**Source of truth 規則**：`inapplicable-matrix.json` 為唯一權威來源。build script 比對 yaml 的 `inapplicable: true` 與 matrix 內容；任何不一致 hard-fail，error 訊息列出 yaml 與 matrix 的 diff，提示開發者修 yaml（不是改 matrix）。

**計算**（依上方矩陣逐項加總）：

| domain | inapplicable 數 |
|--------|----------------|
| behavior | 2 |
| gross_motor | 0 |
| fine_motor | 1 |
| language | 1 |
| cognition | 2 |
| language_comprehension | 1 |
| language_expression | 2 |
| social_emotional | 1 |
| **合計** | **10** |

CDSA domain 8×7=56 − 10 inapplicable = **46 reachable**；總 reachable = 14 (triage) + 46 (domain) + 63 (CDSS) = **123**。

矩陣與此計算為 plan phase 1 sign-off 之前的 v1 估計；sign-off 後若調整數值，必須同步更新本節合計、§4.8 / §7 / §10 引用。

**Lookup 行為對照**：

| yaml 狀態 | 語義 | 行為 |
|----------|------|------|
| `inapplicable: true` | 臨床上不評估 | **絕對回空**，custom videos 不能 override |
| `videoIds: []` 無 inapplicable | 適用但目前無影片 | 嘗試 ageGroup fallback；可被 custom override |
| `videoIds: [...]` | 有影片 | 直接回 |

### 3.6 AgeGroup Fallback 鏈

```typescript
const CDSA_FALLBACK_CHAIN: Record<AgeGroupCDSA, AgeGroupCDSA[]> = {
  '2-6m':   ['7-12m'],
  '7-12m':  ['2-6m', '13-24m'],
  '13-24m': ['7-12m', '25-36m'],
  '25-36m': ['13-24m', '37-48m'],
  '37-48m': ['25-36m', '49-60m'],
  '49-60m': ['37-48m', '61-72m'],
  '61-72m': ['49-60m'],
};
```

CDSS 3 bin 不做 fallback。Fallback 永遠不跨越 `inapplicable: true`。Chain 順序為設計選擇：先試**最鄰近**的年齡 bin（如 13-24m 先試 7-12m 再試 25-36m），衛教內容鄰近性高於發展階段相同性。

`tryAgeGroupFallback` 實作見 §3.8 `video-lookup.ts`。

### 3.7 Build-time Index Generation（修正版）

`scripts/build-video-index.ts`（用 `tsx` 執行，共用 `src/lib/education/schemas.ts`）：

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import fg from 'fast-glob';
import { z } from 'astro/zod';
import {
  videoCatalogItemSchema, triggerEntrySchema, runtimeIndexSchema,
  type VideoCatalogItem,
} from '../src/lib/education/schemas';
import inapplicableMatrix from './curate/inapplicable-matrix.json' with { type: 'json' };

interface InapplicableMatrix {
  version: number;
  rationale: string;
  'cdsa.domain': Record<string, { inapplicable: string[] }>;
  'cdsa.triage': { inapplicable: string[] };
  cdss: { inapplicable: string[] };
}
const matrix = inapplicableMatrix as InapplicableMatrix;

type TriggerEntry = z.infer<typeof triggerEntrySchema>;

// 1. read yamls
const catalogFiles = await fg('src/data/video-catalog/*.yaml');
const triggerFiles = await fg('src/data/education-videos/*.yaml');

// 2. parse + validate via shared schemas
const catalog: Record<string, VideoCatalogItem> = {};
for (const f of catalogFiles) {
  const arr = yaml.load(await fs.readFile(f, 'utf8'));
  const validated = z.array(videoCatalogItemSchema).parse(arr);
  for (const v of validated) {
    if (catalog[v.videoId]) throw new Error(`Duplicate videoId: ${v.videoId} in ${f}`);
    catalog[v.videoId] = v;
  }
}

const triggers: Record<string, TriggerEntry> = {};
for (const f of triggerFiles) {
  const arr = yaml.load(await fs.readFile(f, 'utf8'));
  const validated = z.array(triggerEntrySchema).parse(arr);
  for (const t of validated) {
    if (triggers[t.trigger]) throw new Error(`Duplicate trigger: ${t.trigger} (file: ${f})`);
    triggers[t.trigger] = t;
  }
}

// 3. cross-check: yaml `inapplicable: true` ↔ inapplicable-matrix.json 完全一致
//    matrix 是 source of truth，不一致 hard-fail。涵蓋三個 root（cdsa.domain / cdsa.triage / cdss）
const matrixInapplicable = new Set<string>();
for (const [domain, def] of Object.entries(matrix['cdsa.domain'] ?? {})) {
  for (const age of def.inapplicable) {
    matrixInapplicable.add(`cdsa.domain.${domain}.anomaly.${age}`);
  }
}
// matrix v1 結構：cdsa.triage / cdss 各為 { inapplicable: [...trigger 完整字串] }
for (const t of matrix['cdsa.triage']?.inapplicable ?? []) {
  matrixInapplicable.add(t);
}
for (const t of matrix.cdss?.inapplicable ?? []) {
  matrixInapplicable.add(t);
}
const yamlInapplicable = new Set(
  Object.values(triggers).filter(t => t.inapplicable === true).map(t => t.trigger),
);
const onlyInMatrix = [...matrixInapplicable].filter(k => !yamlInapplicable.has(k));
const onlyInYaml   = [...yamlInapplicable].filter(k => !matrixInapplicable.has(k));
if (onlyInMatrix.length || onlyInYaml.length) {
  console.error('inapplicable mismatch — matrix is source of truth.');
  if (onlyInMatrix.length) console.error('  missing in yaml:', onlyInMatrix);
  if (onlyInYaml.length)   console.error('  extra in yaml:',   onlyInYaml);
  process.exit(1);
}

// 4. cross-check: 每個 trigger 引用的 videoId 必須在 catalog 中存在
for (const t of Object.values(triggers)) {
  for (const id of t.videoIds) {
    if (!catalog[id]) throw new Error(`Trigger ${t.trigger} references unknown videoId: ${id}`);
  }
}

// 5. cross-check: 每個 educationSlug 必須對應 src/data/education/<slug>.md 存在
for (const t of Object.values(triggers)) {
  if (!t.educationSlug) continue;
  const mdPath = `src/data/education/${t.educationSlug}.md`;
  try { await fs.access(mdPath); }
  catch { throw new Error(`Trigger ${t.trigger} educationSlug not found: ${mdPath}`); }
}
// 6. emit slim runtime shape — 唯一過濾點：rejected 影片不進 catalog 也不進 trigger
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

runtimeIndexSchema.parse(runtime);  // final guard

// 確保 deterministic emit — 遞迴排序所有 object keys
function sortObjectDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map(k => [k, sortObjectDeep((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

const stable = JSON.stringify(sortObjectDeep(runtime), null, 2) + '\n';
await fs.writeFile('public/data/video-index.json', stable);

// 時間戳寫到 gitignored sidecar（不進 reproducibility 範圍）
await fs.writeFile(
  'scripts/curate/.last-build.json',
  JSON.stringify({ builtAt: new Date().toISOString() }, null, 2) + '\n',
);
```

`package.json` scripts 由 §4.1 統一定義（必須用 `tsx` 而非 `node` 執行 `.ts`）。本節不重複貼出，請以 §4.1 為單一來源。

**Bundle 影響估算**：runtime slim 每筆 ~120 bytes，250 支影片 ~30 KB；trigger map 123 條，key (~45 字) + value (~35 字) ≈ 80 bytes/entry × 123 ≈ ~10 KB；合計 ~40 KB raw / ~12 KB gzip。透過 fetch 從 `/data/video-index.json` 載入，不打包進首屏 island bundle。

### 3.8 Runtime Lookup（async）

`src/lib/education/video-lookup.ts`：

```typescript
import type { CustomVideo, RuntimeIndex, RuntimeVideo } from './schemas';
import { AGE_GROUPS_CDSA, type AgeGroupCDSA } from '../utils/age-groups';
import { mergeCustomVideos } from './merge-custom-videos';
import { CDSA_FALLBACK_CHAIN } from './age-fallback';   // §3.6 chain 表

/** 拼 AGE_GROUPS_CDSA 為尾段 alternation，避免 lazy `.+?` 在 `cdsa.domain.<dom>.anomaly.<age>`
 *  錯把 `anomaly.<age>` 整段當 currentAge 抓走（v7 reviewer 跑 regex 驗證的 bug）。 */
const CDSA_TRIGGER_REGEX = new RegExp(
  `^(cdsa\\.(?:triage|domain)\\..+)\\.(${AGE_GROUPS_CDSA.join('|')})$`,
);

let indexPromise: Promise<RuntimeIndex> | null = null;

/** Astro 保證 BASE_URL 結尾為 '/'，故相對片段不可以 '/' 開頭。
 *  已驗 BASE_PATH='' (→ BASE_URL='/') 與 BASE_PATH='/smart-pedi-cds' 兩種情境。 */
function loadIndex(): Promise<RuntimeIndex> {
  if (!indexPromise) {
    indexPromise = fetch(`${import.meta.env.BASE_URL}data/video-index.json`)
      .then(r => {
        if (!r.ok) throw new Error(`video-index.json fetch failed: ${r.status}`);
        return r.json() as Promise<RuntimeIndex>;
      })
      .catch(err => {
        indexPromise = null;      // 失敗後清掉 cache，下次呼叫可重試
        throw err;
      });
  }
  return indexPromise;
}

export interface VideoLookupOptions {
  maxResults?: number;            // 預設 3
  ageGroupFallback?: boolean;     // 預設 false
}

/** §3.6 fallback：對 CDSA 7-bin trigger 在 chain 內逐一試，跳過 inapplicable，
 *  命中第一個有 videoIds 的就回；CDSS trigger 直接回 []。 */
export function tryAgeGroupFallback(
  trigger: string,
  idx: RuntimeIndex,
): string[] {
  const m = trigger.match(CDSA_TRIGGER_REGEX);
  if (!m) return [];                                // CDSS or 非預期格式 → 不 fallback
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

  // inapplicable: ABSOLUTE empty，不顧 custom
  if (entry?.inapplicable) return [];

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

> 回 **plain object** 而非 Map，便於 Svelte 5 runes reactivity（`$state` / `$derived` 對 object 屬性存取追蹤良好；對 Map 的 `.get` 不追蹤）。

### 3.9 mergeCustomVideos 介面契約（鎖死）

```typescript
/**
 * 合約：
 *  - `inapplicable` trigger 已在呼叫前過濾，本函式不收 inapplicable 情境
 *  - dedupe by videoId（同 id 以 custom 版本取代 static）
 *  - custom 整段 prepend（自訂優先顯示）
 *  - 雙端各自按 score 降冪排
 *  - maxResults 在 merge 後套用
 *  - custom 端的 trigger 對應：custom video item 可帶 `triggers: string[] | '*'`
 *    （'*' 表通用），merge 函式依此過濾
 */
import type { CustomVideo, RuntimeVideo } from './schemas';

export function mergeCustomVideos(
  staticVideos: RuntimeVideo[],
  customVideos: CustomVideo[],
  trigger: string,
  options: { maxResults?: number },
): RuntimeVideo[];
```

V1 實作以「custom 永遠空陣列」走 happy path；介面行為仍由 §6 合約測試守住，避免未來多租戶 spec churn。

---

## 4. Curate-Videos 腳本

### 4.1 系統依賴

- **yt-dlp** ≥ 2026.03.17（系統二進位，brew install）
- **Python 3.10+**
- **node** ≥ 20.10（JSON import attribute 需要）
- **`js-yaml`** ^4.1.1：**已在 dependencies**，build/curate/tests 共用，不需新增
- 新增 npm devDeps：
  - **`fast-glob`** ≥ 3.3.x（build-video-index 用）
  - **`@lhci/cli`** ≥ 0.13.x（Lighthouse 驗收 CI）
  - **`tsx`** ≥ 4.x（build / curate script 共用 schemas.ts 必需；node 20 無原生 TS 支援）
- `sharp` 已在 devDeps（縮圖目前不需，但保留作為後續可選 self-host）

**腳本檔規範**（v6 變更）：

- 純資料處理 / 無共用 TS 依賴的腳本 → `.mjs` + JSDoc（如既有 `build-pdf-font.mjs`）
- **需共用 `src/lib/education/schemas.ts` 的腳本 → `.ts`，由 `tsx` 執行**：
  - `scripts/build-video-index.ts`（共用 schemas）
  - `scripts/curate-videos.ts`（共用 schemas + 寫 yaml 也走 schema validate）

`package.json` scripts：
```json
{
  "build:video-index": "tsx scripts/build-video-index.ts",
  "curate:videos":     "tsx scripts/curate-videos.ts",
  "prebuild":          "tsx scripts/build-video-index.ts",
  "predev":            "tsx scripts/build-video-index.ts"
}
```

### 4.2 呼叫

```bash
pnpm curate:videos                              # 全量
pnpm curate:videos --trigger cdss.spo2.critical.infant
pnpm curate:videos --category cdss
pnpm curate:videos --redo-rejected
pnpm curate:videos --validate-only
pnpm curate:videos --validate-only --batch 50   # 限 batch（GitHub Actions 用）
pnpm curate:clean                               # 清 TTL 過期 cache
```

### 4.3 Pipeline

```
0. （pre-flight）Channel seeds resolution：
     掃 scripts/curate/channel-seeds.json，所有 channelId==null 的 seed 透過
     `yt-dlp -J --playlist-end 1 https://www.youtube.com/@HANDLE/videos` 取得真實
     channelId，寫進 channel-whitelist.json。任何一個失敗 → hard-abort，
     不進入 step 1。
1. 載入 trigger → keywords（scripts/curate/keywords.json）
2. yt-dlp 階段 1：ytsearch30:<keywords> → id, title, duration（flat 模式）
3. Heuristics A：duration、標題黑名單、已 rejected 去重 → top 8
4. yt-dlp 階段 2：對 top 8 各跑一次 --print-json
   → 完整 metadata（channel_id, view_count, upload_date, description）
5. Heuristics B：channelTier、age decay、view count、簡體偵測 → top 5
6. yt-dlp 階段 3：字幕（--write-subs --write-auto-subs --sub-langs zh-Hant,zh-TW,zh,en）
7. Heuristics C：字幕內容（醫學詞密度、危險詞、簡體佔比、auto vs human）→ score
8. 三態 verdict：
     auto-verified  (score ≥ 0.80, 無危險詞, human subs, 白名單 channel)
     auto-rejected  (黑名單 / 簡體 > 30% / score < 0.30)
     needs-review   (其餘)
9. 寫 report 到 scripts/curate/reports/<trigger>.md
10. Claude Code 複審：
     verified → 寫入 video-catalog/<tier>.yaml + trigger mapping
     rejected → 寫入 catalog（status=rejected，去重黑名單）
     needs-review → 不寫入 catalog，留 report 等下次決定
11. 跑 pnpm prebuild → 更新 public/data/video-index.json
```

### 4.4 yt-dlp 指令

```bash
# 階段 1
yt-dlp --flat-playlist --print-json \
  --sleep-requests 1.5 --retries 3 --no-warnings \
  "ytsearch30:嬰兒 血氧 過低 衛教"

# 階段 2
yt-dlp --skip-download --print-json --no-warnings \
  "https://www.youtube.com/watch?v=<videoId>"

# 階段 3
yt-dlp --skip-download \
  --write-subs --write-auto-subs \
  --sub-langs "zh-Hant,zh-TW,zh,en" \
  --sub-format "vtt" \
  --output "scripts/curate/cache/%(id)s.%(ext)s" \
  --no-warnings \
  "https://www.youtube.com/watch?v=<videoId>"
```

**429 偵測**：
```javascript
if (/HTTP Error 429|Too Many Requests|Sign in to confirm/i.test(stderr)) {
  // 指數退避：30s → 60s → 120s → 240s（上限 5 分鐘），最多 3 次
}
```

### 4.5 Channel Seeds Resolution

`scripts/curate/channel-seeds.json`（**tracked**，人工維護）：

```json
{
  "official-tw": [
    { "tag": "@MOHWtaiwan",          "channelId": null },
    { "tag": "@HPATaiwan",           "channelId": null },
    { "tag": "@NTUHchildren",        "channelId": null },
    { "tag": "@TWPedSoc",            "channelId": null }
  ],
  "international": [
    { "tag": "@AmericanAcademyofPediatrics", "channelId": null },
    { "tag": "@CDC",                          "channelId": null }
  ],
  "pro-kol": []
}
```

Seed 既可給 `@handle` 也可給 raw `UCxxxx`（後者免 resolve）。

**Resolve 步驟**（curate 啟動時，channelId 為 null 才跑）：
```bash
# 比訪問 channel page 更穩：抓 channel 的最新一支影片 metadata
yt-dlp -J --playlist-end 1 "https://www.youtube.com/@HANDLE/videos"
```
從 JSON 取 `channel_id` 寫回 `scripts/curate/channel-whitelist.json`（**gitignore**）。

**Resolution 失敗即 hard-fail**（不 silent skip），錯誤訊息列出哪個 handle 失敗，curator 修 seed 或暫時改填 raw channelId。

### 4.6 Blacklist 規則

```typescript
const BLACKLIST = {
  channelDescriptionContains: ['简体', '简介', '简化', '中国大陆', 'CCTV'],
  channelHandleSuffix: ['.cn'],
  titleKeywords: ['偏方', '神奇療法', '保健食品推薦', '代購', '微商'],
  subtitleSimplifiedRatio: 0.3,
};
```

**簡體偵測**：以字元對照表（~60 對高頻字如「兒/儿、體/体」）計算簡體佔總中文字比，無外部依賴。

### 4.7 Heuristics 評分

```
score =
  base 0.20
  + channelTier:    { official-tw: +0.40, international: +0.35, pro-kol: +0.20 }
  + subtitleType:   { human: +0.15, auto: +0.05, none: 0 }
  + medicalTermDensity              clamp(0 .. +0.15)
  + viewCountSignal: log10(views+1) × 0.02   clamp(0 .. +0.10)
  − dangerKeywordHits × 0.20        (≥1 hit → floor 0)
  − publishedAgeDecay:
      0 if < 3y
      linear up to −0.15 if 3–8y
      hard reject if > 8y AND keywords.json `timeSensitive: true`
  − durationOutOfRangePenalty: 0.05 / outOfRangeFactor
  clamp [0, 1]
```

### 4.8 Keywords 對照表

`scripts/curate/keywords.json` 由 Claude Code 在 phase-1 產出（在 §3.5 inapplicable matrix sign-off 之後），只覆蓋 reachable trigger（123 個）。範例：

```json
{
  "cdss.spo2.critical.infant": {
    "primary":   ["嬰兒 血氧 過低", "新生兒 缺氧 緊急"],
    "secondary": ["infant low SpO2 emergency"],
    "educationSlug": "respiratory-care",
    "minDuration": 60,
    "maxDuration": 600,
    "timeSensitive": false
  }
}
```

**Keywords 設計準則**：

1. **視角分層**：每組 keywords 必須涵蓋兩種讀者
   - 家長視角：「寶寶嘴唇發紫怎麼辦」「嬰兒呼吸急促」
   - 醫療衛教視角：「兒童 SpO2 監測」「新生兒缺氧處置」
   - 避免純醫師教學影片（衛教應對象為家長）

2. **中英並用**：`primary` 至少含 2 組繁中關鍵字，`secondary` 含 1 組英文（補強冷門 trigger），但繁中優先排序

3. **語意涵蓋**：對症狀型 trigger（如 critical SpO2）必含「症狀詞 + 處置詞」，不能只放診斷詞
   - ✅ `嬰兒 嘴唇發紫 急救`、`新生兒 缺氧 送醫`
   - ❌ `嬰兒 hypoxemia`（術語太硬，家長不會搜）

4. **年齡限定詞**：嬰幼兒專屬 trigger 必含年齡關鍵字（嬰兒 / 新生兒 / 幼兒 / 學齡前），避免命中成人衛教

5. **禁用關鍵字**（永遠不能出現在任何 keywords entry）：「偏方」「神奇」「秘方」「保健品」「代購」「中醫」「DIY 治療」— 即使是為了排除也不要寫進來，否則 yt-dlp 仍會搜到並進入篩選池

6. **`timeSensitive: true` 條件**：以下 trigger 內容年限敏感（疫苗排程、生長曲線、感染症指引等），keywords 必加 `timeSensitive: true`，§4.7 評分中 > 8 年的影片直接 hard reject
   - 所有疫苗相關 advisory/warning
   - 所有 respiratory_rate / temperature 配 advisory 以上（指引常更新）
   - 飲食指南類（衛福部建議常修訂）

7. **重複搜尋避免**：跨 trigger 的 keywords primary 不要完全重複（否則同支影片在多 trigger 上 curate 結果幾乎一樣），可以重疊但每組至少有 1 個獨特關鍵字

### 4.9 Cache / Retention

| 路徑 | 內容 | git | TTL |
|------|------|-----|-----|
| `scripts/curate/cache/*.vtt` | 字幕 | ignore | 30 天 |
| `scripts/curate/cache/*.meta.json` | yt-dlp metadata | ignore | 30 天 |
| `scripts/curate/reports/*.md` | 複審報告 | ignore | 90 天 |
| `scripts/curate/channel-whitelist.json` | resolved channelId | ignore | 永久（手動清） |
| `scripts/curate/.last-build.json` | build 時間戳 sidecar | ignore | 每次 build 覆寫 |
| `scripts/curate/channel-seeds.json` | 人工維護 seed | tracked | 永久 |
| `scripts/curate/keywords.json` | trigger → keyword | tracked | 永久 |
| `scripts/curate/inapplicable-matrix.json` | inapplicable 矩陣 | tracked | 永久 |
| `src/data/video-catalog/*.yaml` | 影片元資料 | tracked | 永久 |
| `src/data/education-videos/*.yaml` | trigger 映射 | tracked | 永久 |
| `public/data/video-index.json` | runtime index | tracked | 自動更新 |

`pnpm curate:clean` 清完所有 TTL 過期項。

### 4.10 Validate-Only 自動化

`.github/workflows/validate-videos.yml`：

> **Validate-only 影響範圍規則**：`validate-only` 模式**只動 catalog**（更新 `verificationStatus` 與 `lastValidatedAt`），**不動 `education-videos/*.yaml`**。下架影片從 runtime index 出局的過濾在 `build-video-index.ts` 的 step 6 完成（同時從 `runtime.catalog` 與 `triggers[].videoIds` 兩處剔除 rejected）。

```yaml
name: Validate Videos
on:
  schedule:
    - cron: '0 3 * * 0'        # 每週日 03:00 UTC（台北 11:00）
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
          # validate-only 預期只動 catalog + video-index.json，其他檔不該有 diff
          git diff --stat
          git diff --exit-code -- ':!src/data/video-catalog' ':!public/data/video-index.json'
      - name: Open PR if changes
        uses: peter-evans/create-pull-request@v6
        with:
          title: "chore(videos): mark unavailable videos"
          body: |
            Auto-detected unavailable videos this run.
            Inspect changed files in `src/data/video-catalog/*.yaml` and `public/data/video-index.json`.
          branch: bot/video-validate
          commit-message: "chore(videos): validate sweep"
```

> 需在 repo Settings → Actions → Workflow permissions 啟用「Allow GitHub Actions to create and approve pull requests」。

**Batch 限制**：每週只巡檢 50 支（rotated by `lastValidatedAt` 欄位，最舊的先），降低 YouTube 對 GitHub-hosted runner IP 的 rate-limit 風險。完整 catalog 在 5 週內輪一遍。

### 4.11 Claude Code 人工複審 Checklist

`auto-verified` 三態之外，Claude Code 讀完字幕的最終決定步驟。Report 中每支候選 影片下方必須附上以下 10 項勾選結果，全 pass 才寫入 catalog 為 `verified`；任一項 fail 一律 `rejected`，並把失敗條目寫進 `notes` 欄位。

| # | 檢核項 | 通過條件 |
|---|--------|---------|
| 1 | **臨床正確性** | 字幕陳述符合台灣兒科醫學會 / WHO / CDC 主流共識；無單一研究結論誇大、無已撤回指引 |
| 2 | **年齡適配** | 影片內 demonstrated 年齡與 trigger 的 ageGroup 一致或鄰近一格；不適配（如示範學齡兒卻歸 infant trigger）→ fail |
| 3 | **症狀 vs 診斷區隔** | 不把症狀直接稱為診斷（例如「咳嗽 = 肺炎」）；該轉介就醫的場景明確提示「請就醫」而非自行處置 |
| 4 | **無商業推銷** | 不推銷特定品牌奶粉/益生菌/維他命/智慧穿戴；不出現「使用優惠碼」「下方連結購買」 |
| 5 | **無偽科學** | 不提偏方、不提中醫無 RCT 證據療法、不提食補替代醫療、不提抗疫苗論述 |
| 6 | **家長語氣** | 對家長說話的口吻友善、無 victim-blaming（「你怎麼沒注意到」），重點明確（家長 30 秒內知道要做什麼） |
| 7 | **資訊密度** | 主訊息能在 60–600 秒講完（與 keywords minDuration/maxDuration 一致）；不過度冗長、不過度跳重點 |
| 8 | **無 PII 暴露** | 不展示真實病人面孔、姓名、病歷號（即使家屬同意也標 reject — 兒童特別敏感） |
| 9 | **頻道身分驗證** | 頻道描述含可驗證的醫療專業身分（醫師執照字號、醫院/協會官方標記）或為 §4.5 白名單 |
| 10 | **時效性**（僅 timeSensitive: true） | 影片發布日距今 < 5 年；若提及具體年份的指引版本，該版本仍為現行 |

**複審輸出格式**（report 內 per-candidate 區塊）：

```markdown
### Candidate: <videoId> — <title>
- channel: <channel> (<sourceTier>)
- duration: <s> | subtitleType: <human|auto|none> | score: <0–1>
- subtitle excerpt (字幕首尾各 200 字):
    ...
- Checklist:
  - [x] 1. 臨床正確性
  - [x] 2. 年齡適配
  - [ ] 3. 症狀 vs 診斷區隔 — fail: 把「發燒」直接稱為「腦炎徵兆」
  ...
- Verdict: rejected
- Notes: 「症狀 vs 診斷」失敗；建議改找衛福部相同主題影片
```

**多人複審情境**：未來若改為人工複審，同一支影片由不同 reviewer 看到的 verdict 應一致；不一致時優先採 reject（safety-first）。

### 4.12 PR 端 Index 一致性 Gate

新建 `.github/workflows/ci.yml`（既有 repo 只有 `deploy.yml`，本 spec 補一個 PR-time CI 入口）：

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

  # 既有 deploy.yml 已跑 pnpm check / lint / build；本 spec 只新增上面的 index-consistency + test job。
```

> 既有 `.github/workflows/deploy.yml` 已涵蓋 `pnpm check`、`pnpm lint`、`pnpm build`；本 spec 補的 ci.yml 額外負責 index-consistency 與 `pnpm test`，避免 deploy.yml 變更範圍過大。

`tests/data/index-consistency.test.ts` 跑同樣邏輯，本地早期反饋。

---

## 5. 前端整合

### 5.1 使用點

| 頁面 | 路徑 | hydration | trigger 來源 |
|------|------|-----------|-------------|
| 評估結果 | `/result/` | `<ResultViewWrapper client:load />` | `deriveCdsaTriggers(triage, ageGroup)` |
| 醫師工作台 — 病患結果 | `/workspace/result/` | `<ResultDetail client:load />` | CDSA + CDSS 合併 |
| 醫師工作台首頁 | `/workspace/` | client island | 病患卡 hover 預覽 |
| 衛教首頁 | `/education/` | hybrid | 反查 `educationSlug` |

所有 lookup 在 client island 內 `onMount` 後 fetch `public/data/video-index.json`。Promise 模組級單例，多次呼叫複用。

### 5.2 元件

```
src/components/education/
├── VideoCard.svelte             # 兩種視覺變體：with-thumbnail / no-thumbnail
├── VideoGrid.svelte             # sort by score
└── TriggerVideoList.svelte      # props: triggers[]，內部呼叫 getVideosForTriggers
```

**VideoCard 兩種變體**：

- **with-thumbnail（預設）**：縮圖 + 標題 + 時長 + sourceTier badge；點擊才嵌入 iframe
- **no-thumbnail（fallback）**：sourceTier badge + 標題 + 時長 + 「▶ 觀看」按鈕；以純色背景 + 大字標題替代縮圖位置

切換時機：縮圖 `<img onerror>` 觸發後，元件 state 切到 no-thumbnail 變體；同時把 `videoId` 寫進 `sessionStorage` 的 `failed-thumbnails` set，同 session 後續同 id 直接走 no-thumbnail（避免重複試載）。不寫 IndexedDB，避免長期記住可能只是暫時的網路問題。

> 存取一律用 `typeof window !== 'undefined' && 'sessionStorage' in window` 守護，避免 SSR / jsdom 測試環境 throw。

**多支影片顯示策略**（單一 trigger 拿到 N 支 verified 影片時）：

| 情境 | 顯示策略 |
|------|---------|
| trigger 拿到 1 支 | 直接顯示，VideoCard with-thumbnail |
| trigger 拿到 2–3 支 | 全顯示為 VideoGrid（橫向排列）；按 score 降冪。每支顯示 sourceTier badge（official-tw / international / pro-kol）幫家長分辨來源 |
| trigger 拿到 > 3 支 | 預設只顯示 top 3（`maxResults: 3`，§3.8 已預設），「展開更多」按鈕顯示其餘 |
| 多 trigger 在同頁 | 各 trigger 自己一個 VideoGrid，**跨 trigger 不去重**（家長可能對同支影片在不同情境下重複看到 — 這是 feature 不是 bug） |

**sourceTier 並列規則**：score 排序中若分數接近（差 ≤ 0.05），優先把 sourceTier=`official-tw` 提前。理由：台灣家長對國健署 / 台大兒醫等官方頻道信任度高於同等級的國際頻道。

**隨機輪播避免**：不採「每次重新整理顯示不同影片」策略（會讓家長困惑「上次看到的影片去哪了」）。同一 trigger 在同一 patient session 顯示 stable 順序。

**長度限制**：VideoCard 標題以 CSS `line-clamp: 2` 限制 2 行；超過用 `...` 截斷，hover 顯示完整標題（aria-label 同步完整字串供螢幕閱讀器）。

**多影片 vs 一支衛教文**：當 trigger 同時有 `educationSlug`（指向 markdown 衛教文）與 `videoIds` 時，UI **同時顯示**：衛教文擺在影片上方（文字 > 影片，文字較易掃讀）；影片補強示範性內容（餵奶姿勢、急救手法等不易文字化的）。

### 5.3 Embed + 縮圖策略

**縮圖**：用 `<img referrerpolicy="no-referrer" loading="lazy" src="https://i.ytimg.com/vi/<id>/hqdefault.jpg" onerror={...}>` hotlink。

**法律 / 隱私立場**（誠實揭露）：
- ✅ thumbnail hotlinking 為 YouTube 自家 oEmbed / IFrame Player API 採用的相同 pattern，**業界廣泛實作但未經 YouTube 正式書面授權**，屬 ToS 灰色地帶
- ✅ `referrerpolicy=no-referrer`：阻止 referrer 洩漏
- ⚠ IP 仍透過 GET 暴露給 Google（與 iframe embed 同等級）
- ⚠ 若 YouTube 來日正式異議，fallback 為「不顯示縮圖、純文字卡片 + 點擊跳轉」（已設計 onerror 路徑）

WebP 不需要（直接從 i.ytimg.com 拿 JPEG）。

**Iframe**（縮圖點擊後才插入）：

```svelte
<iframe
  src={`https://www.youtube-nocookie.com/embed/${videoId}?cc_load_policy=1&hl=zh-Hant&modestbranding=1`}
  title={video.title}
  loading="lazy"
  allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
  referrerpolicy="no-referrer"
  allowfullscreen
/>
```

### 5.4 i18n / Offline / a11y

- **i18n**：UI locale 為 en + catalog 語言為 zh-Hant → 顯示原始中文標題並標 `[繁中]` 徽章
- **Offline**：
  - 同時使用 `navigator.onLine` 與 `<img onerror>` 雙重防護
  - onerror 觸發 → 顯示 placeholder「需連網觀看 / 縮圖載入失敗」（涵蓋 captive portal、ToS 異議下架等情境）
  - SW 不快取縮圖（避免版權與更新風險）
- **a11y**：
  - 縮圖 `<img alt={video.title}>`
  - 按鈕 `aria-label="播放影片：{title}（{duration} 分鐘）"`
  - iframe `title` 必設
  - 字級 ≥ `--text-base`（18px）
  - 觸控目標 ≥ 44px

### 5.5 Trigger 計算（Svelte 5 client island）

```svelte
<script lang="ts">
import { deriveCdsaTriggers } from '$lib/education/trigger-derivation';
import { getVideosForTriggers } from '$lib/education/video-lookup';
import type { RuntimeVideo } from '$lib/education/schemas';

let triageResult = $state(/* loaded from IndexedDB */);
let ageGroup = $state(/* ... */);

let triggers = $derived(
  triageResult ? deriveCdsaTriggers(triageResult, ageGroup) : [],
);

let videosByTrigger = $state<Record<string, RuntimeVideo[]>>({});

$effect(() => {
  if (triggers.length === 0) { videosByTrigger = {}; return; }
  getVideosForTriggers(triggers, [], { maxResults: 3, ageGroupFallback: true })
    .then(result => { videosByTrigger = result; });
});
</script>

{#each Object.entries(videosByTrigger) as [trigger, videos]}
  <TriggerVideoList {trigger} {videos} />
{/each}
```

> Lookup 為 async（fetch），故用 `$effect` 改寫 state；不用 `$derived` 因為它要求同步求值。

---

## 6. 測試

```
tests/
├── lib/education/
│   ├── trigger-derivation.test.ts        # CDSA + CDSS、KNOWN_DOMAINS guard
│   │                                     # fine_motor 兩條路徑（z-score + questionnaire）的去重
│   │                                     # DEV/prod 切換：vitest 透過 vi.stubEnv('DEV', false) 測 prod warn
│   ├── video-lookup.test.ts              # sort, filter, inapplicable absolute empty
│   │                                     # ageGroup fallback 跨 inapplicable 的行為
│   │                                     # loadIndex fetch 失敗後 retry
│   ├── merge-custom-videos.test.ts       # 合約：dedupe by id, custom prepend, maxResults 後套用, '*' wildcard
│   ├── i18n-fallback.test.ts             # en locale + zh-Hant 徽章
│   └── schemas.test.ts                   # discriminatedUnion 正面/負面：
│                                         #   - cross-field refine 觸發（trigger 字串 ≠ 欄位組合）
│                                         #   - unknown domain → 拒
│                                         #   - invalid videoId regex（10 字 / 12 字 / 含 $）→ 拒
│                                         #   - category=triage + triageCategory='normal'（normal 不在 enum）→ 拒
│                                         #   - category=domain 帶多餘的 indicator 欄位 → 預設被 strip
│                                         #     （zod v4 預設 strip；若加 `.strict()` 才拒）
├── components/education/
│   ├── VideoCard.test.ts                 # 點擊才載 iframe；referrerpolicy；onerror placeholder
│   ├── VideoGrid.test.ts                 # sort
│   └── TriggerVideoList.test.ts          # async lookup、reactive 更新
├── data/
│   ├── education-slug-integrity.test.ts  # yaml educationSlug ↔ src/data/education/<slug>.md（讀 fs）
│   ├── trigger-uniqueness.test.ts        # 跨 yaml 檔 trigger 唯一（讀 fs + js-yaml）
│   ├── inapplicable-consistency.test.ts  # yaml inapplicable flag ↔ inapplicable-matrix.json 一致
│   └── index-consistency.test.ts         # 本地版本：build:video-index 後 diff 為空
└── scripts/
    ├── build-video-index.test.ts         # 用 tests/fixtures/video-yaml/ 真實 fs；
    │                                     # 跑兩次輸出 byte-identical；duplicate videoId/trigger 偵測
    │                                     # injectable cwd（main(cwd)）便於 fixture 切換
    │                                     # CDSA_TRIGGER_REGEX 對畸形 trigger 的 sanity case
    ├── curate-heuristics.test.ts         # 評分邊界、簡體偵測、age decay
    ├── curate-three-verdict.test.ts      # auto-verified / auto-rejected / needs-review 邊界
    └── validate-only-mark.test.ts        # validate-only 偵測下架 → rejected
```

**測試一律走 yaml-direct + js-yaml + 共用 schemas，不嘗試 import `astro:content`**。

---

## 7. 驗收標準

1. `pnpm curate:videos` 跑完 123 個 reachable trigger，無 crash
2. **分組覆蓋率**（取代單一比例）：
   - High-stakes（`cdsa.triage.refer.*`、`cdss.*.critical.*`）≥ **90%** 有 verified 影片
   - Mid-stakes（`cdsa.triage.monitor.*`、`cdss.*.warning.*`、`cdsa.domain.*.anomaly.*`）≥ **70%**
   - Low-stakes（`cdss.*.advisory.*`）≥ **40%**
3. 所有 embed 走 nocookie + referrerpolicy=no-referrer + 點擊才嵌入
4. `pnpm check` / `pnpm test` / `pnpm build` 全綠
5. **Lighthouse Performance ≥ 85** on `/result/` / `/workspace/result/`，跑在 `astro preview` + `@lhci/cli` mobile preset
6. CI 加 Lighthouse-CI budget assertion + bundle-size budget（首屏 island bundle ≤ 既有 baseline + 20 KB gzip，video-index.json 不計）

   **Baseline（量於 2026-05-19，pre-implementation）**：
   - `/result/` 主 island (`ResultViewWrapper.js`)：**2.0 KB gzip**
   - `/workspace/result/` 主 island (`ResultDetail.js`)：**3.9 KB gzip**
   - 相關共用 island (`AssessmentShell.js`)：18.8 KB gzip
   - Lighthouse Performance baseline：留待 Task 32（CI 設定階段）量測

   **Budget（baseline + 20 KB gzip）**：
   - `/result/` ≤ 22 KB gzip
   - `/workspace/result/` ≤ 24 KB gzip
7. PR 端 `index-consistency` job 必綠（generated JSON 與 yaml 同步）

---

## 8. 風險與緩解

| 風險 | 影響 | 緩解 |
|------|------|------|
| YouTube 影片下架 | UI 顯示縮圖 404 | weekly GitHub Actions `--validate-only` + onerror placeholder |
| YouTube ToS thumbnail hotlink 灰色 | 法律風險 | 透明揭露；fallback「無縮圖卡片」已實作 |
| yt-dlp API 變更 | curate 失敗 | 版本 pin；首次跑 self-test；降級 manual |
| GitHub Actions IP 被 YouTube 限速 | validate 中斷 | 每週 batch 50 + rotation；5 週輪一遍 |
| 字幕版權邊界 | 法律 | cache gitignore + 30 天 TTL + 不發布（**僅本地開發 curate 流程**；§4.10 validate-only workflow 不下載字幕，runner 上無此風險） |
| Heuristics 漏放偽科學 | 醫療安全 | Claude Code 三態複審；needs-review 不入 catalog |
| `public/data/video-index.json` 與 yaml 漂移 | runtime 拿舊資料 | prebuild 強制更新 + PR CI hash check |
| Client bundle 膨脹 | Lighthouse | runtime slim 欄位 + fetch + 不 inline JSON 進 bundle |
| navigator.onLine 不可靠 | offline 偵測誤判 | onerror 為主，navigator.onLine 為輔 |

---

## 9. 不在本 spec 範圍

- 自製衛教影片
- 影片字幕翻譯
- 醫師自訂影片 UI（`mergeCustomVideos` 合約已鎖；UI + Dexie 表留後續 spec）
- 字幕 LLM 摘要

> **未來合約風險**：`mergeCustomVideos` 採 `triggers: string[] | '*'`，若多租戶 UI 真實需求超出此模型（例如「依 ageGroup 套用一組影片」），需發 v2 合約。本 spec 接受此 churn 風險。

---

## 10. 後續工作（給 writing-plans skill）

**Plan 第一步**：量目前 `/result/` 與 `/workspace/result/` 的 island bundle gzip baseline 並寫回 §7.6 數字，再設 budget。

**步驟與依賴**：

1. 共用 `src/lib/education/schemas.ts`（zod 定義 + types）+ 把 `AGE_GROUPS_CDSA` 改 `as const` tuple。
   執行前先 `grep -rn AGE_GROUPS_CDSA src/` 列所有 consumer，確認沒有把它當 mutable array（`.push`/`splice`）使用；目前已知唯一 consumer 為 `NormsManager.svelte`（純 `{#each}` 迭代，相容）
2. `inapplicable-matrix.json` v1 + 與臨床顧問 sign-off **（hard gate，後續步驟在此之前不能 start）**
3. `trigger-derivation.ts` + 單元測試（← step 1）
4. `keywords.json` 全 123 reachable trigger，claude-code 產出（← step 2）
5. `scripts/build-video-index.ts` + 接 prebuild + 自身測試（← step 1）
6. `video-lookup.ts` + `mergeCustomVideos` 合約測試（← step 1, 5）
7. `scripts/curate-videos.ts`：兩階段 metadata + heuristics + 三態 verdict + channel-seeds resolution（← step 1, 4）
8. 分批跑 curate，**順序為硬性要求**：CDSS critical → CDSA refer → CDSS warning → CDSA monitor → CDSA domain anomaly → CDSS advisory；claude-code 複審 → 寫回 yaml。
   理由：(a) high-stakes 先做，覆蓋率達標即可早結束 / 早 release；(b) domain anomaly 排在 monitor 後是因為 domain anomaly 的 keywords 多依賴前面 triage 影片驗證過的詞彙；(c) advisory 最後因為內容多但風險低，可選擇性放棄。
9. 三個 UI 元件 + 元件測試（← step 6）
10. 整合進 4 個頁面 + 整合測試（← step 3, 6, 9）
11. `.github/workflows/validate-videos.yml` + 新建 `.github/workflows/ci.yml`（含 `index-consistency` job）
12. Lighthouse-CI 設定 + 通過驗收
