<script lang="ts">
  import { ageInMonths } from '../../lib/utils/cfs-levels';
  import type { Child } from '../../lib/db/schema';
  import type { SubjectWithStats } from '../../lib/db/assessments';

  interface Props {
    subjects: SubjectWithStats[];
    selectedId: string | null;
    onSelect: (child: Child | null) => void;
  }
  let { subjects, selectedId, onSelect }: Props = $props();

  // Capture the initial value outside $state to avoid the "reference only captures
  // initial value" warning — mode is intentionally a one-time default (like defaultValue).
  function initialMode(): 'new' | 'existing' {
    return selectedId ? 'existing' : 'new';
  }
  let mode = $state<'new' | 'existing'>(initialMode());
  const hasSubjects = $derived(subjects.length > 0);

  function setMode(next: 'new' | 'existing') {
    mode = next;
    if (next === 'new') onSelect(null);
  }
  function fmtDate(d: Date | null): string {
    return d ? new Date(d).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' }) : '—';
  }
  function ageYears(birthDate: string): number | null {
    if (!birthDate) return null;
    const m = ageInMonths(birthDate);
    return m > 0 ? Math.floor(m / 12) : null;
  }
</script>

<fieldset class="subject-selector">
  <legend>受測者</legend>
  <div class="mode-pills">
    <label class="pill" class:selected={mode === 'new'}>
      <input type="radio" name="subjectMode" value="new" checked={mode === 'new'} onchange={() => setMode('new')} />
      新增
    </label>
    <label class="pill" class:selected={mode === 'existing'}>
      <input type="radio" name="subjectMode" value="existing" checked={mode === 'existing'}
        disabled={!hasSubjects} onchange={() => setMode('existing')} />
      沿用既有
    </label>
  </div>

  {#if !hasSubjects}
    <p class="empty-note">尚無既有受測者</p>
  {/if}

  {#if mode === 'existing' && hasSubjects}
    <ul class="subject-list">
      {#each subjects as s (s.child.id)}
        {@const yrs = ageYears(s.child.birthDate)}
        <li>
          <button type="button" class="subject-row" class:selected={selectedId === s.child.id}
            aria-pressed={selectedId === s.child.id} onclick={() => onSelect(s.child)}>
            <span class="srow-name">{s.child.nickName?.trim() || `ID: ${s.child.id.slice(0, 8)}…`}</span>
            {#if yrs !== null}<span class="srow-age">約 {yrs} 歲</span>{/if}
            <span class="srow-meta">上次 {fmtDate(s.lastAssessedAt)} · {s.assessmentCount} 次</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</fieldset>

<style>
  .subject-selector { margin: 0 0 var(--space-3); padding: 0; border: 0; }
  legend { font-size: var(--text-sm); font-weight: var(--font-medium); margin-bottom: var(--space-1); color: var(--text); }
  .mode-pills { display: flex; gap: var(--space-2); }
  .pill {
    flex: 1; display: flex; align-items: center; justify-content: center;
    padding: var(--space-2); border: 1px solid var(--line); border-radius: var(--radius-md);
    cursor: pointer; font-size: var(--text-xs); min-height: 44px;
  }
  .pill.selected { background: var(--accent); color: white; border-color: var(--accent); }
  .pill:has(input:disabled) { opacity: 0.45; cursor: not-allowed; }
  .pill input[type="radio"] { position: absolute; opacity: 0; width: 0; height: 0; }
  .subject-list { list-style: none; margin: var(--space-2) 0 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-1); }
  .subject-row {
    width: 100%; text-align: left; display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2);
    padding: var(--space-2) var(--space-3); min-height: 44px; cursor: pointer;
    border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--bg);
    font-size: var(--text-xs); color: var(--text);
  }
  .subject-row:hover { border-color: var(--accent); }
  .subject-row.selected { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 12%, var(--bg)); }
  .srow-name { font-weight: var(--font-medium); }
  .srow-age { color: var(--accent); font-size: var(--text-caption); }
  .srow-meta { margin-left: auto; color: color-mix(in srgb, var(--text), var(--bg) 35%); font-size: var(--text-caption); }
  .empty-note { margin: var(--space-2) 0 0; color: color-mix(in srgb, var(--text), var(--bg) 35%); font-size: var(--text-caption); }
</style>
