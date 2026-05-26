# 影片 Catalog — YAML 影片元資料

## 用途

本目錄存「衛教影片」的**元資料（catalog）**。影片/文章 **↔ 評估情境的關聯**統一放在
`src/data/education/content-relevance.yaml`（唯一關聯源）。**Markdown 不放影片**（schema 已禁止）。

## 結構

```
src/data/video-catalog/        # 影片本身的元資料（catalog，本目錄）
├── official-tw.yaml           # Tier 1 — 台灣官方頻道（國健署、衛福部、各醫院高齡醫學科）
├── international.yaml          # Tier 2 — 國際認證頻道（WHO、AGS、NICE、Cleveland Clinic 等）
└── pro-kol.yaml               # Tier 3 — 醫療專業 KOL（老年醫學/長照/失智/跌倒預防醫師頻道）

src/data/education/content-relevance.yaml   # 唯一關聯源：
#   inapplicable           哪些 領域×年齡 不評估
#   triggers[]             每個情境格的 videoIds + articles(可帶 severities/browse)
#   clinicalAlertEducation closed-loop 警示用 indicator → 文章
```

## Catalog item schema（每支影片）

```yaml
- videoId: "abc123XYZ45"            # YouTube 11 字元 ID
  title: "..."
  channel: "..."
  channelId: "UC..." (22 字元 UC* 開頭)
  duration: 514                     # 秒
  publishedAt: "2024-03-15"
  language: "zh-Hant" | "en"
  subtitleType: "human" | "auto" | "none"
  sourceTier: "official-tw" | "international" | "pro-kol"
  viewCount: 161421
  curatedAt: "2026-05-21"
  verifiedBy: "claude-code" | "manual"
  verificationStatus: "verified" | "rejected"
  score: 0.85                       # heuristics 0-1
  notes: "..."                      # 自由說明（複審 + 來源備註）
```

## 關聯（影片對應到評估情境）

要讓某支影片出現在某情境，在 `content-relevance.yaml` 的對應 trigger 把 videoId 加進該格 `videoIds`：

```yaml
triggers:
  - trigger: cga.domain.functional.falls.anomaly.cfs4
    videoIds: []
    articles:
      - { slug: fall-prevention }
```

trigger 字串格式：`cga.domain.<top>.<sub>.anomaly.<cfs>`（高齡周全性評估 CGA）。

## 維護流程（新增影片）

1. **找 YouTube 影片**（人工挑選，或 `pnpm curate:videos` 自動 curate）
2. **抓 metadata**：`yt-dlp --skip-download --print "%(id)s|%(title)s|..." "https://www.youtube.com/watch?v=<id>"`
3. **寫進對應 tier yaml**：依頻道身分判斷 official-tw / international / pro-kol
4. **加關聯**：在 `content-relevance.yaml` 對應 trigger 的 `videoIds` 加 videoId
5. **rebuild + 測試**：
   ```bash
   pnpm build   # prebuild 跑 build-content-index 重產 public/data/video-index.json
   pnpm test    # 含 content-index-parity / trigger-uniqueness / education-slug-integrity
   ```
6. **commit + push**

## ❌ 不要

- **不要**把影片寫進 `src/data/education/*.md` 的 frontmatter
- **不要**省略 channelId（schema 強制 `UC[A-Za-z0-9_-]{22}` 格式）
- **不要**直接編輯 `public/data/video-index.json`（由 build script 產出）

## 自動化工具

- `scripts/curate-videos.ts` — yt-dlp 自動搜尋 + heuristics 評分 + 產 report
- `scripts/build-content-index.ts` — 由 `content-relevance.yaml` + 本目錄 catalog 產 `public/data/video-index.json`（含 parity 守護）

## 測試守護

- `tests/data/education-no-video-fields.test.ts` — markdown 不可含 videoUrl / triggerIndicators / format=video
- `tests/data/trigger-uniqueness.test.ts` — `content-relevance.yaml` trigger key 唯一
- `tests/data/education-slug-integrity.test.ts` — `articles[].slug` 對應 markdown 真實存在
- `tests/education/content-index-parity.test.ts` — 重構前後 index 行為等價
