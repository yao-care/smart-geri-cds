<script lang="ts">
  import { assessmentStore } from '../../lib/stores/assessment.svelte';
  import { type TriageResult } from '../../engine/cdsa/triage';
  import { computeDomainScores } from '../../engine/cdsa/radar-scoring';
  import { type ScaleDef } from '../../lib/scales/scale';
  import { buildTriageResult } from '../../lib/assess/build-triage-result';
  import DomainBarChart from './DomainBarChart.svelte';
  import EducationMatch from './EducationMatch.svelte';
  import AssessmentPdfReport from './AssessmentPdfReport.svelte';
  import { deriveCgaTriggers } from '$lib/education/trigger-derivation';
  import TriggerVideoList from '../education/TriggerVideoList.svelte';
  import IntakeSubmit from './IntakeSubmit.svelte';

  interface Props {
    scales?: ScaleDef[];
  }

  let { scales = [] }: Props = $props();

  // 分流結果為「純衍生」：依 cfsLevel + partialAnalysis 計算，無副作用。
  // （副作用＝寫回 DB/標完成 — 移到下方 save-once 的 $effect，避免在反應式計算中
  //  觸發 store 變更而造成無窮重算迴圈。）
  const triageResult = $derived.by<TriageResult | null>(() => {
    const cfs = assessmentStore.cfsLevel;
    if (!cfs) return null;
    const partial = $state.snapshot(assessmentStore.partialAnalysis);
    return buildTriageResult(scales, partial, cfs);
  });
  const isComputing = $derived(!triageResult);

  const categoryLabels: Record<string, string> = {
    normal: '正常',
    monitor: '追蹤觀察',
    refer: '建議轉介',
    incomplete: '尚未完成',
  };

  const categoryColors: Record<string, string> = {
    normal: 'var(--accent)',
    monitor: 'var(--warn)',
    refer: 'var(--danger)',
    incomplete: 'var(--line)',
  };

  const categoryBgColors: Record<string, string> = {
    normal: 'color-mix(in srgb, var(--accent) 12%, var(--bg))',
    monitor: 'color-mix(in srgb, var(--warn) 12%, var(--bg))',
    refer: 'color-mix(in srgb, var(--danger) 14%, var(--bg))',
    incomplete: 'var(--surface)',
  };

  // 進結果頁時把分流結果寫回 DB + 標完成，只做一次（問卷 summary 多半已先 finalise；
  // 此處為 idempotent 補寫）。用 plain 旗標而非 $state，避免它本身造成反應式重觸發。
  let saved = false;
  $effect(() => {
    if (triageResult && !saved) {
      saved = true;
      void saveResult(triageResult);
    }
  });

  const domainScores = $derived(computeDomainScores(triageResult));

  /** Per-domain severity rows for the recommendation engine (incomplete kept;
   *  EducationMatch filters it out). */
  const perDomain = $derived(
    triageResult?.details.map(d => ({
      domain: `${d.domain.top}.${d.domain.sub}`,
      severity: d.severity,
    })) ?? [],
  );

  const hasActionable = $derived(
    perDomain.some(d => d.severity === 'monitor' || d.severity === 'refer'),
  );

  const videoTriggers = $derived(
    triageResult && assessmentStore.cfsLevel
      ? deriveCgaTriggers(triageResult, assessmentStore.cfsLevel)
      : [],
  );

  async function saveResult(result: TriageResult) {
    // store.finalize 寫入 triageResult + status=completed（問卷 summary 可能已先寫過一次，
    // 此處 idempotent 覆寫同一結果）。
    await assessmentStore.finalize(result);
  }

</script>

{#if isComputing || !triageResult}
  <div class="computing">
    <p>正在產生評估結果…</p>
  </div>
{:else}
<div class="result-view">
  <div class="disclaimer" role="alert">
    本評估結果僅供參考，不構成醫療診斷。如有疑慮，請諮詢專業醫療人員。
  </div>

  <div
    class="triage-card"
    style="background: {categoryBgColors[triageResult.category]}; border-color: {categoryColors[triageResult.category]};"
  >
    <h2 style="color: {categoryColors[triageResult.category]};">
      {categoryLabels[triageResult.category]}
    </h2>
    <p class="summary">{triageResult.summary}</p>
  </div>

  {#if domainScores.length > 0}
    <section class="radar-section" aria-label="各面向評估結果">
      <DomainBarChart data={domainScores} />
    </section>
  {/if}

  {#if triageResult && assessmentStore.cfsLevel && hasActionable}
    <section class="education-section" aria-label="衛教建議">
      <h3>建議閱讀</h3>
      <EducationMatch {perDomain} cfsLevel={assessmentStore.cfsLevel} />
    </section>
  {/if}

  {#if videoTriggers.length > 0}
    <section class="recommended-videos" aria-label="建議參考影片">
      <h2>建議參考影片</h2>
      <TriggerVideoList triggers={videoTriggers} />
    </section>
  {/if}

  <div class="result-actions">
    {#if assessmentStore.assessment && assessmentStore.child && triageResult}
      <IntakeSubmit
        assessment={assessmentStore.assessment}
        child={assessmentStore.child}
        {triageResult}
      />
    {/if}

    {#if assessmentStore.assessment && assessmentStore.child}
      <AssessmentPdfReport assessment={assessmentStore.assessment} child={assessmentStore.child} />
    {/if}

    <a href="/history/" class="btn-history">查看評估紀錄</a>
    <a href="/assess/" class="btn-home">開始新評估</a>
  </div>
</div>
{/if}

<style>
  .result-view {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  /* Disclaimer banner */
  .disclaimer {
    padding: var(--space-3) var(--space-4);
    background: color-mix(in srgb, var(--warn) 12%, var(--bg));
    border: 1px solid var(--warn);
    border-radius: var(--radius-md);
    font-size: var(--text-xs);
    color: var(--warn);
    text-align: center;
    font-weight: var(--font-medium);
  }

  /* Triage card */
  .triage-card {
    padding: var(--space-7);
    border: 2px solid;
    border-radius: var(--radius-lg);
    text-align: center;
  }

  .triage-card h2 {
    font-size: var(--text-3xl);
    margin-bottom: var(--space-2);
  }

  .summary {
    font-size: var(--text-base);
    color: var(--text);
    line-height: var(--lh-base);
  }

  /* Domain bar-chart section (DomainBarChart renders its own heading + legend) */
  .radar-section {
    text-align: center;
  }

  /* (Detail-table CSS removed — raw metric section moved to physician detail view.) */

  /* Education section */
  .education-section h3 {
    font-size: var(--text-lg);
    margin-bottom: var(--space-4);
  }

  /* Recommended videos */
  .recommended-videos {
    margin-top: var(--space-7);
  }

  .recommended-videos h2 {
    font-size: var(--text-lg);
    margin-bottom: var(--space-md, 16px);
  }

  /* Action buttons */
  .result-actions {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    padding-top: var(--space-4);
    border-top: 1px solid var(--line);
  }

  .btn-history {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-3) var(--space-7);
    background: var(--surface);
    color: var(--accent);
    border: 1px solid var(--accent);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    text-decoration: none;
    min-height: 48px;
    min-width: 200px;
    transition: background 0.2s, color 0.2s;
  }

  .btn-history:hover {
    background: var(--accent);
    color: white;
  }

  .btn-home {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-3) var(--space-7);
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    text-decoration: none;
    min-height: 48px;
    min-width: 200px;
    transition: border-color 0.2s;
  }

  .btn-home:hover {
    border-color: var(--accent);
  }
</style>
