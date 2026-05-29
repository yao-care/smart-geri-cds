<script lang="ts">
  import { db, type Assessment } from '../../lib/db/schema';
  import DomainBarChart from './DomainBarChart.svelte';
  import EducationMatch from './EducationMatch.svelte';
  import AssessmentPdfReport from './AssessmentPdfReport.svelte';
  import { deriveCgaTriggers } from '$lib/education/trigger-derivation';
  import { computeDomainScores } from '../../engine/cdsa/radar-scoring';
  import TriggerVideoList from '../education/TriggerVideoList.svelte';
  import type { Child } from '../../lib/db/schema';

  // Stand-alone result page entry. Reads ?id= from the URL, loads the
  // stored assessment from IndexedDB, and renders the subject-facing
  // simple view using the already-computed triageResult (no recompute).

  let loading = $state(true);
  let error = $state<'invalid' | 'not_found' | null>(null);
  let assessment = $state<Assessment | null>(null);
  let child = $state<Child | null>(null);

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

  $effect(() => {
    (async () => {
      try {
        const id = new URLSearchParams(window.location.search).get('id');
        if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
          error = 'invalid';
          return;
        }
        const a = await db.assessments.get(id);
        if (!a) {
          error = 'not_found';
          return;
        }
        assessment = a;
        const c = await db.children.get(a.childId);
        if (c) child = c;
      } finally {
        loading = false;
      }
    })();
  });

  const triageResult = $derived(assessment?.triageResult ?? null);
  const cfsLevel = $derived(assessment?.cfsLevel ?? null);

  /** Reconstruct a full TriageResult so the shared engine helpers apply. */
  const fullTriage = $derived(
    triageResult
      ? {
          category: triageResult.category,
          summary: triageResult.summary,
          details: triageResult.details ?? [],
        }
      : null,
  );

  const domainScores = $derived(computeDomainScores(fullTriage));

  const perDomain = $derived(
    fullTriage?.details.map((d) => ({
      domain: `${d.domain.top}.${d.domain.sub}`,
      severity: d.severity,
    })) ?? [],
  );

  const hasActionable = $derived(
    perDomain.some((d) => d.severity === 'monitor' || d.severity === 'refer'),
  );

  const videoTriggers = $derived(
    fullTriage && cfsLevel ? deriveCgaTriggers(fullTriage, cfsLevel) : [],
  );
</script>

{#if loading}
  <p class="status">載入中…</p>
{:else if error === 'invalid'}
  <div class="error-box">
    <p>網址無效。</p>
    <a href="/">返回首頁</a>
  </div>
{:else if error === 'not_found'}
  <div class="error-box">
    <p>找不到此評估紀錄。可能已被刪除，或此網址來自另一台裝置。</p>
    <a href="/history/">查看評估歷史</a>
  </div>
{:else if assessment && triageResult}
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

    {#if cfsLevel && hasActionable}
      <section class="education-section" aria-label="衛教建議">
        <h3>建議閱讀</h3>
        <EducationMatch {perDomain} {cfsLevel} />
      </section>
    {/if}

    {#if videoTriggers.length > 0}
      <section class="recommended-videos" aria-label="建議參考影片">
        <h2>建議參考影片</h2>
        <TriggerVideoList triggers={videoTriggers} />
      </section>
    {/if}

    <div class="result-actions">
      {#if child}
        <AssessmentPdfReport {assessment} {child} />
      {/if}
      <a href="/history/" class="btn-history">查看評估紀錄</a>
      <a href="/assess/" class="btn-home">開始新評估</a>
    </div>
  </div>
{/if}

<style>
  .status,
  .error-box {
    text-align: center;
    padding: var(--space-8);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
  }

  .error-box a {
    display: inline-block;
    margin-top: var(--space-3);
    color: var(--accent);
  }

  .result-view {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

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

  .radar-section,
  .education-section {
    text-align: center;
  }

  .education-section h3 {
    font-size: var(--text-lg);
    margin-bottom: var(--space-4);
  }

  .recommended-videos {
    margin-top: var(--space-7);
  }

  .recommended-videos h2 {
    font-size: var(--text-lg);
    margin-bottom: var(--space-md, 16px);
  }

  .result-actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    align-items: center;
    padding-top: var(--space-4);
    border-top: 1px solid var(--line);
  }

  .btn-history,
  .btn-home {
    min-height: 44px;
    padding: var(--space-2) var(--space-5);
    border-radius: var(--radius-md);
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--text);
    text-decoration: none;
    font-size: var(--text-sm);
    text-align: center;
  }

  .btn-history:hover,
  .btn-home:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
