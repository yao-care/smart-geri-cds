# 受測者身分管理（沿用既有受測者 + 合併重複）設計

- 日期：2026-06-04
- 狀態：設計待審
- 範圍：`/assess` 開始評估流程、`/history` 評估紀錄頁、`src/lib/db` 資料層、`assessment.svelte.ts` store

## 1. 背景與問題

CGA（高齡周全性評估）本質是**縱貫追蹤**工具：同一位長者會多次評估，比較歷次變化。但目前流程無法達成此目的。

**根因（程式碼證據）：**

1. `/assess` 唯一入口 `AssessmentShell → SubjectProfile` 是全空白表單，**沒有任何「沿用既有受測者」的 UI**。
2. 送出後 `assessment.svelte.ts` 的 `startNew()` 無條件 `id: crypto.randomUUID()` 建新 child（`db.children.put`）。因 id 每次都是新 UUID，**永遠新增、從不沿用**。
3. `getAllChildren()` 只在歷史頁列出，建檔流程不查既有。

**後果：** 同一長者每次評估都成為新受測者。實測 IndexedDB 中 6 位受測者有 5 位是同一人（同生日 `1982-04-30`、同暱稱、僅 id 不同）。歷史頁 `getAssessmentsForChild(child.id)` 因此無法以「同一人」聚合其歷次評估，「比較／趨勢」功能形同虛設。

**非問題（不修）：** 空生日是刻意設計（`SubjectProfile.svelte` 註解：DOB optional、record-only、CFS 為唯一 submit gate），不在本設計範圍。

## 2. 目標與非目標

**目標：**

- 開始評估時可**沿用既有受測者**（共用同一 `child.id`），使縱貫追蹤成立。
- 兩條發起路徑：歷史頁「再次評估」、開始評估頁「選既有受測者」。
- 選既有後基本資料（生日／暱稱／性別）**可改並回寫**該受測者。
- **合併**現有重複受測者：手動多選 → 選主檔 → 轉移評估 + 刪除被併者。

**非目標（YAGNI / 本次不做）：**

- 自動偵測「疑似同一人」與自動去重（生日選填、同名同生日不一定同人，不可靠）。
- 多分頁 BroadcastChannel 協調合併後刷新（沿用現有機制；列為後續）。
- 把空生日 `''` 正規化為 `undefined`（無邏輯影響）。

## 3. 已確認的需求決策

| 決策點 | 結論 |
|---|---|
| 發起路徑 | 歷史頁「再次評估」**與** 開始評估頁「選既有」兩者都做 |
| 選既有後基本資料 | 可改，並**回寫**更新該受測者 |
| 合併 scope | **含**合併功能 |
| 合併觸發 | 手動多選 → 選主檔（保留主檔資料） |
| 開始評估頁 UX | 同頁頂部「新增／沿用既有」切換 |
| CFS／知情者／本人可作答 | 每次評估必填，**不**從上次帶入（屬本次臨床事實） |

## 4. 架構與資料流

```
歷史頁「再次評估」 ──┐
                    ├─► /assess?subject=<childId> ─► AssessmentShell 讀 param
開始評估頁「選既有」─┘                                  │
                                                        ▼
                                          SubjectProfile（含 SubjectSelector）
                                            mode=new      → startNew(childData,…)        → 新建 child（隨機 id）
                                            mode=existing → startForExisting(child,…)    → updateChild(若有改) + createAssessment(既有 child.id)

歷史頁「管理／合併」模式 ─► 多選 child ─► SubjectMergeDialog ─► mergeChildren(primaryId, others)
                                                                  │（單一 transaction）
                                                                  ├─ assessments.childId(others) → primaryId
                                                                  └─ children.bulkDelete(others)
```

## 5. 資料層（`src/lib/db/assessments.ts`）

### 5.1 `updateChild`

```ts
export async function updateChild(child: Child): Promise<void> {
  await db.children.put(child); // 同 id 即更新；呼叫端須帶原 id 與原 createdAt
}
```

### 5.2 `mergeChildren`

```ts
/**
 * 把 mergedIds 的所有 assessment 轉移到 primaryId，並刪除 mergedIds 的 children。
 * 單一 transaction 確保原子性：任一步失敗則全部回滾，不留孤兒 assessment。
 */
export async function mergeChildren(primaryId: string, mergedIds: string[]): Promise<void> {
  const targets = mergedIds.filter((id) => id !== primaryId); // 防呆：主檔不可在被併清單
  if (targets.length === 0) return;
  await db.transaction('rw', db.children, db.assessments, async () => {
    const orphaned = await db.assessments.where('childId').anyOf(targets).toArray();
    await Promise.all(
      orphaned.map((a) => db.assessments.update(a.id, { childId: primaryId, updatedAt: new Date() })),
    );
    await db.children.bulkDelete(targets);
  });
}
```

### 5.3 `loadSubjectsWithStats`

供開始評估頁清單與歷史頁共用（消除目前歷史頁內聯的重複統計邏輯）。

```ts
export interface SubjectWithStats {
  child: Child;
  assessmentCount: number;
  lastAssessedAt: Date | null; // completedAt ?? startedAt 的最大值
}
// 依 lastAssessedAt 倒序（最近評估者優先；無評估者 lastAssessedAt=null 排末）。
export async function loadSubjectsWithStats(): Promise<SubjectWithStats[]>;
```

## 6. Store（`src/lib/stores/assessment.svelte.ts`）

維持 `startNew`（新建路徑）不變以保回歸；新增獨立的沿用路徑：

```ts
/** 沿用既有受測者：保留其 id 與 createdAt，只回寫可變欄位，不新建 child。 */
async startForExisting(
  child: Child,                       // 編輯後的完整 child（含原 id、原 createdAt）
  cfsLevel: CfsLevel,
  availability: { informantAvailable: boolean; patientAble: boolean },
): Promise<void> {
  this.isLoading = true;
  this.error = null;
  try {
    const existing = await assessmentDao.getChild(child.id);
    if (!existing) throw new Error('該受測者已不存在，請重新選擇');
    await assessmentDao.updateChild(child); // 回寫生日/暱稱/性別編輯
    this.child = child;
    this.cfsLevel = cfsLevel;
    this.informantAvailable = availability.informantAvailable;
    this.patientAble = availability.patientAble;
    this.assessment = await assessmentDao.createAssessment(child.id, cfsLevel, availability);
    this.currentStepIndex = 1;
  } catch (e) {
    this.error = e instanceof Error ? e.message : 'Failed to start assessment';
  } finally {
    this.isLoading = false;
  }
}
```

兩方法共用 `createAssessment`、`isLoading`/`error` 慣例，差異僅在「child 來源（新建 vs 沿用）」。

## 7. 元件

### 7.1 `SubjectSelector.svelte`（新）

只負責身分選擇，不含 CFS／表單。

- Props：`subjects: SubjectWithStats[]`、`selectedId: string | null`
- 回呼：`onSelect: (child: Child | null) => void`（`null` = 新增模式）
- 內容：`[●新增] [○沿用既有]` 切換（`role="radiogroup"`）；選「沿用」展開既有受測者清單。
- 清單每列：暱稱（無則 `ID: xxxxxxxx…`）· `約 N 歲`（有生日時，沿用 `ageInMonths` 換算為歲）· `上次評估 MM/DD` · `N 次`。
- 清單列為可點選的 `button`/`label`，觸控 ≥44px。
- **空狀態**：`subjects` 為空（首次使用、無任何既有受測者）時，「沿用既有」選項停用（`disabled`）並顯示「尚無既有受測者」，強制留在新增模式。

### 7.2 `SubjectProfile.svelte`（改）

- 頂部嵌入 `<SubjectSelector>`；掛載時 `loadSubjectsWithStats()` 取清單。
- 新增本地狀態：`mode: 'new' | 'existing'`、`selectedChild: Child | null`。
- `mode='existing'`：把 `selectedChild` 的 `birthDate/gender/nickName` 帶入既有欄位，可改。
- 提交分流：
  - `new` → `startNew({ birthDate, gender, nickName }, cfsLevel, availability)`（現狀）
  - `existing` → `startForExisting({ ...selectedChild, birthDate, gender, nickName }, cfsLevel, availability)`
- 既有驗證（CFS + informantAvailable）兩模式皆適用，不變。

### 7.3 `AssessmentShell.svelte`（改）

- 讀取 `?subject=<childId>` query param。
- 若存在且 `getChild` 有效 → 傳給 `SubjectProfile`，預設 `mode='existing'` 並選中該人。
- 無效（已刪）→ 退回 `mode='new'` 並顯示提示「找不到該受測者，已切換為新增」。

### 7.4 `AssessmentHistory.svelte`（改）

- **再次評估**：每位受測者 header 加連結 → `/assess?subject=<child.id>`，沿用既有連結樣式、觸控 ≥44px。
- **合併模式**：新增「管理／合併」切換（與既有 `compareIds`「選評估比較」**獨立**，避免狀態混淆）。
  - 開啟後每位受測者 header 出現多選框；本地狀態 `mergeIds: Set<string>`。
  - `mergeIds.size >= 2` → 顯示「合併 N 位」按鈕 → 開 `SubjectMergeDialog`。
  - 合併完成後清空 `mergeIds`、退出合併模式、`loadData()` 重載。
- 重構：把目前內聯的「總數／上次／統計」改用 `loadSubjectsWithStats` 衍生，去除重複。

### 7.5 `SubjectMergeDialog.svelte`（新）

- Props：選中的 `SubjectWithStats[]`；回呼 `onConfirm(primaryId)`、`onCancel()`。
- 內容：列出選中受測者，`radio` 選**主檔**（預設評估次數最多者）。
- 後果說明（`--danger` 色）：「將把其餘 M 位的 X 筆評估轉移到主檔，並刪除那 M 位受測者。**此動作無法復原。**」
- 兩顆按鈕：取消、確認合併（confirm 為 `--danger` 強調）。觸控 ≥44px。

## 8. 樣式約束（實作必守，依專案 `tokens.css` 與 CLAUDE.md）

- 色彩僅 7 token：`--bg / --surface / --text / --line / --accent / --warn / --danger`；衍生色一律 `color-mix()`。
- 顏色用 OKLCH 並提供 `@supports not (color: oklch(...))` 的 hex fallback（沿用 `tokens.css` 既有機制，元件層直接引用 token 即可）。
- 最小字級 `--text-xs`（18px）；唯一例外 `--text-caption`（16px）。
- 最小觸控目標 44px（按鈕、清單列、多選框 label、radio label）。
- 不可逆／刪除後果以 `--danger` 標示。
- 沿用 `SubjectProfile`／`AssessmentHistory` 既有的 class 與樣式慣例，不另立風格。

## 9. 錯誤處理與邊界

| 情境 | 處理 |
|---|---|
| 沿用時 child 已被刪（他分頁） | `startForExisting` 內 `getChild` 回 undefined → 拋錯，UI 顯示「請重新選擇」 |
| `?subject=` 指向無效 id | `AssessmentShell` 退回新增模式並提示 |
| `updateChild` 失敗 | 阻斷開始評估，顯示錯誤，不靜默 |
| `mergeChildren` transaction 失敗 | 原子回滾，UI 顯示錯誤，不部分提交 |
| 主檔誤入被併清單 | `mergeChildren` 內 `filter(id !== primaryId)` 防呆 |
| 合併後其他分頁未刷新 | 已知限制，本次不處理（非目標） |

## 10. 測試計畫（TDD，先紅後綠）

**資料層（vitest，沿用現有 DB 測試模式）**

- `mergeChildren`：被併者的 assessment `childId` 全轉為 `primaryId`；被併 children 被刪除；主檔與其 assessment 不動；`primaryId` 出現在 `mergedIds` 時不自刪；transaction 失敗時不部分提交。
- `updateChild`：同 id 更新欄位、`createdAt` 保留原值。
- `loadSubjectsWithStats`：`assessmentCount` 與 `lastAssessedAt` 計算正確（含無評估、僅 started 等）。

**Store**

- `startForExisting`：沿用傳入 `child.id`、**不**新增 children；回寫編輯欄位；建立一筆新 assessment 指向既有 id；child 不存在時設定 `error`。
- `startNew`：回歸測試，行為不變（仍新建）。

**元件（沿用既有元件測試基礎，如 `ContributionForm` 模式）**

- `SubjectSelector`：切換 new/existing；清單渲染列數與欄位；點選列觸發 `onSelect(child)`；切回新增觸發 `onSelect(null)`。
- `SubjectProfile`：`existing` 模式帶入既有 `birthDate/gender/nickName`；提交走 `startForExisting`；`new` 模式提交走 `startNew`。
- `SubjectMergeDialog`：顯示後果文字與 M／X 數字；確認呼叫 `onConfirm(primaryId)`；預設主檔為次數最多者。

**驗證**：`pnpm check`、`pnpm lint`、`pnpm test` 全綠。

## 11. 實作順序（建議）

1. 資料層 `updateChild` / `mergeChildren` / `loadSubjectsWithStats` + 測試
2. Store `startForExisting` + 測試
3. `SubjectSelector` + `SubjectProfile` 整合（含 `?subject=` 於 `AssessmentShell`）+ 測試
4. 歷史頁「再次評估」連結
5. 歷史頁合併模式 + `SubjectMergeDialog` + 測試
6. 全量 `pnpm check / lint / test`
