# 高齡周全性評估 CDS（smart-geri-cds）

開源的**高齡周全性評估（CGA）臨床決策輔助系統**，以 SMART on FHIR 標準運行於瀏覽器端。
零後端、部署於 GitHub Pages、支援 PWA 離線；CFS 分層 + 多領域量表的分流評估，所有運算皆在瀏覽器執行。

> 本專案由兒科 CDS（smart-pedi-cds）fork 改造而來。部分基建（closed-loop 預警 / webhook / ONNX ML worker）沿用自來源，**目前非高齡 CGA 主流程重點**，維護時以下方「核心流程」為準。

## 兩條使用路徑

- **民眾自我檢視** `/self-check/` — 白話題庫、TTS 朗讀、紅黃綠結果，純記憶體不持久化
- **專業評估** `/assess/` → `/result/`（可上傳至收案機構）→ 臨床工作區 `/workspace/`
  - 入口先定 **CFS 1–9** 分層 → 三層金字塔出題（triage 短篩 → 異常才展開 screen/full）
  - 結果頁分流：`normal / monitor / refer / incomplete`（取各領域最嚴重）

## 技術棧

| 元件 | 技術 |
|------|------|
| 框架 | [Astro 5](https://astro.build/) SSG + [Svelte 5](https://svelte.dev/) runes |
| 樣式 | CSS Custom Properties + OKLCH（`src/styles/tokens.css`，7 token + hex fallback） |
| 內容 | Astro Content Layer + Zod（`src/content.config.ts`） |
| 資料庫 | IndexedDB via [Dexie 4](https://dexie.org/)（瀏覽器端） |
| 圖表 | D3 子模組（`d3-scale`、`d3-shape`…） |
| FHIR | [fhirclient.js](https://docs.smarthealthit.org/client-js/) + 原生 PKCE（見下） |
| 搜尋 / PDF | [Pagefind](https://pagefind.app/) / jsPDF（動態 import） |
| 部署 | GitHub Pages + GitHub Actions |

## 快速開始

```bash
pnpm install
pnpm dev       # 開發（predev 先產生索引）→ http://localhost:4321/
pnpm build     # 建置（prebuild 產生索引 + Pagefind + SW/manifest）
pnpm preview   # 預覽建置結果
pnpm check     # astro check + svelte-check（型別）
pnpm lint      # ESLint
pnpm test      # vitest（單元）
pnpm test:e2e  # Playwright（端到端）
```

## 專案結構

```
src/
├── components/   # UI 元件（按功能分目錄）
│   ├── assess/       # 專業評估流程 + 結果（ResultView / ResultViewWrapper / IntakeSubmit…）
│   ├── self-check/   # 民眾自評
│   ├── fhir/         # 連線與 callback（StandaloneLaunch / LaunchCallback…）
│   ├── education/    # 衛教與影片
│   ├── workspace/    # 臨床工作區
│   └── common/ ui/ blocks/ settings/  # 通用 / 設定（含沿用的 webhook/ML 設定）
├── engine/       # 客戶端引擎
│   ├── cdsa/         # 分流核心（triage / radar-scoring / assessment-analyzer）
│   ├── workers/      # Web Workers（rule-engine / baseline / ml-inference）
│   └── fhir-writer / closed-loop / webhook / notification / tab-coordinator
├── lib/          # 共用函式庫
│   ├── fhir/         # SMART client、收案上傳（gcm-submit / intake-institutions）
│   ├── db/           # IndexedDB DAO（Dexie schema、assessments…）
│   ├── scales/       # 量表計分（scoreScale / Severity 型別）
│   ├── domain/       # 二層 BGS 領域樹、結果去重
│   ├── education/ stores/ tts/ pdf/ utils/ sw/
├── data/         # Content Layer 資料（見「維護重點」）
├── pages/        # 路由（含 /assess /result /self-check /workspace /launch …）
├── layouts/      # Base.astro
└── styles/       # tokens.css / global.css / typography.css
```

## 收案上傳（FHIR）— 兩條路徑

結果頁 `IntakeSubmit` 提供統一「收案機構」選擇器：

1. **已連線醫院**（`kind: fhirclient`）— 執行期動態項，僅在 `authStore.isAuthenticated` 時出現；走 fhirclient 頁內 POST（`cdsa-submit.ts`）。
2. **redirect 型收案機構**（`kind: redirect-pkce`，如 GCM）— 靜態清單 `src/lib/fhir/intake-institutions.ts`；用原生 `fetch` + `crypto.subtle` 做動態註冊 + PKCE，導向授權後回到共用 `/launch/` callback（`gcm-submit.ts`）。

`/launch/` 以 `sessionStorage['gcm.flow']` 分流：有→完成 GCM 上傳並顯示收案編號；否則當作 fhirclient OAuth callback。**新增收案機構**：在 `intake-institutions.ts` 加一筆 `IntakeInstitution`（scopes 勿含 `openid`/`fhirUser`、`aud=base`）。

## 維護重點

- **產生檔（已納版控，改完要重產提交）** — 否則 CI drift 檢查會擋下：
  `public/data/video-index.json`、`src/lib/education/clinical-education.generated.ts`、`src/lib/data/expected-questionnaire-domains.generated.json`。執行 `pnpm build`（或 predev/prebuild hook）即重產。
- **內容資料位置**（`src/data/`）：量表 `scales/`、自評題庫 `self-check/`、衛教 `education/`、規則 `rules/`、基線 `baselines/`、影片 `video-catalog/`（皆 YAML/JSON/Markdown）。
- **設計系統**：色彩僅用 7 個 token + `color-mix()`（OKLCH + hex fallback）；最小字級 18px、觸控 44px。規格見 `docs/superpowers/specs/`。
- **開發規則**：見 [`CLAUDE.md`](./CLAUDE.md)（型別 strict 無 `any`、Svelte 5 runes、D3 子模組匯入、安全/PII 規範）。
- **設計/實作文件**：`docs/superpowers/specs/`（設計）與 `docs/superpowers/plans/`（實作計畫）。

## 部署與 CI

- **push 到 `main` → `.github/workflows/deploy.yml` 自動部署**到 GitHub Pages（自訂網域 `smart-geri-cds.yao.care`，`base='/'`）。
- 手動備援：`gh workflow run deploy.yml --ref main`。
- CI（`.github/workflows/ci.yml`）：產生檔 drift 檢查 + `vitest` + Lighthouse（門檻全 `warn ≥0.9`，不擋 CI）。

## 客製化

- **量表**：`src/data/scales/*.yaml`（`tier`、`applicableCfs`、`mode`、band 切分點）。
- **衛教**：`src/data/education/*.md`，frontmatter 須符合 Content Layer schema。
- **影片**：`pnpm curate:videos` → 人工審核 → `incorporate-approved.ts` 納入 catalog。

## 授權

MIT License

## 致謝

[Astro](https://astro.build/) · [Svelte](https://svelte.dev/) · [SMART on FHIR](https://docs.smarthealthit.org/) · [Dexie.js](https://dexie.org/) · [Pagefind](https://pagefind.app/)
