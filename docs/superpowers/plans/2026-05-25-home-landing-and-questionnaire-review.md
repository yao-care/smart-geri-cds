# 首頁引流落地頁 + 問卷審閱記錄修正 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把首頁 `/` 改成引流落地頁、評估流程搬到 `/assess`，修正問卷臨床審閱記錄與重複 ID，並修好 about 頁右側留白。

**Architecture:** Astro 5 SSG + Svelte 5 islands。落地頁為純 Astro 靜態頁（零/極少 JS），評估維持既有 `AssessmentShell`（`client:load`）。資料修正以頂層 metadata + 每題布林翻轉（DRY）；測試用 vitest 驗資料、Playwright 驗路由與落地頁。

**Tech Stack:** Astro 5、Svelte 5 runes、TypeScript、vitest、@playwright/test、CSS Custom Properties (OKLCH tokens)。

---

## 設計依據與規則（執行前必讀）

- 對應 spec：`docs/superpowers/specs/2026-05-25-home-landing-and-questionnaire-review-design.md`。
- **誠實底線（不可違反）**：信任文案只能寫「架構與國健署學前長者發展檢核表／ASQ-3 一致」「參考通用發展評估指標」「經老年醫學專業人員審閱（2026-05）」。**禁止**寫「採用標準化量表」「經信效度驗證」「具名背書」。
- **spec 偏差修正**：spec §7-4 原寫「source 維持 manual + 加 basis」。實際 `source` 已是混合（`manual`×31、`Denver II inspiration`×9、`ASQ-3 inspiration`×3、`M-CHAT inspiration`×1）。本計畫**不改各題 source**，改用頂層 `clinicalReview` metadata 記錄審閱與依據（見 Task 1）。
- 全域規則：TypeScript strict 不用 `any`；最小字級 18px、觸控目標 44px；CSS 用既有 token；Mermaid 用 hex（本計畫無新圖）。
- 每階段結尾跑 `pnpm check && pnpm lint`，綠燈才 commit。

## 檔案結構（建立/修改）

| 檔案 | 動作 | 責任 |
|---|---|---|
| `src/data/questionnaire/questions.json` | 修改 | 頂層加 `clinicalReview`、44 題 `clinicallyReviewed→true`、改名重複 ID |
| `tests/data/questionnaire-coverage.test.ts` | 修改 | 加「無重複 ID／全已審／頂層 metadata」斷言 |
| `src/pages/assess.astro` | 建立 | 評估流程新路由（搬自現 index.astro） |
| `src/pages/index.astro` | 改寫 | 引流落地頁 |
| `src/data/site-faqs.ts` | 建立 | 共用 FAQ 資料（落地頁 + about 共用，DRY） |
| `src/components/blocks/Header.astro` | 修改 | 導覽列加「開始評估」CTA（→ `/assess`） |
| `src/pages/about.astro` | 修改 | FAQ 改用共用資料；兩段改兩欄 + 側欄 + 底部 CTA |
| `src/layouts/Base.astro` | 修改 | 加 og:image 預設值（社群分享預覽） |
| `tests/e2e/parent-flow.spec.ts` | 修改 | 評估流程改走 `/assess`；加落地頁→評估的路由斷言 |

---

## Phase 1：問卷資料修正（TDD）

### Task 1: 問卷資料完整性測試 + 修正 questions.json

**Files:**
- Test: `tests/data/questionnaire-coverage.test.ts`
- Modify: `src/data/questionnaire/questions.json`

- [ ] **Step 1: 加失敗測試**

在 `tests/data/questionnaire-coverage.test.ts` 的最外層 `describe` 內、結尾 `});` 之前，加入新的 describe 區塊：

```typescript
describe('clinical review record integrity', () => {
  const questions = (questionsData.questions as Question[]);

  it('has no duplicate question IDs', () => {
    const ids = questions.map((q) => q.id);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes).toEqual([]);
  });

  it('every question is clinically reviewed', () => {
    for (const q of questions) {
      expect(q.clinicallyReviewed).toBe(true);
    }
  });

  it('records a top-level clinical review metadata block', () => {
    const meta = (questionsData as { clinicalReview?: { reviewed: boolean; reviewedAt: string } }).clinicalReview;
    expect(meta).toBeDefined();
    expect(meta?.reviewed).toBe(true);
    expect(meta?.reviewedAt).toBe('2026-05-01');
  });
});
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `pnpm test -- questionnaire-coverage`
Expected: FAIL — duplicate IDs `lc-05`/`se-03`、clinicallyReviewed 為 false、無 `clinicalReview` metadata。

- [ ] **Step 3: 修正 questions.json — 頂層 metadata**

把檔首：

```json
{
  "version": "1.1",
  "questions": [
```

改為：

```json
{
  "version": "1.2",
  "clinicalReview": {
    "reviewed": true,
    "reviewedAt": "2026-05-01",
    "scope": "全部 44 題發展問卷（不含生命徵象規則／基線）",
    "reviewer": "未公開揭露",
    "basis": "題目參考通用長者發展評估指標編寫（部分啟發自 Denver II / ASQ-3 / M-CHAT，見各題 source 欄位）；六大發展領域架構與國民健康署『學前長者發展檢核表』及 ASQ-3 一致。本工具為發展分流參考，未經信效度驗證。"
  },
  "questions": [
```

- [ ] **Step 4: 修正 questions.json — 全題翻 clinicallyReviewed**

將檔案中所有 `"clinicallyReviewed": false` 取代為 `"clinicallyReviewed": true`（共 44 處）。`source` 欄位**全部保持原值不動**。

- [ ] **Step 5: 修正 questions.json — 改名重複 ID**

`lc-05` 與 `se-03` 各出現兩次。改名**第二次出現**者（保留第一次出現的原 ID）：
- 第二個 `lc-05`（`ageGroups: ["7-12m"]`、text「叫寶寶名字時，他會轉頭回應嗎？」、`source: "M-CHAT inspiration"`）→ `"id": "lc-09"`
- 第二個 `se-03`（`ageGroups: ["61-72m"]`、text「孩子在玩遊戲時，能輪流和等待嗎？」、`source: "Denver II inspiration"`）→ `"id": "se-06"`

> 已確認 `lc-05`/`se-03` 僅存在於 questions.json，無其他檔案引用；`expected-questionnaire-domains.generated.json` 以 ageGroup→domain 為鍵，不受 ID 改名影響。

- [ ] **Step 6: 跑測試確認通過**

Run: `pnpm test -- questionnaire-coverage`
Expected: PASS（含原有 44 題與每題 source/clinicallyReviewed 斷言 + 新增三項）。

- [ ] **Step 7: 確認照顧者端「未審」徽章消失**

`QuestionnaireModule.svelte:190` 的 `{#if currentQuestion.clinicallyReviewed !== true}` 在全題 true 後不再渲染「未審」徽章——此為預期行為，不需改該元件。
Run: `pnpm check`
Expected: 無型別錯誤（`clinicallyReviewed?: boolean` 與 `true` 相容）。

- [ ] **Step 8: Commit**

```bash
git add src/data/questionnaire/questions.json tests/data/questionnaire-coverage.test.ts
git commit -m "fix(questionnaire): 補登臨床審閱記錄並修正重複 ID

- 頂層加 clinicalReview metadata（reviewed/reviewedAt 2026-05-01/scope/basis）
- 44 題 clinicallyReviewed false→true，移除照顧者端「未審」徽章
- 改名重複 ID：第二個 lc-05→lc-09、se-03→se-06
- source 維持原值（manual / Denver II・ASQ-3・M-CHAT inspiration）"
```

---

## Phase 2：路由搬遷（評估 → /assess）

### Task 2: 建立 /assess 路由（搬入現有評估）

**Files:**
- Create: `src/pages/assess.astro`
- Reference: `src/pages/index.astro`（現況，將於 Task 4 改寫）

- [ ] **Step 1: 建立 assess.astro，內容搬自現 index.astro**

建立 `src/pages/assess.astro`，內容為現 `index.astro` 的完整內容，僅將 `<Base>` 的 title 改為評估專用：

```astro
---
import Base from '../layouts/Base.astro';
import Header from '../components/blocks/Header.astro';
import AssessmentShell from '../components/assess/AssessmentShell.svelte';
import { getCollection } from 'astro:content';

const cardEntries = await getCollection('cards');
const approvedCards = cardEntries
  .filter((e) => e.data.reviewStatus === 'approved')
  .map((e) => ({ id: e.id, ...e.data }));
---

<Base title="開始評估" description="長者衰弱失能智慧分流評估">
  <div class="app-layout">
    <Header />
    <main id="main-content" class="app-main" data-pagefind-body>
      <AssessmentShell client:load cards={approvedCards} />
    </main>
  </div>
</Base>

<style>
  .app-layout {
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
  }

  .app-main {
    flex: 1;
    padding: var(--space-6) var(--space-4);
    max-width: 960px;
    width: 100%;
    margin: 0 auto;
  }
</style>
```

- [ ] **Step 2: 建置驗證路由產生**

Run: `pnpm build`
Expected: 成功，`dist/assess/index.html` 產生；無 Content Layer 錯誤。

- [ ] **Step 3: Commit**

```bash
git add src/pages/assess.astro
git commit -m "feat(routing): 新增 /assess 路由承載評估流程"
```

### Task 3: 更新 E2E 測試走 /assess

**Files:**
- Modify: `tests/e2e/parent-flow.spec.ts`

- [ ] **Step 1: 把三個測試的 `page.goto('/')` 改為 `page.goto('/assess')`**

`tests/e2e/parent-flow.spec.ts` 內共三處 `await page.goto('/');`（行 25、32、59），全部改為：

```typescript
await page.goto('/assess');
```

第一個測試的標題與斷言保留（`/assess` 上仍渲染 shell 與「長者基本資料」heading）。

- [ ] **Step 2: 新增落地頁→評估的路由測試**

在 `tests/e2e/parent-flow.spec.ts` 的 `test.describe` 區塊內，最後一個 `test(...)` 之後、`});` 之前加入：

```typescript
  test('landing page links through to the assessment', async ({ page }) => {
    await page.goto('/');
    // 落地頁不應直接顯示評估表單
    await expect(page.getByRole('heading', { name: '長者基本資料' })).toHaveCount(0);
    // 點主 CTA 進入評估
    await page.getByRole('link', { name: '開始評估' }).first().click();
    await expect(page).toHaveURL(/\/assess/);
    await expect(page.getByRole('heading', { name: '長者基本資料' })).toBeVisible({ timeout: 10000 });
  });
```

> 此測試依賴 Task 4 的落地頁與其 `開始評估` 連結；故須在 Task 4 之後一起跑綠（見 Task 4 Step 末）。

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/parent-flow.spec.ts
git commit -m "test(e2e): 評估流程改走 /assess + 落地頁路由斷言"
```

---

## Phase 3：引流落地頁

### Task 4: 共用 FAQ 資料 + 改寫 index.astro 為落地頁

**Files:**
- Create: `src/data/site-faqs.ts`
- Modify: `src/pages/index.astro`（整檔改寫）
- Reference: `src/pages/about.astro:13-39`（既有 faqs 與 JSON-LD，Task 6 改用共用資料）

- [ ] **Step 1: 建立共用 FAQ 資料**

建立 `src/data/site-faqs.ts`（內容取自 about.astro 既有三題，逐字搬移）：

```typescript
export interface Faq {
  question: string;
  answer: string;
}

export const siteFaqs: Faq[] = [
  {
    question: '這個系統需要安裝什麼軟體嗎？',
    answer: '不需要。Smart Pedi 是一個純瀏覽器端應用程式，只需要現代瀏覽器（Chrome、Firefox、Safari、Edge）即可使用。所有運算邏輯在瀏覽器執行，無需安裝額外軟體或維護後端伺服器。',
  },
  {
    question: '如何連接醫院的 FHIR Server？',
    answer: '系統支援兩種連線模式：Standalone Launch 與 EHR Launch。Standalone 模式下，您可以在醫師工作台的設定中輸入 FHIR Server 位址進行連線；照顧者評估流程亦可選擇性連線。EHR Launch 模式下，醫院 EHR 系統會自動透過 SMART on FHIR 協議啟動本系統並傳入病患資料。',
  },
  {
    question: '病患資料會被傳送到外部伺服器嗎？',
    answer: '不會。本系統採用「隱私優先」設計，所有資料僅在您的瀏覽器與醫院 FHIR Server 之間流動。我們不收集、不儲存、不轉傳任何病患資料。系統本身為靜態網頁，部署後不需要任何後端伺服器。',
  },
];

export const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: siteFaqs.map((faq) => ({
    '@type': 'Question',
    name: faq.question,
    acceptedAnswer: { '@type': 'Answer', text: faq.answer },
  })),
};
```

- [ ] **Step 2: 改寫 index.astro 為落地頁**

將 `src/pages/index.astro` 整檔替換為（信任段嚴守誠實底線；CTA 連 `/assess`）：

```astro
---
import App from '../layouts/App.astro';
import { siteFaqs, faqJsonLd } from '../data/site-faqs';

const steps = [
  { n: '1', title: '填寫基本資料', desc: '輸入孩子的出生日期與性別，約 30 秒。' },
  { n: '2', title: '引導式評估', desc: '依年齡顯示發展題目，照孩子實際情況點選即可。' },
  { n: '3', title: '即時建議', desc: '當下得到風險分級、衛教建議與是否需就醫的分流參考。' },
];

const gains = [
  { title: '發展風險分級', desc: '六大發展面向（粗動作、精細動作、語言理解、語言表達、認知、社會情緒）的分級結果。' },
  { title: '對應衛教建議', desc: '依結果推播相關衛教內容與居家可做的互動。' },
  { title: '就醫分流參考', desc: '提供「是否建議進一步評估」的參考方向，幫助你決定下一步。' },
];

const trust = [
  { title: '隱私優先', desc: '所有運算在你的瀏覽器內完成，資料不離開裝置、不收集、不轉傳。' },
  { title: '可離線使用', desc: '純靜態網頁，免登入、免安裝，支援離線開啟。' },
  { title: '開源透明', desc: '程式碼公開於 GitHub，任何人皆可檢視。' },
  { title: '參考通用評估指標', desc: '六大發展面向架構與國民健康署「學前長者發展檢核表」、ASQ-3 一致；題目參考通用發展評估指標編寫，並經老年醫學專業人員審閱（2026-05）。' },
];
---

<App title="免費長者發展篩檢自評" description="免費的長者衰弱失能自評工具：依年齡引導式問卷，即時提供發展風險分級與衛教建議。資料只在瀏覽器端運算，免登入、保護隱私。">
  <script type="application/ld+json" set:html={JSON.stringify(faqJsonLd)} />

  <!-- 1. Hero -->
  <section class="hero" aria-label="主要訴求">
    <h1>孩子發展是否跟上？<br />花幾分鐘，免費自我評估</h1>
    <p class="hero-sub">
      擔心孩子說話比較慢、走路比較晚、和同齡孩子不太一樣？
      這個免費工具用引導式問卷，幫你快速了解孩子的發展狀況，並提供衛教與就醫參考。
    </p>
    <a href="/assess" class="cta-primary">開始評估</a>
    <ul class="hero-trustbar">
      <li>免費</li><li>免登入</li><li>保護隱私</li><li>約 3 分鐘</li>
    </ul>
  </section>

  <!-- 2. 共鳴痛點 -->
  <section class="section" aria-label="常見擔心">
    <h2>你是不是也有這些擔心？</h2>
    <p class="lead">
      「兩歲還不太會講話正常嗎？」「比同齡孩子晚走路要緊嗎？」
      「該繼續觀察，還是去看醫生？」發展的每一步都讓人放心不下，
      但網路資訊雜亂、又不知道該不該掛號。這個工具就是幫你把擔心整理成具體的方向。
    </p>
  </section>

  <!-- 3. 怎麼運作 -->
  <section class="section" aria-label="如何運作">
    <h2>三步驟，馬上開始</h2>
    <ol class="steps">
      {steps.map((s) => (
        <li class="step-card">
          <span class="step-n">{s.n}</span>
          <h3>{s.title}</h3>
          <p>{s.desc}</p>
        </li>
      ))}
    </ol>
  </section>

  <!-- 4. 你會得到什麼 -->
  <section class="section" aria-label="評估結果">
    <h2>你會得到什麼</h2>
    <div class="card-grid">
      {gains.map((g) => (
        <div class="info-card">
          <h3>{g.title}</h3>
          <p>{g.desc}</p>
        </div>
      ))}
    </div>
  </section>

  <!-- 5. 為什麼可信 -->
  <section class="section" aria-label="為什麼可信">
    <h2>為什麼可以放心使用</h2>
    <div class="card-grid">
      {trust.map((t) => (
        <div class="info-card">
          <h3>{t.title}</h3>
          <p>{t.desc}</p>
        </div>
      ))}
    </div>
  </section>

  <!-- 6. FAQ -->
  <section class="section" aria-label="常見問題">
    <h2>常見問題</h2>
    <div class="faq-list">
      {siteFaqs.map((faq) => (
        <details class="faq-item">
          <summary class="faq-question">{faq.question}</summary>
          <p class="faq-answer">{faq.answer}</p>
        </details>
      ))}
    </div>
  </section>

  <!-- 7. 免責 -->
  <section class="section disclaimer" aria-label="免責聲明">
    <p>
      本工具僅為發展分流參考，<strong>不是醫療診斷</strong>，亦未經信效度驗證。
      評估結果不能取代專業醫療判斷。若您對孩子的發展有疑慮，或孩子有急性症狀，
      請諮詢小老年醫學或長者發展相關專業人員。
    </p>
  </section>

  <!-- 8. 最終 CTA -->
  <section class="final-cta" aria-label="開始評估">
    <h2>準備好了嗎？</h2>
    <a href="/assess" class="cta-primary">開始評估</a>
  </section>
</App>

<style>
  .hero {
    text-align: center;
    padding: var(--space-8) 0 var(--space-6);
  }
  .hero h1 {
    font-size: var(--text-3xl);
    line-height: var(--lh-3xl);
    font-weight: var(--font-bold);
    color: var(--text);
    margin-bottom: var(--space-4);
  }
  .hero-sub {
    font-size: var(--text-lg);
    line-height: var(--lh-lg);
    color: color-mix(in srgb, var(--text), var(--bg) 25%);
    max-width: 60ch;
    margin: 0 auto var(--space-5);
  }
  .cta-primary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: var(--space-3) var(--space-6);
    font-size: var(--text-lg);
    font-weight: var(--font-bold);
    color: var(--bg);
    background-color: var(--accent);
    border-radius: var(--radius-md);
    text-decoration: none;
  }
  .cta-primary:hover {
    background-color: color-mix(in srgb, var(--accent), #000 12%);
  }
  .hero-trustbar {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: var(--space-4);
    list-style: none;
    margin: var(--space-5) 0 0;
    padding: 0;
    font-size: var(--text-sm);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
  }
  .hero-trustbar li::before {
    content: '✓ ';
    color: var(--accent);
  }

  .section {
    margin-bottom: var(--space-8);
  }
  .section h2 {
    font-size: var(--text-2xl);
    line-height: var(--lh-2xl);
    font-weight: var(--font-bold);
    margin-bottom: var(--space-4);
    color: var(--text);
  }
  .lead {
    font-size: var(--text-base);
    line-height: var(--lh-base);
    color: color-mix(in srgb, var(--text), var(--bg) 25%);
    max-width: 72ch;
  }

  .steps {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--space-5);
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .step-card {
    background-color: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    padding: var(--space-5);
  }
  .step-n {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: 50%;
    background-color: var(--accent);
    color: var(--bg);
    font-weight: var(--font-bold);
    margin-bottom: var(--space-3);
  }
  .step-card h3, .info-card h3 {
    font-size: var(--text-lg);
    line-height: var(--lh-lg);
    font-weight: var(--font-bold);
    margin-bottom: var(--space-2);
    color: var(--text);
  }
  .step-card p, .info-card p {
    font-size: var(--text-sm);
    line-height: var(--lh-sm);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
  }

  .card-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: var(--space-5);
  }
  .info-card {
    background-color: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    padding: var(--space-5);
  }

  .faq-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }
  .faq-item {
    background-color: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  .faq-question {
    padding: var(--space-4) var(--space-5);
    font-size: var(--text-base);
    font-weight: var(--font-medium);
    color: var(--text);
    cursor: pointer;
    list-style: none;
  }
  .faq-answer {
    padding: 0 var(--space-5) var(--space-5);
    font-size: var(--text-sm);
    line-height: var(--lh-sm);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    max-width: 72ch;
  }

  .disclaimer p {
    font-size: var(--text-sm);
    line-height: var(--lh-sm);
    color: color-mix(in srgb, var(--text), var(--bg) 35%);
    background-color: color-mix(in srgb, var(--bg), var(--text) 4%);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    padding: var(--space-4) var(--space-5);
  }

  .final-cta {
    text-align: center;
    padding: var(--space-8) 0;
    border-top: 1px solid var(--line);
  }
  .final-cta h2 {
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    margin-bottom: var(--space-4);
    color: var(--text);
  }
</style>
```

> 注意：若 `tokens.css` 無 `--text-3xl`/`--lh-3xl`，改用 `--text-2xl`/`--lh-2xl`。執行前先確認：`grep -n "text-3xl\|lh-3xl" src/styles/tokens.css`，無則替換。

- [ ] **Step 3: 建置 + 型別 + Lint**

Run: `pnpm build && pnpm check && pnpm lint`
Expected: 成功；`dist/index.html` 含 hero H1、FAQ JSON-LD `<script type="application/ld+json">`、`/assess` 連結；無型別/lint 錯誤。

- [ ] **Step 4: 跑 E2E（含 Task 3 新增的路由測試）**

Run: `pnpm build && pnpm exec playwright test parent-flow`
Expected: 全綠，含 `landing page links through to the assessment`。
（若本機未裝瀏覽器：`pnpm exec playwright install chromium`）

- [ ] **Step 5: Commit**

```bash
git add src/data/site-faqs.ts src/pages/index.astro
git commit -m "feat(home): 首頁改為引流落地頁（hero/步驟/信任/FAQ/免責/CTA）

- 信任段守誠實底線：架構一致、參考評估指標、經專業審閱，不寫採用量表/驗證
- 共用 FAQ 抽至 src/data/site-faqs.ts
- 所有 CTA 連往 /assess"
```

### Task 5: 導覽列加「開始評估」CTA

**Files:**
- Modify: `src/components/blocks/Header.astro`

- [ ] **Step 1: 在 nav-links 末尾加 CTA 項**

`Header.astro` 的 `<ul class="nav-links">` 內，`{navLinks.map(...)}` 區塊**之後**、`</ul>` 之前，加入：

```astro
        <li>
          <a href="/assess" class="nav-link nav-cta">開始評估</a>
        </li>
```

- [ ] **Step 2: 加 CTA 樣式**

在 `Header.astro` `<style>` 內 `.nav-link.active { ... }` 規則**之後**加入：

```css
  .nav-cta {
    color: var(--bg);
    background-color: var(--accent);
    font-weight: var(--font-bold);
  }

  .nav-cta:hover {
    color: var(--bg);
    background-color: color-mix(in srgb, var(--accent), #000 12%);
  }
```

- [ ] **Step 3: 驗證**

Run: `pnpm check && pnpm build`
Expected: 成功；各頁 header 出現「開始評估」accent 按鈕，連往 `/assess`；行動版隨漢堡選單收合。

- [ ] **Step 4: Commit**

```bash
git add src/components/blocks/Header.astro
git commit -m "feat(nav): 導覽列加「開始評估」CTA 連往 /assess"
```

---

## Phase 4：about 頁版面修正

### Task 6: about 頁改用共用 FAQ + 兩欄版面 + 側欄 + 底部 CTA

**Files:**
- Modify: `src/pages/about.astro`

- [ ] **Step 1: FAQ 改用共用資料（移除重複定義）**

`about.astro` frontmatter（行 4-39）中，刪除 inline 的 `faqs` 與 `faqJsonLd` 定義，改為 import；保留 `features` 陣列。frontmatter 改為：

```astro
---
import App from '../layouts/App.astro';
import { siteFaqs, faqJsonLd } from '../data/site-faqs';

const features = [
  { title: '照顧者自評 (CDSA)', description: '照顧者可透過引導式問卷評估孩子健康狀況，取得即時衛教建議' },
  { title: '臨床決策輔助 (CDSS)', description: '醫護人員可即時監測長者健康指標，接收智慧預警與風險分級' },
  { title: '智慧預警引擎', description: '即時偵測長者健康指標異常，自動分級預警' },
  { title: '衛教資源整合', description: '依評估結果與預警類型自動推播對應衛教內容' },
  { title: 'SMART on FHIR 整合', description: '可連線醫院 FHIR Server，或獨立離線使用' },
  { title: '完全離線運算', description: '所有邏輯在瀏覽器端執行，保護病患隱私' },
];

const introHighlights = [
  '雙角色：照顧者自評 + 醫護工作台',
  '隱私優先：資料不離開瀏覽器',
  '開源免費，免登入',
  'SMART on FHIR 標準',
];

const techStack = ['Astro 5', 'Svelte 5', 'Web Worker', 'GitHub Pages', '零後端'];
---
```

接著把 body 中 `{faqs.map(...)}` 改為 `{siteFaqs.map(...)}`（常見問題 section）。

- [ ] **Step 2: 「系統介紹」改兩欄 + 重點摘要側欄**

把「系統介紹」section（現行 `<section class="about-section" aria-label="系統介紹">...</section>`）整段替換為：

```astro
  <section class="about-section about-twocol" aria-label="系統介紹">
    <div class="twocol-main">
      <h2>系統介紹</h2>
      <p>
        Smart Pedi 是一套開源的老年醫學健康輔助系統，提供雙角色服務：
        照顧者可透過 CDSA（臨床決策輔助應用）進行孩子健康自評並取得衛教建議；
        醫護人員可透過 CDSS（臨床決策輔助系統）工作台即時監測指標、接收預警。
        系統以 SMART on FHIR 標準運行於瀏覽器端，確保隱私與互通性。
      </p>
    </div>
    <aside class="twocol-aside" aria-label="重點摘要">
      <h3>重點摘要</h3>
      <ul>
        {introHighlights.map((h) => <li>{h}</li>)}
      </ul>
    </aside>
  </section>
```

- [ ] **Step 3: 「技術架構」改兩欄 + 技術棧 badge 側欄**

把「技術架構」section 整段替換為：

```astro
  <section class="about-section about-twocol" aria-label="技術架構">
    <div class="twocol-main">
      <h2>技術架構簡述</h2>
      <p>
        本系統採用 Astro 5 靜態網站生成框架，搭配 Svelte 5 做為互動元件的島嶼架構。
        前端以 SMART on FHIR 標準與醫院 FHIR Server 通訊，所有臨床決策邏輯
        （規則引擎、趨勢分析、風險評估）皆在瀏覽器端以 Web Worker 執行，
        確保效能與隱私兼顧。靜態資產部署於 GitHub Pages，無需後端伺服器。
      </p>
    </div>
    <aside class="twocol-aside" aria-label="技術棧">
      <h3>技術棧</h3>
      <ul class="tech-badges">
        {techStack.map((t) => <li>{t}</li>)}
      </ul>
    </aside>
  </section>
```

- [ ] **Step 4: 頁面底部加 CTA**

在最後一個 section（常見問題）`</section>` 之後、`</App>` 之前加入：

```astro
  <section class="about-cta" aria-label="開始評估">
    <a href="/assess" class="cta-primary">開始評估</a>
  </section>
```

- [ ] **Step 5: 加兩欄與側欄樣式**

在 `about.astro` `<style>` 內、`.about-section p { ... }` 規則之後加入：

```css
  /* ---------- 兩欄版面 ---------- */
  .about-twocol {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 18rem);
    gap: var(--space-6);
    align-items: start;
  }

  .twocol-aside {
    background-color: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    padding: var(--space-5);
  }

  .twocol-aside h3 {
    font-size: var(--text-base);
    font-weight: var(--font-bold);
    margin-bottom: var(--space-3);
    color: var(--text);
  }

  .twocol-aside ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .twocol-aside li {
    font-size: var(--text-sm);
    line-height: var(--lh-sm);
    color: color-mix(in srgb, var(--text), var(--bg) 25%);
  }

  .twocol-aside li::before {
    content: '✓ ';
    color: var(--accent);
  }

  .tech-badges {
    flex-direction: row !important;
    flex-wrap: wrap;
  }

  .tech-badges li {
    background-color: color-mix(in srgb, var(--bg), var(--text) 6%);
    border-radius: var(--radius-sm);
    padding: var(--space-1) var(--space-3);
  }

  .tech-badges li::before {
    content: none;
  }

  @media (max-width: 767px) {
    .about-twocol {
      grid-template-columns: 1fr;
    }
  }

  /* ---------- 底部 CTA ---------- */
  .about-cta {
    text-align: center;
    padding: var(--space-6) 0;
    border-top: 1px solid var(--line);
  }

  .about-cta .cta-primary {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: var(--space-3) var(--space-6);
    font-size: var(--text-lg);
    font-weight: var(--font-bold);
    color: var(--bg);
    background-color: var(--accent);
    border-radius: var(--radius-md);
    text-decoration: none;
  }
```

- [ ] **Step 6: 驗證**

Run: `pnpm build && pnpm check && pnpm lint`
Expected: 成功；about 頁兩段呈左文字右側欄（寬螢幕），窄螢幕疊單欄；底部有 CTA；FAQ 仍正常（共用資料）。手動確認最小字級 18px、CTA 觸控目標 ≥44px。

- [ ] **Step 7: Commit**

```bash
git add src/pages/about.astro
git commit -m "fix(about): 兩段改兩欄補右側留白（重點摘要/技術棧）+ 底部 CTA + 共用 FAQ"
```

---

## Phase 5：SEO 分享圖（小幅）

### Task 7: Base.astro 加 og:image 預設值

**Files:**
- Modify: `src/layouts/Base.astro`

- [ ] **Step 1: 加 og:image meta**

`Base.astro` 的 Open Graph 區塊（`<meta property="og:url" .../>` 之後）加入，並把 twitter:card 升級為大圖：

```astro
    <meta property="og:image" content={new URL(base + '/icons/icon-512.png', Astro.site).href} />
```

並將 `<meta name="twitter:card" content="summary" />` 改為：

```astro
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:image" content={new URL(base + '/icons/icon-512.png', Astro.site).href} />
```

> 先確認檔案存在：`ls public/icons/icon-512.png`。若不存在，改用 `apple-touch-icon.png`。專屬分享圖（含標題文案）列為後續，不阻擋本次。

- [ ] **Step 2: 驗證**

Run: `pnpm build`
Expected: 各頁 head 含 `og:image` 絕對 URL。

- [ ] **Step 3: Commit**

```bash
git add src/layouts/Base.astro
git commit -m "feat(seo): 加 og:image 預設值供社群分享預覽"
```

---

## 收尾驗證

- [ ] `pnpm test`：全部 vitest 綠（含新增資料完整性測試）。
- [ ] `pnpm build && pnpm exec playwright test`：E2E 全綠（評估走 /assess、落地頁路由）。
- [ ] `pnpm check && pnpm lint`：無錯誤。
- [ ] 手動：`/` 為落地頁、CTA → `/assess`；`/assess` 評估正常、續做正常、問卷無「未審」徽章；`/about/` 兩欄正常、底部 CTA。
- [ ] 用 `superpowers:finishing-a-development-branch` 決定合併方式（PR / 直接合 main）。

## 自我複查（已執行）

- **Spec 覆蓋**：①落地頁=Task4、②信任文案=Task4(trust 陣列)、③資料修正=Task1、④about 兩欄=Task6、路由=Task2/3/5、SEO=Task7。皆有對應任務。
- **Placeholder 掃描**：無 TBD/TODO；所有 code step 附完整內容。
- **型別一致**：`Faq`/`siteFaqs`/`faqJsonLd` 在 Task4 定義，Task6 沿用同名；E2E 連結名稱「開始評估」在 Task4/Task5 一致。
- **spec 偏差**：Task1 已據實修正 source 處理（不壓平 manual）；計畫頂部已記。
