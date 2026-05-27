<script lang="ts">
  import { assessmentStore } from '../../lib/stores/assessment.svelte';
  import { recordEvent, getEventsByModule } from '../../lib/db/assessment-events';
  import { domainLabel } from '../../lib/domain/domain-tree';
  import type { ScaleDef, ScaleItem, ScaleResult } from '../../lib/scales/scale';
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

  // ---- Derived state ----
  const cfsLevel = $derived(assessmentStore.cfsLevel);

  /** Scales applicable to the assessment's CFS level. */
  const applicableScales = $derived<ScaleDef[]>(
    cfsLevel ? scales.filter(s => s.applicableCfs.includes(cfsLevel)) : [],
  );

  /** Timed-task scales (e.g. sit-to-stand) are rendered by a dedicated module,
   *  not as option questions. Option scales keep the flattened-question path. */
  const timedScales = $derived<ScaleDef[]>(
    applicableScales.filter(s => s.inputType === 'timed-task'),
  );
  const optionScales = $derived<ScaleDef[]>(
    applicableScales.filter(s => s.inputType !== 'timed-task'),
  );

  /** Flatten option scales into a single question sequence. */
  const questions = $derived<FlatQuestion[]>(
    optionScales.flatMap(s =>
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
  // 'timed' runs the timed-task module(s) first; then 'asking' for option
  // questions; then 'summary'. Initialised by an $effect once scales resolve.
  let phase = $state<'timed' | 'asking' | 'summary'>('asking');
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
    if (applicableScales.length === 0) return;
    phaseInitialised = true;
    void initPhase();
  });

  /** Resolve entry phase, restoring prior progress when resuming. */
  async function initPhase(): Promise<void> {
    await restoreAnswers();

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
      phase = 'summary';
    } else {
      phase = 'asking';
    }
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
    for (const ev of events) {
      const questionId = ev.data.questionId as string | undefined;
      const score = ev.data.score as number | undefined;
      const scaleId = ev.data.scaleId as string | undefined;
      if (typeof questionId === 'string' && typeof score === 'number' && typeof scaleId === 'string') {
        restored[questionId] = { score, scaleId };
      }
    }
    answers = restored;
  }

  /** A timed-task module produced its uniform ScaleResult. Store it as a
   *  pre-computed result (ResultView prefers these over re-scoring), then
   *  advance to the next timed task or the option questions. */
  function handleTimedResult(result: ScaleResult): void {
    assessmentStore.addAnalysis({
      scaleResults: { ...(assessmentStore.partialAnalysis.scaleResults ?? {}), [result.scaleId]: result },
    });
    if (timedIndex < timedScales.length - 1) {
      timedIndex++;
    } else if (questions.length > 0) {
      phase = 'asking';
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

  // ---- Per-scale summary (option scales only; timed tasks have no per-item score) ----
  const scaleSummary = $derived.by(() => {
    return optionScales.map(s => {
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
      };
    });
  });

  // ---- Answer handler ----
  async function handleAnswer(option: { label: string; score: number }) {
    if (!currentQuestion) return;
    if (isSaving) return;

    isSaving = true;
    lastAnswerLabel = option.label;

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
          questionText: currentQuestion.item.text,
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

    if (currentIndex < totalQuestions - 1) {
      currentIndex++;
    } else {
      persistScoresToStore();
      phase = 'summary';
    }
  }

  function persistScoresToStore(): void {
    // Keyed by scaleId so ResultView can map back to a ScaleDef and run scoreScale.
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
  }

  async function handleFinish() {
    persistScoresToStore();
    await assessmentStore.nextStep();
  }
</script>

<div class="questionnaire">

  {#if phase === 'timed' && currentTimedScale}
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

    <!-- Domain badge -->
    <div class="domain-badge">{currentQuestion.domainLabel}</div>

    <!-- Question text -->
    <h2 class="question-text">
      {currentQuestion.item.text}
      {#if currentQuestion.clinicallyReviewed !== true}
        <span
          class="badge-unreviewed"
          aria-label="本量表尚未經臨床顧問審查"
        >未審</span>
      {/if}
    </h2>

    <!-- Feedback overlay -->
    {#if lastAnswerLabel}
      <div class="feedback-banner" role="status">好的！下一題</div>
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
      <p class="summary-desc">以下是各評估面向的作答摘要</p>

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
            <span class="domain-score">{d.score}/{d.max}</span>
          </div>
        {/each}
      </div>

      <div class="recommendation">
        <h3>下一步</h3>
        <p>送出後將依各量表的驗證切分點計分，彙整為周全性評估結果與衛教建議。</p>
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

  /* ---- Question ---- */
  .question-text {
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
    line-height: var(--lh-xl);
    margin-bottom: var(--space-6);
    color: var(--text);
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
    grid-template-columns: 80px 1fr 40px;
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
