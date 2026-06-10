# 備份與還原測試記錄（ISO 27001 A.5.29）

> ⚠️ 含「備份標的與策略（常設）」與「還原測試記錄（每次填寫）」。本系統零後端、
> 無自管資料庫，「備份／還原」聚焦於可重建部署的資產，而非伺服器資料庫。

## 1. 備份標的與策略

| 資產 | 儲存位置 | 備份方式 | 還原方式 | RPO | RTO（目標） |
|---|---|---|---|---|---|
| 原始碼 + 產生檔 | GitHub repo（`main`） | Git 分散式歷史；建議鏡像至第二遠端 | clone/重建 | 即時（每次 commit） | ≤30 分（實測乾淨重建 45s，見下方測試） |
| GitHub Pages 部署 | GitHub Pages（CNAME `yao-care.github.io`） | 由 `deploy.yml` 從 `main` 重建 | 重新觸發 workflow | n/a（可重建） | ≤30 分（實測 push→上線 1m9s） |
| 網域 / DNS 設定 | DNS 託管：**Linode**（ns1-5.linode.com）；註冊商：**GoDaddy.com, LLC**（到期 2027-04-16） | 匯出 DNS zone 設定留存 | 依留存設定於 Linode 還原 | 每次 zone 異動後 | ≤4 小時（受註冊商/DNS 傳播時間影響） |
| CI/部署密鑰 | GitHub Actions secrets | 來源憑證留存於私有 ISMS（QC 目錄 `agent.system-integration-quality-control`，本機） | 重新產生並寫回 secrets | n/a | ≤1 小時 |
| 使用者評估資料 | 用戶瀏覽器 IndexedDB | **本系統不集中持有**；屬用戶端 | 由系統匯出/PDF 功能 | n/a | n/a |
| 已上傳 FHIR 資料 | **收案機構 FHIR 伺服器** | 由收案機構依其 ISMS 負責 | 同左 | 依機構 | 依機構 |

> 註：DNS zone 與密鑰來源的離線留存是本系統「備份」的實質重點——
> 因 repo 本身已是分散式備份，最大的單點風險在網域與部署密鑰。

## 2. 還原測試記錄

> 每次測試後**新增一列**並填入真實結果，驗證 RTO/RPO 是否達標。

| 測試日期 | 測試標的 | 方法 | 結果（成功/問題） | 實測 RTO | 達標? | 負責人 |
|---|---|---|---|---|---|---|
| 2026-06-10 | 從 `main` 全新重建並驗證可部署 | 乾淨環境 `git clone --depth 1` → `pnpm install --frozen-lockfile` → `pnpm build`，確認產出 `dist/index.html` | 成功，產出可部署靜態檔；同日 CI `deploy.yml` 實際部署上線、正式站 HTTP 200 | clone 9s + install 11s + build 25s = **45s**（本地重建）；push→上線 **1m9s**（CI 部署） | 是（≤30 分） | 部署/基礎設施 |

> **測試常態週期**：還原測試以**每年至少一次**為常態（與 IR 演練同步），
> 下次排程 **2027-06-10**。

### 建議測試項目

1. **全新重建部署**：從乾淨環境 clone `main` → `pnpm install` → `pnpm build`
   → 觸發 `deploy.yml`，量測自啟動到網站可用的時間（RTO）。
2. **DNS 還原演練**：以留存的 zone 設定，在測試子網域驗證可正確指向 Pages。
3. **密鑰輪替演練**：產生新部署 token、寫回 secrets、確認部署仍成功。
