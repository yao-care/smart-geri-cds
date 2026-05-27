# 行動評估改造：相機錄影 + 自測計時的五次坐立測試（FTSTS）

日期：2026-05-27
分支：`feat/geri-mobility-task`

## 目標

把 `functional.mobility` 由「純自述短篩」升級為「受測者於電腦前、固定鏡頭、自測計時」的
**五次坐立測試（Five-Times Sit-to-Stand, FTSTS / 5×STS）**：受測者點「開始」→ 計時與錄影同時開始 →
連續做 5 次「完全站起來再坐下」→ 第 5 次坐下後點「完成」→ 計時與錄影停止。結果＝完成總秒數 → severity；
錄影僅存本機供臨床檢視。任何相機/權限失敗皆能無縫退回自述題組，流程不卡住。

## 量表覆蓋決策（mobility-screen 去留 + CFS 覆蓋）

- 新增 `src/data/scales/sit-to-stand.yaml`：`functional.mobility`、`inputType: timed-task`、
  `scoring: measured-value`、`maxScore: 30`（雷達正規化上限）、秒數分段
  正常 ≤12s / 追蹤 13–15s / 轉介 ≥16s、`applicableCfs: [cfs2..cfs6]`、`clinicallyReviewed: false`。
- `src/data/scales/mobility-screen.yaml` **保留但限縮為 `applicableCfs: [cfs7]`**。
  理由：重度衰弱者（cfs7）難以可靠完成 5 次坐立，改以自述較合適；且每個 CFS 只有一個
  `functional.mobility` 量表（cfs2–6 = sit-to-stand；cfs7 = mobility-screen），**不會雙重渲染**。
- 相機失敗時的 fallback 內容放在 `src/data/mobility-fallback.ts`（非 content-collection 的純資料），
  題目/分段與 mobility-screen 完全一致（兩處需手動同步，已於檔頭註明）。
- **CFS 覆蓋驗證**：改造前 mobility 覆蓋 cfs2–cfs7；改造後 cfs2–cfs7 仍全部有 mobility 量表，
  **無任何 CFS 失去既有 mobility 覆蓋**。每個 CFS 仍有 ≥1 個量表（最少 cfs1 = 4 個）。

## 計分路徑（uniform ScaleResult）

`scale.ts` 的 `inputType` union 加入 `'timed-task'`；`scoreScale` 既有的數值 band 查找直接適用
（秒數對 bands，higher=worse）。新增 `elapsedSecondsToSeverity()` 薄包裝供 UI 即時預覽。

三種收尾都產出同一形狀的 `ScaleResult`（`functional.mobility`）：

| 路徑 | rawScore | severity | 來源量表 |
|---|---|---|---|
| 計時完成 | 完成秒數（≥1，四捨五入） | scoreScale(sit-to-stand, 秒) | sit-to-stand |
| 「無法完成」 | null | refer（強制） | sit-to-stand |
| 相機失敗 / 「無法錄影或不便」→ 自述 | 0–8 總分 | scoreScale(fallback, 總分) | mobility-screen |

因 fallback 用「別的量表 bands」、「無法完成」要強制 refer，這些 rawScore↔severity 無法用
sit-to-stand 單一量表的 bands 重建，所以改用 **pre-computed ScaleResult** 機制：

- `PartialAnalysis` 新增 `scaleResults?: Record<scaleId, ScaleResult>`。
- `MobilityTaskModule` 透過 `onResult` 回傳已計分的 ScaleResult，`QuestionnaireModule` 存入
  `assessmentStore.partialAnalysis.scaleResults`。
- `ResultView.buildScaleResults()` 對有 pre-computed 結果的量表 **優先採用**，否則沿用 option 量表的
  「累計原始分 → scoreScale」舊路徑。option 量表行為完全不變。

## QuestionnaireModule 分流

- 把 applicable scales 拆成 `timedScales`（inputType === 'timed-task'）與 `optionScales`。
- phase：`timed`（逐一跑計時模組）→ `asking`（option 題目）→ `summary`。
  入口 phase 由 `$effect` 在 scales/cfs resolve 後決定（有計時量表先 timed）。
- timed phase 渲染 `<MobilityTaskModule>`（不是選項按鈕）；完成回 `handleTimedResult` 存結果並前進。

## DB

- `src/lib/db/schema.ts`：新增 `MobilityRecording {id, assessmentId, scaleId, blob, mimeType, durationSec, createdAt}`，
  Dexie 版本鏈加 `this.version(2).stores({ mobilityRecordings: 'id, assessmentId, scaleId, createdAt, [assessmentId+scaleId]' })`。
- `src/lib/db/mobility-recordings.ts`：`saveMobilityRecording` / `getMobilityRecording` /
  `getMobilityRecordingsForAssessment` / `getLatestMobilityRecording`。

## 結果頁播放

- 醫師檢視 `src/components/patient/ResultDetail.svelte`：以 `URL.createObjectURL` 載入本機錄影 `<video controls>`，
  effect 卸載時 `revokeObjectURL`；無錄影（fallback / 無法完成 / FHIR 來源）時整段不渲染。
- 受測者面向頁（ResultView / ResultViewWrapper）維持以 triage/radar 呈現 mobility 的 elapsed＋severity，
  不另外播放臨床錄影。

## 隱私

- 錄影 Blob 只存本機 IndexedDB；DAO/元件皆不上傳、不寫入 PDF、不 `console.log` blob/PII。
- `AssessmentPdfReport.svelte` 不引用 recording/blob（grep 確認）。
- UI 明示「錄影僅儲存在本機瀏覽器，供臨床檢視，不會上傳。」

## 相機特徵偵測（SSR/jsdom 安全）

`cameraSupported()` 守 `navigator.mediaDevices?.getUserMedia` 與 `window.MediaRecorder`，
缺任一即走 fallback。jsdom 無這些 API → 元件自動顯示自述題組（component test 驗證此路徑與其計分）。

## 待真實瀏覽器驗證

- getUserMedia 權限流、MediaRecorder 錄製/停止與 Blob 完整性、IndexedDB Blob round-trip、
  `<video>` 回放（fake-indexeddb 在 jsdom 不保留 Blob 身分，故僅在瀏覽器驗證）。
- 自測計時的臨床信效度未驗證 → 僅篩檢、`clinicallyReviewed: false`。
