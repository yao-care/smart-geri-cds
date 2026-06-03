# 衛教資源矩陣 — Master-Detail 熱圖改造設計

**日期**: 2026-06-03
**狀態**: 已確認，待實作
**相關**: `src/pages/education/`, `src/components/education/`
**前置設計**: [`2026-05-25-education-matrix-design.md`](2026-05-25-education-matrix-design.md)（原矩陣 + 貢獻流程，兒科時期維度，後 repurpose 為高齡 CGA × CFS）

---

## 背景與問題

`/education/` 衛教資源頁目前以表格呈現：列＝CGA 二層評估領域（依六大頂層域分組），欄＝臨床衰弱量表 CFS 1–9。方向正確，但**展開後的內容十分難讀**，根因在程式碼層面很明確：

- 矩陣 9 個 CFS 欄擠在 `min-width: 700px`，每欄極窄（`src/pages/education/index.astro`）。
- 每格用原生 `<details>` + `<summary>` **就地展開**，把文章清單、影片縮圖卡全部塞進窄格子內（`index.astro:94-169`）。
- 結果：展開內容換行破碎、縮圖變形、閱讀困難；多格展開後版面更亂。

使用者要的是：左側保留矩陣總覽、點格子後在**固定的右側面板**清楚閱讀並就地操作。

---

## 目標 / 非目標

### 目標

1. **左熱圖、右面板**的 master-detail 版面：左側矩陣只當「導覽地圖」，內容移到右側固定面板閱讀。
2. **熱圖式總覽**：一眼看出哪些「域 × CFS」資源充足、哪些是缺口。
3. **右欄就地操作**：閱讀官方資源、就地填寫貢獻表單（沿用現有 Worker→GitHub Issue 流程），不再彈出獨立 Modal。
4. **行動裝置可用**：窄螢幕退化為單欄矩陣 + 底部滑入 bottom sheet。

### 非目標（本次不做）

- **不動資料模型 / 持久化**：官方矩陣內容仍建置期靜態（`video-index.json` + Content Collections）；貢獻仍走 Worker→GitHub Issue 待審，**非即時生效**。
- **不整合醫院自訂衛教進矩陣**：`CustomEducation`（IndexedDB）目前無 domain 維度，維持在矩陣下方 `CustomEducationList` 獨立區塊，**完全不動**。
- **不動任何產生檔**：`video-index.json`、`clinical-education.generated.ts`、`expected-questionnaire-domains.generated.json` 皆不受影響（只改呈現與互動容器）。
- 不做維護者審核 Issue 後的 PR 自動化（沿用前置設計，手動合併）。

---

## 使用者與情境

頁面同時服務兩種情境（**兩者都要**）：

- **瀏覽查找**：臨床人員 / 民眾依某領域或某 CFS 等級，找出相關衛教資源閱讀。
- **盤點與貢獻**：維護者盤點「哪些 域×CFS 有/缺資源」，逐格補資源（透過貢獻建議）。

熱圖總覽同時滿足兩者：前者快速定位、後者一眼看出缺口。

---

## 已確認的設計決策

| # | 決策 | 選定 |
|---|------|------|
| 1 | 左側格子資訊密度 | **精簡指示（熱圖式總覽）**：格子只放單一數字/符號，內容全移右欄 |
| 2 | 右欄編輯方式 | **右欄就地操作**（取代彈窗）：閱讀 + 內嵌貢獻表單於同一面板 |
| 3 | 右欄「編輯」語意 | **貢獻建議式（沿用現有）**：送出＝提交 GitHub Issue 待審，非即時生效；不動 schema |
| 4 | 窄螢幕退化 | **單欄 + 底部滑入 bottom sheet** |
| 5 | 技術實作路線 | **路線 1：單一 Svelte island** |

### 架構翻案說明（相對前置設計）

前置設計採「方案 B：Astro SSG 0-JS 矩陣 + `<details>` 展開」。本次因 master-detail 選取、右欄就地操作、手機 bottom sheet 三項都需要共享互動狀態，**翻案為單一 `client:load` island（路線 1）**。

- 評估過的替代：多個小 island 互通（跨 island 狀態同步易 race，否決）、Astro 渲染矩陣＋只有右欄 island（就地操作需跨 Astro/island 邊界回寫，彆扭，否決）。
- **SSG / 搜尋影響**：Astro island 預設仍 server-render 初始 HTML，Pagefind 照常索引內容，不傷 SEO；首屏 JS 僅此頁增加，可接受。

---

## 桌機版面（≥ 1024px）

```
┌─────────────────────────────────────────────────────────────────────┐
│  衛教資源地圖   [說明：點任一格查看／提交該領域×CFS的資源]            │
├──────────────────────────────────────────┬──────────────────────────┤
│  左 60%：熱圖矩陣（可橫向捲動）            │  右 40%：固定面板 (sticky) │
│  ┌────────┬──┬──┬──┬──┬──┬──┬──┬──┬──┐    │ ┌──────────────────────┐ │
│  │ 領域＼CFS│1 │2 │3 │4 │5 │6 │7 │8 │9 │    │ │   DetailPanel        │ │
│  ├────────┼──┼──┼──┼──┼──┼──┼──┼──┼──┤    │ │  （見「右欄三狀態」） │ │
│  │▼ 身體                              │    │ │                      │ │
│  │  多重共病│– │– │· │2 │[3]│2 │1 │· │· │    │ │                      │ │
│  │  多重用藥│– │· │1 │2 │ 1│· │· │– │– │    │ │                      │ │
│  │  營養    │· │· │· │1 │ 2│3 │2 │1 │· │    │ │                      │ │
│  │▼ 心理 …                            │    │ │                      │ │
│  └────────┴──┴──┴──┴──┴──┴──┴──┴──┴──┘    │ └──────────────────────┘ │
└──────────────────────────────────────────┴──────────────────────────┘
```

- 左右比例 **60 / 40**。右欄 `position: sticky`，捲動矩陣時面板恆在視野。
- 斷點建議 `1024px`：≥ 此寬左右並排；窄於則進入手機版面（見下）。

---

## 左側熱圖矩陣

### 維度（現況）

- **列**：19 個二層域，依 6 個頂層域分組（physical / psychological / functional / social / environmental / future_wishes），來源 `src/lib/domain/domain-tree.ts`。
- **欄**：CFS 1–9，欄頭沿用現有 `CFS_COL_LABEL`（「等級數字 + 中文標籤」）。

### 格子視覺語彙

| 狀態 | 顯示 | 樣式 | 互動 |
|------|------|------|------|
| 有資源 | 數字＝文章＋影片總數（如 `3`） | 背景濃淡＝熱圖，量越多越深；`color-mix(in oklch, var(--accent) N%, var(--surface))` | 可選取 |
| 空·可貢獻 | `·`（淡點） | 極淡底；hover/focus 浮現 `＋` | 可選取（空清單） |
| 不適用 | `–` | 灰（`--line` 底） | 不可選取 |
| 選取中 | 維持原符號 | `--accent` 邊框 + 微亮 | 右欄同步顯示該格 |

要點：

- 格子**只放單一數字/符號**，徹底告別「塞清單進窄格」。
- 表頭（CFS 列、領域欄）`position: sticky`，橫向捲動不迷路。
- 6 頂層域用 `.group-row` 分隔（沿用現有），可整組摺疊（`▼/▶`，狀態存 `collapsedGroups`）讓長矩陣好掃描。
- 「資源總數」= 該格 `articleSlugs.length + videoIds.length`，由 `buildMatrixData()` 既有輸出直接計算，**不需新資料來源**。
- 熱圖深淺以「全矩陣最大資源數」正規化分檔（建議 4 檔：1、2–3、4–5、6+），分檔邏輯在 island 內計算。

---

## 右欄三種狀態

```
① 未選取（空狀態）                ② 已選取·閱讀              ③ 就地貢獻（點 ✎ 或 ＋）
┌────────────────────┐         ┌────────────────────┐    ┌────────────────────┐
│  ◐ 衛教資源地圖     │         │ 身體 · 多重共病     │    │ ← 返回　貢獻資源    │
│                    │         │ CFS 5（輕度衰弱）   │    │ ⚠ 送出＝提交建議，  │
│  點左側任一格子，   │         ├────────────────────┤    │   待維護者審核合併  │
│  查看該情境的衛教   │         │ 📄 官方文章 (3)     │    ├────────────────────┤
│  資源、或提交貢獻。 │         │ • 慢性病自我管理 ✎🗑│    │ 類型 ○文章 ○影片    │
│                    │         │ • 多重共病用藥 ✎ 🗑 │    │     ○外部連結       │
│  ─ 全站盤點 ─      │         │ • …                │    │ 標題 [__________]   │
│  148 格有資源       │         │ 🎬 官方影片 (1)     │    │ 內容 [__________]   │
│  23 格待補（高亮）  │         │ [縮圖] 用藥安全 🗑  │    │ …                  │
│                    │         ├────────────────────┤    │ 提交者(選填)[_____] │
│                    │         │ ┌────────────────┐ │    │ ┌────────────────┐ │
│                    │         │ │ ＋ 貢獻資源    │ │    │ │   送出建議      │ │
│                    │         │ └────────────────┘ │    │ └────────────────┘ │
└────────────────────┘         └────────────────────┘    └────────────────────┘
```

### ① 未選取（空狀態）

- 提示「點左側任一格子，查看該情境的衛教資源、或提交貢獻」。
- **全站盤點**：「X 格有資源 / Y 格待補」。Y（缺口）可點擊高亮左側對應空格，呼應「盤點缺口」用途。統計由 island 從 `matrixData` 計算。

### ② 已選取·閱讀

- 標題：域中文 · 子域中文 + `CFS N（中文等級）`。
- **官方文章** `(N)`：清單，每篇 = 連往 `/education/[slug]/` 的連結 + ✎（編輯建議）+ 🗑（刪除建議）。
- **官方影片** `(N)`：縮圖（`hqdefault.jpg`）+ 標題/頻道/時長 + 🗑（刪除影片建議）。
- **＋ 貢獻資源**按鈕：切到狀態③（`action: 'add'`）。
- 不適用格（`–`）不可選取，因此右欄不會進入此狀態。

### ③ 就地貢獻表單

- 由 ✎ / 🗑 / ＋ 進入，對應現有四種 action：`add` / `edit-article` / `delete-article` / `delete-video`。
- **表單頂部紅字明確標示**：「⚠ 送出＝提交建議，待維護者審核合併，非即時生效」，杜絕「以為即時生效」的誤解。
- 欄位與提交邏輯**完全沿用** `ContributionModal.svelte` 現有實作（type 切換、payload 組裝、`fetch` Worker、Issue 連結回顯），只是改為內嵌於右欄面板。
- 送出後就地顯示 GitHub Issue 連結；「← 返回」回到狀態②。

---

## 手機（< 1024px）bottom sheet

```
┌──────────────┐      點格子 ↑滑入       ┌──────────────┐
│ 衛教資源地圖  │   ───────────────▶     │ 衛教資源地圖  │（背景變暗）
│ ┌──────────┐ │                        │ ┌──────────┐ │
│ │熱圖矩陣  │ │                        │ │熱圖矩陣  │ │
│ │(可橫捲)  │ │                        │ ╞══════════╡ │← 半屏 sheet
│ │          │ │                        │ │身體·多重 │ │  (可上拉全屏)
│ └──────────┘ │                        │ │CFS5      │ │
│              │                        │ │📄文章(3) │ │
│              │                        │ │…  [貢獻] │ │
└──────────────┘                        │ └──────────┘ │
                                        └──────────────┘
  關閉（下滑 / ✕ / Esc）→ 回矩陣
```

- 窄螢幕只顯示矩陣（可橫向捲動）。點格子後，`DetailPanel` 由底部滑入半屏 sheet（可上拉全屏）。
- 關閉方式：下滑、✕ 按鈕、Esc。關閉後清除 `selectedKey`。
- **右欄與 sheet 共用同一個 `DetailPanel` 元件**，僅外層容器（sticky 欄 vs sheet）不同，不重寫兩套內容。

---

## 元件 / 資料流拆解（路線 1）

```
education/index.astro  ── build 期算好資料，序列化成 props ──┐
   matrixData / articleTitles / articleContent / catalog     │
   PUBLIC_CONTRIBUTION_WORKER_URL                             ▼
┌──────────────────────────────────────────────────────────────┐
│ EducationMatrix.svelte  (client:load，唯一 root island)        │
│   $state: selectedKey, mode(reading|contributing), 表單欄位,  │
│           collapsedGroups, sheetOpen(手機)                    │
│   $derived: 熱圖分檔、全站盤點統計、目前選格的 articles/videos │
│   ┌────────────────────┐      select(domain, cfs)            │
│   │ MatrixGrid.svelte  │ ───────────────────────┐            │
│   │  左側熱圖、sticky 表頭、群組摺疊、鍵盤導覽   │            │
│   └────────────────────┘                        ▼            │
│   ┌──────────────────────────────────────────────────────┐  │
│   │ DetailPanel.svelte  桌機=右欄 / 手機=bottom sheet 內   │  │
│   │   閱讀官方 articles+videos（由 props 依 key 查）        │  │
│   │   內嵌 ContributionForm（type 切換 + fetch Worker）    │  │
│   └──────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
矩陣下方：<CustomEducationList client:idle />  （醫院自訂衛教，維持原樣不動）
```

### 元件職責

| 元件 | 職責 | 依賴 |
|------|------|------|
| `EducationMatrix.svelte` | root island；持有所有互動狀態與衍生值；協調 grid ↔ panel ↔ sheet | props（build 期資料）、子元件 |
| `MatrixGrid.svelte` | 渲染熱圖格子、sticky 表頭、群組摺疊、鍵盤導覽；emit `select(domain, cfs)` | matrixData、選取狀態（props down） |
| `DetailPanel.svelte` | 閱讀官方資源 + 內嵌貢獻表單；桌機/手機共用 | 目前選格資料、`ContributionForm` |
| `ContributionForm.svelte` | 由 `ContributionModal` 抽出的表單邏輯（type 切換、payload、fetch Worker、Issue 回顯） | `PUBLIC_CONTRIBUTION_WORKER_URL` |

### ContributionModal 的命運

- 把表單邏輯抽成 `ContributionForm.svelte`，由 `DetailPanel` 內嵌。
- 矩陣這條的 `ContributionModal` 退役；其 `open-contribution` CustomEvent 橋接機制不再需要（改為 island 內直接呼叫）。
- 矩陣下方的 `CustomEducationList` 區塊**完全不動**。

### 資料流不變

- 官方矩陣資料仍建置期靜態（`buildMatrixData()` 輸出，序列化進 island props）。
- 貢獻仍走 `fetch` → Cloudflare Worker → GitHub Issue。
- 持久化與資料模型零變動，因此**不動任何產生檔**。

---

## 可及性 / 設計系統

- **色彩**：僅用 7 個 token；熱圖濃淡用 `color-mix()`；OKLCH + `@supports` hex fallback。
- **字級**：≥ 18px（`--text-xs`）；caption 16px 為唯一例外。
- **觸控**：格子、按鈕 ≥ 44px。
- **鍵盤**：矩陣格子可 Tab 進入、方向鍵在格間移動、Enter/Space 選取；bottom sheet 有 focus-trap + Esc 關閉；右欄與 sheet 切換時管理 focus。
- **語意**：矩陣用 `role="grid"` / `gridcell`（或保留 `<table>` 語意但格子為 `<button>`），選取格 `aria-selected`；右欄為 `aria-live` 區域，選取變更時播報目前情境。

---

## 測試策略

- **單元（vitest）**：熱圖分檔正規化、全站盤點統計（有資源/待補計數）、依 `selectedKey` 取 articles/videos 的衍生邏輯。
- **元件**：`MatrixGrid` 點格子 emit 正確 `(domain, cfs)`；不適用格不可選；群組摺疊。`DetailPanel` 三狀態切換；貢獻表單欄位依 type 顯示/驗證。
- **E2E（Playwright）**：桌機點格子 → 右欄顯示對應內容；點 ＋ → 表單 → mock Worker 回 Issue 連結；窄螢幕 viewport 點格子 → sheet 滑入 → Esc 關閉。
- **回歸**：CustomEducationList 區塊不受影響；Pagefind 仍索引到矩陣初始 HTML 內容。

---

## 新增 / 修改檔案清單

| 檔案 | 動作 | 說明 |
|------|------|------|
| `src/pages/education/index.astro` | 改寫 | 移除 `<table>` + `<details>` + CustomEvent 橋接；改為掛載 `EducationMatrix` island 並序列化 build 期資料為 props；保留下方 `CustomEducationList` |
| `src/components/education/EducationMatrix.svelte` | 新增 | root island，持有互動狀態與衍生值 |
| `src/components/education/MatrixGrid.svelte` | 新增 | 左側熱圖矩陣 |
| `src/components/education/DetailPanel.svelte` | 新增 | 右欄 / bottom sheet 共用面板 |
| `src/components/education/ContributionForm.svelte` | 新增 | 由 `ContributionModal` 抽出的表單邏輯 |
| `src/components/education/ContributionModal.svelte` | 退役 | 矩陣這條不再使用（確認無其他引用後移除） |
| `src/lib/education/matrix-data.ts` | 視需要小調 | 若 island 需要「每格資源總數」便捷欄位可在此補；否則不動 |

---

## 風險與 YAGNI

- **風險：island 首屏 JS 增加**。僅此頁，且 island 仍 SSR 初始 HTML，Lighthouse 影響可控（門檻為 `warn`）。
- **風險：矩陣語意 a11y**。`role="grid"` 鍵盤導覽需謹慎實作與測試。
- **YAGNI（明確排除）**：不做整列/整欄彙整選取（只選單格）、不做熱圖以外的篩選器、不把醫院自訂內容整合進矩陣、不做即時編輯官方內容。
