<script lang="ts">
  /**
   * Workspace "評估" tab: every CDSA assessment grouped by triage category.
   *
   * Two data paths:
   *   1. FHIR-authenticated → listAssessmentsFromFhir() across the whole
   *      server (every patient the user can read).
   *   2. Demo mode (not authenticated) → all completed assessments in this
   *      device's IndexedDB, so a clinician can browse the same surface
   *      with parent-side test data before any FHIR integration.
   */
  import { listAssessmentsFromFhir, type AssessmentSummary } from '../../lib/fhir/assessment-fetch';
  import { getClient, isAuthorized } from '../../lib/fhir/client';
  import { db } from '../../lib/db/schema';

  type Category = 'refer' | 'monitor' | 'normal';

  const CATEGORY_LABELS: Record<Category, string> = {
    refer: '建議轉介',
    monitor: '追蹤觀察',
    normal: '正常',
  };

  const CATEGORY_ORDER: Category[] = ['refer', 'monitor', 'normal'];

  let loading = $state(true);
  let error = $state<string | null>(null);
  let rows = $state<AssessmentSummary[]>([]);
  let demoMode = $state(false);

  $effect(() => {
    (async () => {
      demoMode = !isAuthorized();
      try {
        if (demoMode) {
          rows = await loadFromLocal();
        } else {
          rows = await listAssessmentsFromFhir(undefined, getClient());
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : '載入失敗';
        error = message;
      } finally {
        loading = false;
      }
    })();
  });

  /** Pull every completed local assessment in the same summary shape
   *  the FHIR list returns, so the renderer is identical. */
  async function loadFromLocal(): Promise<AssessmentSummary[]> {
    const all = await db.assessments
      .where('status').equals('completed')
      .reverse().sortBy('completedAt');
    return all
      // Roster groups by refer/monitor/normal; an incomplete triage has no
      // bucket (and a completed-yet-incomplete record is degenerate) — skip it.
      .filter((a): a is typeof a & { triageResult: { category: 'normal' | 'monitor' | 'refer'; summary: string } } =>
        a.triageResult != null && a.triageResult.category !== 'incomplete')
      .map((a) => ({
        id: a.id,
        fhirReportId: a.fhirDiagnosticReportId ?? a.id,
        patientRef: `Local/${a.childId}`,
        date: new Date(a.completedAt ?? a.startedAt),
        category: a.triageResult.category,
        summary: a.triageResult.summary,
      }));
  }

  const grouped = $derived.by(() => {
    const map: Record<Category, AssessmentSummary[]> = { refer: [], monitor: [], normal: [] };
    for (const r of rows) {
      map[r.category].push(r);
    }
    return map;
  });

  function formatDate(d: Date): string {
    return d.toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit' });
  }

  function shortRef(ref: string): string {
    const id = ref.replace(/^(Patient|Local)\//, '');
    return id.length > 8 ? `${id.slice(0, 8)}…` : id;
  }

  function detailHref(id: string): string {
    // Same component handles FHIR and IDB sources via the resolver.
    return `/workspace/result/?id=${encodeURIComponent(id)}`;
  }
</script>

<section class="assessments-tab" aria-label="所有評估清單">
  <header class="tab-header">
    <h2>所有 CDSA 評估</h2>
    {#if demoMode}
      <span class="mode-badge mode-demo">示範模式（本機資料）</span>
    {/if}
    {#if rows.length > 0}
      <span class="count-total">共 {rows.length} 筆</span>
    {/if}
  </header>

  {#if loading}
    <p class="status">載入中…</p>
  {:else if error}
    <p class="status error">{error}</p>
  {:else if rows.length === 0}
    <div class="empty">
      {#if demoMode}
        <p>本機尚無評估紀錄。完成一次評估後會出現在這裡。</p>
        <a href="/assess/" class="empty-cta">前往評估流程 →</a>
      {:else}
        <p>FHIR Server 上目前沒有 CDSA 評估報告。</p>
      {/if}
    </div>
  {:else}
    {#each CATEGORY_ORDER as cat}
      {@const list = grouped[cat]}
      {#if list.length > 0}
        <section class="group" aria-labelledby="cat-{cat}">
          <header class="group-header">
            <span class="badge badge-{cat}">{CATEGORY_LABELS[cat]}</span>
            <span class="group-count">{list.length} 筆</span>
          </header>
          <ul class="list">
            {#each list as row}
              <li class="row">
                <span class="row-date">{formatDate(row.date)}</span>
                <span class="row-patient">{demoMode ? '個案' : '病人'} {shortRef(row.patientRef)}</span>
                <span class="row-summary" title={row.summary}>{row.summary || '—'}</span>
                <a class="row-link" href={detailHref(row.id)}>看詳細 →</a>
              </li>
            {/each}
          </ul>
        </section>
      {/if}
    {/each}
  {/if}
</section>

<style>
  .assessments-tab {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .tab-header {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
  }

  .tab-header h2 {
    margin: 0;
    font-size: var(--text-lg);
  }

  .count-total {
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    font-size: var(--text-xs);
  }

  .mode-badge {
    padding: 2px 10px;
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
  }

  .mode-demo {
    background: color-mix(in srgb, var(--accent) 12%, var(--bg));
    color: var(--accent);
  }

  .empty-cta {
    display: inline-block;
    margin-top: var(--space-3);
    color: var(--accent);
    text-decoration: none;
  }

  .status {
    text-align: center;
    padding: var(--space-6);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
  }

  .status.error {
    color: var(--danger);
  }

  .empty {
    text-align: center;
    padding: var(--space-8);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    background: var(--surface);
    border: 1px dashed var(--line);
    border-radius: var(--radius-md);
  }

  .group {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .group-header {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--line);
  }

  .group-count {
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    font-size: var(--text-xs);
  }

  .badge {
    padding: 2px 10px;
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
  }

  .badge-refer {
    background: color-mix(in srgb, var(--danger) 14%, var(--bg));
    color: var(--danger);
  }

  .badge-monitor {
    background: color-mix(in srgb, var(--warn) 12%, var(--bg));
    color: var(--warn);
  }

  .badge-normal {
    background: color-mix(in srgb, var(--accent) 12%, var(--bg));
    color: var(--accent);
  }

  .list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .row {
    display: grid;
    grid-template-columns: 110px 120px 1fr auto;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    font-size: var(--text-sm);
  }

  .row:hover {
    border-color: var(--accent);
  }

  .row-date {
    font-weight: var(--font-medium);
  }

  .row-patient {
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }

  .row-summary {
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-link {
    color: var(--accent);
    text-decoration: none;
    font-size: var(--text-xs);
  }

  @media (max-width: 720px) {
    .row {
      grid-template-columns: 1fr auto;
    }

    .row-patient,
    .row-summary {
      grid-column: 1 / -1;
    }
  }
</style>
