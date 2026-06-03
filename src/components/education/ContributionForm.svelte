<script lang="ts">
  import { domainLabel, isValidDomain } from '../../lib/domain/domain-tree';
  import { CFS_LABELS } from '../../lib/utils/cfs-levels';

  type FormAction = 'add' | 'edit-article' | 'delete-article' | 'delete-video';
  interface Prefill {
    slug?: string; title?: string; summary?: string; content?: string;
    videoId?: string; videoTitle?: string;
  }
  interface Props {
    top: string; sub: string; cfsLevel: string;
    action: FormAction;
    prefill?: Prefill;
    onback: () => void;
  }
  let { top, sub, cfsLevel, action, prefill = {}, onback }: Props = $props();

  function contextDomainLabel(t: string, s: string): string {
    return isValidDomain(t, s) ? domainLabel(t, s) : `${t}.${s}`;
  }
  function contextCfsLabel(cfs: string): string {
    return (CFS_LABELS as Record<string, string>)[cfs] ?? cfs;
  }

  // add-mode fields
  let type      = $state<'youtube' | 'article' | 'external-link'>('youtube');
  let url       = $state('');
  let title     = $state(prefill.title ?? '');
  let summary   = $state(prefill.summary ?? '');
  let content   = $state(prefill.content ?? '');
  let notes     = $state('');
  let submitter = $state('');
  // edit/delete targets
  const targetSlug    = prefill.slug ?? '';
  const targetVideoId = prefill.videoId ?? '';
  const videoTitle    = prefill.videoTitle ?? '';

  let submitting = $state(false);
  let issueUrl   = $state<string | null>(null);
  let errorMsg   = $state<string | null>(null);

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

  function heading(): string {
    if (action === 'edit-article') return '修改文章（建議）';
    if (action === 'delete-article') return '刪除文章（建議）';
    if (action === 'delete-video') return '刪除影片（建議）';
    return '貢獻資源';
  }

  function onTypeChange() {
    url = ''; title = ''; summary = ''; content = '';
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    submitting = true; errorMsg = null;
    try {
      const workerUrl = import.meta.env.PUBLIC_CONTRIBUTION_WORKER_URL as string | undefined;
      if (!workerUrl) throw new Error('Worker URL 未設定，請聯絡管理員');

      let payload: Record<string, string>;
      if (action === 'edit-article') {
        if (!targetSlug) throw new Error('缺少目標文章 slug');
        if (!title) throw new Error('標題為必填');
        payload = { type: 'edit-article', top, sub, cfsLevel, targetSlug, title, summary, content, notes, submitter };
      } else if (action === 'delete-article') {
        if (!targetSlug) throw new Error('缺少目標文章 slug');
        if (!notes) throw new Error('刪除原因為必填');
        payload = { type: 'delete-article', top, sub, cfsLevel, targetSlug, notes, submitter };
      } else if (action === 'delete-video') {
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

<div class="form-wrap">
  <header class="form-head">
    <button class="back-btn" onclick={onback} type="button">← 返回</button>
    <h3>{heading()}</h3>
  </header>

  <p class="warn-note" role="note">⚠ 送出＝提交建議，待維護者審核合併，非即時生效</p>

  <p class="context">
    情境：<strong>{contextDomainLabel(top, sub)}</strong> ×
    <strong>CFS {cfsLevel.replace('cfs', '')} {contextCfsLabel(cfsLevel)}</strong>
  </p>

  {#if issueUrl}
    <div class="success">
      <p>已成功送出！</p>
      <a href={issueUrl} target="_blank" rel="noopener noreferrer">在 GitHub 查看 Issue →</a>
      <button class="btn-secondary" onclick={onback} type="button">返回</button>
    </div>
  {:else}
    <form onsubmit={handleSubmit} class="contribution-form">
      {#if action === 'add'}
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
            <img class="video-preview" src="https://i.ytimg.com/vi/{videoPreviewId}/mqdefault.jpg" alt="影片預覽" referrerpolicy="no-referrer" />
          {/if}
          <label class="field">
            <span>標題（選填）</span>
            <input type="text" bind:value={title} placeholder="影片標題" />
          </label>
        {:else if type === 'article'}
          <label class="field"><span>標題 *</span><input type="text" bind:value={title} required /></label>
          <label class="field"><span>摘要 *</span><input type="text" bind:value={summary} required /></label>
          <label class="field"><span>內容（Markdown）*</span><textarea bind:value={content} required rows="8"></textarea></label>
        {:else}
          <label class="field"><span>URL *</span><input type="url" bind:value={url} required /></label>
          <label class="field"><span>標題 *</span><input type="text" bind:value={title} required /></label>
        {/if}

        <label class="field"><span>補充說明（選填）</span><textarea bind:value={notes} rows="3" placeholder="為何適合此情境？"></textarea></label>
        <label class="field"><span>提交者（選填）</span><input type="text" bind:value={submitter} placeholder="姓名 / 科別" /></label>

      {:else if action === 'edit-article'}
        <p class="meta-info">目標文章：<code>{targetSlug}</code></p>
        <label class="field"><span>標題 *</span><input type="text" bind:value={title} required /></label>
        <label class="field"><span>摘要</span><input type="text" bind:value={summary} /></label>
        <label class="field"><span>內容（Markdown）</span><textarea bind:value={content} rows="8"></textarea></label>
        <label class="field"><span>修改說明（選填）</span><textarea bind:value={notes} rows="3" placeholder="說明修改原因或重點"></textarea></label>
        <label class="field"><span>提交者（選填）</span><input type="text" bind:value={submitter} placeholder="姓名 / 科別" /></label>

      {:else if action === 'delete-article'}
        <p class="meta-info">目標文章：<code>{targetSlug}</code></p>
        <label class="field"><span>刪除原因 *</span><textarea bind:value={notes} required rows="3" placeholder="請說明為何需要刪除此文章"></textarea></label>
        <label class="field"><span>提交者（選填）</span><input type="text" bind:value={submitter} placeholder="姓名 / 科別" /></label>

      {:else if action === 'delete-video'}
        <p class="meta-info">目標影片：<strong>{videoTitle || targetVideoId}</strong></p>
        <label class="field"><span>刪除原因 *</span><textarea bind:value={notes} required rows="3" placeholder="請說明為何需要刪除此影片（如：連結失效、內容不適切）"></textarea></label>
        <label class="field"><span>提交者（選填）</span><input type="text" bind:value={submitter} placeholder="姓名 / 科別" /></label>
      {/if}

      {#if errorMsg}<p class="error">{errorMsg}</p>{/if}

      <div class="form-actions">
        <button type="button" class="btn-secondary" onclick={onback}>取消</button>
        <button type="submit" class="btn-primary" disabled={submitting}>
          {submitting ? '送出中…' : '送出建議（開 GitHub Issue）'}
        </button>
      </div>
    </form>
  {/if}
</div>

<style>
  .form-wrap { display: flex; flex-direction: column; gap: var(--space-3); }
  .form-head { display: flex; align-items: center; gap: var(--space-2); }
  .form-head h3 { font-size: var(--text-lg); margin: 0; }
  .back-btn {
    background: none; border: 1px solid var(--line); border-radius: var(--radius-sm);
    cursor: pointer; color: var(--text); padding: var(--space-1) var(--space-2);
    min-height: 44px; font-size: var(--text-sm);
  }
  .warn-note {
    font-size: var(--text-sm); color: var(--danger);
    background: color-mix(in srgb, var(--danger) 8%, var(--bg));
    border: 1px solid color-mix(in srgb, var(--danger) 30%, var(--bg));
    border-radius: var(--radius-sm); padding: var(--space-2) var(--space-3); margin: 0;
  }
  .context { font-size: var(--text-sm); color: color-mix(in srgb, var(--text), var(--bg) 30%); margin: 0; }
  .meta-info {
    font-size: var(--text-sm); color: color-mix(in srgb, var(--text), var(--bg) 20%); margin: 0;
    padding: var(--space-2) var(--space-3); background: color-mix(in srgb, var(--bg), var(--text) 4%);
    border-radius: var(--radius-sm); border: 1px solid var(--line);
  }
  .meta-info code {
    font-family: monospace; font-size: var(--text-xs);
    background: color-mix(in srgb, var(--bg), var(--text) 8%); padding: 2px 4px; border-radius: 2px;
  }
  fieldset { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: var(--space-3); margin: 0; }
  legend { font-size: var(--text-sm); font-weight: var(--font-medium); padding: 0 var(--space-2); }
  fieldset label { display: inline-flex; align-items: center; gap: var(--space-2); margin-right: var(--space-4); min-height: 44px; padding: var(--space-1) 0; }
  .field { display: flex; flex-direction: column; gap: var(--space-2); }
  .field span { font-size: var(--text-sm); font-weight: var(--font-medium); }
  .field input, .field textarea {
    border: 1px solid var(--line); border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3); font-size: var(--text-base);
    background: var(--surface); color: var(--text); width: 100%; min-height: 44px;
  }
  .field textarea { min-height: 88px; resize: vertical; }
  .video-preview { width: 100%; aspect-ratio: 16/9; object-fit: cover; border-radius: var(--radius-sm); }
  .form-actions { display: flex; justify-content: flex-end; gap: var(--space-3); }
  .btn-primary {
    background: var(--accent); color: var(--bg); border: none; border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-5); font-size: var(--text-base); cursor: pointer; min-height: 44px;
  }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary {
    background: none; border: 1px solid var(--line); border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-5); font-size: var(--text-base); cursor: pointer; color: var(--text); min-height: 44px;
  }
  .error { color: var(--danger); font-size: var(--text-sm); }
  .success { text-align: center; padding: var(--space-4); }
  .success a { color: var(--accent); text-decoration: underline; display: block; margin: var(--space-3) 0; }
</style>
