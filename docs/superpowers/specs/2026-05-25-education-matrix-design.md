# 衛教資源矩陣 + 醫師共筆貢獻流程 — 設計文件

**日期**: 2026-05-25  
**狀態**: 已確認，待實作  
**相關**: `src/pages/education/`, `src/components/education/`, `workers/education-contribution/`

---

## 背景與問題

現有 `/education/` 頁面以混合 card grid 呈現文章和影片，存在以下問題：

1. 文章只顯示「長者、高齡」等粗略年齡標籤，不知對應哪個評估情境
2. 影片雖有觸發情境清單，但清單式呈現不易快速瀏覽全貌
3. 無法從頁面直接新增衛教資源，需手動編輯 YAML/MD 再送 PR
4. 年齡層 × 領域的完整覆蓋狀態無法一眼掌握

---

## 目標

1. **矩陣表**：一眼看出哪個「年齡層 × 發展領域」有哪些資源、哪些空缺
2. **整齊版面**：點格子展開，看到文章清單 + 影片縮圖卡
3. **醫師共筆**：在格子旁點「＋」→ 填表單 → 自動開 GitHub Issue，無需 GitHub 帳號

---

## 架構決策：方案 B — Astro SSG 矩陣 + Svelte 貢獻 Modal

矩陣在 build time 由 Astro 靜態產生，0 JS。貢獻表單是獨立的 Svelte island。

**選擇理由**：
- 符合現有 SSG 架構，不增加首頁 JS bundle
- 矩陣資料來源（`video-index.json` + Content Collections）在 build time 已知
- 貢獻流程才需要互動，獨立 island 邊界清晰

---

## 頁面結構

```
/education/index.astro
├── 矩陣表（Astro 靜態，0 JS）
│   ├── 行：8 個發展領域
│   ├── 欄：7 個 CDSA 年齡段
│   └── 每格：計數徽章 + <details> 展開 + ＋ 按鈕
├── ContributionModal.svelte（client:load）
│   └── 貢獻表單，向 Cloudflare Worker 送出
└── MatrixCustomRow.svelte（client:idle）
    └── 顯示 IndexedDB 自訂衛教（附加在矩陣下方）
```

---

## 矩陣維度

### 列：發展領域（8 個）

| 代碼 | 中文 |
|------|------|
| `behavior` | 行為 |
| `gross_motor` | 粗動作 |
| `fine_motor` | 細動作 |
| `language` | 語言 |
| `language_comprehension` | 語言理解 |
| `language_expression` | 語言表達 |
| `cognition` | 認知 |
| `social_emotional` | 社交情緒 |

### 欄：CDSA 年齡段（7 個）

`2-6m` | `7-12m` | `13-24m` | `25-36m` | `37-48m` | `49-60m` | `61-72m`

### 格子狀態

| 狀態 | 顯示 | 互動 |
|------|------|------|
| `inapplicable: true` | `—`（灰色） | 不可展開、無 ＋ |
| 有資源 | `📄N 🎬N`（計數徽章） | 可展開 + 有 ＋ |
| 無資源但可貢獻 | `（空白）＋` | 可展開空清單 + 有 ＋ |

---

## 格子展開內容（`<details>` accordion）

```
┌─────────────────────────────────────────┐
│  語言  ×  1-2歲 (13-24m)          [＋]  │
├─────────────────────────────────────────┤
│  📄 文章                                 │
│    • 語言發展促進技巧  →（/education/language-stimulation/）│
│                                         │
│  🎬 影片（3 支）                          │
│    • [縮圖] 照護共讀技巧  CH: 台灣老年醫學   │
│    • [縮圖] 語言刺激活動  CH: OT 頻道    │
│    • [縮圖] 長者說話發展  CH: 醫師說     │
│                                         │
│           ＋ 新增資源至此情境            │
└─────────────────────────────────────────┘
```

- 文章：文字連結，連往 `/education/[slug]/`
- 影片：小縮圖卡（`hqdefault.jpg`）+ 頻道 + 時長，點開新分頁 YouTube
- 「＋ 新增資源」帶入 `domain` + `ageGroup` 開啟 ContributionModal

---

## 貢獻 Modal 表單

### 欄位

| 欄位 | 必填 | 說明 |
|------|------|------|
| 資源類型 | ✓ | YouTube 影片 / Markdown 文章 / 外部連結 |
| 發展領域 | ✓ | 預填自格子，可修改 |
| 年齡段 | ✓ | 預填自格子，可修改 |
| YouTube URL | 影片必填 | 自動擷取 ID，顯示縮圖預覽 |
| 標題 | 文章/連結必填 | |
| 摘要 | 文章必填 | |
| 內容 | 文章必填 | Markdown textarea |
| URL | 連結必填 | |
| 補充說明 | 選填 | 為何適合此情境 |
| 提交者 | 選填 | 姓名 / 科別 |

### 送出流程

1. 前端 validate → POST `https://pedi-cds.yao-care.workers.dev/education-contribution`
2. Worker 驗證 origin → 用 GitHub App JWT 換 installation token → 建 issue
3. Issue 標題：`[衛教貢獻] {domain中文} × {age中文}｜{type}｜{title}`
4. Issue labels：`education-contribution`、`youtube` / `article` / `external-link`
5. Modal 顯示成功訊息 + issue URL

### Issue Body 格式

```markdown
## 衛教貢獻申請

**類型**: YouTube 影片
**年齡段**: 1-2歲 (13-24m)
**發展領域**: 語言 (language)

### 資源資訊

- YouTube URL: https://www.youtube.com/watch?v=xxxxxxx
- 標題: 照護共讀技巧
- 頻道: 台灣老年醫學醫學會

### 補充說明

> （提交者填寫的說明）

**提交者**: Dr. Chen，台大老年醫學  
**提交時間**: 2026-05-25T10:30:00Z

---

### 維護者操作區（請 copy-paste 至 YAML）

\`\`\`yaml
# 加入 src/data/education-videos/cdsa-domains.yaml
# 找到對應 trigger，將 videoId 加入 videoIds 清單：
# - trigger: cdsa.domain.language.anomaly.13-24m
#   videoIds:
#     - xxxxxxx   ← 貢獻的 YouTube video ID（11 碼）
\`\`\`
```

---

## Cloudflare Worker

### 目錄結構

```
workers/
└── education-contribution/
    ├── src/
    │   └── index.ts      # Worker 主體
    └── wrangler.toml     # 部署設定
```

### 端點

`POST https://<worker-name>.yao-care.workers.dev/education-contribution`

> Worker 名稱於 `wrangler.toml` 的 `name` 欄位設定，部署後實際 URL 待確認。

Request body（JSON）：

```typescript
{
  type: 'youtube' | 'article' | 'external-link';
  domain: string;       // e.g. 'language'
  ageGroup: string;     // e.g. '13-24m'
  url?: string;         // YouTube URL 或外部連結
  title?: string;
  summary?: string;
  content?: string;     // Markdown（文章用）
  notes?: string;
  submitter?: string;
}
```

Response：

```typescript
{ issueUrl: string }   // 成功
{ error: string }      // 失敗
```

### 環境變數（Cloudflare Secrets，不進 git）

| 名稱 | 取得方式 |
|------|----------|
| `GITHUB_APP_ID` | GitHub App 設定頁 → App ID |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App 設定頁 → Generate private key → base64 |
| `GITHUB_INSTALLATION_ID` | `GET /app/installations` API 查詢 |
| `ALLOWED_ORIGIN` | `https://yao-care.github.io`（Worker 回傳 CORS header 用） |

### Auth 流程

```
Worker 啟動
  → 用 GITHUB_APP_PRIVATE_KEY 簽 JWT（10 分鐘有效）
  → GET /app/installations/{GITHUB_INSTALLATION_ID}/access_tokens
  → 得到 installation token（1 小時有效）
  → POST /repos/yao-care/smart-geri-cds/issues
```

---

## 新增 / 修改的檔案清單

| 檔案 | 動作 | 說明 |
|------|------|------|
| `src/pages/education/index.astro` | 改寫 | 矩陣表取代原 card grid |
| `src/components/education/ContributionModal.svelte` | 新增 | 貢獻表單 island |
| `src/components/education/MatrixCustomRow.svelte` | 新增 | IndexedDB 自訂衛教顯示 |
| `workers/education-contribution/src/index.ts` | 新增 | Cloudflare Worker |
| `workers/education-contribution/wrangler.toml` | 新增 | Worker 部署設定 |

---

## 不在本次範圍

- 維護者審核 issue 後的 PR 自動化（手動 copy YAML → commit 即可）
- 影片 metadata 自動抓取（YouTube Data API）— 現行手動 curate 流程不變
- 自訂衛教的矩陣整合（`MatrixCustomRow` 只附加在矩陣下方，不嵌入格子）
