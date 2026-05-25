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

### 1. 取得 GitHub App 認證資料

若尚未建立 GitHub App，請：
1. 前往 https://github.com/settings/apps (或組織設定)
2. 建立新 App（或使用現有的）
3. 記下：
   - **App ID** (在 App 詳情頁)
   - **Installation ID** (見下方)
   - **Private key** (下載 .pem 檔案)

### 2. 查詢 Installation ID

最簡單的方式是透過 GitHub UI：

> 前往 GitHub → Settings → Developer settings → GitHub Apps → yao-care-app → Install App → 點擊已安裝的組織/repo → URL 中即有 Installation ID
> 
> 例如：`https://github.com/settings/installations/12345678` 中的 `12345678` 就是 Installation ID

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
  -H "Origin: https://smart-pedi-cds.yao.care" \
  -d '{
    "type": "youtube",
    "domain": "language",
    "ageGroup": "13-24m",
    "url": "https://www.youtube.com/watch?v=TEST_VIDEO_ID",
    "title": "測試影片"
  }'
```

> **注意**: 此指令會建立一個真實的 GitHub Issue，測試完畢後請手動關閉它。

預期成功回應（HTTP 201）：
```json
{
  "issueUrl": "https://github.com/yao-care/smart-pedi-cds/issues/XXX"
}
```

常見錯誤排查：
- **CORS 錯誤**: 檢查 Origin header 是否為 `https://smart-pedi-cds.yao.care`
- **GitHub auth 失敗**: 確認三個密鑰（App ID、Private Key、Installation ID）已正確設置
- **無效 payload**: 檢查 `type`、`domain`、`ageGroup` 是否在有效值清單中

有效值清單：
- **type**: `youtube`, `article`, `external-link`
- **domain**: `behavior`, `gross_motor`, `fine_motor`, `language`, `language_comprehension`, `language_expression`, `cognition`, `social_emotional`
- **ageGroup**: `2-6m`, `7-12m`, `13-24m`, `25-36m`, `37-48m`, `49-60m`, `61-72m`

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

確保網路連線正常，GitHub API 可達。檢查 GitHub App 是否已安裝到目標 repo（`yao-care/smart-pedi-cds`）。

---

**最後維護**: 2026-05-25
