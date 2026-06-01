# 移除「問卷完成！」摘要頁，答完直接進結果頁

日期：2026-06-01
狀態：已批准（設計）

## 問題

問卷答完後會停在中繼「問卷完成！」摘要頁，該頁以一排**空的灰色長條** + 「0/8」「0/1」（得分/滿分）呈現各面向。視覺語言自相矛盾：

- 空灰條 = 大腦讀成「空的／沒填／0%」。
- 「0/N」看起來像「N 題答了 0 題」，實為得分/滿分（全正常 → 0 分）。
- 越健康（全正常）的個案，畫面越空、越像「沒做完」。
- 與第 3 步「評估結果」頁職責重疊（結果頁已有正確的彩色嚴重度長條）。

使用者亦曾因停在此頁未按「查看評估結果」而導致評估卡在 `started`／歷史顯示「未完成」（已於 `9d5a2ba` 修 finalise，但摘要頁本身的呈現問題仍在）。

## 決策

採方案 B：**移除中繼摘要頁**。問卷全部答完即自動進入第 3 步「評估結果」頁。

## 行為

| 觸發 | 現在 | 改成 |
|---|---|---|
| 答完最後一題（各層 resolved、無剩餘題/計時任務） | 進入 `summary` phase → 顯示摘要頁 → 手動按「查看評估結果」 | **finalise（算分流 + 寫 triageResult + 標 completed）→ `nextStep()` 進結果頁** |
| 過場畫面 | 摘要頁停留 | 結果頁既有的「正在產生評估結果…」（<1 秒）→ 顯示分流 |
| resume 一筆已答完但卡 `started` 的評估 | 進入 `summary` phase | 直接落在結果頁並 finalise（順帶自動修好舊卡住紀錄） |

## 範圍

**移除**
- `QuestionnaireModule.svelte` 的 `summary` phase UI 區塊（含 ✓「問卷完成！」、`scaleSummary` 灰條、「0/N」、「下一步／查看評估結果」按鈕、`handleFinish` 按鈕路徑）。
- `summary` phase 值（或保留為 transient「完成中」狀態，nextStep 落地前不渲染摘要 markup）。

**改為**
- 所有「問卷已全部答完」的收斂點，改呼叫單一 `finishQuestionnaire()`：`persistScoresToStore()` →（snapshot）`buildTriageResult` → `assessmentStore.finalize()` → `await assessmentStore.nextStep()`。
- finalise 在進結果頁**之前**完成（穩健：結果頁 mount 被中斷時評估仍 `completed`）。

**保留**
- `ResultView` mount 時的 finalise（idempotent 覆寫同一結果）。
- `buildTriageResult` 共用純函式為單一真相源。
- CFS 在基本資料頁選取（本次不動其呈現）。

## 邊界情況

- 「該 CFS 無任何適用量表 → 空問卷」：罕見（cfs1–9 皆有量表），維持現有空狀態處理，不在本次範圍。
- 進結果頁後無「上一步回問卷」：與現況相同（結果頁本就無 back）。

## 測試

- 調整 `QuestionnaireModule` 既有測試：不再有 `summary` phase 的預期；答完最後一題後 currentStep 應前進至 `result`、`triageResult` 已寫入、status=`completed`。
- 共用 `buildTriageResult` 測試維持不變。
- 實機（Playwright）：答完最後一題 → 自動到結果頁、IndexedDB 已 `completed`，無中繼摘要頁。

## 不做（YAGNI）

- 不改 CFS 呈現／加判定輔助（另開一輪）。
- 不加「結果頁→回問卷」返回鍵。
- 不保留任何形式的逐域作答摘要。
