<script lang="ts">
  /**
   * /workspace/ 使用說明 — 給醫師看怎麼操作這個工作台。
   * 文案層面，不引用任何 store；可在示範模式 / 已登入兩種狀態同樣顯示。
   */
  import { isAuthorized } from '../../lib/fhir/client';

  const isAuth = $derived(isAuthorized());
</script>

<article class="guide">
  <h2>工作台使用說明</h2>
  <p class="lede">這個頁面整合了臨床監測、個案趨勢、預警處理與評估結果。以下幾段帶你快速上手。</p>

  <section>
    <h3>連線到醫院 FHIR Server</h3>
    <p>
      第一次使用建議到 <a href="/settings/">系統設定 → FHIR Server 設定</a>
      新增一筆伺服器設定（FHIR Base URL、Client ID、scopes）。儲存後回到本頁，點側邊的「連線」就會跳到醫院的 OAuth 授權流程。
    </p>
    <p>
      授權成功後，工作台就會以該醫院的 FHIR Server 為資料來源。{#if isAuth}
        <strong>目前狀態：已連線 ✓</strong>
      {:else}
        <strong>目前狀態：未連線（示範模式 — 顯示本機 IndexedDB 內的測試資料）</strong>
      {/if}
    </p>
  </section>

  <section>
    <h3>各 Tab 的用途</h3>
    <dl class="tab-list">
      <dt>總覽</dt>
      <dd>監看所有病人的 advisory / warning / critical 預警，類似 dashboard feed。需 FHIR 連線。</dd>

      <dt>個案</dt>
      <dd>從側邊病人清單選一位後切到此 tab，看其生命徵象趨勢圖、過往觀察與警示。需 FHIR 連線。</dd>

      <dt>預警</dt>
      <dd>對個別預警做 acknowledge / 結案 / 加註備註。連動 FHIR Observation。需 FHIR 連線。</dd>

      <dt>評估</dt>
      <dd>
        所有 CGA 高齡周全性評估報告，依分流（建議轉介 / 追蹤觀察 / 正常）分組。
        <strong>本機模式也能用</strong> — 沒登入時讀此裝置 IndexedDB 內的本地測試資料。
      </dd>

      <dt>使用說明</dt>
      <dd>就是本頁。</dd>
    </dl>
  </section>

  <section>
    <h3>看一份 CGA 評估的詳細指標</h3>
    <p>
      在「評估」清單點任一筆「看詳細」，會進到
      <code>/workspace/result/?id=...</code>。頁面分三段：
    </p>
    <ol>
      <li><strong>頂部摘要</strong>：個案識別碼、評估日期、分流類別、資料來源（本地 / 醫院 FHIR）。</li>
      <li><strong>分流判定</strong>：類別 + 信心度 + 異常 metric 數，並附判定規則。</li>
      <li><strong>完整指標</strong>：每筆 metric 的數值 / 常模 / Z-score / 狀態。z ≤ -1.5 表示比常模差超過 1.5 個標準差。</li>
    </ol>
    <p>「常模」在「設定 → 常模管理」可改成醫院本地值，未改時用系統內建預設。</p>
  </section>

  <section>
    <h3>跨裝置情境</h3>
    <p>
      家長端評估完成後送 FHIR Observation + DiagnosticReport 到醫院 Server。
      醫師在自己裝置開「評估」清單時，會從 FHIR 拉回；本機沒紀錄的評估第一次開會 fetch FHIR，之後 cache 在本機 IndexedDB（顯示「來自 FHIR Server」badge）。
    </p>
  </section>

  <section>
    <h3>常見問題</h3>
    <details>
      <summary>為什麼有些評估顯示「來自 FHIR Server」而非「本地紀錄」？</summary>
      <p>該評估不是這台裝置產出的，由 resolver 從 FHIR 拉回展示。原始事件 timeline（每次點擊延遲、筆跡等）不會送進 FHIR，所以這類紀錄看不到 timeline。</p>
    </details>
    <details>
      <summary>Session 過期怎麼辦？</summary>
      <p>系統會在背景嘗試 refresh token 一次，失敗才會 surface「Session 過期」訊息。點訊息內的「回工作台登入」會帶 return URL 跳回。</p>
    </details>
    <details>
      <summary>本機示範資料怎麼產生？</summary>
      <p>用 <a href="/assess/">家長端評估流程</a> 跑一遍，完成後該筆紀錄會自動寫入這台裝置的 IndexedDB，未登入 FHIR 時的「評估」tab 就會列出來。</p>
    </details>
  </section>
</article>

<style>
  .guide {
    max-width: 720px;
    margin: 0 auto;
    line-height: 1.7;
    color: var(--text);
  }

  .guide h2 {
    font-size: var(--text-2xl);
    margin: 0 0 var(--space-3);
  }

  .lede {
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    margin-bottom: var(--space-6);
  }

  .guide section {
    margin-bottom: var(--space-7);
  }

  .guide h3 {
    font-size: var(--text-lg);
    margin: 0 0 var(--space-2);
  }

  .guide p,
  .guide ol,
  .guide dl {
    margin: 0 0 var(--space-3);
  }

  .guide ol {
    padding-left: var(--space-6);
  }

  .guide a {
    color: var(--accent);
  }

  .guide code {
    background: color-mix(in srgb, var(--bg), var(--text) 5%);
    padding: 0 0.3em;
    border-radius: 4px;
    font-size: 0.9em;
  }

  .tab-list {
    display: grid;
    grid-template-columns: max-content 1fr;
    column-gap: var(--space-4);
    row-gap: var(--space-2);
    align-items: baseline;
  }

  .tab-list dt {
    font-weight: var(--font-bold);
    margin: 0;
  }

  .tab-list dd {
    margin: 0;
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    padding-left: 0;
  }

  details {
    margin-bottom: var(--space-2);
    padding: var(--space-2) var(--space-3);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
  }

  details summary {
    cursor: pointer;
    font-weight: var(--font-medium);
  }

  details p {
    margin: var(--space-2) 0 0;
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    font-size: var(--text-sm);
  }
</style>
