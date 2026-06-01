# 高齡周全性評估 CDS（smart-geri-cds）— 開發規則

## 專案概述

開源高齡周全性評估（CGA）臨床決策輔助系統，以 SMART on FHIR 標準運行於瀏覽器端。
零後端、部署於 GitHub Pages、支援 PWA 離線；所有評估邏輯、規則引擎與 ML 推論皆在瀏覽器執行。

兩條使用路徑：
- 民眾自我檢視 `/self-check/`
- 專業評估 `/assess/` → `/result/`（可上傳至收案機構）→ 臨床工作區 `/workspace/`

## 技術棧

- **框架**: Astro 5 SSG + Svelte 5（runes）
- **樣式**: CSS Custom Properties + OKLCH（`src/styles/tokens.css`，7 個 source-of-truth token + hex fallback）
- **內容**: Astro Content Layer + Zod（`src/content.config.ts`）
- **資料庫**: IndexedDB via Dexie 4（瀏覽器端）
- **圖表**: D3 子模組（`d3-scale`、`d3-shape` 等）
- **FHIR**: 上傳兩路徑 — fhirclient.js（已連線醫院 SMART launch，頁內 POST）／原生 `fetch`+`crypto.subtle` PKCE（redirect 型收案機構如 GCM，不用 fhirclient 因需帶自訂 `login_hint`/`nickname`），共用 `/launch/` callback 雙路分流（憑 `sessionStorage['gcm.flow']`）
- **搜尋**: Pagefind　**PDF**: jsPDF（動態 import）
- **PWA**: 自建 service worker + manifest（`scripts/build-sw.mjs`、`build-manifest.mjs`）
- **套件管理**: pnpm

## 常用指令

```bash
pnpm dev          # 開發（predev 會先產生索引）
pnpm build        # 建置（prebuild 產生索引 + Pagefind + SW/manifest）
pnpm check        # astro check + svelte-check
pnpm lint         # ESLint
pnpm test         # vitest
pnpm test:e2e     # Playwright
```

## 部署與 CI

- 本 repo 為獨立 repo；**push 到 `main` 由 `.github/workflows/deploy.yml` 自動部署**到 GitHub Pages（自訂網域 `smart-geri-cds.yao.care`）。
- 手動觸發備援：`gh workflow run deploy.yml --ref main`。
- CI（`.github/workflows/ci.yml`）：產生檔 drift 檢查 + `vitest` + Lighthouse（門檻全 `warn ≥0.9`，不擋 CI）。
- **產生檔（已納版控）**：改動內容/量表後須重新產生並提交，否則 CI drift 檢查會擋下——
  `public/data/video-index.json`、`src/lib/education/clinical-education.generated.ts`、`src/lib/data/expected-questionnaire-domains.generated.json`（執行 `pnpm build` 或 predev/prebuild hook 即會重產）。

## 強制規則

### 程式碼

- TypeScript strict mode，不允許 `any`
- Svelte 5 runes（`$state`、`$derived`、`$effect`），不用 Svelte 4 stores
- D3 僅允許子模組匯入，禁止 `import * as d3`
- CSS 色彩僅用 7 個 token，衍生色用 `color-mix()`；OKLCH + `@supports` hex fallback
- Mermaid 圖表色彩用 hex，不用 `oklch()`
- 最小字級 18px（`--text-xs`；`--text-caption` 16px 為唯一例外）
- 最小觸控目標 44px

### 安全

- 禁止硬編碼密碼/Token/密鑰
- console 禁止輸出 PII（姓名、身分證）
- PDF 報告僅使用 FHIR Patient ID
- 不使用大陸廠牌 AI 服務

### 架構

- 分流核心在 `src/engine/cdsa/`（triage / radar-scoring / assessment-analyzer）
- 主執行緒僅處理 UI 與閉環狀態
- 多分頁用 BroadcastChannel 協調（`src/engine/tab-coordinator.ts`）
- 離線操作排入 sync queue（`src/lib/db/sync-queue.ts`）

### 內容

- 衛教 `src/data/education/`（含唯一關聯源 `content-relevance.yaml`）
- 量表 `src/data/scales/`、自評題庫 `src/data/self-check/`、影片 `src/data/video-catalog/`

## 目錄結構重點

- `src/engine/` — 引擎（`cdsa/` 分流、`tab-coordinator`）
- `src/lib/` — 共用函式庫（`fhir`、`db`、`stores`、`scales`、`education`、`sw`）
- `src/components/` — UI 元件（按功能分目錄：`assess`、`self-check`、`common`、`education`…）
- `src/data/` — Content Layer 資料
- `src/pages/` — 路由　`src/layouts/` — 佈局（`Base.astro`）
- `src/styles/` — `tokens.css`、`global.css`、`typography.css`
- `public/sounds/` — 音效　`public/data/` — 產生的 video-index

## 分級（Severity）與設計系統

- Severity 型別（`src/lib/scales/scale.ts`）：`normal | monitor | refer | incomplete`
- 色彩 token（`src/styles/tokens.css`）：`--warn`（注意，琥珀）、`--danger`（嚴重，紅）等 7 個
- 完整設計系統規格：`docs/superpowers/specs/2026-05-16-design-system-spec.md`

## Island 水合策略

- 首屏互動 `client:load`／捲動觸發 `client:visible`／低優先 `client:idle`／純展示 零 JS
