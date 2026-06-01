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
  // SOP 事實（取代 operator 角色）：
  // - informantAvailable（必填，未預設）：是否有熟悉受測者日常的家屬／照顧者可提供資訊。
  //   gate ask-informant 量表、決定認知用 AD8（有）或 Mini-Cog（無）。
  // - patientAble（預設「是」）：受測者本人能否參與作答/受測。否則需病人本人作答的
  //   認知/情緒測驗標 incomplete「需受測者本人，建議由專業評估」。
  let informantAvailable = $state<boolean | null>(null);
  let patientAble = $state<boolean>(true);
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
    if (informantAvailable === null) {
      validationError = '請先回答是否有熟悉受測者日常的家屬／照顧者可提供資訊';
      return;
    }

    await assessmentStore.startNew(
      { birthDate, gender, nickName: nickName || undefined },
      cfsLevel,
      { informantAvailable, patientAble },
    );
  }
</script>

<form class="subject-profile" onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
  <h2>受測者評估設定</h2>
  <p class="form-desc">請先由臨床或照護者判定臨床衰弱量表（CFS）；下方基本資料僅供紀錄、皆為選填。</p>

  <fieldset class="field cfs-field cfs-card">
    <legend>臨床衰弱量表 CFS <span class="required">*</span></legend>
    <p class="cfs-principle">
      請依受測者<strong>近 2 週的日常狀態</strong>判定（非急性生病期），由臨床或照護者評估。
    </p>

    <div class="cfs-anchors">
      <span class="cfs-anchors-title">判讀關鍵分界</span>
      <ul>
        <li><span class="anchor-edge">3→4</span> 開始有症狀使活動變慢，但日常仍能自理</li>
        <li><span class="anchor-edge">4→5</span> 工具性日常（購物／理財／服藥）需協助</li>
        <li><span class="anchor-edge">5→6</span> 戶外活動與家務需協助</li>
        <li><span class="anchor-edge">6→7</span> 個人照護（洗澡／穿衣／如廁）依賴他人</li>
      </ul>
    </div>

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

  <fieldset class="field availability-field">
    <legend>是否有熟悉受測者日常的家屬／照顧者可提供資訊？ <span class="required">*</span></legend>
    <p class="cfs-hint">用於需向知情者詢問的題目（如 AD8、急性變化、照顧者負荷），並決定認知短篩採 AD8（有）或 Mini-Cog（無）。（必填，未答不得開始評估）</p>
    <div class="yesno-pills" role="radiogroup" aria-label="是否有可提供資訊的家屬或照顧者">
      <label class="pill" class:selected={informantAvailable === true}>
        <input type="radio" name="informantAvailable" value="yes" checked={informantAvailable === true} onchange={() => (informantAvailable = true)} />
        是
      </label>
      <label class="pill" class:selected={informantAvailable === false}>
        <input type="radio" name="informantAvailable" value="no" checked={informantAvailable === false} onchange={() => (informantAvailable = false)} />
        否
      </label>
    </div>
  </fieldset>

  <fieldset class="field availability-field">
    <legend>受測者本人能否參與作答/受測？</legend>
    <p class="cfs-hint">若否，需受測者本人作答的認知/情緒測驗將標示「需受測者本人，建議由專業評估」。（預設為「是」）</p>
    <div class="yesno-pills" role="radiogroup" aria-label="受測者本人能否參與作答或受測">
      <label class="pill" class:selected={patientAble === true}>
        <input type="radio" name="patientAble" value="yes" checked={patientAble === true} onchange={() => (patientAble = true)} />
        是
      </label>
      <label class="pill" class:selected={patientAble === false}>
        <input type="radio" name="patientAble" value="no" checked={patientAble === false} onchange={() => (patientAble = false)} />
        否
      </label>
    </div>
  </fieldset>

  <div class="optional-section">
    <h3 class="optional-title">基本資料（選填）</h3>

    <div class="field">
      <label for="birthDate">出生日期</label>
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
      <label for="nickName">暱稱</label>
      <input id="nickName" type="text" bind:value={nickName} placeholder="顯示用稱呼" />
    </div>
  </div>

  {#if validationError}
    <p class="error" role="alert">{validationError}</p>
  {/if}
  {#if assessmentStore.error}
    <p class="error" role="alert">{assessmentStore.error}</p>
  {/if}

  <button type="submit" class="btn-start" disabled={assessmentStore.isLoading || !cfsLevel || informantAvailable === null}>
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

  /* ---- CFS selector (lead card) ---- */
  .cfs-card {
    padding: var(--space-5);
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--line));
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--accent) 5%, var(--bg));
    margin-bottom: var(--space-8);
  }

  .cfs-card > legend {
    font-size: var(--text-lg);
    font-weight: var(--font-bold);
    color: var(--text);
    margin-bottom: var(--space-2);
  }

  .cfs-principle {
    font-size: var(--text-sm);
    line-height: var(--lh-base);
    color: color-mix(in srgb, var(--text), var(--bg) 20%);
    margin-bottom: var(--space-3);
  }

  /* Decision aid: adjacent-level thresholds (判讀關鍵分界) */
  .cfs-anchors {
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-4);
    margin-bottom: var(--space-4);
  }

  .cfs-anchors-title {
    display: block;
    font-size: var(--text-sm);
    font-weight: var(--font-bold);
    color: var(--accent);
    margin-bottom: var(--space-2);
  }

  .cfs-anchors ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .cfs-anchors li {
    font-size: var(--text-sm);
    line-height: var(--lh-base);
    color: color-mix(in srgb, var(--text), var(--bg) 15%);
  }

  .anchor-edge {
    display: inline-block;
    min-width: 44px;
    margin-right: var(--space-2);
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--accent) 14%, var(--bg));
    color: var(--accent);
    font-weight: var(--font-bold);
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

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

  /* ---- Availability (在場/可參與) yes/no pills ---- */
  .yesno-pills {
    display: flex;
    gap: var(--space-3);
  }

  /* ---- Optional (record-only) demographics, demoted below the clinical inputs ---- */
  .optional-section {
    margin-top: var(--space-8);
    padding-top: var(--space-5);
    border-top: 1px solid var(--line);
  }

  .optional-title {
    font-size: var(--text-base);
    font-weight: var(--font-medium);
    color: color-mix(in srgb, var(--text), var(--bg) 25%);
    margin-bottom: var(--space-4);
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
