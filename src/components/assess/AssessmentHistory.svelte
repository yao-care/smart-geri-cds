<script lang="ts">
  import { getAllChildren, getAssessmentsForChild } from '../../lib/db/assessments';
  import { ageInMonths } from '../../lib/utils/cfs-levels';
  import { domainLabel as domainSubLabel } from '../../lib/domain/domain-tree';
  import { isAuthorized } from '../../lib/fhir/client';
  import type { Assessment, Child } from '../../lib/db/schema';

  interface ChildWithAssessments {
    child: Child;
    assessments: Assessment[];
  }

  let loading = $state(true);
  let childrenData = $state<ChildWithAssessments[]>([]);
  let compareIds = $state<Set<string>>(new Set());
  let showCompare = $state(false);

  const physicianMode = $derived(isAuthorized());

  const categoryLabels: Record<string, string> = {
    normal: '正常',
    monitor: '追蹤觀察',
    refer: '建議轉介',
    incomplete: '尚未完成',
  };

  const categoryClasses: Record<string, string> = {
    normal: 'badge-normal',
    monitor: 'badge-monitor',
    refer: 'badge-refer',
    incomplete: 'badge-incomplete',
  };

  function formatDate(d: Date | string): string {
    const date = typeof d === 'string' ? new Date(d) : d;
    return date.toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }

  function abbreviateId(id: string): string {
    return id.length > 8 ? id.slice(0, 8) + '…' : id;
  }

  function detailLink(id: string): string {
    return physicianMode ? `/workspace/result/?id=${id}` : `/result/?id=${id}`;
  }

  function toggleCompare(id: string) {
    const next = new Set(compareIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    compareIds = next;
  }

  $effect(() => {
    loadData();
  });

  async function loadData() {
    loading = true;
    try {
      const children = await getAllChildren();
      const result: ChildWithAssessments[] = [];
      for (const child of children) {
        const assessments = await getAssessmentsForChild(child.id);
        if (assessments.length > 0) {
          // newest first
          assessments.sort((a, b) => {
            const ta = new Date(a.completedAt ?? a.startedAt).getTime();
            const tb = new Date(b.completedAt ?? b.startedAt).getTime();
            return tb - ta;
          });
          result.push({ child, assessments });
        }
      }
      childrenData = result;
    } catch {
      // Empty state will show
    } finally {
      loading = false;
    }
  }

  const allAssessments = $derived(
    childrenData.flatMap((c) => c.assessments.map((a) => ({ child: c.child, assessment: a }))),
  );

  const stats = $derived.by(() => {
    const completed = allAssessments.filter(({ assessment }) => assessment.status === 'completed');
    const latest = completed[0]?.assessment ?? null;
    return {
      total: allAssessments.length,
      completedTotal: completed.length,
      latestDate: latest ? formatDate(latest.completedAt ?? latest.startedAt) : '—',
      latestCategory: latest?.triageResult?.category ?? null,
    };
  });

  const compareRows = $derived(
    // newest first for radar overlay (matches timeline order — easier to read trend)
    allAssessments
      .filter(({ assessment }) => compareIds.has(assessment.id))
      .sort((a, b) => {
        const ta = new Date(a.assessment.completedAt ?? a.assessment.startedAt).getTime();
        const tb = new Date(b.assessment.completedAt ?? b.assessment.startedAt).getTime();
        return ta - tb; // oldest → newest for "before / after" reading
      }),
  );

  // SVG palette for compare overlay. Distinct hues so multi-series stays
  // legible. JS literal because SVG attrs can't read CSS vars across <each>
  // blocks reliably.
  const SERIES_COLORS = ['#3d6b54', '#a87a2e', '#7c3aed', '#0d9488'];

  /** `top.sub` → 子項中文標籤。 */
  function domainLabel(key: string): string {
    const [top, sub] = key.split('.');
    return sub ? domainSubLabel(top, sub) : key;
  }

  /** 0-100 normalised score per scale (rawScore / maxScore). incomplete → null. */
  function rawPercent(rawScore: number | null, maxScore: number): number | null {
    if (rawScore === null || maxScore <= 0) return null;
    return Math.max(0, Math.min(100, Math.round((100 * rawScore) / maxScore)));
  }

  /** Per `top.sub` score (averaged over its scales) for one assessment. */
  function perDomainScore(assessment: Assessment): Record<string, number | null> {
    const buckets: Record<string, number[]> = {};
    if (!assessment.triageResult) return {};
    for (const d of assessment.triageResult.details ?? []) {
      const pct = rawPercent(d.rawScore, d.maxScore);
      if (pct === null) continue;
      const key = `${d.domain.top}.${d.domain.sub}`;
      (buckets[key] ??= []).push(pct);
    }
    const result: Record<string, number | null> = {};
    for (const dom of Object.keys(buckets)) {
      const arr = buckets[dom];
      result[dom] = arr.reduce((a, b) => a + b, 0) / arr.length;
    }
    return result;
  }

  /** 0-100 score for radar plotting; incomplete → 50 (mid, no signal). */
  function plotScore(score: number | null): number {
    return score === null ? 50 : score;
  }

  /** Union of all `top.sub` across compared assessments, stable order. */
  const compareDomains = $derived.by(() => {
    const seen = new Set<string>();
    for (const row of compareRows) {
      if (!row.assessment.triageResult) continue;
      for (const d of row.assessment.triageResult.details ?? []) {
        seen.add(`${d.domain.top}.${d.domain.sub}`);
      }
    }
    return [...seen].sort();
  });

  /** Scale × series matrix for the diff table. */
  const compareMetricRows = $derived.by(() => {
    const map = new Map<string, { domain: string; scaleId: string; cells: Array<{ value: number; pct: number | null }> }>();
    compareRows.forEach((row, seriesIdx) => {
      if (!row.assessment.triageResult) return;
      for (const d of row.assessment.triageResult.details ?? []) {
        const domainKey = `${d.domain.top}.${d.domain.sub}`;
        const key = `${domainKey}::${d.scaleId}`;
        let entry = map.get(key);
        if (!entry) {
          entry = { domain: domainKey, scaleId: d.scaleId, cells: [] };
          map.set(key, entry);
        }
        while (entry.cells.length < seriesIdx) {
          entry.cells.push({ value: NaN, pct: null });
        }
        entry.cells.push({ value: d.rawScore ?? NaN, pct: rawPercent(d.rawScore, d.maxScore) });
      }
    });
    for (const entry of map.values()) {
      while (entry.cells.length < compareRows.length) {
        entry.cells.push({ value: NaN, pct: null });
      }
    }
    return [...map.values()].sort((a, b) => a.domain.localeCompare(b.domain));
  });

  /** Days between oldest and newest selected. */
  const compareSpanDays = $derived.by(() => {
    if (compareRows.length < 2) return 0;
    const first = new Date(compareRows[0].assessment.completedAt ?? compareRows[0].assessment.startedAt).getTime();
    const last = new Date(
      compareRows[compareRows.length - 1].assessment.completedAt ?? compareRows[compareRows.length - 1].assessment.startedAt,
    ).getTime();
    return Math.round((last - first) / (1000 * 60 * 60 * 24));
  });

  function trendSymbol(delta: number): { glyph: string; klass: string } {
    if (delta > 5) return { glyph: '↗', klass: 'trend-up' };
    if (delta < -5) return { glyph: '↘', klass: 'trend-down' };
    return { glyph: '→', klass: 'trend-flat' };
  }

  function formatValue(v: number): string {
    if (Number.isNaN(v)) return '—';
    if (Math.abs(v) >= 1000) return v.toFixed(0);
    if (Math.abs(v) >= 10) return v.toFixed(1);
    return v.toFixed(2);
  }

  /** SVG geometry */
  const RADAR = { size: 360, cx: 180, cy: 180, radius: 140 } as const;

  function axisAngle(i: number, total: number): number {
    // start at top, go clockwise
    return -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(total, 1);
  }

  function polarPoint(score: number, angle: number): { x: number; y: number } {
    const r = (score / 100) * RADAR.radius;
    return { x: RADAR.cx + r * Math.cos(angle), y: RADAR.cy + r * Math.sin(angle) };
  }

  function radarPolygonPath(scores: number[]): string {
    if (scores.length === 0) return '';
    return scores
      .map((s, i) => {
        const p = polarPoint(s, axisAngle(i, scores.length));
        return `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      })
      .join(' ') + ' Z';
  }
</script>

<div class="history-container">
  <header class="history-header">
    <h1 class="history-title">評估歷史</h1>
    <span class="source-badge" class:source-fhir={physicianMode}>
      {physicianMode ? '醫院 FHIR Server' : '本地紀錄'}
    </span>
  </header>

  {#if loading}
    <div class="loading-state">
      <div class="spinner"></div>
      <p>載入中…</p>
    </div>
  {:else if childrenData.length === 0}
    <div class="empty-state">
      <div class="empty-icon">🌱</div>
      <h2>還沒有評估紀錄</h2>
      <p>完成第一次評估後，紀錄會在這裡保留。</p>
      <a href="/assess/" class="btn-start">開始評估</a>
    </div>
  {:else}
    <section class="stats-row" aria-label="評估統計">
      <div class="stat-card">
        <span class="stat-label">總評估次數</span>
        <strong class="stat-value">{stats.total}</strong>
      </div>
      <div class="stat-card">
        <span class="stat-label">最近一次</span>
        <strong class="stat-value">{stats.latestDate}</strong>
      </div>
      <div class="stat-card">
        <span class="stat-label">最近分流</span>
        <strong class="stat-value">
          {stats.latestCategory ? categoryLabels[stats.latestCategory] : '—'}
        </strong>
      </div>
    </section>

    {#each childrenData as { child, assessments }}
      <section class="child-section">
        <h2 class="child-header">
          {#if child.nickName?.trim()}
            <span class="child-nick">{child.nickName}</span>
          {/if}
          <span class="child-id" class:secondary={child.nickName?.trim()}>ID: {abbreviateId(child.id)}</span>
          {#if child.birthDate && ageInMonths(child.birthDate) > 0}
            <span class="child-age">約 {Math.floor(ageInMonths(child.birthDate) / 12)} 歲</span>
          {/if}
        </h2>

        <a class="reassess-link" href={`/assess?subject=${child.id}`}>再次評估 →</a>

        <ol class="timeline">
          {#each assessments as assessment}
            {@const isCompleted = assessment.status === 'completed'}
            {@const selected = compareIds.has(assessment.id)}
            <li class="timeline-row" class:selected>
              <div class="timeline-main">
                <span class="row-date">{formatDate(assessment.completedAt ?? assessment.startedAt)}</span>
                {#if isCompleted && assessment.triageResult}
                  <span class="badge {categoryClasses[assessment.triageResult.category] ?? ''}">
                    {categoryLabels[assessment.triageResult.category] ?? assessment.triageResult.category}
                  </span>
                {:else}
                  <span class="badge badge-incomplete">{isCompleted ? '已完成' : '未完成'}</span>
                {/if}
              </div>
              <div class="timeline-actions">
                {#if isCompleted}
                  <a href={detailLink(assessment.id)} class="action-link">👁 看詳細</a>
                  <label class="compare-toggle">
                    <input
                      type="checkbox"
                      checked={selected}
                      onchange={() => toggleCompare(assessment.id)}
                    />
                    比較
                  </label>
                {/if}
              </div>
            </li>
          {/each}
        </ol>
      </section>
    {/each}
  {/if}

  {#if compareIds.size >= 2}
    <div class="compare-bar" role="region" aria-label="比較選取">
      <span>已選 {compareIds.size} 筆</span>
      <button type="button" class="btn-compare" onclick={() => (showCompare = true)}>
        比較 →
      </button>
      <button type="button" class="btn-clear" onclick={() => (compareIds = new Set())}>清空</button>
    </div>
  {/if}

  {#if showCompare && compareRows.length >= 2}
    <section class="compare-view" aria-label="比較結果">
      <div class="compare-header">
        <h2>比較結果（{compareRows.length} 筆，間隔 {compareSpanDays} 天）</h2>
        <button type="button" class="btn-close" onclick={() => (showCompare = false)}>✕ 關閉</button>
      </div>

      <!-- Series legend / meta row: one chip per compared assessment -->
      <ol class="compare-meta">
        {#each compareRows as row, i}
          {@const cat = row.assessment.triageResult?.category}
          <li class="meta-chip" style="--series-color: {SERIES_COLORS[i % SERIES_COLORS.length]}">
            <span class="meta-swatch" aria-hidden="true"></span>
            <span class="meta-date">{formatDate(row.assessment.completedAt ?? row.assessment.startedAt)}</span>
            {#if cat}
              <span class="badge {categoryClasses[cat] ?? ''}">{categoryLabels[cat]}</span>
            {/if}
            <a href={detailLink(row.assessment.id)} class="meta-link">詳細 →</a>
          </li>
        {/each}
      </ol>

      <!-- Trajectory line: category progression across all selected assessments -->
      <div class="trajectory" aria-label="分流變化">
        {#each compareRows as row, i}
          {@const cat = row.assessment.triageResult?.category}
          {#if i > 0}<span class="trajectory-arrow" aria-hidden="true">→</span>{/if}
          <span class="badge {cat ? categoryClasses[cat] : ''}">
            {cat ? categoryLabels[cat] : '—'}
          </span>
        {/each}
      </div>

      <!-- Overlay radar: per-domain directionalZ avg → score 0-100 -->
      {#if compareDomains.length > 0}
        <figure class="radar-figure">
          <figcaption>各領域原始分占比軌跡（0-100，未完成以中點呈現）</figcaption>
          <svg
            class="radar-svg"
            viewBox="0 0 {RADAR.size} {RADAR.size}"
            role="img"
            aria-label="重疊雷達圖 — 每筆評估一個多邊形"
          >
            <!-- concentric grid: 25 / 50 / 75 / 100 -->
            {#each [25, 50, 75, 100] as lvl}
              <circle
                cx={RADAR.cx}
                cy={RADAR.cy}
                r={(lvl / 100) * RADAR.radius}
                fill="none"
                stroke="var(--line)"
                stroke-dasharray={lvl === 50 ? '0' : '4 4'}
              />
            {/each}
            <!-- axis lines + labels -->
            {#each compareDomains as dom, i}
              {@const a = axisAngle(i, compareDomains.length)}
              {@const p100 = polarPoint(100, a)}
              {@const pLabel = polarPoint(118, a)}
              <line
                x1={RADAR.cx}
                y1={RADAR.cy}
                x2={p100.x}
                y2={p100.y}
                stroke="var(--line)"
              />
              <text
                class="radar-axis-label"
                x={pLabel.x}
                y={pLabel.y}
                text-anchor="middle"
                dominant-baseline="middle"
              >{domainLabel(dom)}</text>
            {/each}
            <!-- one polygon per series -->
            {#each compareRows as row, i}
              {@const scoreMap = perDomainScore(row.assessment)}
              {@const scores = compareDomains.map((d) => plotScore(scoreMap[d] ?? null))}
              {@const color = SERIES_COLORS[i % SERIES_COLORS.length]}
              <path
                d={radarPolygonPath(scores)}
                fill={color}
                fill-opacity="0.12"
                stroke={color}
                stroke-width="2"
              />
              {#each scores as s, j}
                {@const p = polarPoint(s, axisAngle(j, compareDomains.length))}
                <circle cx={p.x} cy={p.y} r="3.5" fill={color} />
              {/each}
            {/each}
          </svg>
        </figure>
      {/if}

      <!-- Per-metric diff table -->
      {#if compareMetricRows.length > 0}
        <div class="diff-table-wrap">
          <table class="diff-table">
            <thead>
              <tr>
                <th scope="col">量表</th>
                <th scope="col">領域</th>
                {#each compareRows as row, i}
                  <th
                    scope="col"
                    class="series-col"
                    style="--series-color: {SERIES_COLORS[i % SERIES_COLORS.length]}"
                  >
                    {formatDate(row.assessment.completedAt ?? row.assessment.startedAt)}
                  </th>
                {/each}
                <th scope="col">趨勢</th>
              </tr>
            </thead>
            <tbody>
              {#each compareMetricRows as mrow}
                {@const firstPct = mrow.cells[0]?.pct ?? null}
                {@const lastPct = mrow.cells[mrow.cells.length - 1]?.pct ?? null}
                {@const delta = firstPct !== null && lastPct !== null ? lastPct - firstPct : null}
                {@const trend = delta !== null ? trendSymbol(delta) : null}
                <tr>
                  <th scope="row">{mrow.scaleId}</th>
                  <td class="muted">{domainLabel(mrow.domain)}</td>
                  {#each mrow.cells as cell}
                    <td class="value-cell" class:value-missing={Number.isNaN(cell.value)}>
                      <span class="cell-value">{formatValue(cell.value)}</span>
                      {#if cell.pct !== null}
                        <span class="cell-z">{cell.pct}%</span>
                      {/if}
                    </td>
                  {/each}
                  <td class="trend-cell">
                    {#if trend}
                      <span class={trend.klass} title="Δ = {delta!.toFixed(0)}%">{trend.glyph}</span>
                    {:else}
                      <span class="muted">—</span>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
          <p class="diff-legend">
            <span class="trend-up">↗</span> 占比上升（Δ ≥ +5%）·
            <span class="trend-flat">→</span> 持平 ·
            <span class="trend-down">↘</span> 占比下降（Δ ≤ -5%）
          </p>
        </div>
      {/if}
    </section>
  {/if}

  <div class="history-nav">
    <a href="/" class="btn-back">返回首頁</a>
  </div>
</div>

<style>
  .history-container {
    max-width: 800px;
    margin: 0 auto;
  }

  .history-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-6);
  }

  .history-title {
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    margin: 0;
  }

  .source-badge {
    padding: 4px 12px;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--bg), var(--text) 5%);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    font-size: var(--text-xs);
  }

  .source-badge.source-fhir {
    background: color-mix(in srgb, var(--warn) 12%, var(--bg));
    color: var(--warn);
  }

  .loading-state {
    text-align: center;
    padding: var(--space-10);
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid var(--line);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin: 0 auto var(--space-3);
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .empty-state {
    text-align: center;
    padding: var(--space-10) var(--space-4);
  }

  .empty-icon {
    /* design-system-allow: emoji icon, 56px above token scale; no text token suitable */
    font-size: 56px;
    margin-bottom: var(--space-4);
  }

  .empty-state h2 {
    font-size: var(--text-xl);
    margin-bottom: var(--space-2);
  }

  .empty-state p {
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    margin-bottom: var(--space-6);
  }

  .btn-start {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-3) var(--space-7);
    background: var(--accent);
    color: white;
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    text-decoration: none;
    min-height: 48px;
  }

  .btn-start:hover { background: color-mix(in srgb, var(--accent) 85%, black); }

  .stats-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: var(--space-3);
    margin-bottom: var(--space-6);
  }

  .stat-card {
    display: flex;
    flex-direction: column;
    padding: var(--space-3) var(--space-4);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
  }

  .stat-label {
    font-size: var(--text-xs);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    margin-bottom: var(--space-1);
  }

  .stat-value {
    font-size: var(--text-lg);
    font-weight: var(--font-bold);
    color: var(--text);
  }

  .child-section { margin-bottom: var(--space-8); }

  .reassess-link {
    display: inline-block;
    margin: var(--space-1) 0 var(--space-2);
    min-height: 44px;
    line-height: 44px;
    color: var(--accent);
    text-decoration: none;
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
  }
  .reassess-link:hover { text-decoration: underline; }

  .child-header {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--text-base);
    font-weight: var(--font-medium);
    margin-bottom: var(--space-3);
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--line);
  }

  .child-nick {
    color: var(--text);
    font-weight: var(--font-bold);
    font-size: var(--text-base);
  }

  .child-id {
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }

  /* 有暱稱時 ID 退為次要參照（仍保留唯一鍵供醫護核對）。 */
  .child-id.secondary {
    color: color-mix(in srgb, var(--text), var(--bg) 45%);
    font-size: var(--text-xs);
    font-weight: normal;
  }

  .child-age {
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    font-size: var(--text-xs);
    font-weight: normal;
  }

  .timeline {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .timeline-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
  }

  .timeline-row.selected {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, var(--bg));
  }

  .timeline-main {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .row-date { font-weight: var(--font-medium); min-width: 100px; }

  .timeline-actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .action-link {
    color: var(--accent);
    text-decoration: none;
    font-size: var(--text-xs);
    min-height: 32px;
    display: inline-flex;
    align-items: center;
  }

  .compare-toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-xs);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    cursor: pointer;
  }

  .badge {
    display: inline-block;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-full);
    font-size: var(--text-caption);
    font-weight: var(--font-medium);
    line-height: 1;
  }

  .badge-normal { background: color-mix(in srgb, var(--accent) 12%, var(--bg)); color: var(--accent); }
  .badge-monitor { background: color-mix(in srgb, var(--warn) 12%, var(--bg)); color: var(--warn); }
  .badge-refer { background: color-mix(in srgb, var(--danger) 14%, var(--bg)); color: var(--danger); }
  .badge-incomplete { background: var(--surface); color: color-mix(in srgb, var(--text), var(--bg) 45%); border: 1px solid var(--line); }

  .compare-bar {
    position: sticky;
    bottom: 0;
    background: var(--surface);
    border-top: 1px solid var(--line);
    padding: var(--space-3) var(--space-4);
    display: flex;
    align-items: center;
    gap: var(--space-3);
    z-index: 10;
  }

  .btn-compare,
  .btn-clear {
    padding: 6px 14px;
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    border: 1px solid var(--line);
    cursor: pointer;
    min-height: 36px;
  }

  .btn-compare {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
    margin-left: auto;
  }

  .btn-clear {
    background: none;
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
  }

  .compare-view {
    margin-top: var(--space-6);
    padding: var(--space-4);
    background: var(--surface);
    border: 1px solid var(--accent);
    border-radius: var(--radius-lg);
  }

  .compare-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-4);
  }

  .compare-header h2 {
    margin: 0;
    font-size: var(--text-lg);
  }

  .btn-close {
    background: none;
    border: none;
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    cursor: pointer;
    font-size: var(--text-sm);
  }

  .compare-meta {
    list-style: none;
    margin: 0 0 var(--space-3);
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .meta-chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-3);
    background: var(--bg);
    border: 1px solid var(--line);
    border-left: 4px solid var(--series-color, var(--accent));
    border-radius: var(--radius-md);
    font-size: var(--text-xs);
  }

  .meta-swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--series-color, var(--accent));
  }

  .meta-date {
    font-weight: var(--font-medium);
  }

  .meta-link {
    color: var(--accent);
    text-decoration: none;
    margin-left: var(--space-1);
  }

  .trajectory {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
    padding: var(--space-3);
    background: var(--bg);
    border-radius: var(--radius-md);
    margin-bottom: var(--space-4);
    font-size: var(--text-sm);
  }

  .trajectory-arrow {
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    font-size: 1.2em;
  }

  .radar-figure {
    margin: 0 0 var(--space-4);
    text-align: center;
  }

  .radar-figure figcaption {
    font-size: var(--text-xs);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    margin-bottom: var(--space-2);
  }

  .radar-svg {
    width: 100%;
    max-width: 420px;
    height: auto;
  }

  :global(.radar-axis-label) {
    font-size: var(--text-caption);
    fill: var(--text);
  }

  .diff-table-wrap {
    overflow-x: auto;
  }

  .diff-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-xs);
    min-width: 480px;
  }

  .diff-table th,
  .diff-table td {
    padding: var(--space-2) var(--space-2);
    border-bottom: 1px solid var(--line);
    text-align: left;
    vertical-align: top;
  }

  .diff-table thead th {
    background: color-mix(in srgb, var(--bg), var(--text) 5%);
    font-weight: var(--font-medium);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
  }

  .diff-table .series-col {
    border-bottom: 3px solid var(--series-color, var(--accent));
    text-align: right;
    white-space: nowrap;
  }

  .value-cell {
    text-align: right;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .value-cell.value-missing {
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
  }

  .cell-value {
    display: block;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
  }

  .cell-z {
    display: block;
    font-size: var(--text-caption);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
  }

  .trend-cell {
    text-align: center;
    font-size: 1.3em;
  }

  .trend-up { color: var(--accent); }
  .trend-flat { color: color-mix(in srgb, var(--text), var(--bg) 30%); }
  .trend-down { color: var(--danger); }

  .diff-legend {
    margin: var(--space-3) 0 0;
    font-size: var(--text-caption);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .muted {
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
  }

  .history-nav {
    padding-top: var(--space-6);
    border-top: 1px solid var(--line);
    margin-top: var(--space-6);
  }

  .btn-back {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-3) var(--space-6);
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    text-decoration: none;
    min-height: 44px;
  }

  .btn-back:hover { border-color: var(--accent); }
</style>
