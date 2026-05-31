<script lang="ts">
  import { onMount } from 'svelte';
  import { completeGcmUpload } from '$lib/fhir/gcm-submit';
  import { handleCallback } from '$lib/fhir/launch';
  import { authStore } from '$lib/stores/auth.svelte';

  type View =
    | { kind: 'working' }
    | { kind: 'gcm-done'; caseId: string }
    | { kind: 'error'; message: string };

  let view = $state<View>({ kind: 'working' });

  onMount(async () => {
    const params = new URLSearchParams(window.location.search);

    // 1. GCM redirect 流程：以 sessionStorage['gcm.flow'] 分流
    if (sessionStorage.getItem('gcm.flow')) {
      try {
        const { caseId } = await completeGcmUpload();
        view = { kind: 'gcm-done', caseId };
      } catch (e) {
        view = { kind: 'error', message: e instanceof Error ? e.message : '上傳失敗' };
      }
      return;
    }

    // 2. fhirclient 醫院 standalone callback
    if (params.has('code') || params.has('error')) {
      if (params.has('error')) {
        view = { kind: 'error', message: params.get('error') ?? '授權失敗' };
        return;
      }
      try {
        const { accessToken, fhirUser, scopes, serverUrl } = await handleCallback();
        authStore.setAuth(accessToken, serverUrl, fhirUser, scopes);
        const back = sessionStorage.getItem('fhir.return') ?? '/assess/';
        sessionStorage.removeItem('fhir.return');
        window.location.replace(back);
      } catch (e) {
        view = { kind: 'error', message: e instanceof Error ? e.message : '連線失敗' };
      }
      return;
    }

    // 3. 既非 GCM 也非 callback → 導回首頁
    window.location.replace('/');
  });
</script>

{#if view.kind === 'working'}
  <p class="msg">處理中，請稍候…</p>
{:else if view.kind === 'gcm-done'}
  <div class="done">
    <h1>已上傳至 GCM 收案系統</h1>
    <p class="case">收案編號：<strong>{view.caseId}</strong></p>
    <p class="hint">請保留此編號供複診對照。</p>
    <a class="btn" href="/history/">查看評估紀錄</a>
  </div>
{:else}
  <div class="err" role="alert">
    <h1>上傳未完成</h1>
    <p>{view.message}</p>
    <a class="btn" href="/result/">返回結果頁</a>
  </div>
{/if}

<style>
  .msg, .done, .err {
    max-width: 480px;
    margin: var(--space-8) auto;
    padding: var(--space-6);
    text-align: center;
  }
  h1 { font-size: var(--text-xl); margin-bottom: var(--space-4); }
  .case { font-size: var(--text-lg); }
  .case strong { color: var(--accent); }
  .hint { color: color-mix(in srgb, var(--text), var(--bg) 30%); font-size: var(--text-sm); }
  .btn {
    display: inline-block;
    margin-top: var(--space-5);
    padding: var(--space-3) var(--space-6);
    background: var(--accent);
    color: white;
    border-radius: var(--radius-md);
    text-decoration: none;
    min-height: 44px;
    font-size: var(--text-base);
  }
  .err h1 { color: var(--danger); }
</style>
