# Education Contribution Worker — 部署指南

本 Worker 接受醫生提交的衛教內容貢獻，自動建立 GitHub Issue，供 repo 維護者審核。

## 前置準備

1. **安裝 Node.js** (v18 or later)
   ```bash
   node --version
   ```

2. **安裝 wrangler CLI**（全域）
   ```bash
   pnpm add -g wrangler
   ```

3. **Cloudflare 登入**
   ```bash
   wrangler login
   ```
   會自動開啟瀏覽器進行授權。

4. **建立 Cloudflare Workers 專案**（已完成，在 `workers/education-contribution/`）

## 設置 GitHub App 環境變數

本 Worker 使用 GitHub App 身份創建 Issue。需要設置以下四個密鑰：

### 1. 建立 GitHub App（完整流程）

**1.1 開啟建立頁面**

- 組織擁有（建議，App 屬 yao-care）：
  `https://github.com/organizations/yao-care/settings/apps/new`
- 或個人帳號：`https://github.com/settings/apps/new`

**1.2 填寫註冊表單**（只列需要設定的欄位，其餘留空/預設）

| 欄位 | 設定值 |
|---|---|
| **GitHub App name** | 全域唯一，例如 `yao-care-geri-contrib`（若被佔用換一個） |
| **Homepage URL** | `https://smart-geri-cds.yao.care` |
| **Identifying and authorizing users** | 全部留空（不需要 user OAuth） |
| **Post installation** → Setup URL | 留空；Redirect on update 不勾 |
| **Webhook** → **Active** | **取消勾選**（本 Worker 不用 webhook） |
| Webhook URL / Secret | 取消 Active 後可留空 |
| **Permissions → Repository permissions → Issues** | **Read and write**（唯一需要的權限） |
| 其他所有 Repository / Organization / Account permissions | 全部維持 **No access** |
| **Subscribe to events** | 全部不勾 |
| **Where can this GitHub App be installed?** | **Only on this account**（限 yao-care） |

按頁面最下方 **Create GitHub App**。

**1.3 記下 App ID**

建立後進入 App 詳情頁（`.../settings/apps/<app-name>`），最上方 **About** 區有 **App ID**（純數字，例如 `123456`）→ 記下，這是 `GITHUB_APP_ID`。

**1.4 產生並下載 Private key**

同一頁往下捲到 **Private keys** 區 → 按 **Generate a private key** → 瀏覽器會自動下載一個 `*.private-key.pem`（這是 **PKCS#1** 格式，開頭 `-----BEGIN RSA PRIVATE KEY-----`）。
> 此檔只會出現這一次，請妥善保存；遺失就重新 Generate（舊的可刪）。**切勿 commit 進 git。**

**1.5 安裝 App 到 repo**

App 詳情頁左側選 **Install App** → 在 `yao-care` 那列按 **Install** → 選 **Only select repositories** → 勾 **`smart-geri-cds`** → **Install**。

**1.6 取得 Installation ID**

安裝完成後瀏覽器網址會變成：
```
https://github.com/organizations/yao-care/settings/installations/12345678
```
（個人帳號則是 `https://github.com/settings/installations/12345678`）
末段數字 `12345678` 就是 `GITHUB_INSTALLATION_ID`。
> 之後若忘記：App 詳情頁 → Install App → 點該安裝旁的齒輪（Configure），網址末段即是。

**到這裡你應有三項：App ID、Installation ID、`*.private-key.pem`（待步驟 2 轉 PKCS#8）。**

### 3. 轉換私鑰格式（PKCS#1 → PKCS#8）

⚠️ **必做**：Cloudflare Workers 使用 Web Crypto API，僅支援 **PKCS#8** 格式私鑰。
GitHub 下載的 `.pem` 是 **PKCS#1**（開頭 `-----BEGIN RSA PRIVATE KEY-----`），
未轉換會在執行時丟出 `Private Key is in PKCS#1 format, but only PKCS#8 is supported`。

```bash
openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt \
  -in /path/to/github-private-key.pem \
  -out /path/to/private-key-pkcs8.pem
```

轉換後 `private-key-pkcs8.pem` 開頭應為 `-----BEGIN PRIVATE KEY-----`。

### 4. 設置密鑰

進入 `workers/education-contribution/` 目錄後執行。
私鑰以「檔案重導向」寫入以**保留換行**（**不要** base64 編碼，Worker 直接把 PEM 字串交給簽章函式，不會解碼）：

```bash
# GitHub App ID（純數字）
echo -n "123456" | wrangler secret put GITHUB_APP_ID

# GitHub App 私鑰（PKCS#8 PEM，從檔案讀取以保留換行）
wrangler secret put GITHUB_APP_PRIVATE_KEY < /path/to/private-key-pkcs8.pem

# Installation ID（純數字）
echo -n "12345678" | wrangler secret put GITHUB_INSTALLATION_ID
```

**重要**: `ALLOWED_ORIGIN` 與 `GITHUB_REPO` 已在 `wrangler.toml` 的 `[vars]` 中設置，無需另行設為密鑰。

## 部署

進入 Worker 目錄並部署：

```bash
cd workers/education-contribution
pnpm install
wrangler deploy
```

部署成功後會輸出 Worker URL，類似：
```
✅ Deployed to https://education-contribution.<account>.workers.dev
```

記下 Worker URL，用於後續配置。

## 配置 Astro 專案

在主專案根目錄 `.env.local`（或 Cloudflare Pages 環境變數）加入：

```env
PUBLIC_CONTRIBUTION_WORKER_URL=https://education-contribution.<account>.workers.dev/education-contribution
```

（將 `<account>` 替換為實際的 Cloudflare 帳戶子域）

或在 Cloudflare Pages 專案設定中，於 Environment Variables 環節新增環境變數。

## 驗證部署（煙測）

使用 curl 測試 Worker 是否正常運作：

```bash
curl -X POST https://education-contribution.<account>.workers.dev/education-contribution \
  -H "Content-Type: application/json" \
  -H "Origin: https://smart-geri-cds.yao.care" \
  -d '{
    "type": "youtube",
    "top": "functional",
    "sub": "falls",
    "cfsLevel": "cfs5",
    "url": "https://www.youtube.com/watch?v=TEST_VIDEO_ID",
    "title": "測試影片"
  }'
```

> **注意**: 此指令會建立一個真實的 GitHub Issue，測試完畢後請手動關閉它。

預期成功回應（HTTP 201）：
```json
{
  "issueUrl": "https://github.com/yao-care/smart-geri-cds/issues/XXX"
}
```

常見錯誤排查：
- **CORS 錯誤**: 檢查 Origin header 是否為 `https://smart-geri-cds.yao.care`
- **GitHub auth 失敗**: 確認三個密鑰（App ID、Private Key、Installation ID）已正確設置
- **無效 payload**: 檢查 `type`、`top`、`sub`、`cfsLevel` 是否在有效值清單中

有效值清單（CGA 二層域 × CFS）：
- **type**: `youtube`, `article`, `external-link`, `edit-article`, `delete-article`, `delete-video`
- **top.sub**: `physical.{comorbidity,polypharmacy,nutrition,continence,sensory}`、`psychological.{cognition,mood,delirium}`、`functional.{adl,iadl,mobility,falls}`、`social.{social_support,caregiver,financial}`、`environmental.{home_safety,accessibility}`、`future_wishes.{advance_care_planning,treatment_preferences}`
- **cfsLevel**: `cfs1`…`cfs9`

## 持續部署

如需更新 Worker 邏輯，只需修改 `src/index.ts` 等檔案，再執行：
```bash
wrangler deploy
```

無需重新設置密鑰（Cloudflare 已保存）。

## 故障排除

### 密鑰過期或遺失

重新運行 `wrangler secret put <KEY_NAME>` 更新。

### Worker 返回 500 錯誤

檢查 Cloudflare Workers 控制台的日誌：
```bash
wrangler tail
```

### 無法連接到 GitHub API

確保網路連線正常，GitHub API 可達。檢查 GitHub App 是否已安裝到目標 repo（`yao-care/smart-geri-cds`）。

---

**最後維護**: 2026-05-25
