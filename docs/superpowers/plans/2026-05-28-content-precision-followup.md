# 衛教矩陣內容精準化 — 後續三件工作

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans。每件可獨立做，但建議順序 Task 1 → Task 2 → Task 3（後者依賴前者建立的工具與 pool 多樣性）。

## 接手前必讀：當前狀態（main `d4df41f`）

- 矩陣 **141 cells 全部 ≥1 影片**（validate 過）；catalog 135 verified videos。
- **0/20 → 6/20 真實 set 差異化**（falls/pain/delirium/nutrition/polypharmacy/cognition）。falls 最戲劇性：cfs2-6 預防衛教 vs cfs7-8 臥床護理完全不同。
- **`yt-dlp.ts` 預設帶 `--cookies-from-browser chrome:Default`** —— 突破 YouTube anti-bot 牆，search/metadata/subtitle 都可用。env `YT_DLP_COOKIES_FROM_BROWSER` 可覆寫（如 `firefox`、`chrome:Profile 1`）。
- **字幕已 commit 在 `src/data/video-subtitles/`**（28 vtt，內容資產持久化）；`scripts/curate/cache/` 是 curate runtime 暫存（gitignored）。
- **pain 文章已寫**（`src/data/education/pain-management.md`），掛 9 個 pain trigger。其餘域仍每域 1 篇文章共用。

**未完成的 3 件事**：
1. **細化 classifier 啃下剩 3 域**（comorbidity/continence/financial）
2. **補 cfs1-3 主動 band 影片** 進一步差異化
3. **多寫 articles per 域** per-CFS 拆篇（內容作業）

---

## Task 1: 細化 classifier 規則 — 啃下 comorbidity/continence/financial

**Goal**：這 3 域真實 set 差異化（目前 1/cell 共用同 5 支）。  
**根因**：新加的 cfs7-9 重度依賴片被「多重慢性病」「福利」「失禁」廣譜規則命中 → 分到 `ALL_CFS` band → 與既有片同 set。

**Files:**
- Modify: `scripts/curate/lib/cfs-band.ts`
- Test: `tests/curate/cfs-band.test.ts`
- Re-run: `scripts/curate/broadcast-domain-coverage.ts`

- [ ] **Step 1: 診斷現況** — 對 3 域，列每支影片的 title + 目前 classify band：

```bash
cd /Users/lightman/yao.care/smart-geri-cds
pnpm tsx -e "
import { loadVideoTexts } from './scripts/curate/lib/video-text';
import { classifyCfsBands } from './scripts/curate/lib/cfs-band';
import yaml from 'js-yaml';
import fs from 'node:fs/promises';
const main = async () => {
  const texts = await loadVideoTexts();
  const cr = yaml.load(await fs.readFile('src/data/education/content-relevance.yaml','utf8')) as any;
  for (const dom of ['physical.comorbidity','physical.continence','social.financial']) {
    console.log(\`\\n=== \${dom} 池內所有影片 ===\`);
    const ids = new Set<string>();
    for (const t of cr.triggers) {
      if (t.trigger.includes(dom)) for (const id of t.videoIds||[]) ids.add(id);
    }
    for (const vid of ids) {
      const bands = [...classifyCfsBands(texts.get(vid)||'')].sort();
      const txt = (texts.get(vid)||'').slice(0,80);
      console.log(\`  \${vid} bands=[\${bands.join(',')}] | \${txt}\`);
    }
  }
};
main();
"
```

- [ ] **Step 2: 規則細化建議**（先驗 Step 1 結果再決定具體值）：

| 現規則 | 問題 | 細化方向 |
|---|---|---|
| `多重慢性病 \| 整合門診` → ALL_CFS | 在宅醫療失能片被吃 | 拆：「多重慢性病 + 失能/在宅醫療」→ cfs6-9；單純「多重慢性病」→ cfs3-7 |
| `經濟 \| 福利` → ALL_CFS | 長照經濟弱勢片被吃 | 拆：「長照 + 經濟/弱勢/補助」→ cfs5-9；單純「福利/老人健保」→ cfs1-9 |
| 失禁無專屬規則 | 失禁護理片落 fallback | 加：「失禁 + 護理/換尿片/尿管」→ cfs7-9；「失禁 + 預防/骨盆底肌/運動」→ cfs3-6 |

- [ ] **Step 3: 寫失敗測試先** — 為新規則加 3 個測試到 `tests/curate/cfs-band.test.ts`（rule 細化的預期 band）。

- [ ] **Step 4: 改 cfs-band.ts**，加細化規則（注意：規則順序由具體到廣譜；新規則插在現有「廣譜慢病」之前）。

- [ ] **Step 5: 跑測試 + broadcast 重檢**：

```bash
pnpm vitest run tests/curate/
pnpm tsx scripts/curate/broadcast-domain-coverage.ts
# 真實 set 差異化檢查
python3 -c "
import yaml
from collections import defaultdict
cr=yaml.safe_load(open('src/data/education/content-relevance.yaml'))
by_dom=defaultdict(list)
for t in cr['triggers']:
    if not t['trigger'].startswith('cga.domain.'): continue
    p=t['trigger'].split('.')
    by_dom[p[2]+'.'+p[3]].append(frozenset(t.get('videoIds') or []))
diff=sum(1 for cs in by_dom.values() if len(set(cs))>1)
print(f'真實 set 差異化 {diff}/{len(by_dom)} 領域')
for dom,cs in sorted(by_dom.items()):
    if len(set(cs))>1: print(f'  ✅ {dom}: {len(set(cs))} sets')
"
```

- [ ] **Step 6: 四關卡 + commit + deploy**（gate 命令見 §共用 pipeline）。預期 9/20 真實差異化（多 3 個）。

- [ ] **Step 7: playwright UI 抽驗** comorbidity 列 cfs2 vs cfs8 看到不同影片（command 見 §共用 pipeline）。

---

## Task 2: 補 cfs1-3 主動 band 影片 — 三層差異化（健壯/中度/重度）

**Goal**：每域 cfs1-3 主動健康老化、cfs4-6 中段、cfs7-9 重度 三層各有專屬影片。  
**前提**：Task 1 完成（classifier 已能區分 cfs1-3）。

**Files:**
- Modify: `scripts/curate/keywords.json`（加 cfs2 keyword group）

- [ ] **Step 1: 為 20 個域加 cfs2 主動 band keyword**（已有 cfs3-5 為 mid、cfs7 為重度；加 cfs2 為主動健壯）。範例 keyword（依域微調）：

```jsonc
// 通用 pattern：高齡 / 活躍 / 預防 / 60-90歲 + domain topic
"cga.domain.functional.mobility.anomaly.cfs2": {
  "primary": ["活躍長者 健走 衛教", "高齡 平衡訓練 預防", "60歲 70歲 退休 體能"],
  "secondary": ["active aging walking elderly", "balance training prevention"],
  "minDuration": 120, "maxDuration": 1800, "timeSensitive": false
},
"cga.domain.psychological.cognition.anomaly.cfs2": {
  "primary": ["健康老化 認知保健", "活躍長者 腦力訓練", "退休後 大腦健康 預防失智"],
  "secondary": ["healthy aging cognitive prevention"], ...
},
"cga.domain.psychological.mood.anomaly.cfs2": {
  "primary": ["退休 心理健康 衛教", "活躍長者 社交 情緒"],
  "secondary": ["retired mental health social"], ...
},
// ...其餘 17 域類推
```

- [ ] **Step 2: curate 全跑（cookies 不限流，~30 分鐘）**：

```bash
# 只跑新加的 20 個 cfs2 triggers
for T in $(jq -r 'keys[]' scripts/curate/keywords.json | grep "\.cfs2$"); do
  echo "=== $T ==="
  pnpm curate:videos --trigger "$T" 2>&1 | tail -2
done
```

- [ ] **Step 3: 抽看候選對題性**（避免再次拿到雜訊片）：

```bash
for T in $(ls scripts/curate/reports/*cfs2.md | head); do
  echo "── $T ──"
  grep -E "^## Candidate:|- channel:" "$T" | sed 's/^## Candidate: /▶ /'
done
```

- [ ] **Step 4: incorporate + broadcast + 驗收**：

```bash
pnpm tsx scripts/curate/incorporate-approved.ts --verified-by claude-code
pnpm tsx scripts/curate/broadcast-domain-coverage.ts
pnpm tsx scripts/build-content-index.ts
pnpm tsx scripts/curate/validate-cell-coverage.ts
# 真實 set check（同 Task 1 Step 5）
```

- [ ] **Step 5: 四關卡 + commit + deploy**。預期 15+/20 真實差異化（cfs1-3 / cfs4-6 / cfs7-9 三層大致都分得開）。

- [ ] **Step 6: playwright 確認** — 抽 3 域看 cfs2 vs cfs5 vs cfs8 三個 cell 是否分別拿到不同片。

---

## Task 3: 多寫 articles per 域 — per-CFS 文章拆篇

**Goal**：解掉「每域 1 篇文章、所有 CFS 共用」問題（pain 已有 pain-management，是唯一例外）。  
**性質**：內容作業，依賴臨床知識；要 grounded in real guidelines（BGS/AGS/Taiwan 衛福部 etc.），**禁止杜撰**。

**Files:**
- Create: `src/data/education/*.md`（每篇遵循 fall-prevention.md 結構）
- Modify: `src/data/education/content-relevance.yaml`（接 article 到對應 cfs-band triggers）

### 建議拆篇清單（每域 +1-2 篇，焦點 cfs7-9 末期/重度）

| 域 | 既有 | 加寫 (cfs band) |
|---|---|---|
| falls | fall-prevention | falls-bedridden-care (cfs7-9 翻身/壓瘡/中風後) |
| cognition | cognitive-training | dementia-mid-care (cfs5-7 失智中期) + dementia-late-stage (cfs8-9 失智晚期) |
| pain | pain-management | （已涵蓋全 cfs，可保留）— 或加 pain-painad (cfs7-9 失智疼痛行為觀察) |
| nutrition | geriatric-nutrition | nutrition-end-of-life (cfs8-9 末期營養支持) |
| mobility | （無？）| mobility-active (cfs2-4) + mobility-bedridden (cfs7-9) |
| caregiver | caregiver-support | caregiver-burnout (cfs7-9 重度照顧) |
| ... | ... | ... |

### 每篇 article 步驟

- [ ] **Step a: 寫 .md（grounded）** — 結構：frontmatter (title/summary/category/format/publishedAt/locale) + 為什麼重要 → 評估/紅旗 → 處理策略 → 何時就醫。參考 `src/data/education/fall-prevention.md` 與 `pain-management.md`。

- [ ] **Step b: 接到 trigger** — Python 編輯 content-relevance.yaml，對該 cfs-band 的 triggers 加 article (browse:true + severities:[monitor,refer])。範例：

```python
for t in cr['triggers']:
    if 'cga.domain.functional.falls.anomaly' in t['trigger']:
        cfs = t['trigger'].rsplit('.cfs',1)[1]
        # cfs7-9 換成 bedridden care
        if cfs in ('7','8','9'):
            t['articles'] = [{'slug':'falls-bedridden-care','browse':True,'severities':['monitor','refer']}]
        else:
            t['articles'] = [{'slug':'fall-prevention','browse':True,'severities':['monitor','refer']}]
```

- [ ] **Step c: build + 矩陣 UI 抽驗**：對應 CFS cell 顯示新 article。

- [ ] **Step d: commit + deploy**.

---

## §共用 Pipeline 與檢驗命令

### 完整重跑（從 keywords 改起）

```bash
cd /Users/lightman/yao.care/smart-geri-cds
# 1. (optional) 擴 keywords
$EDITOR scripts/curate/keywords.json

# 2. curate（cookies 不限流，每 trigger ~30-90s）
pnpm curate:videos --trigger <full trigger string>
# 或全跑：pnpm curate:videos

# 3. incorporate
pnpm tsx scripts/curate/incorporate-approved.ts --verified-by claude-code

# 4. broadcast per-cell selection
pnpm tsx scripts/curate/broadcast-domain-coverage.ts

# 5. coverage validate (每格 ≥1)
pnpm tsx scripts/curate/validate-cell-coverage.ts

# 6. rebuild runtime index
pnpm tsx scripts/build-content-index.ts

# 7. 四關卡
pnpm check && pnpm lint --max-warnings 10 && pnpm vitest run && pnpm build
```

### 真實 set 差異化檢查（每次 broadcast 後跑）

```bash
python3 -c "
import yaml
from collections import defaultdict
cr=yaml.safe_load(open('src/data/education/content-relevance.yaml'))
by_dom=defaultdict(list)
for t in cr['triggers']:
    if not t['trigger'].startswith('cga.domain.'): continue
    p=t['trigger'].split('.')
    by_dom[p[2]+'.'+p[3]].append(frozenset(t.get('videoIds') or []))
diff=sum(1 for cs in by_dom.values() if len(set(cs))>1)
print(f'{diff}/{len(by_dom)} 領域真實 set 差異化')
for dom,cs in sorted(by_dom.items()):
    print(f'  {\"✅\" if len(set(cs))>1 else \"·\"} {dom}: {len(set(cs))} sets')
"
```

### Playwright UI 抽驗（取代僅信 script）

```bash
# 起 preview
pnpm build && pkill -f "astro preview" 2>/dev/null; sleep 1
nohup pnpm preview > /tmp/p.log 2>&1 & sleep 5
# 開瀏覽器（用 playwright MCP；或啟 chrome 看 http://localhost:4321/education/）
```

Playwright JS：抽某域不同 CFS cell 的實際 youtubeIds：

```js
(async()=>{
  await new Promise(r=>setTimeout(r,1500));
  const rows=[...document.querySelectorAll('table tr')];
  const out={};
  for(const tr of rows){
    const head=(tr.querySelector('th,td')||{}).innerText||'';
    const L=head.trim().split('\n')[0];
    if(!['平衡跌倒','多重共病','疼痛'].includes(L)) continue;  // 改成想看的域
    const cells=[...tr.querySelectorAll('td')];
    out[L]={};
    cells.forEach((c,i)=>{
      const yts=[...c.querySelectorAll('a[href*="youtu"]')].map(a=>{
        const m=a.href.match(/[?&]v=([A-Za-z0-9_-]{11})|youtu\.be\/([A-Za-z0-9_-]{11})/);
        return m?(m[1]||m[2]):null;
      }).filter(Boolean);
      if(yts.length) out[L]['cfs'+(i+1)]=yts;
    });
  }
  return JSON.stringify(out,null,1);
})();
```

### Commit + deploy 流程

```bash
git checkout -b <branch-name>
git add -A
git commit -q -m "<message>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git checkout main
git merge --no-ff <branch-name> -m "<merge-message>

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
git push origin main
gh workflow run deploy.yml --ref main
sleep 10; runid=$(gh run list --workflow=deploy.yml -L 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$runid" --exit-status --interval 15
```

---

## Key Files Reference

| 檔案 | 用途 |
|---|---|
| `scripts/curate/lib/yt-dlp.ts` | yt-dlp wrapper，預設 chrome:Default cookies（突破 anti-bot） |
| `scripts/curate/lib/cfs-band.ts` | 影片 → CFS band 分類器（**Task 1 修這裡**） |
| `scripts/curate/lib/coverage.ts` | `selectPerCellVideos`（per-cell 選片邏輯） |
| `scripts/curate/lib/video-text.ts` | 整合 catalog title+channel、report description、字幕內容 |
| `scripts/curate/keywords.json` | 各 trigger 的搜尋關鍵字（**Task 2 加 cfs2 在這**） |
| `scripts/curate/broadcast-domain-coverage.ts` | per-cell 選片 CLI |
| `scripts/curate/validate-cell-coverage.ts` | 矩陣覆蓋驗收（141/141） |
| `scripts/curate/incorporate-approved.ts` | reports → catalog + content-relevance（`--verified-by claude-code`） |
| `src/data/education/content-relevance.yaml` | 單一真相源（triggers, inapplicable, articles） |
| `src/data/video-catalog/*.yaml` | verified videos |
| `src/data/video-subtitles/*.vtt` | 字幕資產（committed） |
| `src/data/education/*.md` | 衛教文章（**Task 3 加在這**） |

---

## 已踩過的雷（別重犯）

1. **「排序差異」≠「真實 set 差異化」**。檢查時必用 `frozenset` 比較，不是 tuple/list。
2. **小樣本誤導**：別用「pick 3 domain」推全 20 域狀況，全掃才準。
3. **池子同質就無解**：classifier/select 演算法不能變魔法，必須先補 band-specific 影片進 pool。
4. **YouTube anti-bot 牆**：必用 `--cookies-from-browser`；yt-dlp.ts 已內建 chrome:Default，env `YT_DLP_COOKIES_FROM_BROWSER` 可覆寫。
5. **subtitleType:'none' 不等於真的沒字幕**：可能當時 yt-dlp 抓不到（rate-limit/anti-bot）。
6. **字幕別 commit 到 cache/**：那是 gitignored runtime 暫存；committed asset 放 `src/data/video-subtitles/`。
7. **新影片標 `verifiedBy:claude-code`** 並加 `notes` 標未臨床審核（待人工抽查），保留 manual 給人工核可批次。
8. **報告寫不出來才會偷懶**：實際抽查多筆、看真實內容，不要憑「應該」。

---

## 驗證期望

| 指標 | 當前 | Task 1 完成後 | Task 2 完成後 | Task 3 完成後 |
|---|---|---|---|---|
| validate 覆蓋 | 141/141 | 141/141 | 141/141 | 141/141 |
| 真實 set 差異化（影片） | 6/20 | 9/20 | 15+/20 | 同 Task 2 |
| Articles per 域 | 1（pain 唯一 cfs-specific） | 同 | 同 | 多域有 2+ 篇分 cfs band |
| vitest | 357 pass | + Task 1 新測試 | 同 | 同 |
