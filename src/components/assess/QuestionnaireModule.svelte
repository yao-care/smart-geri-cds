<script lang="ts">
  import { assessmentStore, type SkippableModule } from '../../lib/stores/assessment.svelte';
  import { recordEvent } from '../../lib/db/assessment-events';
  import questionsData from '../../data/questionnaire/questions.json';
  import expectedDomainsMap from '../../lib/data/expected-questionnaire-domains.generated.json';
  import type { AgeGroupCDSA } from '../../lib/utils/age-groups';

  // ---- Types ----
  interface QuestionOption {
    value: string;
    label: string;
    score: number;
  }

  interface Question {
    id: string;
    domain: string;
    domainLabel: string;
    ageGroups: string[];
    text: string;
    options: QuestionOption[];
    clinicallyReviewed?: boolean;
    source?: string;
  }

  // ---- Derived state ----
  const ageGroup = $derived(assessmentStore.ageGroup);

  const questions = $derived<Question[]>(
    ageGroup
      ? (questionsData.questions as Question[]).filter(q =>
          q.ageGroups.includes(ageGroup as string)
        )
      : []
  );

  // ---- Module state ----
  let currentIndex = $state(0);
  let answers = $state<Record<string, { value: string; score: number; domainLabel: string; domain: string }>>({});
  let lastAnswerLabel = $state<string | null>(null);
  let phase = $state<'asking' | 'summary'>('asking');
  let isSaving = $state(false);

  // ---- Progress ----
  const currentQuestion = $derived(questions[currentIndex] ?? null);
  const totalQuestions = $derived(questions.length);
  const answeredCount = $derived(Object.keys(answers).length);
  const progressPct = $derived(totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0);

  // ---- Domain summary ----
  const domainSummary = $derived.by(() => {
    const domains: Record<string, { label: string; score: number; max: number }> = {};
    for (const q of questions) {
      if (!domains[q.domain]) {
        domains[q.domain] = { label: q.domainLabel, score: 0, max: 0 };
      }
      domains[q.domain].max += 2; // max score per question is 2
      if (answers[q.id]) {
        domains[q.domain].score += answers[q.id].score;
      }
    }
    return Object.entries(domains).map(([domain, data]) => ({
      domain,
      label: data.label,
      score: data.score,
      max: data.max,
      pct: data.max > 0 ? Math.round((data.score / data.max) * 100) : 0,
    }));
  });

  // ---- Answer handler ----
  async function handleAnswer(option: QuestionOption) {
    if (!currentQuestion) return;
    if (isSaving) return;

    isSaving = true;
    lastAnswerLabel = option.label;

    // Record in local state
    answers = {
      ...answers,
      [currentQuestion.id]: {
        value: option.value,
        score: option.score,
        domainLabel: currentQuestion.domainLabel,
        domain: currentQuestion.domain,
      },
    };

    // Persist event to IndexedDB
    const assessment = assessmentStore.assessment;
    const child = assessmentStore.child;
    if (assessment && child) {
      await recordEvent({
        assessmentId: assessment.id,
        childId: child.id,
        moduleType: 'questionnaire',
        eventType: 'questionnaire_answer',
        timestamp: new Date(),
        data: {
          questionId: currentQuestion.id,
          domain: currentQuestion.domain,
          domainLabel: currentQuestion.domainLabel,
          questionText: currentQuestion.text,
          answerValue: option.value,
          answerLabel: option.label,
          score: option.score,
          ageGroup: ageGroup,
        },
        qualityFlags: {
          isComplete: true,
          isAnomaly: false,
        },
      });
    }

    isSaving = false;

    // Brief feedback then advance
    await new Promise(r => setTimeout(r, 520));
    lastAnswerLabel = null;

    if (currentIndex < totalQuestions - 1) {
      currentIndex++;
    } else {
      // Persist scores into the store immediately on the last answer so a
      // distracted user / Playwright run that never reaches the summary
      // "完成問卷" button still feeds the triage engine. The summary screen
      // remains as a confirmation surface; pressing 完成問卷 only advances.
      persistScoresToStore();
      phase = 'summary';
    }
  }

  function persistScoresToStore(): void {
    const scores: Record<string, number> = {};
    const maxScores: Record<string, number> = {};
    for (const s of domainSummary) {
      scores[s.domain] = s.score;
      maxScores[s.domain] = s.max;
    }

    if (import.meta.env.DEV && ageGroup) {
      const expected = (expectedDomainsMap as Record<string, string[]>)[ageGroup as string] ?? [];
      for (const d of expected) {
        if (!(d in scores)) {
          console.warn(`[Questionnaire] Missing domain '${d}' for ageGroup '${ageGroup as string}'.`);
        }
      }
    }

    assessmentStore.addAnalysis({
      questionnaireScores: scores,
      questionnaireMaxScores: maxScores,
    });
  }

  // ---- Finish ----
  async function handleFinish() {
    // Re-write in case the user changed an earlier answer via back-nav;
    // the call above already covered the happy path.
    persistScoresToStore();
    await assessmentStore.nextStep();
  }

  async function handleForceFullEval() {
    assessmentStore.forceFullAssessment = true;
    await handleFinish();
  }
</script>

<div class="questionnaire">

  {#if phase === 'asking' && currentQuestion}
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
      {currentQuestion.text}
      {#if currentQuestion?.clinicallyReviewed === false}
        <span
          class="badge-unreviewed"
          aria-label="本題尚未經臨床顧問審查"
        >未審</span>
      {/if}
    </h2>

    <!-- Feedback overlay -->
    {#if lastAnswerLabel}
      <div class="feedback-banner" role="status">好的！下一題</div>
    {/if}

    <!-- Options -->
    <div class="options-list">
      {#each currentQuestion.options as option (option.value)}
        <button
          class="option-btn"
          class:selected={answers[currentQuestion.id]?.value === option.value}
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
      <p class="summary-desc">以下是各發展領域的作答摘要</p>

      <div class="domain-bars">
        {#each domainSummary as d (d.domain)}
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
        <h3>依您的作答結果，建議完成：</h3>
        <ul>
          <li>✓ 互動遊戲（量「行為」面向）</li>
          <li class:skipped={assessmentStore.skippedModules.has('video' as SkippableModule)}>
            {assessmentStore.skippedModules.has('video' as SkippableModule) ? '✗ 影片錄製（粗動作滿分，已跳過）' : '✓ 影片錄製（粗動作）'}
          </li>
          <li class:skipped={assessmentStore.skippedModules.has('drawing' as SkippableModule)}>
            {assessmentStore.skippedModules.has('drawing' as SkippableModule) ? '✗ 繪圖（細動作滿分，已跳過）' : '✓ 繪圖（細動作）'}
          </li>
          <li class:skipped={assessmentStore.skippedModules.has('voice' as SkippableModule)}>
            {assessmentStore.skippedModules.has('voice' as SkippableModule) ? '✗ 語音（語言滿分，已跳過）' : '✓ 語音（語言）'}
          </li>
        </ul>
        <div class="actions">
          <button class="btn-finish" onclick={handleFinish}>依建議繼續</button>
          <button class="btn-finish secondary" onclick={handleForceFullEval}>跑完整評估</button>
        </div>
      </div>
    </div>

  {:else}
    <!-- No questions for this age group (should not happen) -->
    <div class="empty-state">
      <p>此年齡層目前沒有適用的問卷題目。</p>
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

  /* ---- clinicallyReviewed badge ---- */
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
  .recommendation ul { list-style: none; padding: 0; }
  .recommendation li { padding: var(--space-2) 0; font-size: var(--text-base); }
  .recommendation li.skipped { color: var(--text); opacity: 0.5; text-decoration: line-through; }
  .recommendation .actions { display: flex; gap: var(--space-3); margin-top: var(--space-4); }
  .recommendation .actions button.secondary { background: transparent; border: 1px solid var(--line); color: var(--text); }
</style>
