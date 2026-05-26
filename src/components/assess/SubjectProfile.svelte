<script lang="ts">
  import { assessmentStore } from '../../lib/stores/assessment.svelte';
  import { ageInMonths } from '../../lib/utils/age-groups';
  import {
    CFS_LEVELS,
    CFS_LABELS,
    CFS_DESCRIPTIONS,
    type CfsLevel,
  } from '../../lib/utils/cfs-levels';

  let birthDate = $state('');
  let gender = $state<'male' | 'female' | 'other'>('male');
  let nickName = $state('');
  let cfsLevel = $state<CfsLevel | null>(null);
  let validationError = $state<string | null>(null);

  // DOB is optional (record-only). Show months + an under-65 notice when given,
  // but never block on age — the CFS selector is the only submit gate.
  const ageMonths = $derived(birthDate ? ageInMonths(birthDate) : null);
  const isUnder65 = $derived(ageMonths !== null && ageMonths < 65 * 12);

  async function handleSubmit() {
    validationError = null;

    if (!cfsLevel) {
      validationError = '請先由臨床或照護者判定臨床衰弱量表 (CFS) 等級';
      return;
    }

    await assessmentStore.startNew(
      { birthDate, gender, nickName: nickName || undefined },
      cfsLevel,
    );
  }
</script>

<form class="subject-profile" onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
  <h2>受測者基本資料</h2>
  <p class="form-desc">出生日期僅供紀錄；請務必由臨床或照護者判定臨床衰弱量表 (CFS) 等級。</p>

  <div class="field">
    <label for="birthDate">出生日期（選填）</label>
    <input
      id="birthDate"
      type="date"
      bind:value={birthDate}
      max={new Date().toISOString().split('T')[0]}
    />
    {#if ageMonths !== null}
      <span class="age-badge">約 {Math.floor(ageMonths / 12)} 歲</span>
    {/if}
    {#if isUnder65}
      <span class="age-notice">提醒：本系統以高齡周全性評估為主，未滿 65 歲仍可進行（不阻擋）。</span>
    {/if}
  </div>

  <fieldset class="field">
    <legend>性別</legend>
    <div class="gender-pills">
      <label class="pill" class:selected={gender === 'male'}>
        <input type="radio" name="gender" value="male" bind:group={gender} />
        男
      </label>
      <label class="pill" class:selected={gender === 'female'}>
        <input type="radio" name="gender" value="female" bind:group={gender} />
        女
      </label>
      <label class="pill" class:selected={gender === 'other'}>
        <input type="radio" name="gender" value="other" bind:group={gender} />
        其他
      </label>
    </div>
  </fieldset>

  <div class="field">
    <label for="nickName">暱稱（選填）</label>
    <input id="nickName" type="text" bind:value={nickName} placeholder="顯示用稱呼" />
  </div>

  <fieldset class="field cfs-field">
    <legend>臨床衰弱量表 CFS <span class="required">*</span></legend>
    <p class="cfs-hint">請選擇最符合目前狀態的等級（必填，未選不得開始評估）。</p>
    <div class="cfs-list" role="radiogroup" aria-label="臨床衰弱量表等級">
      {#each CFS_LEVELS as level (level)}
        <label class="cfs-option" class:selected={cfsLevel === level}>
          <input type="radio" name="cfs" value={level} bind:group={cfsLevel} />
          <span class="cfs-head">
            <span class="cfs-num">{level.replace('cfs', '')}</span>
            <span class="cfs-name">{CFS_LABELS[level]}</span>
          </span>
          <span class="cfs-desc">{CFS_DESCRIPTIONS[level]}</span>
        </label>
      {/each}
    </div>
  </fieldset>

  {#if validationError}
    <p class="error" role="alert">{validationError}</p>
  {/if}
  {#if assessmentStore.error}
    <p class="error" role="alert">{assessmentStore.error}</p>
  {/if}

  <button type="submit" class="btn-start" disabled={assessmentStore.isLoading || !cfsLevel}>
    {assessmentStore.isLoading ? '準備中…' : '開始評估'}
  </button>
</form>

<style>
  .subject-profile {
    max-width: 560px;
    margin: 0 auto;
    padding: var(--space-6);
  }

  h2 {
    font-size: var(--text-2xl);
    text-align: center;
    margin-bottom: var(--space-2);
  }

  .form-desc {
    text-align: center;
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    font-size: var(--text-sm);
    margin-bottom: var(--space-8);
  }

  .field {
    margin: 0 0 var(--space-6);
    padding: 0;
    border: 0;
    min-width: 0;
  }

  label,
  .field > legend {
    display: block;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    margin-bottom: var(--space-2);
    padding: 0;
    color: var(--text);
  }

  .required {
    color: var(--danger);
  }

  input[type="date"],
  input[type="text"] {
    width: 100%;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    font-size: var(--text-base);
    min-height: 48px;
    background: var(--bg);
    color: var(--text);
  }

  input:focus {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .age-badge {
    display: inline-block;
    margin-top: var(--space-2);
    padding: var(--space-1) var(--space-3);
    background: color-mix(in srgb, var(--accent) 12%, var(--bg));
    color: var(--accent);
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
  }

  .age-notice {
    display: block;
    margin-top: var(--space-2);
    font-size: var(--text-xs);
    color: var(--warn);
  }

  .gender-pills {
    display: flex;
    gap: var(--space-3);
  }

  .pill {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-size: var(--text-sm);
    min-height: 48px;
    transition: all 0.15s;
    margin-bottom: 0;
  }

  .pill input[type="radio"] {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }

  .pill.selected {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }

  /* ---- CFS selector ---- */
  .cfs-hint {
    font-size: var(--text-xs);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    margin-bottom: var(--space-3);
  }

  .cfs-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .cfs-option {
    display: block;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    cursor: pointer;
    min-height: 44px;
    transition: border-color 0.15s, background 0.15s;
    margin-bottom: 0;
  }

  .cfs-option:hover {
    border-color: var(--accent);
  }

  .cfs-option.selected {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, var(--bg));
  }

  .cfs-option input[type="radio"] {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }

  .cfs-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .cfs-num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--accent) 14%, var(--bg));
    color: var(--accent);
    font-weight: var(--font-bold);
    font-size: var(--text-sm);
  }

  .cfs-name {
    font-size: var(--text-base);
    font-weight: var(--font-medium);
    color: var(--text);
  }

  .cfs-desc {
    display: block;
    margin-top: var(--space-1);
    font-size: var(--text-sm);
    color: color-mix(in srgb, var(--text), var(--bg) 25%);
    line-height: var(--lh-base);
  }

  .error {
    color: var(--danger);
    font-size: var(--text-sm);
    margin-bottom: var(--space-4);
    text-align: center;
  }

  .btn-start {
    width: 100%;
    padding: var(--space-4);
    background: var(--accent);
    color: white;
    border: none;
    border-radius: var(--radius-md);
    font-size: var(--text-lg);
    font-weight: var(--font-bold);
    cursor: pointer;
    min-height: 56px;
    margin-top: var(--space-4);
  }

  .btn-start:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 85%, black);
  }

  .btn-start:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
