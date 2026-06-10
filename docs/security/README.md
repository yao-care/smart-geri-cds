# 資安治理文件（ISMS 記錄）

本目錄存放 smart-geri-cds 的資訊安全管理（ISMS）程序與記錄，對應資安掃描
報告（掃描 ID `20260610-044817-b638`）指出的三項 ISO/IEC 27001 治理缺口。

> ⚠️ **這些是範本框架，不是已完成的記錄。** 標示「（填寫）」的欄位必須由
> 負責人於**實際執行**演練／測試後填入真實日期、參與人員與結果。請勿以假
> 資料充當合規證據。

## 控制項對應

| ISO 27001 控制項 | 文件 | 狀態 |
|---|---|---|
| A.5.24 事件回應規劃與演練 | [incident-response-plan.md](incident-response-plan.md) | 範本待執行演練 |
| A.5.26 事件回應聯絡窗口 | [incident-response-contacts.md](incident-response-contacts.md) | 範本待填聯絡人 |
| A.5.29 備份還原測試 | [backup-restore-test.md](backup-restore-test.md) | 範本待執行還原測試 |

## 本系統的資安特性（撰寫程序時的前提）

- **零後端**：無應用伺服器、無自管資料庫。前端靜態檔部署於 GitHub Pages
  （自訂網域 `smart-geri-cds.yao.care`）。
- **資料落地點**：評估資料存於使用者瀏覽器的 IndexedDB；上傳的 FHIR 資料
  寫入**收案機構的 FHIR 伺服器**（非本系統持有）。
- **本系統「需要備份／還原」的資產**：原始碼 Git repo、GitHub Pages 部署設定、
  網域 DNS 設定、CI/部署密鑰。並非傳統的伺服器資料庫備份。
- **主要事件情境**：供應鏈（npm 套件）污染、GitHub Pages 竄改／置換、
  網域或 DNS 劫持、密鑰外洩、影響臨床端瀏覽器的 XSS。
