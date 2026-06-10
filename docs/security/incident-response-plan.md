# 事件回應計畫與演練記錄（ISO 27001 A.5.24）

> ⚠️ 本檔含「程序（常設）」與「演練記錄（每次填寫）」兩部分。程序部分維護
> 為最新；演練記錄每次桌面／實機演練後新增一筆，**填入真實資訊**。

## 1. 範圍與目標

- 對象系統：smart-geri-cds（GitHub Pages 靜態 SMART-on-FHIR CDS）。
- 目標：在偵測到資安事件後，能於 RTO 內遏制、復原並對外溝通。

## 2. 事件分級

| 等級 | 定義 | 範例 | 目標回應時間 |
|---|---|---|---|
| P1 嚴重 | 影響臨床使用者安全或大量資料 | Pages 被植入惡意腳本、供應鏈 RCE、密鑰外洩可改部署 | 立即（≤1 小時內遏制） |
| P2 高 | 服務中斷或潛在資料風險 | 部署中斷、相依套件 High CVE 在用路徑、DNS 異常 | ≤4 小時 |
| P3 中／低 | 有限影響、可排程修補 | 非在用路徑的相依 CVE、低風險 SAST 告警 | ≤5 個工作天 |

## 3. 回應流程

```mermaid
flowchart LR
  A[偵測/通報] --> B[分級 P1-P3]
  B --> C[遏制]
  C --> D[根因分析]
  D --> E[復原/部署修補]
  E --> F[驗證]
  F --> G[事後檢討與記錄]
  style A fill:#3d6b54,color:#ffffff
  style G fill:#b8860b,color:#ffffff
```

### 各情境的遏制手段

- **Pages 竄改／惡意部署**：撤下或回滾 GitHub Pages 部署（`git revert` +
  重新觸發 `deploy.yml`），必要時暫停 Pages。
- **供應鏈污染**：以 `pnpm.overrides` 釘住安全版本或移除受影響套件，
  重建並重新部署。
- **密鑰外洩**：撤銷並輪替 GitHub Actions secrets / 部署 token / FHIR client。
- **DNS／網域劫持**：聯絡網域註冊商與 DNS 服務商，鎖定並還原紀錄。

## 4. 對外溝通

- 內部通報：依 [事件回應聯絡窗口](incident-response-contacts.md)。
- 對收案機構：涉及上傳 FHIR 資料風險時，依資料處理協議通知對應窗口。

---

## 5. 演練記錄

> 每次演練後**新增一列**並填入真實資訊。

| 演練日期 | 形式 | 情境 | 參與人員（角色） | 發現問題 | 改善事項 | 下次演練排程 |
|---|---|---|---|---|---|---|
| 2026-06-10 | 實機（實戰） | 供應鏈 Critical CVE：shell-quote 1.8.3 命令注入（CVE-2026-9277），另 7 High | 技術負責 + 部署/基礎設施 | ① 公開 repo 經 fhirclient→isomorphic-webcrypto 的 RN-only optionalDeps 默默引入整套 expo/react-native 死碼（335 套件），擴大供應鏈攻擊面；② 無 CI 防線阻擋 Bidi/Trojan-Source 字元 | ① 以 `pnpm.ignoredOptionalDependencies` 連根移除 RN 子樹；② 其餘 CVE 以 `pnpm.overrides`/升版修補；③ 新增 CI Bidi lint gate；④ 建立本 ISMS 文件。後續可評估導入 `pnpm audit` / Dependabot 例行掃描 | 2027-06-10（每年一次） |

> **演練常態週期**：IR 桌面/實戰演練與還原測試（A.5.29）以**每年至少一次**為常態，
> 下次排程 **2027-06-10**。建議另搭配**每季**的相依套件掃描（`pnpm audit` / Dependabot）
> 作為供應鏈持續監控，命中 High 以上時即觸發一次計畫外實戰回應。

### 本次（2026-06-10）實戰時序摘要

- **偵測**：收到資安掃描報告（ID `20260610-044817-b638`），1 Critical + 7 High。
- **分級**：P1（Critical 命令注入於相依層）。
- **遏制／復原**：定位根因為死碼子樹 → 針對性移除；其餘相依升版。**全程於同一工作階段內完成並部署上線，遠低於 P1 ≤1 小時的遏制目標。**
- **驗證**：505 tests 全綠、`--frozen-lockfile` CI 通過、`pnpm build` 完整、正式站 HTTP 200。
- **資料影響評估**：純相依／SAST 層，未觸及已上傳之 FHIR 資料，**無需依 A.5.26 通知收案機構**。
- **commit**：`50837b5`、`a8ed791`、`26bf0d4`、`60af051`（main）。

### 演練情境建議（可輪流採用）

1. npm 相依套件爆出 Critical CVE（如本次 shell-quote）——從偵測到部署修補的全流程。
2. GitHub Pages 首頁被置換惡意腳本——回滾與通報。
3. 部署用 GitHub token 外洩——輪替與影響評估。
