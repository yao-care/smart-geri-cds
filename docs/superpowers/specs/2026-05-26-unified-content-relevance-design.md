# 統一衛教內容關聯系統 — 設計文件

**日期**: 2026-05-26
**狀態**: 設計中，待用戶 review
**相關**: `src/data/education-videos/`, `src/data/recommendations/`, `src/lib/education/`, `src/lib/db/recommendations.ts`, `scripts/build-video-index.ts`

---

## 背景與問題

目前有**三套獨立**的「內容 ↔ 情境」對應，同一篇文章要在多個檔案各登記一次，沒有單一真相源：

| 系統 | 來源檔 | 軸 | 引入時間 |
|------|--------|-----|----------|
| ① 矩陣瀏覽 | `src/data/education-videos/cdsa-domains.yaml` | 領域 × 年齡 | 2026-05-25 |
| ② 評估後推薦 | `src/data/recommendations/default.json` | 分流類別 × 領域（無年齡）+ 租戶 overlay | 2026-05-14 |
| ③ 觸發影片 | `education-videos/*.yaml`（cdsa-domains / cdsa-triage / cdss-vital-signs） | trigger（領域×年齡 / cdss / triage） | 2026-05-19 |

**痛點**：`gross-motor-activities` 同時登記在 ①（cdsa-domains.yaml）和 ②（default.json），改一邊忘另一邊就不一致。①③ 其實共用同一份 yaml，真正分家的是 ②（軸不同：用分流類別、無年齡）。這是「每次加新功能就多一套設定、不管以前」累積出來的。

---

## 已確認決策

- **D1**：單一真相源涵蓋**全部三視圖**（矩陣瀏覽 / 評估後推薦 / 觸發影片），含發展領域與臨床（CDSS 生理警示 + 轉介）。
- **D2**：租戶自訂**只保留在「評估後推薦」層**；矩陣與觸發影片是全站共用基底，不可租戶覆寫。
- **D3**：評估後推薦**改為看年齡**（依小孩年齡只送適齡內容）。這使「領域×年齡×嚴重度」一套座標就能驅動三視圖。
- **D4**：採**方向 B — 單一中央關聯檔**。`default.json` 刪除、其資料折入單一源；①③ 的 yaml 收斂為同一份；三視圖全部從它投影。

---

## 架構：單一真相源 → 編譯 → 三投影

```
單一來源（內容導向，每筆內容只宣告一次）
        │  scripts/build-content-index.ts（取代 build-video-index.ts）
        ▼
public/data/content-index.json（編譯產物，含 catalog + 關聯）
        │
   ┌────┴─────────────┬──────────────────────┐
   ▼                  ▼                       ▼
矩陣瀏覽           評估後推薦                觸發影片
(領域×年齡)     (領域×年齡×嚴重度          (trigger 查找)
零 JS Astro      + 租戶 overlay)           video-lookup
                 ResultView/EducationMatch  TriggerVideoList
```

### 單一來源（內容導向）

每個內容項目（文章或影片）**只宣告一次**它的關聯，用多值陣列取代「一格一列」的重複：

```yaml
# src/data/education/content-relevance.yaml（唯一關聯真相源，含「不適用」定義）
inapplicable:                 # 哪些 領域×年齡 不評估（取代 inapplicable-matrix.json）
  behavior: [2-6m, 7-12m]
  fine_motor: [2-6m]
  language: [2-6m]
  cognition: [2-6m, 7-12m]
  language_comprehension: [2-6m]
  language_expression: [2-6m, 7-12m]
  social_emotional: [2-6m]
  # gross_motor：無（全年齡適用）

relevance:                    # 每個內容項目只宣告一次
  - ref: { type: article, slug: gross-motor-activities }
    cdsa:
      domains: [gross_motor]
      ageGroups: [2-6m, 7-12m, 13-24m, 25-36m, 37-48m, 49-60m, 61-72m]
      severities: [monitor, refer]   # 哪些分流結果適用（normal/monitor/refer）

  - ref: { type: article, slug: when-to-seek-help }
    cdsa: { domains: [all], severities: [refer] }
    clinical: [cdsa.triage.refer.*]  # 臨床觸發（cdss/triage trigger 字串，支援 * 萬用）

  - ref: { type: article, slug: respiratory-care }
    clinical: [cdss.respiratory_rate.critical.*]

  - ref: { type: video, videoId: yzRi9GlSptM }
    cdsa: { domains: [language], ageGroups: [13-24m] }
```

### 「一個檔」的邊界（100% 承諾）

**所有「內容 ↔ 情境」的關聯、嚴重度、臨床觸發、不適用定義 —— 100% 只在 `content-relevance.yaml` 這一個檔。** 沒有第二個關聯檔，`default.json` 與三份 education-videos yaml、`inapplicable-matrix.json` 全部刪除。

唯一留在別處的，是**內容項目自己的事實資料**（不是關聯）：
- 文章本文 → `src/data/education/*.md`（文章的內容）
- 影片事實 → `src/data/video-catalog/*.yaml`（標題/頻道/時長/驗證狀態，等同 YouTube 的客觀 metadata）

判準很簡單：**「這篇/這支該出現在哪」= 關聯 = 進唯一檔；「這篇/這支本身是什麼」= 內容自己的資料 = 留在內容檔。** 新增或搬移一篇文章的出現位置，永遠只改 `content-relevance.yaml` 一處。

### 三視圖投影邏輯（純函式，可單測）

- **矩陣瀏覽**：對每個 (domain, age) cell，收集 `cdsa.domains ∋ domain && ageGroups ∋ age` 的內容（不分嚴重度）。
- **評估後推薦**：給 (anomalousDomain, childAge, triageCategory)，收集 `domains∋d && ageGroups∋age && severities∋category` 的文章，**再疊租戶 overlay**。
- **觸發影片**：給 trigger 字串，收集 `clinical` 命中該 trigger（或 cdsa 投影出的對應 trigger）的影片。

### 租戶 overlay（只在推薦層）

- 沿用現有 IndexedDB overlay 機制，但 key 改為 `tenant::category::domain::ageGroup`（加入年齡，配合 D3）。
- overlay 疊在「評估後推薦」投影結果上（預設清單 + 租戶增減），矩陣/觸發不受影響。

---

## 遷移（重點：清掉現有三套，不留殘骸）

| 現有檔案 | 動作 |
|----------|------|
| `src/data/recommendations/default.json` | **刪除**；內容折入 `content-relevance.yaml` 的 `severities` 標記 |
| `src/data/education-videos/cdsa-domains.yaml` | **遷移**進 `content-relevance.yaml` 後刪除 |
| `src/data/education-videos/cdsa-triage.yaml` | **遷移**進 `clinical` 後刪除 |
| `src/data/education-videos/cdss-vital-signs.yaml` | **遷移**進 `clinical` 後刪除 |
| `scripts/curate/inapplicable-matrix.json` | **遷移**進 `content-relevance.yaml` 的 `inapplicable` 區後刪除 |
| `scripts/build-video-index.ts` | 改寫為 `scripts/build-content-index.ts`，產出 `content-index.json` |
| `public/data/video-index.json` | 由 `content-index.json` 取代（更新所有 import） |
| `src/lib/db/recommendations.ts` | 改寫：投影自 content-index + 套 overlay（年齡感知） |
| `src/lib/education/matrix-data.ts` | 改為投影自 content-index |
| `src/lib/education/video-lookup.ts` | 改為投影自 content-index |
| `src/lib/education/schemas.ts` | 更新 schema（content-relevance + 新 runtime index） |
| `src/content.config.ts` | education frontmatter 不變（關聯不放 frontmatter，維持方向 B） |
| 消費端 | `index.astro`、`ResultView`/`EducationMatch`、`TriggerVideoList`/`EducationRelatedVideos`、`[...slug].astro`、`/settings/recommendations` 改接新投影 API |

遷移驗證：build 後比對「遷移前 video-index.json + default.json 表達的關聯」與「遷移後 content-index.json 投影結果」逐筆一致（migration parity test），確保沒有任何內容掉落或改變行為（除 D3 年齡感知為刻意行為變更）。

---

## 不在本次範圍

- 不改文章本文內容、不改影片 catalog metadata。
- 不改 CDSA 評估演算法、triage 計算、FHIR 流程。
- 不新增內容（純策展是另一條工作）。
- 不把租戶自訂擴大到矩陣/觸發（D2 維持現狀）。

---

## 成功標準

1. `content-relevance.yaml` 是唯一宣告「內容 ↔ 情境」的地方；新增/搬移一篇文章只改這一處。
2. `default.json`、三份 education-videos yaml、`inapplicable-matrix.json` 全部刪除，無重複登記。關聯只在 `content-relevance.yaml` 一處。
3. 三視圖行為：矩陣（10 不適用 / 其餘可貢獻，現有內容如實顯示）、推薦（年齡感知 + 租戶 overlay 仍可用）、觸發影片（與遷移前一致）。
4. migration parity test 通過：除年齡感知外，關聯關係與遷移前等價。
