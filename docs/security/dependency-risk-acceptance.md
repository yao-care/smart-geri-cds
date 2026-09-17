# 相依弱點風險接受記錄（ISO 27001 A.8.8 技術弱點管理）

> 本檔記錄**經評估後決定暫不修補**的相依弱點，及其理由與再評估條件。
> 已修補者不列入此處，逕由 git log 與 Dependabot PR 佐證。
>
> ⚠️ 風險接受**不是**忽略：每筆均須有可驗證的不適用理由或上游阻因，
> 並訂定再評估時機。條件一旦改變即須重新處置。

## 掃描 `20260714-231411-b638`（2026-07-14）

處置後結果：**Critical 0 / High 0**（原 High 20 → 0，Quality Gate 由 FAIL 轉 PASS）。

### 已修補

| 套件 | 原版本 | 修補版本 | 涵蓋 |
|---|---|---|---|
| astro | 6.3.1 | 6.4.8 | CVE-2026-50146 (H)、CVE-2026-54299 (H)、CVE-2026-54298 (M) |
| vite | 7.3.3 | 7.3.6（override） | CVE-2026-53571 (H)、CVE-2026-53632 (M) |
| dompurify | 3.4.2 | 3.4.12（override） | CVE-2026-49458/49459/49978 (M)、GHSA-76mc-f452-cxcm (M)、GHSA-cmwh-pvxp-8882 (M)、GHSA-gvmj-g25r-r7wr (L)、GHSA-vxr8-fq34-vvx9 (L) |
| js-yaml | 4.1.1 | 4.3.0 | CVE-2026-53550 (M) |
| js-yaml（@lhci/cli 路徑） | 3.14.2 | 3.15.0（override） | CVE-2026-53550 (M)，dev-only |
| esbuild（tsx 路徑） | 0.28.0 | 0.28.1（override） | GHSA-g7r4-m6w7-qqqr (L) |

GitHub Actions 供應鏈：17 處 mutable tag 已全數 pin 至 40 字元 commit SHA
（Semgrep 17 筆 High 歸零），並以 `.github/dependabot.yml` 維持後續更新。

### 接受風險（暫不修補）

#### 1. esbuild 0.27.7 — GHSA-g7r4-m6w7-qqqr（Low）

- **弱點**：在 **Windows** 上執行 esbuild 開發伺服器時可任意讀取檔案。
- **不適用理由**：本專案為 SSG，產出靜態檔部署至 GitHub Pages；esbuild 僅
  在**建置期**使用，不隨產物送至瀏覽器。開發伺服器僅於維運者本機（macOS）
  執行，CI 為 `ubuntu-latest`。**觸發條件（Windows + dev server）在本專案不成立。**
- **上游阻因**：esbuild 0.27.x 分支**無任何修補版**（最新即 0.27.7），修補僅存在
  於 0.28.1；而 astro 6.4.8 宣告 `esbuild: ^0.27.3`（即 `<0.28.0`）。強制 override
  將違反 astro 宣告範圍並引入 API 相容風險，代價高於此弱點的實際風險。
  - 註：tsx 路徑的 esbuild 因宣告 `~0.28.0`（允許 0.28.1），已另以範圍限定
    override `esbuild@0.28` 修補，故此項僅殘留 astro 綁定的 0.27.7 一處。
- **再評估條件**：升級至 astro 7（其宣告 `esbuild: ^0.28.0`）時自動消解；
  或 esbuild 釋出 0.27.x 修補版時改採之。astro 7 升級屬 major，另案評估。

#### 2. dompurify 3.4.12 — GHSA-x4vx-rjvf-j5p4（Low）

- **弱點**：`IN_PLACE` 模式信任攻擊者可控的 `nodeName`，可能保留 script 而 XSS。
- **上游阻因**：**上游尚無修補版**（`first_patched_version: 無`）。已升至現行
  最新 3.4.12，無更高版本可用。
- **暴露面評估**：dompurify 經 jspdf 的 **optionalDependencies** 引入，用於
  `jspdf.html()` 路徑。本系統 PDF 由自有結構化評估資料產生，且依專案規則
  「PDF 報告僅使用 FHIR Patient ID」；觸發需以 `IN_PLACE` 模式處理攻擊者提供的
  DOM 物件。
- **再評估條件**：dompurify 釋出修補版後即升級（Dependabot 會自動開 PR）。
  → **待辦**：確認 jspdf 是否確實走 `IN_PLACE`；若專案未使用 `jspdf.html()`，
  可評估移除此 optional 相依以徹底消除暴露面。

## 複查 2026-09-17（`pnpm audit`）

距上次處置兩個月，上游新增告警，其中 **1 筆 critical** 需要判定。

#### 3. astro 6.4.8 — Astro: Remote code execution through AVIF image optimization（Critical）

- **弱點**：透過 AVIF 影像最佳化路徑可達成遠端程式碼執行。
- **影響版本／修補版**：`<7.2.8` → `>=7.2.8`。**6.x 分支無修補版**，修補僅存在於 Astro 7。
- **不適用理由（已核實）**：本專案**未使用 Astro 影像最佳化**——`src/` 內無
  `astro:assets` 匯入、無 `<Image>` / `<Picture>` 元件，`astro.config.mjs` 未設定
  `image`。圖片皆為 `public/` 靜態檔，不經最佳化管線。**觸發條件在本專案不成立。**
  另本站為 SSG，執行期無 Node 伺服器可被觸及，即使觸發也僅限建置期、輸入為 repo 內自有檔案。
- **上游阻因**：需升級 Astro 7（major），牽動 Content Layer 與產生檔管線，屬獨立工作。
- **再評估條件**（任一成立即須立即處置）：
  1. 開始使用 `astro:assets` / `<Image>` / `<Picture>` 或設定影像最佳化
     → **升級必須先於該功能上線**；
  2. 出現針對建置期的實際利用手法，或 CI 開始處理外部來源影像；
  3. Astro 7 升級評估完成。
- **相同狀況的 repo**：`smart-func-cds`、`smart-pedi-cds` 亦為 astro 6.4.8，
  同一判定成立；升級應三者同步評估（註：升 Astro 7 亦可一併消解本檔第 1 項的
  esbuild 0.27.7 接受風險）。

> 注意：`pnpm audit` 不是正式掃描報告的替代品，此節僅為兩次正式掃描之間的例行複查。

## 維護方式

- **自動**：`.github/dependabot.yml` — github-actions 與 npm 每週一 04:00 (Asia/Taipei)
  檢查；安全性更新獨立成 PR 以便優先合併；major 升級排除自動化，一律人工評估。
- **人工**：每季相依掃描（見 [README.md](README.md) 常態週期）。
- 本檔於**每次掃描後更新**：新增接受項、移除已修補項、覆核既有項的再評估條件。
