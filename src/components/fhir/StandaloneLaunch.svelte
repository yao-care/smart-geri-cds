<script lang="ts">
  import { handleStandaloneLaunch } from '$lib/fhir/launch';
  import { db } from '$lib/db/schema';
  import type { ServerConfig } from '$lib/db/schema';

  const DEFAULT_SCOPES =
    'openid fhirUser launch/patient patient/*.read offline_access';

  let fhirBaseUrl = $state('');
  let clientId = $state('');
  let scopes = $state(DEFAULT_SCOPES);

  let savedServers = $state<ServerConfig[]>([]);
  let isConnecting = $state(false);
  let error = $state<string | null>(null);

  // Load saved servers on mount
  $effect(() => {
    db.serverConfigs
      .orderBy('lastUsedAt')
      .reverse()
      .toArray()
      .then((rows) => {
        savedServers = rows;
      })
      .catch(() => {
        // Non-critical — proceed without saved list
      });
  });

  function selectServer(server: ServerConfig) {
    fhirBaseUrl = server.fhirBaseUrl;
    clientId = server.clientId;
    scopes = server.scopes;
  }

  async function saveServer() {
    if (!fhirBaseUrl || !clientId) return;
    // Derive a short name from the base URL hostname
    let name = fhirBaseUrl;
    try {
      name = new URL(fhirBaseUrl).hostname;
    } catch {
      // Keep raw string if URL parsing fails
    }
    const id = crypto.randomUUID();
    const entry: ServerConfig = {
      id,
      name,
      fhirBaseUrl,
      clientId,
      scopes,
      lastUsedAt: new Date(),
    };
    await db.serverConfigs.put(entry);
    savedServers = [entry, ...savedServers.filter((s) => s.fhirBaseUrl !== fhirBaseUrl)];
  }

  async function connect() {
    if (!fhirBaseUrl.trim()) {
      error = '請輸入 FHIR Server URL';
      return;
    }
    if (!clientId.trim()) {
      error = '請輸入 Client ID';
      return;
    }
    error = null;
    isConnecting = true;
    try {
      await saveServer();
      // 授權會 redirect 到 /launch/，記住來源頁以便回呼後導回（預設 /assess/）。
      sessionStorage.setItem('fhir.return', window.location.pathname + window.location.search);
      await handleStandaloneLaunch(fhirBaseUrl.trim(), clientId.trim(), scopes.trim());
      // Browser redirects — execution stops here
    } catch (err) {
      error = err instanceof Error ? err.message : '連線失敗，請確認 URL 與 Client ID。';
      isConnecting = false;
    }
  }
</script>

<div class="standalone-launch">
  <h2 class="title">獨立啟動設定</h2>

  {#if savedServers.length > 0}
    <section class="saved-section">
      <h3 class="section-label">已儲存的伺服器</h3>
      <ul class="server-list">
        {#each savedServers as server (server.id)}
          <li>
            <button class="server-item" onclick={() => selectServer(server)}>
              <span class="server-name">{server.name}</span>
              <span class="server-url">{server.fhirBaseUrl}</span>
            </button>
          </li>
        {/each}
      </ul>
    </section>
    <div class="divider" aria-hidden="true"></div>
  {/if}

  <form class="launch-form" onsubmit={(e) => { e.preventDefault(); connect(); }}>
    <div class="field">
      <label for="fhir-url" class="field-label">FHIR Server URL <span class="required">*</span></label>
      <input
        id="fhir-url"
        type="url"
        class="field-input"
        placeholder="https://your-fhir-server/fhir"
        bind:value={fhirBaseUrl}
        required
        autocomplete="url"
      />
    </div>

    <div class="field">
      <label for="client-id" class="field-label">Client ID <span class="required">*</span></label>
      <input
        id="client-id"
        type="text"
        class="field-input"
        placeholder="your-client-id"
        bind:value={clientId}
        required
        autocomplete="off"
      />
    </div>

    <div class="field">
      <label for="scopes" class="field-label">授權範圍 (Scopes)</label>
      <textarea
        id="scopes"
        class="field-input field-textarea"
        rows="2"
        bind:value={scopes}
      ></textarea>
      <p class="field-hint">空格分隔，建議保留預設值</p>
    </div>

    {#if error}
      <p class="error-msg" role="alert">{error}</p>
    {/if}

    <button
      type="submit"
      class="connect-btn"
      disabled={isConnecting}
    >
      {#if isConnecting}
        <span class="spinner"></span>
        連線中...
      {:else}
        連線
      {/if}
    </button>
  </form>
</div>

<style>
  .standalone-launch {
    padding: var(--space-4) 0;
  }

  .title {
    font-size: var(--text-sm);
    font-weight: var(--font-bold);
    color: var(--text);
    margin: 0 0 var(--space-5);
  }

  .section-label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: color-mix(in srgb, var(--text), var(--bg) 45%);
    margin: 0 0 var(--space-2);
  }

  .server-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .server-item {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: var(--space-3) var(--space-4);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    cursor: pointer;
    text-align: left;
    gap: var(--space-1);
    transition: border-color 0.12s ease;
  }

  .server-item:hover {
    border-color: var(--accent);
  }

  .server-name {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--text);
  }

  .server-url {
    font-size: var(--text-xs);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    word-break: break-all;
  }

  .divider {
    height: 1px;
    background: var(--line);
    margin: var(--space-5) 0;
  }

  .launch-form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .field-label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--text);
  }

  .required {
    color: var(--danger);
  }

  .field-input {
    padding: var(--space-2) var(--space-3);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    color: var(--text);
    transition: border-color 0.12s ease;
    font-family: inherit;
  }

  .field-input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .field-textarea {
    resize: vertical;
    min-height: 56px;
  }

  .field-hint {
    font-size: var(--text-xs);
    color: color-mix(in srgb, var(--text), var(--bg) 45%);
    margin: 0;
  }

  .error-msg {
    font-size: var(--text-xs);
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 14%, var(--bg));
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-sm);
    margin: 0;
  }

  .connect-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-6);
    background: var(--accent);
    color: white;
    border: none;
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    cursor: pointer;
    transition: background 0.12s ease;
    align-self: flex-start;
  }

  .connect-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 85%, black);
  }

  .connect-btn:disabled {
    opacity: 0.65;
    cursor: not-allowed;
  }

  .spinner {
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 2px solid oklch(1 0 0 / 0.4);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }
</style>
