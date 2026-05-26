# Geri CGA — Phase 2（內容）Implementation Plan

> **For agentic workers:** Subagent-driven. 內容為主（YAML/Markdown 資料 + 少量 wiring）。全程保持 `pnpm check/lint/test/build` 綠。

**Goal:** 把 Phase-1 骨架填成可實際操作的純問卷版 CGA：完整量表、適用矩陣、高齡衛教、內容關聯，刪除兒科內容，影片清理/重 curate，殘留兒科字串清乾淨。

**重要原則：** 採用**公開可自由使用的標準量表**，忠實轉錄其題目/計分/切分點（非杜撰臨床數值）；全部 `clinicallyReviewed: false`，待臨床最終簽核（題目中譯、適用 CFS、切分點）。`maxScore` 必須等於各題 option 最高分之和。`applicableCfs` 要讓 **cfs1–cfs9 每一級都至少有 1 個可施測量表**（否則結果頁空白）。

---

## P2-A：量表（`src/data/scales/*.yaml`）

每個檔對齊現有 `gds-15.yaml` 結構（id / domain{top,sub} / applicableCfs / scoring / inputType / maxScore / items / bands / clinicallyReviewed:false）。`inputType: option`（沿用現有問卷 UI；**不可用 numeric**，數值元件延後）。`scoring`: `sum`（多數）、`error-count`（SPMSQ）、`weighted`（CCI）。`bands` 用 min/max 對應 severity（normal/monitor/refer）——方向由 bands 決定（higher=better 的量表把 normal 放高分段）。

| 檔名 | top.sub | 量表 | scoring | maxScore | bands（severity 切分，clinicallyReviewed:false 待審） | applicableCfs |
|---|---|---|---|---|---|---|
| `spmsq.yaml` | psychological.cognition | SPMSQ 10 題 | error-count | 10 | 0–2 normal／3–4 monitor／5–10 refer（錯誤數） | cfs1–cfs8 |
| `gds-15.yaml` | psychological.mood | GDS-15 全 15 題 | sum | 15 | 0–4 normal／5–9 monitor／10–15 refer | cfs1–cfs7 |
| `4at.yaml` | psychological.delirium | 4AT（alertness/AMT4/attention/acute change） | sum | 12 | 0 normal／1–3 monitor／4–12 refer | cfs4–cfs9 |
| `barthel.yaml` | functional.adl | Barthel Index 10 項 | sum | 100 | ≥91 normal／61–90 monitor／0–60 refer（higher=better） | cfs3–cfs9 |
| `lawton-iadl.yaml` | functional.iadl | Lawton IADL 8 項 | sum | 8 | 8 normal／6–7 monitor／0–5 refer（higher=better） | cfs3–cfs9 |
| `mobility-screen.yaml` | functional.mobility | 行動自述（行走/起身/樓梯困難）4 題 | sum | 8 | 0–1 normal／2–4 monitor／5–8 refer | cfs2–cfs7 |
| `steadi-falls.yaml` | functional.falls | STEADI 跌倒風險關鍵問題（跌倒史/不穩/擔心跌倒…） | sum | （題數） | 0 normal／1 monitor／≥2 refer | cfs2–cfs8 |
| `mna-sf.yaml` | physical.nutrition | MNA-SF 6 項 | sum | 14 | 12–14 normal／8–11 monitor／0–7 refer | cfs1–cfs9 |
| `cci.yaml` | physical.comorbidity | Charlson CCI 加權共病清單 | weighted | （權重和上限） | 0 normal／1–2 monitor／≥3 refer | cfs2–cfs9 |
| `polypharmacy.yaml` | physical.polypharmacy | 用藥顆數分級 + 高風險藥(Beers)旗標 | sum | （設計） | 0 normal／monitor(≥5 種)／refer(≥10 或高風險) | cfs2–cfs9 |
| `continence-screen.yaml` | physical.continence | 失禁自述短篩（頻率） | sum | （題數） | 對應 normal/monitor/refer | cfs3–cfs9 |
| `sensory-screen.yaml` | physical.sensory | 視/聽自述各 1–2 題 | sum | （題數） | 無困難 normal／單項 monitor／雙項或重度 refer | cfs1–cfs9 |
| `lsns-6.yaml` | social.social_support | Lubben LSNS-6 | sum | 30 | ≥12 normal／6–11 monitor／0–5 refer（higher=better，社會孤立） | cfs2–cfs9 |
| `zarit-12.yaml` | social.caregiver | Zarit Burden ZBI-12 | sum | 48 | 0–10 normal／11–20 monitor／≥21 refer | cfs4–cfs9 |
| `financial-screen.yaml` | social.financial | 經濟壓力自述短篩 | sum | （題數） | 對應 | cfs3–cfs9 |
| `home-safety.yaml` | environmental.home_safety | 居家跌倒危害檢核（地毯/照明/扶手/浴廁…） | sum | （題數） | 0 normal／1–2 monitor／≥3 refer（危害數） | cfs3–cfs8 |
| `accessibility-screen.yaml` | environmental.accessibility | 輔具/可及性自述 | sum | （題數） | 對應 | cfs4–cfs9 |
| `acp-status.yaml` | future_wishes.advance_care_planning | ACP 完成度（是否有預立醫療決定/醫療委任代理人/已討論） | sum | （題數） | 全完成 normal／部分 monitor／未開始 refer（鼓勵 ACP） | cfs5–cfs9 |
| `treatment-pref.yaml` | future_wishes.treatment_preferences | DNR/維生醫療意願記錄狀態 | sum | （題數） | 對應 | cfs5–cfs9 |

> 每級覆蓋檢查：cfs1{spmsq,gds-15,mna-sf,sensory}；cfs9{4at,barthel,lawton,mna-sf,cci,polypharmacy,continence,sensory,lsns-6,zarit,financial,accessibility,acp,treatment-pref}。每級皆 ≥1。
> 標準量表（SPMSQ/GDS-15/4AT/Barthel/Lawton/MNA-SF/CCI/STEADI/LSNS-6/Zarit）忠實轉錄公開版本；自述短篩（mobility/sensory/continence/financial/home-safety/accessibility/polypharmacy/ACP/treatment-pref）以實證合理題目組成。全部 clinicallyReviewed:false。
> 驗證：`pnpm build`（scales collection Zod 通過）、`pnpm dev` 流程每個 cfs 級至少出題。

## P2-B：適用矩陣 + 衛教 + 內容關聯

1. **刪兒科文章**：`git rm` 全部 `src/data/education/*.md`（behavior-guidance, *-motor-*, language-*, milestones/, nutrition-grow-tall/calcium-tofu/garlic/okra/vitamin-d, social-emotional-guide, when-to-seek-help, cognitive-play, diet-control, exercise-guide, respiratory-care, sleep-hygiene...）。保留 README.md（改寫為高齡）。
2. **寫高齡衛教** `src/data/education/*.md`（frontmatter: title/summary/domain 對應）：跌倒預防、肌少症與運動、認知促進、憂鬱與情緒支持、譫妄認識、多重用藥安全、長者營養(MNA)、尿失禁照護、視聽障礙因應、預立醫療照護諮商(ACP)、照顧者支持、居家安全改造、社會參與。每篇對應 1+ 領域子項。
3. **適用矩陣** `content-relevance.yaml` `inapplicable:`：依 spec 草案（future_wishes/delirium 偏 cfs5–9；adl/iadl cfs4–9；mobility/falls cfs3–7；cfs1–2 多數子項標不評，僅留篩檢層）。**與 scales 的 applicableCfs 邏輯一致**。
4. **content-relevance `triggers:`**：把衛教文章掛到 `cga.domain.<top>.<sub>.anomaly.<cfs>` 格（articles 標 severities=[monitor,refer] 等），讓結果頁/矩陣有內容。videoIds 可先空。
5. 守門：`content-index-parity`、`questionnaire-coverage` 重新跑綠（適用格規則一致；空格允許 contributable）。

## P2-C：影片 + curate 種子 + 殘留清理

1. **清兒科影片**：清空/重置 `src/data/video-catalog/pro-kol.yaml`（789 行兒科）、official-tw/international；保留結構。
2. **curate 種子改高齡**：`scripts/curate/channel-seeds.json`（高齡/老年醫學/長照頻道，如國健署、各醫院老年醫學科、長照相關；移除兒科黃瑽寧）、`scripts/curate/keywords.json`（跌倒預防、肌少症、失智、長者營養、用藥安全…）。**嘗試** `pnpm curate:videos`；若沙箱無法抓 YouTube，留空 catalog（影片為選用，parity 允許空格）並註記需 Phase 4 operator 跑 curate。
3. **殘留兒科字串**：`src/pages/education/[...slug].astro`（「發展里程碑」分類標籤→CGA 領域）、`src/pages/admin/card-review.astro`（「兒童」）、`site-faqs`/README 等掃一遍。

## 收尾
- `pnpm check && pnpm lint --max-warnings 10 && pnpm vitest run && pnpm build` 全綠。
- 合併 main → 部署 → 以 `--resolve` 實測 `https://smart-geri-cds.yao.care/` 渲染 + 跑一次評估流程確認每 cfs 級出題、結果頁有衛教。

## 非本計畫（需用戶/外部）
- 貢獻 Worker 部署（GitHub App secrets：APP_ID/PRIVATE_KEY(PKCS#8)/INSTALLATION_ID/REPO + `PUBLIC_CONTRIBUTION_WORKER_URL` repo variable）。
- 量表/切分點/中譯的臨床最終簽核（clinicallyReviewed→true）。
- 真實 YouTube 影片 curate（若沙箱受限）。
