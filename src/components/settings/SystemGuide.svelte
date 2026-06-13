<script lang="ts">
  /**
   * /settings/ 系統說明 — 給「導入這個系統的醫院」看。
   * 解釋多租戶機制、評分邏輯、各 settings tab 的用途、PHI 注意事項、部署期限。
   * 純文字頁，無資料依賴。
   */
</script>

<article class="guide">
  <h2>系統運作說明</h2>
  <p class="lede">這份說明寫給導入本系統的醫院技術窗口與臨床主管。內容涵蓋系統定位、多租戶設計、評分邏輯、各設定 tab 的用途與資料治理重點。</p>

  <section>
    <h3>系統定位</h3>
    <p>
      高齡周全性評估（CGA）智慧系統採用 <strong>Astro 5 SSG + Svelte 5 + IndexedDB</strong>，
      所有頁面在 build 時靜態產出，部署在 GitHub Pages 上、零後端。
      使用者端評估過程的事件、作答結果、分流摘要都儲存在
      <strong>使用者瀏覽器的 IndexedDB</strong>，不會送到任何第三方。
    </p>
    <p>
      跨裝置共享靠 <strong>SMART on FHIR</strong>：受測者完成評估後可選擇將結果以
      <code>Observation + DiagnosticReport</code> 推送到醫院的 FHIR Server，
      醫師端工作台再從 Server 拉回展示。
    </p>
  </section>

  <section>
    <h3>多租戶機制</h3>
    <p>
      系統用<strong>連線中的 FHIR base URL</strong> 作為 tenant 識別碼。
      `tenantSettings`、`customEducation`、`recommendationOverlays`
      全部以此 ID 做 partition。
    </p>
    <p>
      醫院 A 跟醫院 B 即使共用同一台裝置（瀏覽器）開啟，切換 FHIR Server 後設定不會混淆。
      未連線時走「預設租戶」（tenant id = <code>default</code>），用內建衛教與系統預設規則。
    </p>
  </section>

  <section>
    <h3>評分邏輯（CGA 分流）</h3>
    <ol>
      <li>
        <strong>分層軸（CFS）</strong>：進入評估時由臨床／照護者判定臨床衰弱量表
        CFS 1–9，gate 後續適用的領域子項與建議，但 <strong>不參與計分</strong>。
      </li>
      <li>
        <strong>逐量表計分</strong>：各 CGA 量表（GDS-15、Barthel、MNA-SF、SPMSQ…）
        各有驗證過的固定切分點（cutoff）。將原始分對照量表分段（band），
        得到該領域的 severity（normal／monitor／refer）。作答不全者標為 incomplete。
      </li>
      <li>
        <strong>整體分流（取最嚴重領域）</strong>：
        <ul>
          <li><strong>refer（建議轉介）</strong>：任一領域為 refer</li>
          <li><strong>monitor（追蹤觀察）</strong>：無 refer 但有 monitor</li>
          <li><strong>normal（正常）</strong>：所有領域皆 normal</li>
          <li><strong>incomplete（未完成）</strong>：所有領域皆未完成</li>
        </ul>
        incomplete 領域排除於彙整與推薦查詢，但於結果頁明確標示，不假裝正常。
      </li>
    </ol>
  </section>

  <section>
    <h3>各設定 Tab 的用途</h3>
    <dl class="tab-list">
      <dt>FHIR Server 設定</dt>
      <dd>新增、編輯醫院 FHIR Server（base URL、Client ID、scopes）。儲存後到 /workspace/ 即可連線。</dd>

      <dt>規則管理</dt>
      <dd>生命徵象警示閾值（正常 / 注意 / 警告）的 YAML 規則。覆寫系統預設、影響所有預警觸發。</dd>

      <dt>Webhook 設定</dt>
      <dd>當預警產生時，向外部系統（醫院 HIS、Slack、訊息中介）發送 webhook 的 URL 與簽章。</dd>

      <dt>通知偏好</dt>
      <dd>瀏覽器通知、聲音、批次間隔。儲存在本機，不同裝置獨立設定。</dd>

      <dt>模型管理</dt>
      <dd>檢視 / 更新本機 ONNX 模型（繪圖分類、姿態判斷）的版本與發佈日期。</dd>

      <dt>衛教管理</dt>
      <dd>醫院自上傳的衛教內容（文章 / 影片），會出現在 <code>/education/</code> 列表與評估後推薦。</dd>

      <dt>評估推薦</dt>
      <dd>per severity × 領域（top.sub）自訂評估後給個案／照護者看的衛教清單。可選「合併系統預設」或「完全取代」。</dd>

      <dt>系統說明</dt>
      <dd>本頁。</dd>
    </dl>
  </section>

  <section>
    <h3>PHI 與資料治理</h3>
    <ul>
      <li><strong>使用者端 IndexedDB</strong>：包含個案基本資料、評估事件、PII。屬於該裝置的本地資料，<strong>不會自動上傳任何位置</strong>。使用者清除瀏覽器資料即刪除。</li>
      <li><strong>FHIR 上傳</strong>：只有使用者明確選擇收案機構並送出才會推送，且僅傳 Observation + DiagnosticReport（分數、結論），不傳原始事件 timeline。</li>
      <li><strong>URL 安全</strong>：所有 assessment id 都是隨機 UUID v4，不含 PII；結果頁加 <code>referrer no-referrer</code> 避免外洩。</li>
      <li><strong>共用設備</strong>：診所共用裝置請確保每次評估前清空本機，或使用獨立的使用者 profile。</li>
    </ul>
  </section>

  <section>
    <h3>部署注意事項</h3>
    <ul>
      <li>部署為純靜態網站；GitHub Pages、Vercel、Cloudflare Pages、Nginx 皆可。</li>
      <li>建議 HTTPS + custom domain。SMART on FHIR 通常要求 HTTPS redirect_uri。</li>
      <li><code>scripts/base.mjs</code> 控制 base path；部署於子目錄需改 <code>BASE_PATH</code>。</li>
      <li>無 server 端日誌；錯誤回報可考慮接 Sentry / 自家 Webhook。</li>
      <li>規則 / 衛教 / 推薦 都存在使用者裝置的 IndexedDB — 建議搭配 export / import 功能（未來迭代）做備援。</li>
    </ul>
  </section>

  <section>
    <h3>已知限制 / 未來工作</h3>
    <ul>
      <li>多個案切換、家庭/代理模式尚未實作。</li>
      <li>FHIR 端的 DiagnosticReport 反查不含原始事件 timeline。</li>
      <li>i18n 目前只支援 zh-TW。</li>
    </ul>
  </section>

  <section class="footer-note">
    <p>
      原始碼：
      <a href="https://github.com/yao-care/smart-geri-cds" target="_blank" rel="noopener noreferrer">github.com/yao-care/smart-geri-cds</a>。
      授權：MIT。
    </p>
  </section>
</article>

<style>
  .guide {
    max-width: 760px;
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
  .guide ul,
  .guide ol,
  .guide dl {
    margin: 0 0 var(--space-3);
  }

  .guide ul,
  .guide ol {
    padding-left: var(--space-6);
  }

  .guide :global(ol ul),
  .guide :global(ul ul) {
    margin: var(--space-2) 0;
    padding-left: var(--space-5);
  }

  .guide :global(li) {
    margin-bottom: var(--space-2);
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

  .footer-note {
    margin-top: var(--space-8);
    padding-top: var(--space-4);
    border-top: 1px solid var(--line);
    font-size: var(--text-xs);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
  }
</style>
