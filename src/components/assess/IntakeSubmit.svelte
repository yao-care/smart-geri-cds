<script lang="ts">
  import { authStore } from '../../lib/stores/auth.svelte';
  import { getTenantDisplayName } from '../../lib/utils/tenant';
  import { REDIRECT_INSTITUTIONS } from '../../lib/fhir/intake-institutions';
  import { startGcmUpload } from '../../lib/fhir/gcm-submit';
  import { submitAssessmentToFhir } from '../../lib/fhir/cdsa-submit';
  import type { Assessment, Child } from '../../lib/db/schema';
  import type { TriageResult } from '../../engine/cdsa/triage';

  interface Props {
    assessment: Assessment;
    child: Child;
    triageResult: TriageResult;
  }
  let { assessment, child, triageResult }: Props = $props();

  // 結果資料不完整（舊紀錄無 details）→ 不給上傳
  const canUpload = $derived(Array.isArray(triageResult.details) && triageResult.details.length > 0);

  type Selection = null | { kind: 'gcm'; id: string } | { kind: 'hospital' };
  let selection = $state<Selection>(null);
  let nickname = $state('');
  let email = $state('');
  let phone = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let hospitalDone = $state(false);

  async function submitHospital() {
    busy = true; error = null;
    try {
      const r = await submitAssessmentToFhir(assessment, child.id, triageResult);
      if (r.success) hospitalDone = true;
      else error = r.error ?? '傳送失敗';
    } catch {
      error = '傳送失敗，請稍後重試';
    } finally {
      busy = false;
    }
  }

  async function submitGcm() {
    if (!nickname.trim()) { error = '請輸入暱稱'; return; }
    busy = true; error = null;
    try {
      await startGcmUpload(window.location.origin + '/launch/', {
        assessmentId: assessment.id,
        nickname: nickname.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      // 正常情況此處不會 return（已 redirect）
    } catch {
      error = '無法開始上傳，請確認網路連線後重試';
      busy = false;
    }
  }
</script>

<section class="intake" aria-label="上傳評估結果">
  <h3>上傳評估結果至收案機構</h3>

  {#if !canUpload}
    <p class="note">此筆結果資料不完整，無法上傳。</p>
  {:else}
    <ul class="institutions">
      {#if authStore.isAuthenticated}
        <li>
          <button class="inst" onclick={() => { selection = { kind: 'hospital' }; }}>
            {getTenantDisplayName(authStore.fhirBaseUrl)}（已連線醫院）
          </button>
        </li>
      {/if}
      {#each REDIRECT_INSTITUTIONS as inst (inst.id)}
        <li>
          <button class="inst" onclick={() => { selection = { kind: 'gcm', id: inst.id }; }}>
            {inst.name}
          </button>
        </li>
      {/each}
    </ul>

    {#if selection?.kind === 'hospital'}
      {#if hospitalDone}
        <p class="success">已傳送至醫院 FHIR Server</p>
      {:else}
        <button class="primary" onclick={submitHospital} disabled={busy}>
          {busy ? '傳送中…' : '確認傳送至醫院'}
        </button>
      {/if}
    {:else if selection?.kind === 'gcm'}
      <form class="gcm-form" onsubmit={(e) => { e.preventDefault(); submitGcm(); }}>
        <label>暱稱（必填）
          <input type="text" bind:value={nickname} required />
        </label>
        <label>Email（選填）
          <input type="email" bind:value={email} />
        </label>
        <label>電話（選填）
          <input type="tel" bind:value={phone} />
        </label>
        <button class="primary" type="submit" disabled={busy}>
          {busy ? '前往授權…' : '上傳並建立收案'}
        </button>
      </form>
    {/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}
  {/if}
</section>

<style>
  .intake { display: flex; flex-direction: column; gap: var(--space-4); }
  .intake h3 { font-size: var(--text-lg); }
  .institutions { list-style: none; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); }
  .inst {
    width: 100%; text-align: left; padding: var(--space-3) var(--space-4);
    background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-md);
    font-size: var(--text-base); min-height: 44px; cursor: pointer;
  }
  .inst:hover { background: color-mix(in srgb, var(--bg), var(--text) 5%); }
  .gcm-form { display: flex; flex-direction: column; gap: var(--space-3); }
  .gcm-form label { display: flex; flex-direction: column; gap: var(--space-2); font-size: var(--text-sm); }
  .gcm-form input {
    padding: var(--space-3); font-size: var(--text-base); min-height: 44px;
    border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--bg); color: var(--text);
  }
  .primary {
    padding: var(--space-3) var(--space-6); background: var(--accent); color: white; border: none;
    border-radius: var(--radius-md); font-size: var(--text-base); min-height: 44px; cursor: pointer;
  }
  .primary:disabled { opacity: 0.6; cursor: default; }
  .success { color: var(--accent); font-weight: var(--font-medium); }
  .error { color: var(--danger); }
  .note { color: color-mix(in srgb, var(--text), var(--bg) 30%); font-size: var(--text-sm); }
</style>
