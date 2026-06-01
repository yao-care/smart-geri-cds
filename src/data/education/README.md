# 衛教內容 — Markdown 文章單一來源（高齡周全性評估 CGA）

## 用途

每篇 markdown = 一篇高齡衛教**文章**（純文字）。**不放影片資料**。
文章對應到 CGA 評估結果（領域子項 × CFS 等級）的關聯，由 `content-relevance.yaml` 維護。

## Schema（見 `src/content.config.ts` 的 education collection）

```typescript
{
  title: string;
  summary: string;
  category: 'general';                                  // 高齡照護
  format: 'article';                                    // ← 僅允許 'article'
  publishedAt: Date;
  updatedAt?: Date;
  locale?: string;                                      // 預設 'zh-TW'
}
```

## 現有高齡衛教文章（slug → 對應 CGA 領域子項）

| slug | 主題 | 領域子項（top.sub） |
|---|---|---|
| `fall-prevention` | 跌倒預防 | functional.falls |
| `sarcopenia-exercise` | 肌少症與運動 | functional.mobility |
| `cognitive-training` | 認知促進與失智因應 | psychological.cognition |
| `depression-support` | 憂鬱與情緒支持 | psychological.mood |
| `delirium-awareness` | 譫妄認識與處理 | psychological.delirium |
| `medication-safety` | 多重用藥安全 | physical.polypharmacy |
| `geriatric-nutrition` | 長者營養 | physical.nutrition |
| `incontinence-care` | 尿失禁照護 | physical.continence |
| `sensory-impairment` | 視聽功能障礙因應 | physical.sensory |
| `comorbidity-management` | 共病管理 | physical.comorbidity |
| `advance-care-planning` | 預立醫療照護諮商（ACP） | future_wishes.advance_care_planning |
| `treatment-preferences` | 治療意願與 DNR | future_wishes.treatment_preferences |
| `caregiver-support` | 照顧者壓力與支持 | social.caregiver |
| `social-connection` | 社會連結與孤立預防 | social.social_support |
| `ltc-resources` | 經濟與長照資源 | social.financial |
| `home-safety` | 居家安全與無障礙 | environmental.home_safety / accessibility |
| `adl-maintenance` | 日常生活功能維持 | functional.adl / iadl |

## ❌ 禁止欄位

下列欄位**不可**出現在 markdown frontmatter；違反會被 `tests/data/education-no-video-fields.test.ts` 抓到：

- `videoUrl` — 影片網址移到 `src/data/video-catalog/<tier>.yaml`
- `triggerIndicators` — trigger 對應移到 `src/data/education/content-relevance.yaml`
- `format: "video"` / `format: "questionnaire"` — 影片走 yaml catalog；評估問卷走 scales

## 影片與 trigger 關聯放哪裡？

- **影片元資料**（title / channel / duration / sourceTier / score）→ `src/data/video-catalog/<tier>.yaml`
- **內容關聯**（哪個 `cga.domain.<top>.<sub>.anomaly.<cfs>` 對應哪些文章/影片、哪些領域在哪些 CFS 不適用）→ `src/data/education/content-relevance.yaml`

## 為什麼分兩套（markdown 文章 / yaml 影片 / yaml 關聯）

歷史上一度有 markdown frontmatter 帶 `videoUrl` 的設計，但發現 markdown 缺影片元資料、trigger 表達能力不足、雙資料來源造成 UI 渲染分岔。

統一決策：**markdown = 文章；video-catalog yaml = 影片；content-relevance yaml = 關聯與適用矩陣**。
**單一資料來源原則**由 schema + test 雙重守護。
