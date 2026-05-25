<script lang="ts">
  const DOMAIN_ZH: Record<string, string> = {
    behavior: '行為', gross_motor: '粗動作', fine_motor: '細動作',
    language: '語言', language_comprehension: '語言理解',
    language_expression: '語言表達', cognition: '認知', social_emotional: '社交情緒',
  };
  const AGE_ZH: Record<string, string> = {
    '2-6m': '2-6 個月', '7-12m': '7-12 個月', '13-24m': '1-2 歲',
    '25-36m': '2-3 歲', '37-48m': '3-4 歲', '49-60m': '4-5 歲', '61-72m': '5-6 歲',
  };

  let open      = $state(false);
  let domain    = $state('');
  let ageGroup  = $state('');
  let type      = $state<'youtube' | 'article' | 'external-link'>('youtube');
  let url       = $state('');
  let title     = $state('');
  let summary   = $state('');
  let content   = $state('');
  let notes     = $state('');
  let submitter = $state('');

  let submitting = $state(false);
  let issueUrl   = $state<string | null>(null);
  let errorMsg   = $state<string | null>(null);

  let modalEl: HTMLDivElement | undefined = $state();

  let videoPreviewId = $derived(type === 'youtube' ? extractYouTubeId(url) : null);

  function extractYouTubeId(raw: string): string | null {
    const patterns = [
      /youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/,
      /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
      /youtu\.be\/([A-Za-z0-9_-]{11})/,
    ];
    for (const p of patterns) {
      const m = raw.match(p);
      if (m) return m[1];
    }
    return null;
  }

  $effect(() => {
    function onOpen(e: Event) {
      const { domain: d, age } = (e as CustomEvent<{ domain: string; age: string }>).detail;
      domain = d; ageGroup = age;
      type = 'youtube'; url = title = summary = content = notes = submitter = '';
      issueUrl = null; errorMsg = null;
      open = true;
    }
    document.addEventListener('open-contribution', onOpen);
    return () => document.removeEventListener('open-contribution', onOpen);
  });

  $effect(() => {
    if (!open) return;
    function onKeydown(e: KeyboardEvent) {
      if (e.code === 'Escape') close();
    }
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
  });

  $effect(() => {
    if (open) {
      // delay one frame so the element is rendered
      requestAnimationFrame(() => modalEl?.focus());
    }
  });

  function close() { open = false; }

  function onTypeChange() {
    url = ''; title = ''; summary = ''; content = '';
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    submitting = true; errorMsg = null;
    try {
      const workerUrl = import.meta.env.PUBLIC_CONTRIBUTION_WORKER_URL as string | undefined;
      if (!workerUrl) throw new Error('Worker URL 未設定，請聯絡管理員');
      const res = await fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, domain, ageGroup, url, title, summary, content, notes, submitter }),
      });
      const data = await res.json() as { issueUrl?: string; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      issueUrl = data.issueUrl!;
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : '送出失敗，請稍後再試';
    } finally {
      submitting = false;
    }
  }
</script>

{#if open}
<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="新增衛教資源">
  <div class="modal" tabindex="-1" bind:this={modalEl}>
    <header class="modal-header">
      <h2>新增衛教資源</h2>
      <button class="close-btn" onclick={close} aria-label="關閉">✕</button>
    </header>

    <p class="modal-context">
      情境：<strong>{DOMAIN_ZH[domain] ?? domain}</strong> × <strong>{AGE_ZH[ageGroup] ?? ageGroup}</strong>
    </p>

    {#if issueUrl}
      <div class="success">
        <p>已成功送出！</p>
        <a href={issueUrl} target="_blank" rel="noopener noreferrer">在 GitHub 查看 Issue →</a>
        <button class="btn-secondary" onclick={close}>關閉</button>
      </div>
    {:else}
      <form onsubmit={handleSubmit} class="contribution-form">
        <fieldset>
          <legend>資源類型</legend>
          <label><input type="radio" bind:group={type} value="youtube" onchange={onTypeChange} /> YouTube 影片</label>
          <label><input type="radio" bind:group={type} value="article" onchange={onTypeChange} /> Markdown 文章</label>
          <label><input type="radio" bind:group={type} value="external-link" onchange={onTypeChange} /> 外部連結</label>
        </fieldset>

        {#if type === 'youtube'}
          <label class="field">
            <span>YouTube URL *</span>
            <input type="url" bind:value={url} required placeholder="https://www.youtube.com/watch?v=..." />
          </label>
          {#if videoPreviewId}
            <img
              class="video-preview"
              src="https://i.ytimg.com/vi/{videoPreviewId}/mqdefault.jpg"
              alt="影片預覽"
              referrerpolicy="no-referrer"
            />
          {/if}
          <label class="field">
            <span>標題（選填）</span>
            <input type="text" bind:value={title} placeholder="影片標題" />
          </label>

        {:else if type === 'article'}
          <label class="field">
            <span>標題 *</span>
            <input type="text" bind:value={title} required />
          </label>
          <label class="field">
            <span>摘要 *</span>
            <input type="text" bind:value={summary} required />
          </label>
          <label class="field">
            <span>內容（Markdown）*</span>
            <textarea bind:value={content} required rows="8"></textarea>
          </label>

        {:else}
          <label class="field">
            <span>URL *</span>
            <input type="url" bind:value={url} required />
          </label>
          <label class="field">
            <span>標題 *</span>
            <input type="text" bind:value={title} required />
          </label>
        {/if}

        <label class="field">
          <span>補充說明（選填）</span>
          <textarea bind:value={notes} rows="3" placeholder="為何適合此情境？"></textarea>
        </label>

        <label class="field">
          <span>提交者（選填）</span>
          <input type="text" bind:value={submitter} placeholder="姓名 / 科別" />
        </label>

        {#if errorMsg}
          <p class="error">{errorMsg}</p>
        {/if}

        <div class="modal-actions">
          <button type="button" class="btn-secondary" onclick={close}>取消</button>
          <button type="submit" class="btn-primary" disabled={submitting}>
            {submitting ? '送出中…' : '送出（開 GitHub Issue）'}
          </button>
        </div>
      </form>
    {/if}
  </div>
</div>
{/if}

<style>
  .modal-backdrop {
    position: fixed; inset: 0; z-index: 1000;
    background: color-mix(in srgb, var(--text) 40%, transparent);
    display: flex; align-items: center; justify-content: center;
    padding: var(--space-4);
  }
  .modal {
    background: var(--bg); border: 1px solid var(--line);
    border-radius: var(--radius-lg); padding: var(--space-6);
    width: 100%; max-width: 560px; max-height: 90vh;
    overflow-y: auto;
  }
  .modal-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: var(--space-4);
  }
  .modal-header h2 { font-size: var(--text-xl); margin: 0; }
  .close-btn {
    background: none; border: none; cursor: pointer;
    font-size: var(--text-lg); color: var(--text); line-height: 1;
    padding: var(--space-1);
    min-height: 44px;
    min-width: 44px;
  }
  .modal-context {
    font-size: var(--text-sm); color: color-mix(in srgb, var(--text), var(--bg) 30%);
    margin-bottom: var(--space-4);
  }
  fieldset { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: var(--space-3); margin-bottom: var(--space-4); }
  legend { font-size: var(--text-sm); font-weight: var(--font-medium); padding: 0 var(--space-2); }
  fieldset label { display: inline-flex; align-items: center; gap: var(--space-2); margin-right: var(--space-4); min-height: 44px; padding: var(--space-1) 0; }
  .field { display: flex; flex-direction: column; gap: var(--space-2); margin-bottom: var(--space-4); }
  .field span { font-size: var(--text-sm); font-weight: var(--font-medium); }
  .field input, .field textarea {
    border: 1px solid var(--line); border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3); font-size: var(--text-base);
    background: var(--surface); color: var(--text); width: 100%;
    min-height: 44px;
  }
  .field textarea { min-height: 88px; resize: vertical; }
  .video-preview { width: 100%; aspect-ratio: 16/9; object-fit: cover; border-radius: var(--radius-sm); margin-bottom: var(--space-4); }
  .modal-actions { display: flex; justify-content: flex-end; gap: var(--space-3); margin-top: var(--space-4); }
  .btn-primary {
    background: var(--accent); color: var(--bg);
    border: none; border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-5); font-size: var(--text-base);
    cursor: pointer; min-height: 44px;
  }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary {
    background: none; border: 1px solid var(--line);
    border-radius: var(--radius-sm); padding: var(--space-2) var(--space-5);
    font-size: var(--text-base); cursor: pointer; color: var(--text); min-height: 44px;
  }
  .error { color: var(--color-risk-critical); font-size: var(--text-sm); }
  .success { text-align: center; padding: var(--space-6); }
  .success a { color: var(--accent); text-decoration: underline; display: block; margin: var(--space-3) 0; }
</style>
