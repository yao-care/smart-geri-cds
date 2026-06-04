<script lang="ts">
  import { assessmentStore } from '../../lib/stores/assessment.svelte';
  import { ageInMonths } from '../../lib/utils/age-groups';
  import {
    CFS_LEVELS,
    CFS_LABELS,
    CFS_DESCRIPTIONS,
    type CfsLevel,
  } from '../../lib/utils/cfs-levels';
  import SubjectSelector from './SubjectSelector.svelte';
  import { loadSubjectsWithStats, type SubjectWithStats } from '../../lib/db/assessments';
  import type { Child } from '../../lib/db/schema';

  interface Props { preselectedChildId?: string }
  let { preselectedChildId }: Props = $props();

  let subjects = $state<SubjectWithStats[]>([]);
  let selectedChild = $state<Child | null>(null);
  const mode = $derived(selectedChild ? 'existing' : 'new');

  $effect(() => {
    loadSubjectsWithStats().then((list) => {
      subjects = list;
      if (preselectedChildId) {
        const hit = list.find((s) => s.child.id === preselectedChildId);
        if (hit) handleSelect(hit.child);
      }
    });
  });

  function handleSelect(child: Child | null) {
    selectedChild = child;
    if (child) {
      birthDate = child.birthDate ?? '';
      gender = child.gender;
      nickName = child.nickName ?? '';
    } else {
      birthDate = '';
      gender = 'male';
      nickName = '';
    }
  }

  let birthDate = $state('');
  let gender = $state<'male' | 'female' | 'other'>('male');
  let nickName = $state('');
  let cfsLevel = $state<CfsLevel | null>(null);
  // 滑過／鍵盤聚焦預覽的等級（供「未選即可逐級比對描述」）；無預覽時顯示已選等級。
  let previewLevel = $state<CfsLevel | null>(null);
  const shownLevel = $derived(previewLevel ?? cfsLevel);
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

    if (mode === 'existing' && selectedChild) {
      await assessmentStore.startForExisting(
        { ...selectedChild, birthDate, gender, nickName: nickName || undefined },
        cfsLevel,
        { informantAvailable, patientAble },
      );
    } else {
      await assessmentStore.startNew(
        { birthDate, gender, nickName: nickName || undefined },
        cfsLevel,
        { informantAvailable, patientAble },
      );
    }
  }
</script>

<form class="subject-profile" onsubmit={(e) => { e.preventDefault(); handleSubmit(); }}>
  <header class="sp-head">
    <h2>受測者評估設定</h2>
    <p class="form-desc">請先判定臨床衰弱量表（CFS）；基本資料選填、僅供紀錄。</p>
  </header>

  <SubjectSelector {subjects} selectedId={selectedChild?.id ?? null} onSelect={handleSelect} />

  <div class="sp-grid">
    <!-- LEFT: CFS — the lead clinical judgment -->
    <fieldset class="field cfs-card">
      <legend>臨床衰弱量表 CFS <span class="required">*</span></legend>

      <!-- 3×3 grid keeps all nine levels on one screen; hovering/focusing a level
           previews its full description below so levels can be compared before
           選取（previewLevel）；選定後顯示已選等級的描述。 -->
      <div class="cfs-grid" role="radiogroup" aria-label="臨床衰弱量表等級">
        {#each CFS_LEVELS as level (level)}
          <label
            class="cfs-chip"
            class:selected={cfsLevel === level}
            class:preview={previewLevel === level}
            onmouseenter={() => (previewLevel = level)}
            onmouseleave={() => (previewLevel = null)}
          >
            <input
              type="radio"
              name="cfs"
              value={level}
              bind:group={cfsLevel}
              onfocus={() => (previewLevel = level)}
              onblur={() => (previewLevel = null)}
            />
            <span class="cfs-num">{level.replace('cfs', '')}</span>
            <span class="cfs-name">{CFS_LABELS[level]}</span>
          </label>
        {/each}
      </div>

      <p class="cfs-selected-desc" aria-live="polite">
        {#if shownLevel}
          <strong>{shownLevel.replace('cfs', '')} {CFS_LABELS[shownLevel]}</strong>：{CFS_DESCRIPTIONS[shownLevel]}
        {:else}
          滑過或點選等級即可看說明。請依近 2 週日常狀態判定（必填，非急性生病期）。
        {/if}
      </p>

      <details class="cfs-anchors">
        <summary class="cfs-anchors-title">判讀關鍵分界（點開對照）</summary>
        <ul>
          <li><span class="anchor-edge">3→4</span> 開始有症狀使活動變慢，但日常仍能自理</li>
          <li><span class="anchor-edge">4→5</span> 工具性日常（購物／理財／服藥）需協助</li>
          <li><span class="anchor-edge">5→6</span> 戶外活動與家務需協助</li>
          <li><span class="anchor-edge">6→7</span> 個人照護（洗澡／穿衣／如廁）依賴他人</li>
        </ul>
      </details>
    </fieldset>

    <!-- RIGHT: prerequisites + optional record-only data -->
    <div class="sp-side">
      <fieldset class="field availability-field">
        <legend>有家屬／照顧者可提供日常資訊？ <span class="required">*</span></legend>
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
        <legend>受測者本人能否參與作答／受測？<span class="legend-note">（預設是）</span></legend>
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

      <details class="optional-details" open={mode === 'existing'}>
        <summary>基本資料（選填，僅供紀錄）</summary>
        <div class="optional-body">
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
              <span class="age-notice">提醒：未滿 65 歲仍可進行（不阻擋）。</span>
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
      </details>
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
    max-width: 920px;
    margin: 0 auto;
    padding: var(--space-2);
  }

  .sp-head {
    text-align: center;
    margin-bottom: var(--space-2);
  }

  h2 {
    font-size: var(--text-lg);
    margin-bottom: var(--space-1);
  }

  .form-desc {
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    font-size: var(--text-caption);
  }

  /* Two columns on wide screens: CFS lead (left) + prerequisites/optional (right).
     Stacks on narrow screens. */
  .sp-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-3);
  }

  @media (min-width: 720px) {
    .sp-grid {
      grid-template-columns: 1.25fr 1fr;
      align-items: start;
    }
  }

  .field {
    margin: 0;
    padding: 0;
    border: 0;
    min-width: 0;
  }

  label,
  legend {
    display: block;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    margin-bottom: var(--space-1);
    padding: 0;
    color: var(--text);
  }

  .required {
    color: var(--danger);
  }

  input[type="date"],
  input[type="text"] {
    width: 100%;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    font-size: var(--text-xs);
    min-height: 44px;
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
    font-size: var(--text-caption);
    font-weight: var(--font-medium);
  }

  .age-notice {
    display: block;
    margin-top: var(--space-2);
    font-size: var(--text-caption);
    color: var(--warn);
  }

  .gender-pills,
  .yesno-pills {
    display: flex;
    gap: var(--space-2);
  }

  .pill {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    cursor: pointer;
    font-size: var(--text-xs);
    min-height: 44px;
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

  /* ---- CFS lead card ---- */
  .cfs-card {
    padding: var(--space-3);
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--line));
    border-radius: var(--radius-lg);
    background: color-mix(in srgb, var(--accent) 5%, var(--bg));
  }

  .cfs-card > legend {
    font-size: var(--text-base);
    font-weight: var(--font-bold);
    color: var(--text);
    margin-bottom: var(--space-1);
  }

  /* 3×3 level grid */
  .cfs-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-1);
  }

  .cfs-chip {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--bg);
    cursor: pointer;
    min-height: 44px;
    transition: border-color 0.15s, background 0.15s;
    margin-bottom: 0;
  }

  .cfs-chip:hover {
    border-color: var(--accent);
  }

  .cfs-chip.selected {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, var(--bg));
  }

  /* hover/keyboard-focus 預覽：較淡的強調，與「已選」區分。 */
  .cfs-chip.preview:not(.selected) {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 7%, var(--bg));
  }

  .cfs-chip input[type="radio"]:focus-visible + .cfs-num {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .cfs-chip input[type="radio"] {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }

  .cfs-num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    width: 26px;
    height: 26px;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--accent) 16%, var(--bg));
    color: var(--accent);
    font-weight: var(--font-bold);
    font-size: var(--text-caption);
  }

  .cfs-name {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--text);
    line-height: 1.2;
  }

  .cfs-selected-desc {
    margin: var(--space-2) 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: var(--bg);
    font-size: var(--text-caption);
    line-height: var(--lh-base);
    color: color-mix(in srgb, var(--text), var(--bg) 12%);
    /* 固定約兩行高，hover 逐級預覽時不抖動。 */
    min-height: 3em;
  }

  /* Decision aid: adjacent-level thresholds (collapsed by default to keep the
     page on one screen; clinician expands when needed). */
  .cfs-anchors {
    border-top: 1px dashed var(--line);
    padding-top: var(--space-2);
  }

  .cfs-anchors-title {
    font-size: var(--text-caption);
    font-weight: var(--font-bold);
    color: var(--accent);
    cursor: pointer;
    list-style-position: inside;
  }

  .cfs-anchors ul {
    list-style: none;
    margin: var(--space-2) 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .cfs-anchors li {
    font-size: var(--text-caption);
    line-height: var(--lh-base);
    color: color-mix(in srgb, var(--text), var(--bg) 15%);
  }

  .anchor-edge {
    display: inline-block;
    min-width: 40px;
    margin-right: var(--space-2);
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--accent) 14%, var(--bg));
    color: var(--accent);
    font-weight: var(--font-bold);
    font-variant-numeric: tabular-nums;
    text-align: center;
  }

  /* ---- Prerequisites column ---- */
  .sp-side {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .legend-note {
    font-weight: normal;
    font-size: var(--text-caption);
    color: color-mix(in srgb, var(--text), var(--bg) 35%);
  }

  /* ---- Optional (record-only) demographics, collapsed by default ---- */
  .optional-details {
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
  }

  .optional-details summary {
    cursor: pointer;
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: color-mix(in srgb, var(--text), var(--bg) 20%);
    min-height: 44px;
    display: flex;
    align-items: center;
  }

  .optional-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-top: var(--space-3);
  }

  .error {
    color: var(--danger);
    font-size: var(--text-sm);
    margin: var(--space-3) 0 0;
    text-align: center;
  }

  .btn-start {
    width: 100%;
    padding: var(--space-3);
    background: var(--accent);
    color: white;
    border: none;
    border-radius: var(--radius-md);
    font-size: var(--text-lg);
    font-weight: var(--font-bold);
    cursor: pointer;
    min-height: 48px;
    margin-top: var(--space-2);
  }

  .btn-start:hover:not(:disabled) {
    background: color-mix(in srgb, var(--accent) 85%, black);
  }

  .btn-start:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
