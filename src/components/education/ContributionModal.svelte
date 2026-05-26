<script lang="ts">
  import { domainLabel, isValidDomain } from '../../lib/domain/domain-tree';
  import { CFS_LABELS } from '../../lib/utils/cfs-levels';

  function contextDomainLabel(top: string, sub: string): string {
    return isValidDomain(top, sub) ? domainLabel(top, sub) : `${top}.${sub}`;
  }

  function contextCfsLabel(cfs: string): string {
    return (CFS_LABELS as Record<string, string>)[cfs] ?? cfs;
  }

  type Mode = 'add' | 'edit-article' | 'delete-article' | 'delete-video';

  let open      = $state(false);
  let mode      = $state<Mode>('add');
  let top       = $state('');
  let sub       = $state('');
  let cfsLevel  = $state('');
  // add mode
  let type      = $state<'youtube' | 'article' | 'external-link'>('youtube');
  let url       = $state('');
  let title     = $state('');
  let summary   = $state('');
  let content   = $state('');
  let notes     = $state('');
  let submitter = $state('');
  // edit/delete modes
  let targetSlug    = $state('');
  let targetVideoId = $state('');
  let videoTitle    = $state('');

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

  type OpenDetail = {
    action?: string;
    domain: string;
    top: string;
    sub: string;
    cfsLevel: string;
    slug?: string;
    title?: string;
    summary?: string;
    content?: string;
    videoId?: string;
    videoTitle?: string;
  };

  $effect(() => {
    function onOpen(e: Event) {
      const detail = (e as CustomEvent<OpenDetail>).detail;
      const action = (detail.action ?? 'add') as Mode;
      top = detail.top;
      sub = detail.sub;
      cfsLevel = detail.cfsLevel;
      mode = action;
      // reset all fields
      type = 'youtube'; url = ''; title = ''; summary = ''; content = '';
      notes = ''; submitter = '';
      targetSlug = ''; targetVideoId = ''; videoTitle = '';
      issueUrl = null; errorMsg = null;

      if (action === 'edit-article') {
        targetSlug = detail.slug ?? '';
        title = detail.title ?? '';
        summary = detail.summary ?? '';
        content = detail.content ?? '';
      } else if (action === 'delete-article') {
        targetSlug = detail.slug ?? '';
      } else if (action === 'delete-video') {
        targetVideoId = detail.videoId ?? '';
        videoTitle = detail.videoTitle ?? '';
      }

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

  function modalHeading(): string {
    if (mode === 'edit-article') return '修改文章';
    if (mode === 'delete-article') return '刪除文章';
    if (mode === 'delete-video') return '刪除影片';
    return '新增衛教資源';
  }

  function ariaLabel(): string {
    if (mode === 'edit-article') return '修改文章';
    if (mode === 'delete-article') return '刪除文章';
    if (mode === 'delete-video') return '刪除影片';
    return '新增衛教資源';
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    submitting = true; errorMsg = null;
    try {
      const workerUrl = import.meta.env.PUBLIC_CONTRIBUTION_WORKER_URL as string | undefined;
      if (!workerUrl) throw new Error('Worker URL 未設定，請聯絡管理員');

      let payload: Record<string, string>;
      if (mode === 'edit-article') {
        if (!targetSlug) throw new Error('缺少目標文章 slug');
        if (!title) throw new Error('標題為必填');
        payload = { type: 'edit-article', top, sub, cfsLevel, targetSlug, title, summary, content, notes, submitter };
      } else if (mode === 'delete-article') {
        if (!targetSlug) throw new Error('缺少目標文章 slug');
        if (!notes) throw new Error('刪除原因為必填');
        payload = { type: 'delete-article', top, sub, cfsLevel, targetSlug, notes, submitter };
      } else if (mode === 'delete-video') {
        if (!targetVideoId) throw new Error('缺少目標影片 ID');
        if (!notes) throw new Error('刪除原因為必填');
        payload = { type: 'delete-video', top, sub, cfsLevel, targetVideoId, videoTitle, notes, submitter };
      } else {
        payload = { type, top, sub, cfsLevel, url, title, summary, content, notes, submitter };
      }

      const res = await fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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
<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label={ariaLabel()}>
  <div class="modal" tabindex="-1" bind:this={modalEl}>
    <header class="modal-header">
      <h2>{modalHeading()}</h2>
      <button class="close-btn" onclick={close} aria-label="關閉">✕</button>
    </header>

    <p class="modal-context">
      情境：<strong>{contextDomainLabel(top, sub)}</strong> × <strong>CFS {cfsLevel.replace('cfs', '')} {contextCfsLabel(cfsLevel)}</strong>
    </p>

    {#if issueUrl}
      <div class="success">
        <p>已成功送出！</p>
        <a href={issueUrl} target="_blank" rel="noopener noreferrer">在 GitHub 查看 Issue →</a>
        <button class="btn-secondary" onclick={close}>關閉</button>
      </div>
    {:else}
      <form onsubmit={handleSubmit} class="contribution-form">

        {#if mode === 'add'}
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

        {:else if mode === 'edit-article'}
          <p class="meta-info">目標文章：<code>{targetSlug}</code></p>
          <label class="field">
            <span>標題 *</span>
            <input type="text" bind:value={title} required />
          </label>
          <label class="field">
            <span>摘要</span>
            <input type="text" bind:value={summary} />
          </label>
          <label class="field">
            <span>內容（Markdown）</span>
            <textarea bind:value={content} rows="8"></textarea>
          </label>
          <label class="field">
            <span>修改說明（選填）</span>
            <textarea bind:value={notes} rows="3" placeholder="說明修改原因或重點"></textarea>
          </label>
          <label class="field">
            <span>提交者（選填）</span>
            <input type="text" bind:value={submitter} placeholder="姓名 / 科別" />
          </label>

        {:else if mode === 'delete-article'}
          <p class="meta-info">目標文章：<code>{targetSlug}</code></p>
          <label class="field">
            <span>刪除原因 *</span>
            <textarea bind:value={notes} required rows="3" placeholder="請說明為何需要刪除此文章"></textarea>
          </label>
          <label class="field">
            <span>提交者（選填）</span>
            <input type="text" bind:value={submitter} placeholder="姓名 / 科別" />
          </label>

        {:else if mode === 'delete-video'}
          <p class="meta-info">目標影片：<strong>{videoTitle || targetVideoId}</strong></p>
          <label class="field">
            <span>刪除原因 *</span>
            <textarea bind:value={notes} required rows="3" placeholder="請說明為何需要刪除此影片（如：連結失效、內容不適切）"></textarea>
          </label>
          <label class="field">
            <span>提交者（選填）</span>
            <input type="text" bind:value={submitter} placeholder="姓名 / 科別" />
          </label>
        {/if}

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
  .meta-info {
    font-size: var(--text-sm);
    color: color-mix(in srgb, var(--text), var(--bg) 20%);
    margin-bottom: var(--space-4);
    padding: var(--space-2) var(--space-3);
    background: color-mix(in srgb, var(--bg), var(--text) 4%);
    border-radius: var(--radius-sm);
    border: 1px solid var(--line);
  }
  .meta-info code {
    font-family: monospace;
    font-size: var(--text-xs);
    background: color-mix(in srgb, var(--bg), var(--text) 8%);
    padding: 2px 4px;
    border-radius: 2px;
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
