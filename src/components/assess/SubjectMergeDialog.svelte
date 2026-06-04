<script lang="ts">
  import { onMount } from 'svelte';
  import type { SubjectWithStats } from '../../lib/db/assessments';

  interface Props {
    subjects: SubjectWithStats[];
    onConfirm: (primaryId: string) => void;
    onCancel: () => void;
  }
  let { subjects, onConfirm, onCancel }: Props = $props();

  // Compute default primary once at init (subject with most assessments).
  // Avoids the $effect-writing-to-$state anti-pattern.
  function initialPrimary(): string {
    return [...subjects].sort((a, b) => b.assessmentCount - a.assessmentCount)[0]?.child.id ?? '';
  }
  let primaryId = $state(initialPrimary());

  const mergedCount = $derived(subjects.length - 1);
  const transferCount = $derived(
    subjects.filter((s) => s.child.id !== primaryId).reduce((n, s) => n + s.assessmentCount, 0),
  );

  function subjectLabel(s: SubjectWithStats): string {
    return s.child.nickName?.trim() || `ID: ${s.child.id.slice(0, 8)}…`;
  }

  let boxEl = $state<HTMLDivElement | null>(null);
  onMount(() => boxEl?.querySelector<HTMLElement>('input,button')?.focus());
</script>

<svelte:window onkeydown={(e) => { if (e.key === 'Escape') onCancel(); }} />

<div class="merge-overlay" role="dialog" aria-modal="true" aria-label="合併受測者">
  <div class="merge-box" bind:this={boxEl}>
    <h2>合併受測者</h2>
    <p class="merge-hint">選擇要保留的主檔，其餘將併入：</p>

    <div class="merge-list" role="radiogroup" aria-label="選擇主檔">
      {#each subjects as s (s.child.id)}
        <label class="merge-row" class:selected={primaryId === s.child.id}>
          <input
            type="radio"
            name="primary"
            value={s.child.id}
            checked={primaryId === s.child.id}
            onchange={() => (primaryId = s.child.id)}
          />
          <span class="mrow-name">{subjectLabel(s)}</span>
          <span class="mrow-meta">{s.assessmentCount} 次</span>
        </label>
      {/each}
    </div>

    <p class="merge-warn">
      將把其餘 {mergedCount} 位的 {transferCount} 筆評估轉移到主檔，並刪除那 {mergedCount}
      位受測者。<strong>此動作無法復原。</strong>
    </p>

    <div class="merge-actions">
      <button type="button" class="btn-cancel" onclick={onCancel}>取消</button>
      <button type="button" class="btn-confirm" disabled={!primaryId} onclick={() => onConfirm(primaryId)}>確認合併</button>
    </div>
  </div>
</div>

<style>
  .merge-overlay {
    position: fixed;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--text) 45%, transparent);
    padding: var(--space-4);
    z-index: 50;
  }
  .merge-box {
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
    max-width: 480px;
    width: 100%;
  }
  h2 {
    font-size: var(--text-lg);
    margin-bottom: var(--space-2);
    color: var(--text);
  }
  .merge-hint {
    font-size: var(--text-xs);
    color: color-mix(in srgb, var(--text), var(--bg) 25%);
    margin-bottom: var(--space-3);
  }
  .merge-list {
    margin: 0 0 var(--space-3);
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .merge-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 44px;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-size: var(--text-xs);
    color: var(--text);
  }
  .merge-row.selected {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, var(--bg));
  }
  .mrow-meta {
    margin-left: auto;
    color: color-mix(in srgb, var(--text), var(--bg) 35%);
    font-size: var(--text-caption);
  }
  .merge-warn {
    font-size: var(--text-xs);
    color: var(--danger);
    background: color-mix(in srgb, var(--danger) 8%, var(--bg));
    border-radius: var(--radius-md);
    padding: var(--space-3);
    margin-bottom: var(--space-4);
  }
  .merge-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
  .btn-cancel,
  .btn-confirm {
    min-height: 44px;
    padding: var(--space-2) var(--space-5);
    border-radius: var(--radius-md);
    font-size: var(--text-xs);
    cursor: pointer;
  }
  .btn-cancel {
    background: none;
    border: 1px solid var(--line);
    color: var(--text);
  }
  .btn-confirm {
    background: var(--danger);
    border: 1px solid var(--danger);
    color: white;
    font-weight: var(--font-bold);
  }
  .btn-confirm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
