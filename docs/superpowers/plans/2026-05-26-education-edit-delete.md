# education/ 修改+刪除 → 開 issue 給維護者判斷 — 實作計畫

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development

**Goal:** `/education/` 矩陣每筆內容旁加「修改文章 / 刪除文章 / 刪除影片」動作,送出後不直接改資料,而是經 Cloudflare Worker 開 GitHub issue 給維護者判斷後手動套用（沿用現有「新增貢獻」流程）。

**設計確認（2026-05-26 用戶選 A）:** 修改文章 = 預填完整表單（標題/摘要/內文）讓人改。

## Payload 合約（前端 POST → Worker，前後端必須一致）
```ts
type ContributionPayload = {
  type: 'youtube' | 'article' | 'external-link'   // 既有（新增）
      | 'edit-article' | 'delete-article' | 'delete-video';  // 新增
  domain: string; ageGroup: string;               // 所在情境
  // edit-article:
  targetSlug?: string; title?: string; summary?: string; content?: string;  // 提議的新內容
  // delete-article:
  targetSlug?: string;                              // + notes 當刪除原因
  // delete-video:
  targetVideoId?: string; videoTitle?: string;      // + notes 當刪除原因
  notes?: string; submitter?: string;
  // 既有欄位 url 等保留
};
```

## Task 1 — Worker 支援新 type（`workers/education-contribution/`）
- `src/issue-formatter.ts`: `ContributionPayload` 加 3 個 type + 欄位（targetSlug/targetVideoId/videoTitle）。`formatIssueTitle`：edit→`[衛教修改] {領域}×{年齡}｜{slug}`；delete-article→`[衛教刪除文章] …｜{slug}`；delete-video→`[衛教刪除影片] …｜{videoTitle}`。`formatIssueBody`：edit 列出提議的新 title/summary/content + 目標 slug + 情境；delete 列出目標 + 原因(notes) + 情境。
- `src/index.ts`: `validate()` 加新 type；edit-article/delete-article 需 `targetSlug`，delete-video 需 `targetVideoId`。labels: `education-contribution` + type。
- 更新 `src/issue-formatter.test.ts`（新 type 的 title/body 斷言）。
- `pnpm --dir workers/education-contribution test` + tsc 綠。

## Task 2 — 前端（`src/pages/education/index.astro` + `src/components/education/ContributionModal.svelte`）
- index.astro：build 時建 `articleContent: Record<slug,{title,summary,content}>`（用 getCollection('education') 的 data + `body`），以 `<script type="application/json" id="article-content">` 內嵌。
- 每篇文章 `<li>` 加 `✏️修改`/`🗑️刪除` 按鈕（data-action=edit-article/delete-article, data-slug, data-domain, data-age）；每支影片加 `🗑️刪除`（data-action=delete-video, data-videoid, data-title, data-domain, data-age）。
- 既有 `<script>` 事件委派擴充：點到這些按鈕 → 讀 articleContent（edit 用）→ dispatch `open-contribution` CustomEvent，detail 帶 `{action, domain, age, slug/videoId/title, title/summary/content}`。
- ContributionModal.svelte：依 detail.action 進入對應模式：
  - `edit-article`：預填 title/summary/content（可改），送出 type='edit-article' + targetSlug。
  - `delete-article` / `delete-video`：顯示目標 + 必填「刪除原因」textarea，送出對應 type + target + notes。
  - `add`（既有）不變。
- 44px 觸控目標、ESC 關閉等沿用既有。

## Task 3 — 部署 + 驗證
- Worker 重新部署（`wrangler deploy`，需 CF 憑證 — 由用戶提供 token 或自行部署）。
- `pnpm build` + `pnpm test` 綠；本機 modal 煙測；合併 main → push → 部署 → 線上驗證按鈕出現。

## 守則
- 不直接改資料 — 一律開 issue 給維護者判斷後手動套用（用既有修改/刪除步驟）。
- parity / 覆蓋率測試不受影響（此功能不動 content-relevance.yaml）。
