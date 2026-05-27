<script lang="ts">
  import { assessmentStore } from '../../lib/stores/assessment.svelte';
  import { recordEvent, getEventsByModule } from '../../lib/db/assessment-events';
  import { domainLabel } from '../../lib/domain/domain-tree';
  import { scoreScale, type ScaleDef, type ScaleItem, type ScaleResult } from '../../lib/scales/scale';
  import { selectScreenScales, expandedFullScales, applyOperatorGate } from '../../lib/scales/tiering';
  import MobilityTaskModule from './MobilityTaskModule.svelte';
  import { MOBILITY_FALLBACK_SCALE } from '../../data/mobility-fallback';

  interface Props {
    scales?: ScaleDef[];
  }

  let { scales = [] }: Props = $props();

  // ---- Flattened question shape (one per scale item) ----
  interface FlatQuestion {
    scaleId: string;
    top: string;
    sub: string;
    domainLabel: string;
    clinicallyReviewed: boolean;
    item: ScaleItem;
  }

  /** Which tier the asking phase is currently in. Screens run first; once all
   *  screens are scored, `expandTier()` flips this to 'full' and appends the
   *  expanded full scales' questions. Declared before the derived sequences
   *  that read it. */
  let tier = $state<'screen' | 'full'>('screen');

  // ---- Derived state ----
  const cfsLevel = $derived(assessmentStore.cfsLevel);
  const operator = $derived(assessmentStore.operator);

  /** Tier-1 screen scales for this CFS level (always run first).
   *  Operator-aware: with no informant present (operator self/nurse) the
   *  cognition screen falls back from AD8 to Mini-Cog (C-M2). When operator is
   *  not yet known (null) we omit it so legacy AD8 selection is used. */
  const screenScales = $derived<ScaleDef[]>(
    cfsLevel ? selectScreenScales(scales, cfsLevel, operator ?? undefined) : [],
  );

  /** Tier-2 full scales, computed after the screens are scored (only flagged
   *  screens expand). Populated by `expandTier()`; empty until then. */
  let fullScales = $state<ScaleDef[]>([]);

  /** Timed-task scales (e.g. sit-to-stand) render via the dedicated module
   *  rather than as option questions. Split per tier so screen timed tasks
   *  (if any) run first, then any expanded timed task (e.g. sit-to-stand). */
  const screenTimedScales = $derived<ScaleDef[]>(screenScales.filter(s => s.inputType === 'timed-task'));
  const fullTimedScales = $derived<ScaleDef[]>(fullScales.filter(s => s.inputType === 'timed-task'));
  const timedScales = $derived<ScaleDef[]>([...screenTimedScales, ...fullTimedScales]);

  /** Option scales per tier (the only scales that become flat questions). */
  const screenOptionScales = $derived<ScaleDef[]>(screenScales.filter(s => s.inputType !== 'timed-task'));
  const fullOptionScales = $derived<ScaleDef[]>(fullScales.filter(s => s.inputType !== 'timed-task'));

  /** Active option scales depend on the tier: screens first; once expanded,
   *  screens + the flagged full scales. */
  const activeOptionScales = $derived<ScaleDef[]>(
    tier === 'screen' ? screenOptionScales : [...screenOptionScales, ...fullOptionScales],
  );

  /** Flatten the active option scales into a single question sequence. */
  const questions = $derived<FlatQuestion[]>(
    activeOptionScales.flatMap(s =>
      s.items.map(item => ({
        scaleId: s.id,
        top: s.domain.top,
        sub: s.domain.sub,
        domainLabel: domainLabel(s.domain.top, s.domain.sub),
        clinicallyReviewed: s.clinicallyReviewed,
        item,
      })),
    ),
  );

  // ---- Module state ----
  let currentIndex = $state(0);
  let answers = $state<Record<string, { score: number; scaleId: string }>>({});
  let lastAnswerLabel = $state<string | null>(null);
  /** Scales the operator marked 「無法取得」(ask-informant unavailable) — their
   *  remaining items are skipped and their result is forced to incomplete. */
  let unavailableScales = $state<Set<string>>(new Set());
  /** Self-harm safety notice — shown when a redFlag item gets a concerning
   *  answer. Non-blocking; the assessment continues and the score is recorded. */
  let safetyNoticeVisible = $state(false);
  // 'loading' (restore in flight) → 'timed' runs the timed-task module(s)
  // first; then 'asking' for option questions; then 'summary'. Starting in
  // 'loading' prevents answering before `initPhase` finishes restoring prior
  // progress (which would otherwise clobber/race the restore).
  let phase = $state<'loading' | 'timed' | 'asking' | 'summary'>('loading');
  let timedIndex = $state(0);
  let phaseInitialised = $state(false);
  let isSaving = $state(false);
  // Set on teardown so the answer-feedback setTimeout continuation doesn't touch
  // reactive $derived (scaleSummary) after the component's effect root is gone.
  let destroyed = false;
  $effect(() => () => { destroyed = true; });

  const currentTimedScale = $derived<ScaleDef | null>(timedScales[timedIndex] ?? null);

  // Decide the entry phase once scales/cfs resolve: timed tasks first if any.
  // On resume, restore prior answers/progress first so the user doesn't re-answer.
  $effect(() => {
    if (phaseInitialised) return;
    if (!cfsLevel) return;
    phaseInitialised = true;
    void initPhase();
  });

  /** Resolve entry phase, restoring prior progress when resuming. */
  async function initPhase(): Promise<void> {
    // No screen scale applies to this CFS level → empty state. phase 'asking'
    // with a null currentQuestion (no questions) renders the empty-state branch.
    if (screenScales.length === 0) {
      phase = 'asking';
      return;
    }

    await restoreAnswers();
    if (destroyed) return; // unmounted during restore → don't touch reactive deriveds

    // If every screen option scale is already answered, the prior session must
    // have reached (or passed) the screen→full boundary — recompute expansion
    // so resumed full questions reappear in the same order.
    if (screenOptionScales.length > 0 && screenOptionScales.every(isScaleResolved)) {
      expandTier();
    }

    // Skip timed tasks that already produced a ScaleResult (kept across resume;
    // their recording Blob lives separately in IndexedDB by assessmentId+scaleId).
    const doneResults = assessmentStore.partialAnalysis.scaleResults ?? {};
    while (timedIndex < timedScales.length && doneResults[timedScales[timedIndex].id]) {
      timedIndex++;
    }

    // First unanswered option question = resume point.
    const firstUnanswered = questions.findIndex(q => answers[q.item.id] === undefined);
    currentIndex = firstUnanswered === -1 ? Math.max(0, questions.length - 1) : firstUnanswered;

    const timedRemaining = timedIndex < timedScales.length;
    const allAnswered = questions.length > 0 && firstUnanswered === -1;

    if (timedRemaining) {
      phase = 'timed';
    } else if (questions.length === 0 || allAnswered) {
      // No option questions, or every one already answered → go straight to summary.
      persistScoresToStore();
      phase = 'summary';
    } else {
      phase = 'asking';
    }
  }

  /** A scale counts as resolved when all its items are answered OR it was
   *  marked unavailable (ask-informant 「無法取得」). */
  function isScaleResolved(s: ScaleDef): boolean {
    if (unavailableScales.has(s.id)) return true;
    return s.items.every(i => answers[i.id] !== undefined);
  }

  /** Rebuild the per-item answers map from persisted questionnaire events
   *  (one row per answered item). Last answer per question wins (re-answers).
   *  No-op for a fresh assessment (no events). */
  async function restoreAnswers(): Promise<void> {
    const assessment = assessmentStore.assessment;
    if (!assessment) return;
    let events;
    try {
      events = await getEventsByModule(assessment.id, 'questionnaire');
    } catch {
      return; // restore is best-effort; fall back to starting fresh
    }
    if (events.length === 0) return;
    const restored: Record<string, { score: number; scaleId: string }> = {};
    const unavailable = new Set<string>();
    for (const ev of events) {
      // Restore an 「無法取得」 marker (recorded as its own event type).
      if (ev.eventType === 'questionnaire_unavailable') {
        const scaleId = ev.data.scaleId as string | undefined;
        if (typeof scaleId === 'string') unavailable.add(scaleId);
        continue;
      }
      const questionId = ev.data.questionId as string | undefined;
      const score = ev.data.score as number | undefined;
      const scaleId = ev.data.scaleId as string | undefined;
      if (typeof questionId === 'string' && typeof score === 'number' && typeof scaleId === 'string') {
        restored[questionId] = { score, scaleId };
      }
    }
    answers = restored;
    unavailableScales = unavailable;
  }

  /** A timed-task module produced its uniform ScaleResult. Store it (gated),
   *  then advance to the next timed task or the option questions. */
  function handleTimedResult(result: ScaleResult): void {
    storeScaleResult(result);
    if (timedIndex < timedScales.length - 1) {
      timedIndex++;
    } else {
      // Timed tasks of the current set done → fall into the option questions
      // (or summary if there are none). If still in the screen tier with no
      // remaining screen option questions, expansion happens in maybeAdvanceTier.
      advanceToAskingOrSummary();
    }
  }

  /** After the active timed tasks finish, route to the option questions if any,
   *  otherwise compute screen expansion / summary. */
  function advanceToAskingOrSummary(): void {
    const firstUnanswered = questions.findIndex(q => answers[q.item.id] === undefined);
    if (firstUnanswered !== -1) {
      currentIndex = firstUnanswered;
      phase = 'asking';
      return;
    }
    // No option questions remaining in this tier.
    if (tier === 'screen') {
      maybeAdvanceTier();
    } else {
      persistScoresToStore();
      phase = 'summary';
    }
  }

  // ---- Progress ----
  const currentQuestion = $derived(questions[currentIndex] ?? null);
  const totalQuestions = $derived(questions.length);
  const answeredCount = $derived(Object.keys(answers).length);
  const progressPct = $derived(totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0);

  /** The ScaleDef the current question belongs to (for mode framing + gating). */
  const currentScaleDef = $derived<ScaleDef | null>(
    currentQuestion ? activeOptionScales.find(s => s.id === currentQuestion.scaleId) ?? null : null,
  );
  const currentMode = $derived(currentQuestion?.item.mode ?? 'ask-patient');

  /** Operator-oriented framing copy per施測 mode (D3 / spec UI 改造). */
  const MODE_FRAME: Record<string, { title: string; hint: string }> = {
    'ask-patient': { title: '請唸給受測者並記錄其回答', hint: '操作者：依下列題目詢問受測者本人，記錄其回答。' },
    'observe': { title: '請操作者觀察並記錄', hint: '操作者：依下列觀察重點觀察受測者，記錄結果。' },
    'ask-informant': { title: '請詢問家屬／照顧者', hint: '操作者：向同行的家屬或照顧者詢問並記錄。' },
    'measure': { title: '請測量並記錄', hint: '操作者：依下列方式量測，記錄數值。' },
  };
  const currentFrame = $derived(MODE_FRAME[currentMode] ?? MODE_FRAME['ask-patient']);

  // ---- Per-scale summary (active option scales only) ----
  const scaleSummary = $derived.by(() => {
    return activeOptionScales.map(s => {
      const itemIds = s.items.map(i => i.id);
      const answered = itemIds.filter(id => answers[id] !== undefined).length;
      const score = itemIds.reduce((sum, id) => sum + (answers[id]?.score ?? 0), 0);
      const pct = s.maxScore > 0 ? Math.round((score / s.maxScore) * 100) : 0;
      return {
        scaleId: s.id,
        label: domainLabel(s.domain.top, s.domain.sub),
        score,
        max: s.maxScore,
        answered,
        total: itemIds.length,
        pct,
        unavailable: unavailableScales.has(s.id),
      };
    });
  });

  // ---- Answer handler ----
  async function handleAnswer(option: { label: string; score: number }) {
    if (!currentQuestion) return;
    if (isSaving) return;

    isSaving = true;
    lastAnswerLabel = option.label;

    // C-S2 self-harm red flag: a concerning (non-zero / affirmative) answer to a
    // redFlag item surfaces an immediate safety notice. Non-blocking — the score
    // is still recorded and the assessment continues.
    if (currentQuestion.item.redFlag === 'self-harm' && option.score > 0) {
      safetyNoticeVisible = true;
    }

    answers = {
      ...answers,
      [currentQuestion.item.id]: { score: option.score, scaleId: currentQuestion.scaleId },
    };

    // Persist event to IndexedDB (one row per item). maxScore is the item's
    // own max option score so analyzer accumulation matches the scale maxScore.
    const assessment = assessmentStore.assessment;
    const child = assessmentStore.child;
    if (assessment && child) {
      const itemMax = Math.max(0, ...currentQuestion.item.options.map(o => o.score));
      await recordEvent({
        assessmentId: assessment.id,
        childId: child.id,
        moduleType: 'questionnaire',
        eventType: 'questionnaire_answer',
        timestamp: new Date(),
        data: {
          scaleId: currentQuestion.scaleId,
          top: currentQuestion.top,
          sub: currentQuestion.sub,
          questionId: currentQuestion.item.id,
          questionText: currentQuestion.item.text ?? currentQuestion.item.prompt,
          answerLabel: option.label,
          score: option.score,
          maxScore: itemMax,
          cfsLevel,
        },
        qualityFlags: { isComplete: true, isAnomaly: false },
      });
    }

    isSaving = false;

    await new Promise(r => setTimeout(r, 520));
    if (destroyed) return; // component unmounted during feedback delay
    lastAnswerLabel = null;

    // If this answer completed a scale, finalise its gated result now (drives
    // expansion + ResultView). Then advance.
    finaliseScaleIfComplete(currentQuestion.scaleId);
    advanceAfterItem();
  }

  /** Operator marked an ask-informant scale 「無法取得」 (no informant available).
   *  Per spec the scale becomes incomplete; its remaining items are skipped.
   *  C-S6: this path is NOT offered for delirium/cognition (handled by only
   *  rendering the button for ask-informant items whose scale is not those). */
  async function handleUnavailable() {
    if (!currentQuestion) return;
    if (isSaving) return;
    const scaleId = currentQuestion.scaleId;
    unavailableScales = new Set([...unavailableScales, scaleId]);

    const assessment = assessmentStore.assessment;
    const child = assessmentStore.child;
    if (assessment && child) {
      await recordEvent({
        assessmentId: assessment.id,
        childId: child.id,
        moduleType: 'questionnaire',
        eventType: 'questionnaire_unavailable',
        timestamp: new Date(),
        data: { scaleId, top: currentQuestion.top, sub: currentQuestion.sub, cfsLevel },
        qualityFlags: { isComplete: false, isAnomaly: false },
      });
    }

    // Store an incomplete result for the scale so it surfaces in results.
    const def = activeOptionScales.find(s => s.id === scaleId);
    if (def) {
      storeScaleResult({
        scaleId: def.id,
        domain: def.domain,
        rawScore: null,
        maxScore: def.maxScore,
        severity: 'incomplete',
        bandLabel: '無法取得（無可詢問之家屬/照顧者）',
      });
    }
    advanceAfterItem();
  }

  /** Advance to the next still-unanswered active question; if none remain,
   *  cross the tier boundary or finish. Skips items of unavailable scales. */
  function advanceAfterItem(): void {
    const nextIdx = questions.findIndex(
      (q, i) => i > currentIndex && answers[q.item.id] === undefined && !unavailableScales.has(q.scaleId),
    );
    if (nextIdx !== -1) {
      currentIndex = nextIdx;
      return;
    }
    // Backfill: an earlier scale may still be unanswered if order skipped it.
    const anyUnanswered = questions.findIndex(
      q => answers[q.item.id] === undefined && !unavailableScales.has(q.scaleId),
    );
    if (anyUnanswered !== -1) {
      currentIndex = anyUnanswered;
      return;
    }
    // All active questions resolved.
    if (tier === 'screen') {
      maybeAdvanceTier();
    } else {
      persistScoresToStore();
      phase = 'summary';
    }
  }

  /** All screen option scales resolved → compute expansion. If full scales were
   *  added, continue asking into them (timed full tasks first); else summary.
   *  Uses `expandTier`'s return value directly (not the derived signals, which
   *  may not have recomputed yet within this synchronous call). */
  function maybeAdvanceTier(): void {
    const expanded = expandTier();
    const expandedTimed = expanded.filter(s => s.inputType === 'timed-task');
    // After expansion the timedScales queue grows; if there is an unfinished
    // timed task, run it next.
    const stored = assessmentStore.partialAnalysis.scaleResults ?? {};
    const hasUnfinishedTimed = expandedTimed.some(s => !stored[s.id]);
    if (hasUnfinishedTimed) {
      // timedIndex was past the screen timed tasks; the expanded full timed
      // tasks now sit at indices [screenTimedScales.length ...]. Point at the
      // first unfinished one.
      const allTimed = [...screenTimedScales, ...expandedTimed];
      const idx = allTimed.findIndex(s => !stored[s.id]);
      timedIndex = idx === -1 ? allTimed.length : idx;
      phase = 'timed';
      return;
    }
    // Otherwise jump into the first unanswered full option question.
    const firstFull = questions.findIndex(q => answers[q.item.id] === undefined && !unavailableScales.has(q.scaleId));
    if (firstFull !== -1) {
      currentIndex = firstFull;
      phase = 'asking';
    } else {
      persistScoresToStore();
      phase = 'summary';
    }
  }

  /** Compute screen results from current answers, gate them, store them, then
   *  resolve which full scales to expand into. Sets `fullScales`/`tier` and
   *  returns the resolved full scales. Idempotent. */
  function expandTier(): ScaleDef[] {
    const screenResults: ScaleResult[] = [];
    for (const s of screenOptionScales) {
      const r = computeGatedResult(s);
      if (r) screenResults.push(r);
    }
    // Include any timed screen scales' stored results (e.g. measured mobility).
    const stored = assessmentStore.partialAnalysis.scaleResults ?? {};
    for (const s of screenTimedScales) {
      if (stored[s.id]) screenResults.push(stored[s.id]);
    }
    const expanded = expandedFullScales(scales, screenResults);
    fullScales = expanded;
    tier = 'full';
    return expanded;
  }

  /** Compute a scale's ScaleResult from current answers + operator gate, or null
   *  when the scale isn't applicable here. Unavailable scales → incomplete. */
  function computeGatedResult(def: ScaleDef): ScaleResult | null {
    if (unavailableScales.has(def.id)) {
      return {
        scaleId: def.id, domain: def.domain, rawScore: null, maxScore: def.maxScore,
        severity: 'incomplete', bandLabel: '無法取得（無可詢問之家屬/照顧者）',
      };
    }
    const itemIds = def.items.map(i => i.id);
    if (itemIds.length === 0) return null;
    const answered = itemIds.every(id => answers[id] !== undefined);
    if (!answered) return null;
    const raw = itemIds.reduce((sum, id) => sum + (answers[id]?.score ?? 0), 0);
    const result = scoreScale(def, raw);
    return operator ? applyOperatorGate(result, operator, def) : result;
  }

  /** Finalise a scale's gated result into the store when it becomes complete. */
  function finaliseScaleIfComplete(scaleId: string): void {
    const def = activeOptionScales.find(s => s.id === scaleId);
    if (!def) return;
    const r = computeGatedResult(def);
    if (r) storeScaleResult(r);
  }

  /** Persist a (gated) ScaleResult into partialAnalysis.scaleResults — ResultView
   *  prefers these precomputed results over re-scoring raw values, so the
   *  operator gate / incomplete markers surface in the final triage. */
  function storeScaleResult(result: ScaleResult): void {
    assessmentStore.addAnalysis({
      scaleResults: { ...(assessmentStore.partialAnalysis.scaleResults ?? {}), [result.scaleId]: result },
    });
  }

  function persistScoresToStore(): void {
    // Keyed by scaleId so ResultView can map back to a ScaleDef. We finalise a
    // gated ScaleResult for every active option scale so the gate/incomplete
    // markers are authoritative (ResultView prefers scaleResults over raw).
    const scores: Record<string, number> = {};
    const maxScores: Record<string, number> = {};
    for (const s of scaleSummary) {
      scores[s.scaleId] = s.score;
      maxScores[s.scaleId] = s.max;
    }
    assessmentStore.addAnalysis({
      questionnaireScores: scores,
      questionnaireMaxScores: maxScores,
    });
    for (const s of activeOptionScales) {
      const r = computeGatedResult(s);
      if (r) storeScaleResult(r);
    }
  }

  async function handleFinish() {
    persistScoresToStore();
    await assessmentStore.nextStep();
  }
</script>

<div class="questionnaire">

  {#if phase === 'loading'}
    <p class="loading-note" role="status">載入中…</p>

  {:else if phase === 'timed' && currentTimedScale}
    <!-- Timed-task module (e.g. five-times sit-to-stand). Emits a uniform
         ScaleResult via onResult; falls back to self-report when no camera. -->
    {#key timedIndex}
      <MobilityTaskModule
        scale={currentTimedScale}
        fallbackScale={MOBILITY_FALLBACK_SCALE}
        assessmentId={assessmentStore.assessment?.id}
        onResult={handleTimedResult}
      />
    {/key}

  {:else if phase === 'asking' && currentQuestion}
    <!-- Progress bar -->
    <div class="progress-bar-wrap" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
      <div class="progress-bar-track">
        <div class="progress-bar-fill" style="width: {progressPct}%"></div>
      </div>
      <span class="progress-label">第 {currentIndex + 1} 題，共 {totalQuestions} 題</span>
    </div>

    <!-- Self-harm safety notice (C-S2): immediate, prominent, non-blocking -->
    {#if safetyNoticeVisible}
      <div class="safety-notice" role="alert">
        <strong>安全提示：受測者可能有情緒低落或自傷風險</strong>
        <p>請立即關懷並評估安全，必要時陪同就醫或聯絡專業協助。本題分數已記錄，評估可繼續進行。</p>
        <ul>
          <li>安心專線 <a href="tel:1925">1925</a>（24 小時）</li>
          <li>生命線 <a href="tel:1995">1995</a>、張老師 <a href="tel:1980">1980</a></li>
          <li>建議轉介精神科／身心科或老年精神醫療評估</li>
        </ul>
        <button type="button" class="safety-dismiss" onclick={() => (safetyNoticeVisible = false)}>我已了解，繼續評估</button>
      </div>
    {/if}

    <!-- Domain badge -->
    <div class="domain-badge">{currentQuestion.domainLabel}</div>

    <!-- Operator framing (mode-oriented; replaces「請回答」) -->
    <div class="mode-frame mode-{currentMode}">
      <span class="mode-title">{currentFrame.title}</span>
      <span class="mode-hint">{currentFrame.hint}</span>
    </div>

    <!-- Question / prompt -->
    <h2 class="question-text">
      {currentQuestion.item.prompt ?? currentQuestion.item.text ?? ''}
      {#if currentQuestion.clinicallyReviewed !== true}
        <span
          class="badge-unreviewed"
          aria-label="本量表尚未經臨床顧問審查"
        >未審</span>
      {/if}
    </h2>

    <!-- Sub-questions (e.g. AMT4 four orientation items) -->
    {#if currentQuestion.item.subquestions && currentQuestion.item.subquestions.length > 0}
      <ol class="subquestions">
        {#each currentQuestion.item.subquestions as sq (sq)}
          <li>{sq}</li>
        {/each}
      </ol>
    {/if}

    <!-- Feedback overlay -->
    {#if lastAnswerLabel}
      <div class="feedback-banner" role="status">已記錄！下一題</div>
    {/if}

    <!-- Options -->
    <div class="options-list">
      {#each currentQuestion.item.options as option (option.label)}
        <button
          class="option-btn"
          class:selected={answers[currentQuestion.item.id]?.score === option.score}
          disabled={isSaving}
          data-score={option.score}
          onclick={() => handleAnswer(option)}
        >
          {option.label}
        </button>
      {/each}
    </div>

    <!-- ask-informant: allow marking 「無法取得」 (no informant) → scale incomplete.
         C-S6: NOT offered for delirium/cognition (most dangerous if silently skipped). -->
    {#if currentMode === 'ask-informant' && currentScaleDef && currentScaleDef.domain.sub !== 'delirium' && currentScaleDef.domain.sub !== 'cognition'}
      <button type="button" class="unavailable-btn" disabled={isSaving} onclick={handleUnavailable}>
        無法取得（無可詢問之家屬／照顧者）
      </button>
    {/if}

  {:else if phase === 'summary'}
    <!-- Summary screen -->
    <div class="summary">
      <div class="summary-icon" aria-hidden="true">
        <svg width="56" height="56" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="28" cy="28" r="28" style="fill: color-mix(in srgb, var(--accent) 12%, var(--bg));"/>
          <path d="M16 28.5l8 8 16-16" style="stroke: var(--accent);" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <h2 class="summary-title">問卷完成！</h2>
      <p class="summary-desc">以下是各評估面向的作答摘要（短篩亮燈的領域已展開深評）</p>

      <div class="domain-bars">
        {#each scaleSummary as d (d.scaleId)}
          <div class="domain-row">
            <span class="domain-name">{d.label}</span>
            <div class="bar-track">
              <div
                class="bar-fill"
                class:bar-high={d.pct >= 67}
                class:bar-mid={d.pct >= 34 && d.pct < 67}
                class:bar-low={d.pct < 34}
                style="width: {d.pct}%"
              ></div>
            </div>
            <span class="domain-score">{d.unavailable ? '無法取得' : `${d.score}/${d.max}`}</span>
          </div>
        {/each}
      </div>

      <div class="recommendation">
        <h3>下一步</h3>
        <p>送出後將依各量表的驗證切分點計分（含操作者效度檢核），彙整為周全性評估結果與衛教建議。</p>
        <div class="actions">
          <button class="btn-finish" onclick={handleFinish}>查看評估結果</button>
        </div>
      </div>
    </div>

  {:else}
    <!-- No applicable scales for this CFS level -->
    <div class="empty-state">
      <p>目前此衰弱等級沒有可施測的量表。</p>
      <button class="btn-finish" onclick={handleFinish}>繼續下一步</button>
    </div>
  {/if}

</div>

<style>
  .questionnaire {
    max-width: 560px;
    margin: 0 auto;
    padding: var(--space-6);
  }

  .loading-note {
    text-align: center;
    padding: var(--space-8);
    font-size: var(--text-base);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
  }

  /* ---- Progress ---- */
  .progress-bar-wrap {
    margin-bottom: var(--space-6);
  }

  .progress-bar-track {
    height: 6px;
    background: color-mix(in srgb, var(--bg), var(--text) 5%);
    border-radius: var(--radius-full);
    overflow: hidden;
    margin-bottom: var(--space-2);
  }

  .progress-bar-fill {
    height: 100%;
    background: var(--accent);
    border-radius: var(--radius-full);
    transition: width 0.3s ease;
  }

  .progress-label {
    font-size: var(--text-xs);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
  }

  /* ---- Domain badge ---- */
  .domain-badge {
    display: inline-block;
    padding: var(--space-1) var(--space-3);
    background: color-mix(in srgb, var(--warn) 12%, var(--bg));
    color: var(--warn);
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    margin-bottom: var(--space-4);
  }

  /* ---- Mode framing (operator-oriented) ---- */
  .mode-frame {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    border-left: 4px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, var(--bg));
    margin-bottom: var(--space-4);
  }

  .mode-frame.mode-observe {
    border-left-color: var(--warn);
    background: color-mix(in srgb, var(--warn) 8%, var(--bg));
  }

  .mode-frame.mode-ask-informant {
    border-left-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, var(--bg));
  }

  .mode-frame.mode-measure {
    border-left-color: var(--warn);
    background: color-mix(in srgb, var(--warn) 8%, var(--bg));
  }

  .mode-title {
    font-size: var(--text-base);
    font-weight: var(--font-bold);
    color: var(--text);
  }

  .mode-hint {
    font-size: var(--text-sm);
    color: color-mix(in srgb, var(--text), var(--bg) 25%);
    line-height: var(--lh-base);
  }

  /* ---- Question ---- */
  .question-text {
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
    line-height: var(--lh-xl);
    margin-bottom: var(--space-4);
    color: var(--text);
  }

  /* ---- Sub-questions ---- */
  .subquestions {
    margin: 0 0 var(--space-6);
    padding-left: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .subquestions li {
    font-size: var(--text-base);
    line-height: var(--lh-base);
    color: var(--text);
  }

  /* ---- Safety notice (self-harm red flag, C-S2) ---- */
  .safety-notice {
    border: 2px solid var(--danger);
    background: color-mix(in srgb, var(--danger) 10%, var(--bg));
    border-radius: var(--radius-md);
    padding: var(--space-4) var(--space-5);
    margin-bottom: var(--space-5);
  }

  .safety-notice strong {
    display: block;
    font-size: var(--text-lg);
    color: var(--danger);
    margin-bottom: var(--space-2);
  }

  .safety-notice p {
    font-size: var(--text-base);
    line-height: var(--lh-base);
    color: var(--text);
    margin-bottom: var(--space-3);
  }

  .safety-notice ul {
    margin: 0 0 var(--space-4);
    padding-left: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .safety-notice li {
    font-size: var(--text-base);
    line-height: var(--lh-base);
    color: var(--text);
  }

  .safety-notice a {
    color: var(--danger);
    font-weight: var(--font-bold);
  }

  .safety-dismiss {
    width: 100%;
    min-height: 48px;
    padding: var(--space-3) var(--space-4);
    background: var(--danger);
    color: white;
    border: none;
    border-radius: var(--radius-md);
    font-size: var(--text-base);
    font-weight: var(--font-bold);
    cursor: pointer;
  }

  /* ---- Feedback ---- */
  .feedback-banner {
    background: color-mix(in srgb, var(--accent) 12%, var(--bg));
    color: var(--accent);
    border-radius: var(--radius-md);
    padding: var(--space-3) var(--space-4);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    text-align: center;
    margin-bottom: var(--space-4);
  }

  /* ---- Options ---- */
  .options-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .option-btn {
    width: 100%;
    min-height: 64px;
    padding: var(--space-4) var(--space-5);
    background: var(--surface);
    border: 2px solid var(--line);
    border-radius: var(--radius-lg);
    font-size: var(--text-base);
    font-weight: var(--font-medium);
    color: var(--text);
    cursor: pointer;
    text-align: left;
    transition: border-color 0.15s, background 0.15s;
    line-height: var(--lh-base);
  }

  .option-btn:hover:not(:disabled) {
    border-color: var(--accent);
    background: var(--bg);
  }

  .option-btn.selected {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, var(--bg));
    color: var(--accent);
  }

  .option-btn:disabled {
    opacity: 0.7;
    cursor: not-allowed;
  }

  /* ---- ask-informant 「無法取得」 ---- */
  .unavailable-btn {
    width: 100%;
    min-height: 44px;
    margin-top: var(--space-4);
    padding: var(--space-3) var(--space-4);
    background: none;
    border: 1px dashed var(--line);
    border-radius: var(--radius-md);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .unavailable-btn:hover:not(:disabled) {
    border-color: var(--warn);
    color: var(--warn);
  }

  /* ---- Summary ---- */
  .summary {
    text-align: center;
  }

  .summary-icon {
    margin-bottom: var(--space-4);
  }

  .summary-title {
    font-size: var(--text-2xl);
    margin-bottom: var(--space-2);
  }

  .summary-desc {
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    font-size: var(--text-sm);
    margin-bottom: var(--space-7);
  }

  /* ---- Domain bar chart ---- */
  .domain-bars {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    margin-bottom: var(--space-8);
    text-align: left;
  }

  .domain-row {
    display: grid;
    grid-template-columns: 80px 1fr 56px;
    align-items: center;
    gap: var(--space-3);
  }

  .domain-name {
    font-size: var(--text-xs);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    white-space: nowrap;
  }

  .bar-track {
    height: 16px;
    background: color-mix(in srgb, var(--bg), var(--text) 5%);
    border-radius: var(--radius-full);
    overflow: hidden;
  }

  .bar-fill {
    height: 100%;
    border-radius: var(--radius-full);
    transition: width 0.6s ease;
  }

  .bar-fill.bar-high {
    background: var(--accent);
  }

  .bar-fill.bar-mid {
    background: var(--warn);
  }

  .bar-fill.bar-low {
    background: var(--danger);
  }

  .domain-score {
    font-size: var(--text-xs);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    text-align: right;
    white-space: nowrap;
  }

  /* ---- Finish button ---- */
  .btn-finish {
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
  }

  .btn-finish:hover {
    background: color-mix(in srgb, var(--accent) 85%, black);
  }

  /* ---- Empty state ---- */
  .empty-state {
    text-align: center;
    padding: var(--space-8);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
  }

  .empty-state p {
    margin-bottom: var(--space-6);
  }

  /* clinicallyReviewed badge — text-sm 為 20px (≥ 18px 最小字級門檻)，
     對比度 ≥ 4.5:1 (warn oklch(0.48 0.14 65) vs bg oklch(0.985 0.006 85)，WCAG AA pass) */
  .badge-unreviewed {
    display: inline-block;
    background: var(--warn);
    color: var(--bg);
    font-size: var(--text-sm);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    margin-left: var(--space-2);
    vertical-align: middle;
  }

  /* ---- Recommendation section ---- */
  .recommendation { margin-top: var(--space-4); }
  .recommendation h3 { font-size: var(--text-base); font-weight: var(--font-medium); margin-bottom: var(--space-3); }
  .recommendation p { font-size: var(--text-base); line-height: var(--lh-base); color: color-mix(in srgb, var(--text), var(--bg) 25%); }
  .recommendation .actions { display: flex; gap: var(--space-3); margin-top: var(--space-4); }
</style>
