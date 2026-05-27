# 自評分層問答式 CGA — 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development。逐 task 執行，checkbox 追蹤。權威內容依 spec `docs/superpowers/specs/2026-05-27-self-assessment-tiered-redesign-design.md`（尤其〈全領域 短篩→深評 對應表〉與〈臨床審核修正〉C-M1~C-S6）。

**Goal:** 把評估從「19 量表一次 100+ 題自點」改為「問答式臨床資料蒐集 + 自動分層（短篩→亮燈深評）」，含施測模式（mode）、操作者效度閘門、臨床修正（譫妄直接 4AT、認知 AD8/Mini-Cog、STEADI 切分、新增疼痛、自傷紅旗）。

**Architecture:** 量表新增 `tier`(screen/full)/`expandsTo`/`requiresPatient/Informant`；題目新增 `mode`/`prompt`/`subquestions`。問卷引擎先跑全領域 screen → 對亮燈領域插入其 full → 彙整。計分/彙整加操作者效度閘門（代理人答需本人題→incomplete）。triage/結果頁/FHIR 介面不變（仍 ScaleResult[]）。

**Tech Stack:** Astro + Svelte 5 runes + Dexie + Zod(astro/zod) + Vitest + Playwright + TypeScript strict。

**權威參考：** 內容/臨床細節以 spec 為準；本計畫給執行順序、schema/引擎完整程式碼、TDD。每 task 末 `pnpm check` 不新增錯誤。`clinicallyReviewed` 一律 false。

---

## 檔案結構

- `src/lib/scales/scale.ts`：擴充 `ScaleItem`(mode/prompt/subquestions)、`ScaleDef`(tier/expandsTo/requiresPatient/requiresInformant)、`Severity` 已含 incomplete。
- `src/content.config.ts`：scales collection Zod 對應新欄位。
- `src/lib/domain/domain-tree.ts`：`physical` 新增 `pain`。
- `src/lib/scales/tiering.ts`（新）：`selectScreenScales(cfs)`、`expandedFullScales(screenResults)`、`applyOperatorGate(result, operator, def)`。
- `src/data/scales/*.yaml`：每領域 `<sub>-screen.yaml`(tier:screen) + 既有量表改 tier:full + 臨床修正；新增 `pain-screen.yaml`/`painad.yaml`。
- `src/lib/stores/assessment.svelte.ts`：`operator` state + 分層流程。
- `src/components/assess/QuestionnaireModule.svelte`：mode 渲染、分層展開、操作者提示、自傷紅旗。
- `src/components/assess/SubjectProfile.svelte`：加「操作者身分」選擇。
- `src/data/education/content-relevance.yaml`：pain 領域、screen 一律適用。
- tests/：schema、tiering、operator-gate、各臨床行為、playwright。

---

## Phase A — Schema/model + 引擎（TDD，可獨立綠）

### Task A1: 擴充 scale 型別
**Files:** Modify `src/lib/scales/scale.ts`; Test `tests/scales/scale-model.test.ts`
- [ ] **測試**：`ScaleItem` 接受 `mode`/`prompt`/`subquestions`；`ScaleDef` 接受 `tier`/`expandsTo`/`requiresPatient`/`requiresInformant`；型別編譯（建構物件斷言欄位存在）。
- [ ] **實作**：
```ts
export type ItemMode = 'ask-patient' | 'observe' | 'ask-informant' | 'measure';
export type Operator = 'nurse' | 'family' | 'self';
export interface ScaleItem {
  id: string;
  text?: string;          // 病人面向題幹（自填）
  prompt?: string;        // 操作者提示（唸/觀察/問家屬/量測）
  mode?: ItemMode;        // 預設 'ask-patient'
  subquestions?: string[];// 多子題（如 AMT4）
  options: { label: string; score: number }[];
  redFlag?: 'self-harm';  // 觸發安全提示（C-S2）
}
export interface ScaleDef {
  id: string;
  domain: { top: DomainTop; sub: DomainSub };
  tier: 'screen' | 'full';
  expandsTo?: string;     // screen 亮燈時展開的 full 量表 id
  applicableCfs: CfsLevel[];
  scoring: 'sum' | 'weighted' | 'error-count' | 'measured-value' | 'timed-task';
  inputType: 'option' | 'numeric' | 'timed-task';
  requiresPatient?: boolean;   // 需病人本人作答（認知/情緒）
  requiresInformant?: boolean; // 需照顧者（Zarit）
  maxScore: number;
  items: ScaleItem[];
  bands: ScaleBand[];
  clinicallyReviewed: boolean;
}
```
- [ ] Run `pnpm vitest run tests/scales/scale-model.test.ts` → PASS。Commit。

### Task A2: content.config Zod 對應
**Files:** Modify `src/content.config.ts`
- [ ] scales collection schema 加 `tier`(enum screen|full)、`expandsTo`(string optional)、`requiresPatient/requiresInformant`(boolean optional)、item 的 `prompt/mode/subquestions/redFlag`(optional)、`text` 改 optional。
- [ ] Run `pnpm check` → 0 錯。`pnpm build`（現有 yaml 仍合法，因新欄位 optional）→ 成功。Commit。

### Task A3: 操作者效度閘門 `applyOperatorGate`（TDD）
**Files:** Create `src/lib/scales/tiering.ts`; Test `tests/scales/operator-gate.test.ts`
- [ ] **測試**：`applyOperatorGate(result, 'family', def{requiresPatient:true})` → severity='incomplete', invalidReason 含「代理人」；operator='self' 同 def → 不變；無 requires* → 不變。
- [ ] **實作**：
```ts
import type { ScaleResult } from './scale';
import type { ScaleDef, Operator } from './scale';
export function applyOperatorGate(r: ScaleResult, operator: Operator, def: ScaleDef): ScaleResult {
  const needsPatient = def.requiresPatient && operator !== 'self' && operator !== 'nurse';
  // nurse 唸題給病人答視為有效；family 代答認知/情緒測驗無效
  const proxyInvalid = def.requiresPatient && operator === 'family';
  const informantInvalid = def.requiresInformant && operator === 'self';
  if (proxyInvalid || informantInvalid) {
    return { ...r, severity: 'incomplete', bandLabel: '代理人作答，效度存疑' };
  }
  return r;
}
```
（註：nurse 操作＝唸題給病人本人答，視為有效；family＝替病人答，認知/情緒測驗無效。）
- [ ] Run test → PASS。Commit。

### Task A4: 分層選擇 `selectScreenScales`/`expandedFullScales`（TDD）
**Files:** Modify `src/lib/scales/tiering.ts`; Test `tests/scales/tiering.test.ts`
- [ ] **測試**：給一組 ScaleDef（screen+full）與 cfs → `selectScreenScales(all, cfs)` 只回該 cfs 的 tier:screen；`expandedFullScales(all, screenResults)` 對 severity≥monitor 的 screen 回其 expandsTo 對應 full（normal→不回）。
- [ ] **實作**：
```ts
export function selectScreenScales(all: ScaleDef[], cfs: CfsLevel): ScaleDef[] {
  return all.filter(s => s.tier === 'screen' && s.applicableCfs.includes(cfs));
}
const WORSE = (s: Severity) => s === 'monitor' || s === 'refer';
export function expandedFullScales(all: ScaleDef[], screenResults: ScaleResult[]): ScaleDef[] {
  const flaggedScreenIds = new Set(screenResults.filter(r => WORSE(r.severity)).map(r => r.scaleId));
  const out: ScaleDef[] = [];
  for (const r of screenResults) {
    if (!WORSE(r.severity)) continue;
    const screen = all.find(s => s.id === r.scaleId);
    if (screen?.expandsTo) {
      const full = all.find(s => s.id === screen.expandsTo);
      if (full) out.push(full);
    }
  }
  return out;
}
```
- [ ] Run test → PASS。Commit。

> Phase A 完成：型別/閘門/分層邏輯就緒且測試綠；現有 yaml 仍可 build（新欄位 optional）。

---

## Phase B — 內容重做（依 spec 對應表 + 臨床修正）

> 每個量表檔依 spec〈對應表〉與〈臨床審核 C-M*/C-S*〉重寫。全部 `clinicallyReviewed: false`。每 task：寫/改 yaml → `pnpm tsx scripts/build-content-index.ts` 或 `pnpm build` 驗證 collection 通過 → commit。

### Task B1: DOMAIN_TREE 新增 pain
**Files:** Modify `src/lib/domain/domain-tree.ts`, `tests/domain/domain-tree.test.ts`
- [ ] `physical` 陣列加 `'pain'`；`SUB_LABELS` 加 `pain: '疼痛'`。更新測試（physical 子項數+1）。Run test → PASS。Commit。

### Task B2: 每領域 screen 量表（tier:screen）
**Files:** Create `src/data/scales/<sub>-screen.yaml`（依對應表每領域一支短篩）
- [ ] 依 spec 對應表「Tier-1 短篩」欄逐領域建：cognition(AD8 知情者；requiresInformant 視情況)、mood(PHQ-2, requiresPatient)、delirium(**直接放 4AT 不另設 screen**，見 B3)、adl/iadl/mobility/falls(STEADI 3 題, C-M5 切分)/nutrition/comorbidity/polypharmacy/continence/sensory/pain(NRS+PAINAD)/social_support/caregiver(requiresInformant)/financial/home_safety/accessibility/acp/treatment_pref。每題標 `mode`/`prompt`，screen 設 `expandsTo` 指向其 full（若有）。`clinicallyReviewed:false`。
- [ ] 驗證 build 通過。Commit（可分數個 commit）。

### Task B3: 既有量表改 tier:full + 臨床修正
**Files:** Modify `src/data/scales/{4at,spmsq,gds-15,barthel,lawton-iadl,mna-sf,cci,zarit-12,...}.yaml`
- [ ] 每支加 `tier: full`（被 screen `expandsTo` 指向）；falls/polypharmacy/sensory 等「無深評」者改為 screen（tier:screen，無 expandsTo）。
- [ ] **C-M1 譫妄**：`4at.yaml` 設 `tier: full` 但 **delirium 領域直接施測**（在 tiering：delirium 的 4at 視為 always-run，或建一支 `delirium` screen＝4AT 本身）。實作上最簡：4at 設 tier:screen（直接做），不另設守門。
- [ ] **C-M3 4AT**：`at4_amt4` 改 `mode:ask-patient` + `subquestions:[您今年幾歲？,您的出生年月日？,這裡是什麼地方？,今年是哪一年？]` + prompt 註明地點接受醫院/建築/城市；`at4_alertness` mode:observe；`at4_attention` mode:ask-patient；`at4_acute` mode:ask-informant。
- [ ] **C-M4 SPMSQ**：加教育校正說明（於 prompt/notes 與計分；最小：bands 不變但加 `educationAdjust` 註記題或於報告標示）、serial-7s/減3 全對才算對、president 等題加操作者正解提示（prompt）。mode:ask-patient。
- [ ] **C-M5 STEADI**（若為 screen）：bands 改「跌倒史/不穩任一是→refer、僅擔心→monitor」。
- [ ] **C-S3 MNA**：加小腿圍 CC<31cm 替代 BMI 題；mna 行動/神經精神項 mode 改 observe。
- [ ] **C-S4 Barthel/Lawton**：逐項標 mode（移位/行走/上下樓→observe；購物/理財/電話→ask-patient/informant）。設 `requiresPatient` 視情況（ADL 可他評→不設 requiresPatient；認知/情緒才設）。
- [ ] **C-S5 polypharmacy**：高風險藥題改 ask-informant、降權（不單題推 refer）。
- [ ] **C-M6 requires***：SPMSQ/4AT(amt4/attention)/Mini-Cog/PHQ-2/GDS-15 設 `requiresPatient:true`；Zarit-12 設 `requiresInformant:true`。
- [ ] **C-S2 自傷紅旗**：PHQ-2/GDS 觸及自殺意念/絕望之題加 `redFlag: self-harm`。
- [ ] 驗證 build。Commit（分多個 commit）。

### Task B4: 新增 cognition Mini-Cog（無知情者 fallback）+ pain PAINAD
**Files:** Create `src/data/scales/mini-cog.yaml`、`painad.yaml`
- [ ] Mini-Cog：三詞記憶(ask-patient)+畫鐘(observe/measure)，requiresPatient:true，作為認知短篩無知情者時的客觀 fallback（tiering 處理 fallback 選擇）。
- [ ] PAINAD：認知障礙者疼痛觀察(observe)，作為 pain 在認知障礙時的工具。
- [ ] 驗證 build。Commit。

---

## Phase C — 流程/UI

### Task C1: store 操作者身分 + 分層流程
**Files:** Modify `src/lib/stores/assessment.svelte.ts`, `src/lib/db/schema.ts`, `src/lib/db/assessments.ts`; Test `tests/stores/operator-flow.test.ts`
- [ ] `Assessment` 加 `operator: Operator`（Dexie bump）；store `operator=$state`；`startNew(child, cfsLevel, operator)`。
- [ ] 分層狀態：`screenResults` + `expandedFulls`（用 Phase A 的 tiering）。
- [ ] 測試：startNew 帶 operator→persist→resume 還原。Run → PASS。Commit。

### Task C2: SubjectProfile 加操作者身分
**Files:** Modify `src/components/assess/SubjectProfile.svelte`, `tests/components/SubjectProfile?`
- [ ] CFS 選擇器旁加「本次由誰協助填寫：護理師／家屬／長者本人」（必填）。送出帶 operator。Commit。

### Task C3: QuestionnaireModule 分層 + mode 渲染 + 紅旗 + 閘門
**Files:** Modify `src/components/assess/QuestionnaireModule.svelte`; Test `tests/components/QuestionnaireModule.test.ts`
- [ ] 先跑 selectScreenScales 的題 → 計分 → expandedFullScales 插入 → 續跑。
- [ ] 依 `item.mode` 顯示外框/提示（ask-patient「請唸給受測者並記錄」/observe「請觀察」/ask-informant「請問家屬」/measure 數值或攝影）；`subquestions` 列清單；標題改操作者導向。
- [ ] `item.redFlag==='self-harm'` 且選到陽性 → 立即安全提示元件（求助專線+轉介），不阻斷計分。
- [ ] 完成後對每量表結果套 `applyOperatorGate(result, operator, def)`。
- [ ] 測試：family 操作 + requiresPatient 量表→incomplete+警示；screen normal→不展開；screen monitor→展開 full；mode 對應提示文字。Run → PASS。Commit。

---

## Phase D — content-relevance + 收尾

### Task D1: content-relevance 對齊
**Files:** Modify `src/data/education/content-relevance.yaml`、`schemas.ts`(若 domain enum 需 pain)
- [ ] DOMAIN_TREE 已加 pain → schemas/inapplicable 接受 `physical.pain`；補 pain 的衛教 trigger/文章（或先空，parity 允許）。screen 一律適用、full 條件。
- [ ] `pnpm tsx scripts/build-content-index.ts` + `build-questionnaire-applicability.ts` → 成功。Commit。

### Task D2: 守門測試 + 全綠
**Files:** Modify tests（content-index-parity / questionnaire-coverage / 各 component / scale）
- [ ] 對齊新結構（screen/full、pain、operator gate）。
- [ ] `pnpm check && pnpm lint --max-warnings 10 && pnpm vitest run && pnpm build` 全綠。Commit。

### Task D3: playwright 端到端
- [ ] 短篩全 normal → 題數 ~15–25、不展開；某領域亮燈 → 展開深評；family 操作 + 認知測驗 → 標效度存疑；自傷題 → 安全提示；delirium 4AT 直接出。
- [ ] 截圖存證（.verify，勿 commit）。

### Task D4: 合併 main + 部署 + 線上驗證
- [ ] 合併 → 部署 → `--resolve` 驗線上；確認題數合理、mode 提示、亮燈展開。

---

## Self-Review（spec 覆蓋）
- D1 角色/D2 分層/D3 mode/D4 措辭/D5 clinicallyReviewed=false：Phase A(型別/閘門/分層)+B(內容)+C(UI)+D(收尾) 覆蓋。
- 臨床 C-M1(譫妄直接 4AT, B3)/C-M2(AD8+Mini-Cog, B2+B4)/C-M3(AMT4, B3)/C-M4(SPMSQ 教育校正, B3)/C-M5(STEADI, B3)/C-M6(操作者閘門, A3+B3+C3)/C-M7(已 false)/C-S1(pain, B1+B4)/C-S2(自傷紅旗, B3+C3)/C-S3(MNA, B3)/C-S4(per-item mode, B3)/C-S5(polypharmacy, B3)/C-S6(直接深評, B3 tiering)：全覆蓋。

## 非本計畫
- 量表臨床最終簽核（clinicallyReviewed→true）待臨床。
- sleep/oral/skin(Braden) 領域為 C-S1 建議的後續擴充（本計畫先做 pain）。
