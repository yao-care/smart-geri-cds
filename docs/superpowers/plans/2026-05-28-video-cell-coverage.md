# 矩陣每格至少一支影片 — 覆蓋補齊計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 衛教矩陣 132 個適用格（`cga.domain.<top>.<sub>.anomaly.<cfs>`，`inapplicable:false`）每格至少掛 1 支已驗證影片。

**Architecture:** 兩路並行。① 廣播：14 個已有片領域，把每領域影片聯集（依 catalog `score` 排序、上限 5）攤到該領域所有適用 CFS trigger（純資料轉換、沿用已核可影片）。② 新抓：6 個全空領域（comorbidity / pain / iadl / financial / accessibility / treatment_preferences）以 yt-dlp 抓取，`incorporate-approved` 新增 `--verified-by claude-code` 旗標標記為自動策劃（未臨床審核），再由廣播一併攤開。最後對 build 後的 `video-index.json` 驗收每格 ≥1 支。

**Tech Stack:** TypeScript + tsx 腳本、js-yaml、yt-dlp（`scripts/curate/lib/yt-dlp.ts`）、Vitest、既有 `scripts/curate-videos.ts` / `incorporate-approved.ts` / `build-content-index.ts`。

**關鍵事實（已驗證，勿再猜）：**
- `videoCatalogItemSchema.verifiedBy = z.enum(['claude-code','manual'])`、`verificationStatus = z.enum(['verified','rejected'])`、`score ∈ [0,1]`（`src/lib/education/schemas.ts:16-33`）。
- `build-content-index.ts` 只把 `verificationStatus==='verified'` 的影片納入；trigger 的 `videoIds` 再 filter 必須存在於 verified catalog（L127-129, L184）。
- content-relevance.yaml：`inapplicable{ "top.sub": cfs[] }` + `triggers[{trigger, articles[], videoIds[]}]`，共 132 個 domain trigger。
- video-catalog 非 Astro content collection，由腳本直讀。
- 廣播只會填「已存在於 `triggers` 清單」的格；132 格皆已存在。

---

## File Structure

- `scripts/curate/lib/coverage.ts`（新增）— 純函式：`domainOf` / `broadcastDomainVideos` / `uncoveredDomainCells`，可單測、無 IO。
- `tests/curate/coverage.test.ts`（新增）— coverage 純函式單測。
- `scripts/curate/broadcast-domain-coverage.ts`（新增）— CLI：讀 content-relevance + catalog 分數 → 套用 `broadcastDomainVideos` → 寫回（保留 header 註解）。
- `scripts/curate/validate-cell-coverage.ts`（新增）— CLI：build index（write:false）→ 斷言每個 `inapplicable:false` trigger ≥1 videoId，否則 exit 1 並列出缺格。
- `scripts/curate/incorporate-approved.ts`（修改）— 加 `--verified-by` 旗標（預設 `manual`）。
- `scripts/curate/keywords.json`（修改）— 新增 6 個空領域 trigger 的 KeywordSpec。

---

### Task 1: coverage 純函式（廣播 + 缺格偵測）

**Files:**
- Create: `scripts/curate/lib/coverage.ts`
- Test: `tests/curate/coverage.test.ts`

- [ ] **Step 1: 寫失敗測試**

```ts
// tests/curate/coverage.test.ts
import { describe, it, expect } from 'vitest';
import { domainOf, broadcastDomainVideos, uncoveredDomainCells, type TriggerEntry } from '../../scripts/curate/lib/coverage';

describe('domainOf', () => {
  it('擷取 top.sub', () => {
    expect(domainOf('cga.domain.functional.falls.anomaly.cfs3')).toBe('functional.falls');
  });
  it('非 domain trigger 回 null', () => {
    expect(domainOf('cga.triage.refer.cfs5')).toBeNull();
    expect(domainOf('cdss.alert.sugar_intake.warning')).toBeNull();
  });
});

describe('broadcastDomainVideos', () => {
  const triggers: TriggerEntry[] = [
    { trigger: 'cga.domain.functional.falls.anomaly.cfs3', articles: [], videoIds: ['aaaaaaaaaaa', 'bbbbbbbbbbb'] },
    { trigger: 'cga.domain.functional.falls.anomaly.cfs5', articles: [], videoIds: ['ccccccccccc'] },
    { trigger: 'cga.domain.functional.falls.anomaly.cfs7', articles: [], videoIds: [] },
    { trigger: 'cga.domain.physical.pain.anomaly.cfs4', articles: [], videoIds: [] },
  ];
  const scores = { aaaaaaaaaaa: 0.9, bbbbbbbbbbb: 0.5, ccccccccccc: 0.7 };

  it('把同領域聯集依分數排序攤到所有該領域 trigger', () => {
    const out = broadcastDomainVideos(triggers, scores, 5);
    const byT = Object.fromEntries(out.map(t => [t.trigger, t.videoIds]));
    // 聯集 {aaa,bbb,ccc} 依分數 desc：aaa(0.9) > ccc(0.7) > bbb(0.5)
    expect(byT['cga.domain.functional.falls.anomaly.cfs3']).toEqual(['aaaaaaaaaaa', 'ccccccccccc', 'bbbbbbbbbbb']);
    expect(byT['cga.domain.functional.falls.anomaly.cfs5']).toEqual(['aaaaaaaaaaa', 'ccccccccccc', 'bbbbbbbbbbb']);
    expect(byT['cga.domain.functional.falls.anomaly.cfs7']).toEqual(['aaaaaaaaaaa', 'ccccccccccc', 'bbbbbbbbbbb']);
  });

  it('全空領域（pain 無任何片）維持空、不杜撰', () => {
    const out = broadcastDomainVideos(triggers, scores, 5);
    const byT = Object.fromEntries(out.map(t => [t.trigger, t.videoIds]));
    expect(byT['cga.domain.physical.pain.anomaly.cfs4']).toEqual([]);
  });

  it('cap 限制每格數量、取分數最高者', () => {
    const out = broadcastDomainVideos(triggers, scores, 2);
    const byT = Object.fromEntries(out.map(t => [t.trigger, t.videoIds]));
    expect(byT['cga.domain.functional.falls.anomaly.cfs3']).toEqual(['aaaaaaaaaaa', 'ccccccccccc']);
  });

  it('不變動輸入陣列', () => {
    const snapshot = JSON.parse(JSON.stringify(triggers));
    broadcastDomainVideos(triggers, scores, 5);
    expect(triggers).toEqual(snapshot);
  });
});

describe('uncoveredDomainCells', () => {
  it('列出仍為空的 domain 格', () => {
    const triggers: TriggerEntry[] = [
      { trigger: 'cga.domain.functional.falls.anomaly.cfs3', articles: [], videoIds: ['aaaaaaaaaaa'] },
      { trigger: 'cga.domain.physical.pain.anomaly.cfs4', articles: [], videoIds: [] },
    ];
    expect(uncoveredDomainCells(triggers)).toEqual(['cga.domain.physical.pain.anomaly.cfs4']);
  });
});
```

- [ ] **Step 2: 跑測試確認 fail**

Run: `pnpm vitest run tests/curate/coverage.test.ts`
Expected: FAIL（`coverage` 模組不存在 / 函式未定義）。

- [ ] **Step 3: 實作 coverage.ts**

```ts
// scripts/curate/lib/coverage.ts
export interface TriggerEntry {
  trigger: string;
  articles: unknown[];
  videoIds: string[];
  [k: string]: unknown;
}

/** 解析 cga.domain.<top>.<sub>.anomaly.<cfs> → "top.sub"；非 domain trigger → null。 */
export function domainOf(trigger: string): string | null {
  const m = trigger.match(/^cga\.domain\.([^.]+)\.([^.]+)\.anomaly\.[^.]+$/);
  return m ? `${m[1]}.${m[2]}` : null;
}

/**
 * 每個 domain：聯集其所有 trigger 的 videoIds，依 catalog score 降冪（同分 videoId 升冪）
 * 排序、取前 cap 支，套到該 domain 的「每一個」trigger。非 domain trigger 原樣保留。
 * 回傳新陣列，不變動輸入。
 */
export function broadcastDomainVideos(
  triggers: TriggerEntry[],
  scores: Record<string, number>,
  cap = 5,
): TriggerEntry[] {
  const byDomain = new Map<string, Set<string>>();
  for (const t of triggers) {
    const d = domainOf(t.trigger);
    if (!d) continue;
    const set = byDomain.get(d) ?? new Set<string>();
    for (const id of t.videoIds) set.add(id);
    byDomain.set(d, set);
  }
  const rankedByDomain = new Map<string, string[]>();
  for (const [d, set] of byDomain) {
    const ranked = [...set]
      .sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || a.localeCompare(b))
      .slice(0, cap);
    rankedByDomain.set(d, ranked);
  }
  return triggers.map(t => {
    const d = domainOf(t.trigger);
    if (!d) return t;
    return { ...t, videoIds: rankedByDomain.get(d) ?? t.videoIds };
  });
}

/** 仍為空（videoIds 長度 0）的 domain trigger 清單。 */
export function uncoveredDomainCells(triggers: TriggerEntry[]): string[] {
  return triggers
    .filter(t => domainOf(t.trigger) !== null && t.videoIds.length === 0)
    .map(t => t.trigger);
}
```

- [ ] **Step 4: 跑測試確認 pass**

Run: `pnpm vitest run tests/curate/coverage.test.ts`
Expected: PASS（全綠）。

- [ ] **Step 5: Commit**

```bash
git add scripts/curate/lib/coverage.ts tests/curate/coverage.test.ts
git commit -m "feat(curate): coverage 純函式（domain 影片廣播 + 缺格偵測）"
```

---

### Task 2: broadcast CLI（把廣播套到 content-relevance）

**Files:**
- Create: `scripts/curate/broadcast-domain-coverage.ts`

- [ ] **Step 1: 實作 CLI**（純函式已測；CLI 為薄 IO 包裝，讀 catalog 分數 + content-relevance，套用後寫回保留 header）

```ts
// scripts/curate/broadcast-domain-coverage.ts
#!/usr/bin/env tsx
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';
import fg from 'fast-glob';
import { broadcastDomainVideos, uncoveredDomainCells, type TriggerEntry } from './lib/coverage.js';

const RELEVANCE = 'src/data/education/content-relevance.yaml';
const CATALOG_DIR = 'src/data/video-catalog';
const CAP = 5;

async function loadVerifiedScores(): Promise<Record<string, number>> {
  const scores: Record<string, number> = {};
  for (const fp of (await fg(`${CATALOG_DIR}/*.yaml`)).sort()) {
    const arr = (yaml.load(await fs.readFile(fp, 'utf8')) as any[]) ?? [];
    for (const v of arr) {
      if (v?.videoId && v.verificationStatus === 'verified') scores[v.videoId] = v.score ?? 0;
    }
  }
  return scores;
}

async function main(): Promise<void> {
  const raw = await fs.readFile(RELEVANCE, 'utf8');
  const headerEnd = raw.indexOf('\ninapplicable:');
  const header = headerEnd > 0 ? raw.slice(0, headerEnd + 1) : '';
  const data = yaml.load(raw) as {
    inapplicable: unknown;
    triggers: TriggerEntry[];
    clinicalAlertEducation: unknown;
  };

  // 只廣播 verified catalog 內的影片（與 build-content-index 過濾一致），
  // 避免把已下架/rejected 的 id 攤到更多格、製造假覆蓋。
  const scores = await loadVerifiedScores();
  const verified = new Set(Object.keys(scores));
  for (const t of data.triggers) t.videoIds = (t.videoIds ?? []).filter(id => verified.has(id));

  data.triggers = broadcastDomainVideos(data.triggers, scores, CAP);

  const body = yaml.dump(data, { lineWidth: 120, noRefs: true });
  await fs.writeFile(RELEVANCE, header + (header ? '\n' : '') + body);

  const stillEmpty = uncoveredDomainCells(data.triggers);
  const total = data.triggers.filter(t => /^cga\.domain\./.test(t.trigger)).length;
  console.log(`廣播完成：${total} 個 domain 格，仍空 ${stillEmpty.length} 格`);
  if (stillEmpty.length) console.log(`仍空（需新抓）：\n  ${stillEmpty.join('\n  ')}`);
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 乾跑驗證（先只廣播既有，觀察仍空清單）**

Run: `pnpm tsx scripts/curate/broadcast-domain-coverage.ts`
Expected: 印出仍空清單＝6 個領域的格（comorbidity / pain / iadl / financial / accessibility / treatment_preferences 各自的 CFS 格）。確認 14 領域已被攤滿。

- [ ] **Step 3: 重建 index 觀察覆蓋躍升**

Run: `pnpm tsx scripts/build-content-index.ts`
Expected: `triggers with videoIds` 由 18 → 14 領域的適用格總數（約 100 格），尚缺 6 領域。

- [ ] **Step 4: Commit**

```bash
git add scripts/curate/broadcast-domain-coverage.ts src/data/education/content-relevance.yaml public/data/video-index.json src/lib/education/clinical-education.generated.ts
git commit -m "feat(curate): broadcast CLI — 既有影片攤到同領域所有 CFS 格"
```

---

### Task 3: validate CLI（驗收每格 ≥1 支）

**Files:**
- Create: `scripts/curate/validate-cell-coverage.ts`

- [ ] **Step 1: 實作驗收 CLI（對 build 後 index 檢查，非 raw yaml）**

```ts
// scripts/curate/validate-cell-coverage.ts
#!/usr/bin/env tsx
import { buildContentIndex } from '../build-content-index.js';

async function main(): Promise<void> {
  const index = await buildContentIndex({ write: false });
  const empty = Object.entries(index.triggers)
    .filter(([k, t]) => /^cga\.domain\./.test(k) && !t.inapplicable && t.videoIds.length === 0)
    .map(([k]) => k);
  const applicable = Object.entries(index.triggers)
    .filter(([k, t]) => /^cga\.domain\./.test(k) && !t.inapplicable).length;
  console.log(`適用 domain 格 ${applicable}，有片 ${applicable - empty.length}，缺 ${empty.length}`);
  if (empty.length) {
    console.error(`✗ 仍有空格：\n  ${empty.join('\n  ')}`);
    process.exit(1);
  }
  console.log('✓ 每個適用格皆 ≥1 支已驗證影片');
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: 跑（此時應 fail，列出 6 領域缺格）**

Run: `pnpm tsx scripts/curate/validate-cell-coverage.ts`
Expected: exit 1，列出 comorbidity / pain / iadl / financial / accessibility / treatment_preferences 的缺格。

- [ ] **Step 3: Commit**

```bash
git add scripts/curate/validate-cell-coverage.ts
git commit -m "feat(curate): validate CLI — 驗收矩陣每格 ≥1 支影片"
```

---

### Task 4: incorporate-approved 加 `--verified-by` 旗標

**Files:**
- Modify: `scripts/curate/incorporate-approved.ts`

- [ ] **Step 1: 加 CLI 解析 + 套到 catalog 寫入**（預設 `manual`，本次新抓用 `claude-code`）

於檔案頂部 import 後加：

```ts
import { parseArgs } from 'node:util';
const { values: cliArgs } = parseArgs({ options: { 'verified-by': { type: 'string' } } });
const VERIFIED_BY: 'manual' | 'claude-code' = cliArgs['verified-by'] === 'claude-code' ? 'claude-code' : 'manual';
```

把 `CatalogEntry.verifiedBy` 型別由 `'manual'` 改為 `'manual' | 'claude-code'`；catalog 寫入處 `verifiedBy: 'manual'` 改為 `verifiedBy: VERIFIED_BY`，並於 `notes` 標註自動策劃：

```ts
catalog.set(videoId, {
  // …既有欄位不變…
  verifiedBy: VERIFIED_BY, verificationStatus: 'verified', score: c.score,
  ...(VERIFIED_BY === 'claude-code' ? { notes: `auto-curated ${TODAY}；未臨床審核，待抽查` } : {}),
});
```

> 既存 catalog 內的 18 報告影片為 idempotent skip（L99），不受影響、仍為 `manual`。只有本次新抓的 6 領域影片標 `claude-code`。

- [ ] **Step 2: 型別/語法檢查**

Run: `pnpm exec tsc --noEmit -p tsconfig.json` 或 `pnpm check`
Expected: 0 errors。

- [ ] **Step 3: Commit**

```bash
git add scripts/curate/incorporate-approved.ts
git commit -m "feat(curate): incorporate 加 --verified-by 旗標（自動策劃標 claude-code）"
```

---

### Task 5: 6 空領域關鍵字 + yt-dlp 抓取

**Files:**
- Modify: `scripts/curate/keywords.json`

- [ ] **Step 1: 新增 6 個 KeywordSpec**（繁中高齡衛教搜尋詞；trigger 取各領域一個適用 CFS，廣播會攤開）

加入下列 6 鍵（沿用既有條目格式：primary/secondary/educationSlug?/minDuration/maxDuration/timeSensitive）：

```json
"cga.domain.physical.comorbidity.anomaly.cfs3": {
  "primary": ["多重慢性病 長者 衛教", "高齡 共病 自我管理", "老年 慢性病 整合照護"],
  "secondary": ["multimorbidity older adults management", "chronic disease self management elderly"],
  "minDuration": 120, "maxDuration": 1800, "timeSensitive": false
},
"cga.domain.physical.pain.anomaly.cfs4": {
  "primary": ["老年 慢性疼痛 衛教", "長者 疼痛 評估 處理", "高齡 疼痛管理 非藥物"],
  "secondary": ["chronic pain management older adults", "geriatric pain assessment"],
  "minDuration": 120, "maxDuration": 1800, "timeSensitive": false
},
"cga.domain.functional.iadl.anomaly.cfs4": {
  "primary": ["長者 獨立生活能力 衛教", "高齡 工具性日常活動 維持", "老人 居家自我照顧 能力"],
  "secondary": ["instrumental activities daily living elderly", "IADL older adults independence"],
  "minDuration": 120, "maxDuration": 1800, "timeSensitive": false
},
"cga.domain.social.financial.anomaly.cfs3": {
  "primary": ["長者 經濟安全 社會福利", "高齡 財務詐騙 預防", "老人 福利補助 申請"],
  "secondary": ["financial security older adults", "elder financial abuse prevention"],
  "minDuration": 120, "maxDuration": 1800, "timeSensitive": false
},
"cga.domain.environmental.accessibility.anomaly.cfs4": {
  "primary": ["長者 就醫 交通協助", "高齡 無障礙 居家環境", "老人 醫療可近性 社區資源"],
  "secondary": ["accessibility older adults healthcare", "age friendly environment mobility"],
  "minDuration": 120, "maxDuration": 1800, "timeSensitive": false
},
"cga.domain.future_wishes.treatment_preferences.anomaly.cfs5": {
  "primary": ["病人自主權利法 長者", "預立醫療決定 治療意願", "末期 醫療 安寧 意願"],
  "secondary": ["treatment preferences advance directive", "patient autonomy end of life"],
  "minDuration": 120, "maxDuration": 1800, "timeSensitive": false
}
```

- [ ] **Step 2: 逐 trigger 抓取（背景、rate-limit 容忍）**

逐一執行（rate-limit 時退避重試，不平行）：

```bash
for T in \
  cga.domain.physical.comorbidity.anomaly.cfs3 \
  cga.domain.physical.pain.anomaly.cfs4 \
  cga.domain.functional.iadl.anomaly.cfs4 \
  cga.domain.social.financial.anomaly.cfs3 \
  cga.domain.environmental.accessibility.anomaly.cfs4 \
  cga.domain.future_wishes.treatment_preferences.anomaly.cfs5 ; do
  pnpm curate:videos --trigger "$T" || echo "RETRY-LATER $T"
done
```

Expected: `scripts/curate/reports/` 新增 6 份報告，各含 1–5 候選。若某 trigger `NO_CANDIDATES` 或被限流 → 換關鍵字或稍後重跑該 trigger，直到有候選。

- [ ] **Step 3: 確認 6 份新報告皆有候選**

Run: `for T in <上列6個>; do echo -n "$T: "; grep -c "## Candidate:" "scripts/curate/reports/$T.md" 2>/dev/null || echo 0; done`
Expected: 每個 ≥1。任一為 0 → 回 Step 2 調整關鍵字重抓。

- [ ] **Step 4: Commit 關鍵字**

```bash
git add scripts/curate/keywords.json
git commit -m "feat(curate): 6 空領域關鍵字（共病/疼痛/IADL/經濟/可近性/治療偏好）"
```

---

### Task 6: 納入 + 廣播 + 驗收 + 部署

- [ ] **Step 1: 納入新抓影片（標 claude-code）**

Run: `pnpm tsx scripts/curate/incorporate-approved.ts --verified-by claude-code`
Expected: Summary 顯示新納入 ≈6–30 支（6 領域 ×1–5），18 報告影片 idempotent skip。失敗 id 重跑補抓。

- [ ] **Step 2: 廣播（把新影片攤到 6 領域所有 CFS 格）**

Run: `pnpm tsx scripts/curate/broadcast-domain-coverage.ts`
Expected: 仍空 0 格（或列出極少數 NO_CANDIDATES 領域 → 回 Task 5 補抓）。

- [ ] **Step 3: 重建 index + 驗收**

Run: `pnpm tsx scripts/build-content-index.ts && pnpm tsx scripts/curate/validate-cell-coverage.ts`
Expected: validate 印「✓ 每個適用格皆 ≥1 支」、exit 0。

- [ ] **Step 4: 四關卡全綠**

Run: `pnpm check && pnpm lint --max-warnings 10 && pnpm vitest run && pnpm build`
Expected: check 0 errors、lint 通過、vitest 全綠、build 成功（含 Content Layer 驗證 + 重建 index）。

- [ ] **Step 5: Commit + 合併 main + 部署**

```bash
git add src/data/video-catalog/*.yaml src/data/education/content-relevance.yaml public/data/video-index.json src/lib/education/clinical-education.generated.ts
git commit -m "feat(content): 6 空領域 yt-dlp 補片 + 廣播，矩陣每格 ≥1 支影片"
git checkout main && git merge --no-ff <branch> && git push origin main
gh workflow run deploy.yml --ref main
# watch run --exit-status
```

- [ ] **Step 6: Playwright 線上實測**

導航 `https://smart-geri-cds.yao.care/education/`（部署完成後），驗證先前全空的 6 領域（尤其 physical.pain、physical.comorbidity）在矩陣對應 CFS 格現在顯示影片連結（≥1）。截圖佐證。

---

## 非本計畫

- 影片臨床品質最終簽核（`verifiedBy: claude-code` 標記者待人工抽查／抽換）。
- 各 CFS 級的影片差異化排序（目前同領域共用同一組，依 score 排序；per-CFS 精排為日後 recommendation 引擎工作）。
- 既有 18 報告影片（`verifiedBy: manual`）的重新評分。
