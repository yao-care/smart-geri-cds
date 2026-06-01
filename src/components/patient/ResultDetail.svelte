<script lang="ts">
  import { resolveAssessment, type ResolveError, type Source } from '../../lib/db/assessment-resolver';
  import { isAuthorized } from '../../lib/fhir/client';
  import type { Assessment } from '../../lib/db/schema';
  import { db } from '../../lib/db/schema';
  import { getMobilityRecordingsForAssessment } from '../../lib/db/mobility-recordings';
  import type { MobilityRecording } from '../../lib/db/schema';
  import { deriveCgaTriggers } from '$lib/education/trigger-derivation';
  import { domainLabel } from '$lib/domain/domain-tree';
  import { CFS_LABELS } from '$lib/utils/cfs-levels';
  import TriggerVideoList from '../education/TriggerVideoList.svelte';

  const CATEGORY_LABELS: Record<string, string> = {
    normal: '正常',
    monitor: '追蹤觀察',
    refer: '建議轉介',
    incomplete: '尚未完成',
  };

  const SEVERITY_LABELS: Record<string, string> = {
    normal: '正常',
    monitor: '待觀察',
    refer: '建議轉介',
    incomplete: '未完成',
  };

  // Physician-facing detail view. Loads assessment via the cross-device
  // resolver (IDB first, FHIR fallback), enforces auth gate before
  // rendering any clinical data, and surfaces explicit error states.

  let loading = $state(true);
  let error = $state<ResolveError | 'invalid' | null>(null);
  let assessment = $state<Assessment | null>(null);
  let source = $state<Source | null>(null);
  let returnUrl = $state<string>('');

  $effect(() => {
    (async () => {
      try {
        const search = new URLSearchParams(window.location.search);
        const id = search.get('id');
        if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
          error = 'invalid';
          return;
        }
        returnUrl = `/workspace/result/?id=${encodeURIComponent(id)}`;

        if (!isAuthorized()) {
          // Redirect subject-style view; do not render any medical data here.
          window.location.replace(`/result/?id=${encodeURIComponent(id)}`);
          return; // loading stays true until redirect lands
        }

        const result = await resolveAssessment(id);
        if (result.ok) {
          assessment = result.assessment;
          source = result.source;
        } else {
          error = result.error;
        }
      } finally {
        // Stay in loading until redirect navigates away — only switch off
        // when we actually have data or an error to show.
        if (assessment || error) loading = false;
      }
    })();
  });

  const triage = $derived(assessment?.triageResult ?? null);
  const cfsLevel = $derived(assessment?.cfsLevel ?? null);

  // Locally-stored mobility-task recordings (e.g. sit-to-stand). Only present
  // for local (IDB) records; FHIR-sourced records never carry the blob. Object
  // URLs are created for playback and revoked on teardown. Never uploaded.
  interface RecordingView { id: string; url: string; durationSec: number; scaleId: string; }
  let recordings = $state<RecordingView[]>([]);

  $effect(() => {
    if (!assessment || source === 'fhir') return;
    const id = assessment.id;
    let urls: string[] = [];
    (async () => {
      const rows: MobilityRecording[] = await getMobilityRecordingsForAssessment(id);
      const views = rows
        .filter(r => r.blob instanceof Blob)
        .map(r => {
          const url = URL.createObjectURL(r.blob);
          urls.push(url);
          return { id: r.id, url, durationSec: r.durationSec, scaleId: r.scaleId };
        });
      recordings = views;
    })();
    return () => { urls.forEach(u => URL.revokeObjectURL(u)); };
  });

  const referCount = $derived(triage?.details?.filter((d) => d.severity === 'refer').length ?? 0);
  const monitorCount = $derived(triage?.details?.filter((d) => d.severity === 'monitor').length ?? 0);

  const videoTriggers = $derived(
    triage && cfsLevel
      ? deriveCgaTriggers(
          {
            category: triage.category,
            summary: triage.summary,
            details: triage.details ?? [],
          },
          cfsLevel,
        )
      : [],
  );

  let note = $state('');
  let noteSaveTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    if (assessment?.physicianNote && note === '') {
      note = assessment.physicianNote;
    }
  });

  function onNoteInput(e: Event) {
    note = (e.target as HTMLTextAreaElement).value;
    if (!assessment) return;
    if (noteSaveTimer) clearTimeout(noteSaveTimer);
    const id = assessment.id;
    const value = note;
    noteSaveTimer = setTimeout(async () => {
      await db.assessments.update(id, {
        physicianNote: value,
        physicianNoteUpdatedAt: new Date(),
      });
    }, 500);
  }

  function relaunchLink(): string {
    return `/workspace/?return=${encodeURIComponent(returnUrl)}`;
  }
</script>

{#if loading}
  <p class="status">載入中…</p>
{:else if error === 'invalid'}
  <div class="error-box"><p>網址無效。</p></div>
{:else if error === 'token_expired'}
  <div class="error-box">
    <p>Session 過期，請重新登入醫院 FHIR Server。</p>
    <a href={relaunchLink()} class="relaunch-link">回工作台登入 →</a>
  </div>
{:else if error === 'forbidden'}
  <div class="error-box"><p>沒有檢視此評估的權限。</p></div>
{:else if error === 'not_found'}
  <div class="error-box"><p>找不到此評估紀錄。</p></div>
{:else if error === 'network'}
  <div class="error-box"><p>連線失敗，請稍後再試。</p></div>
{:else if assessment && triage}
  <article class="detail">
    <header class="summary-bar">
      <div>
        <span class="label">受測者識別碼</span>
        <span class="value">{assessment.childId.slice(0, 8)}…</span>
      </div>
      <div>
        <span class="label">評估日期</span>
        <span class="value">
          {(assessment.startedAt instanceof Date ? assessment.startedAt : new Date(assessment.startedAt)).toLocaleDateString('zh-TW')}
        </span>
      </div>
      <div>
        <span class="label">衰弱等級 (CFS)</span>
        <span class="value">{cfsLevel ? CFS_LABELS[cfsLevel] : '—'}</span>
      </div>
      <div>
        <span class="label">分類</span>
        <span class="value">{CATEGORY_LABELS[triage.category] ?? triage.category}</span>
      </div>
      <div class="source-badge" class:source-fhir={source === 'fhir'}>
        {source === 'fhir' ? '來自 FHIR Server' : '本地紀錄'}
      </div>
    </header>

    <section aria-label="分流判定">
      <h3>分流判定</h3>
      <div class="triage-summary">
        <span class="triage-cat triage-{triage.category}">{CATEGORY_LABELS[triage.category]}</span>
        <span class="muted">·</span>
        <span class="muted">建議轉介 {referCount} 項 · 待觀察 {monitorCount} 項 / 共 {triage.details?.length ?? 0} 項量表</span>
      </div>
      <details class="rule-detail">
        <summary>分流判定規則</summary>
        <ul>
          <li><strong>refer</strong>：任一量表落入「建議轉介」分段</li>
          <li><strong>monitor</strong>：任一量表落入「待觀察」分段（無轉介）</li>
          <li><strong>normal</strong>：所有量表皆在正常分段</li>
          <li>整體分流＝取各量表最嚴重者；<strong>未完成</strong>量表不參與彙整</li>
        </ul>
      </details>
    </section>

    <section aria-label="各量表結果">
      <h3>各量表結果</h3>
      {#if triage.details && triage.details.length > 0}
        <table class="metric-table">
          <thead>
            <tr>
              <th>領域</th>
              <th>量表</th>
              <th>原始分</th>
              <th>滿分</th>
              <th>判讀</th>
              <th>嚴重度</th>
            </tr>
          </thead>
          <tbody>
            {#each triage.details as d}
              <tr class:anomaly={d.severity === 'refer' || d.severity === 'monitor'}>
                <td>{domainLabel(d.domain.top, d.domain.sub)}</td>
                <td>{d.scaleId}</td>
                <td class="num">{d.rawScore ?? '—'}</td>
                <td class="num">{d.maxScore}</td>
                <td>{d.bandLabel || '—'}</td>
                <td><span class="status-pill status-{d.severity}">{SEVERITY_LABELS[d.severity] ?? d.severity}</span></td>
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="muted small">
          各量表依其驗證過的切分點 (cutoff) 判讀嚴重度，與年齡無關（CFS 僅作分層與詮釋脈絡）。
        </p>
      {:else}
        <p class="muted">此評估未保留量表細節，可能來自舊版或精簡 FHIR 紀錄。</p>
      {/if}
    </section>

    {#if recordings.length > 0}
      <section aria-label="行動測試錄影">
        <h3>行動測試錄影</h3>
        <p class="muted small">
          以下錄影為受測者自行進行坐立測試時所錄製，僅儲存在本機瀏覽器供臨床檢視，未上傳、未納入 PDF 報告。
        </p>
        {#each recordings as rec (rec.id)}
          <div class="recording">
            <!-- svelte-ignore a11y_media_has_caption -->
            <video class="recording-video" src={rec.url} controls playsinline preload="metadata"></video>
            <p class="muted small">{rec.scaleId} · 完成耗時約 {rec.durationSec} 秒</p>
          </div>
        {/each}
      </section>
    {/if}

    <section aria-label="事件時序">
      <h3>事件時序</h3>
      {#if source === 'fhir'}
        <p class="muted">此資料來自 FHIR Server，無原始事件紀錄。</p>
      {:else}
        <p class="muted">事件 timeline 渲染待後續迭代加上。</p>
      {/if}
    </section>

    <section aria-label="醫師備註">
      <h3>醫師備註</h3>
      <textarea
        class="note-input"
        rows="4"
        placeholder="輸入備註（自動暫存到本地，點下方按鈕儲存到 FHIR）"
        value={note}
        oninput={onNoteInput}
      ></textarea>
      <p class="muted small">草稿自動暫存；提交到 FHIR 為下次迭代功能。</p>
    </section>

    {#if videoTriggers.length > 0}
      <section class="recommended-videos" aria-label="建議參考的衛教影片">
        <h2>建議參考的衛教影片</h2>
        <TriggerVideoList triggers={videoTriggers} />
      </section>
    {/if}
  </article>
{/if}

<style>
  .status,
  .error-box {
    text-align: center;
    padding: var(--space-8);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
  }

  .relaunch-link {
    display: inline-block;
    margin-top: var(--space-3);
    color: var(--accent);
    text-decoration: none;
    font-weight: var(--font-medium);
  }

  .detail {
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
  }

  .summary-bar {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
    align-items: center;
    padding: var(--space-3) var(--space-4);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
  }

  .summary-bar .label {
    display: block;
    font-size: var(--text-xs);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
  }

  .summary-bar .value {
    font-weight: var(--font-medium);
  }

  .source-badge {
    margin-left: auto;
    padding: 2px 8px;
    border-radius: var(--radius-full);
    background: color-mix(in srgb, var(--bg), var(--text) 5%);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    font-size: var(--text-xs);
  }

  .source-badge.source-fhir {
    background: color-mix(in srgb, var(--warn) 12%, var(--bg));
    color: var(--warn);
  }

  section h3 {
    font-size: var(--text-base);
    margin-bottom: var(--space-2);
  }

  .metric-table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-xs);
  }

  .metric-table th,
  .metric-table td {
    padding: var(--space-2);
    border-bottom: 1px solid var(--line);
    text-align: left;
  }

  .metric-table td.num {
    font-family: var(--font-mono);
    text-align: right;
  }

  .metric-table tr.anomaly {
    background: color-mix(in srgb, var(--danger) 14%, var(--bg));
  }

  .triage-summary {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
    font-size: var(--text-sm);
  }

  .triage-cat {
    padding: 4px 10px;
    border-radius: var(--radius-full);
    font-weight: var(--font-bold);
    font-size: var(--text-sm);
  }

  .triage-normal { background: color-mix(in srgb, var(--accent) 12%, var(--bg)); color: var(--accent); }
  .triage-monitor { background: color-mix(in srgb, var(--warn) 12%, var(--bg)); color: var(--warn); }
  .triage-refer { background: color-mix(in srgb, var(--danger) 14%, var(--bg)); color: var(--danger); }
  .triage-incomplete { background: color-mix(in srgb, var(--bg), var(--text) 8%); color: color-mix(in srgb, var(--text), var(--bg) 40%); }

  .rule-detail {
    margin-top: var(--space-2);
    font-size: var(--text-xs);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
  }

  .rule-detail summary {
    cursor: pointer;
    color: var(--accent);
    margin-bottom: var(--space-1);
  }

  .rule-detail ul {
    margin: var(--space-2) 0 0;
    padding-left: var(--space-5);
    line-height: 1.6;
  }

  .status-pill {
    display: inline-block;
    padding: 2px 8px;
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
  }

  .status-pill.status-normal { background: color-mix(in srgb, var(--accent) 12%, var(--bg)); color: var(--accent); }
  .status-pill.status-monitor { background: color-mix(in srgb, var(--warn) 12%, var(--bg)); color: var(--warn); }
  .status-pill.status-refer { background: color-mix(in srgb, var(--danger) 14%, var(--bg)); color: var(--danger); }
  .status-pill.status-incomplete { background: color-mix(in srgb, var(--bg), var(--text) 8%); color: color-mix(in srgb, var(--text), var(--bg) 40%); }

  .muted {
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    font-size: var(--text-sm);
  }

  .muted.small {
    font-size: var(--text-xs);
  }

  .note-input {
    width: 100%;
    padding: var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    font: inherit;
  }

  .recording {
    margin-top: var(--space-3);
  }

  .recording-video {
    width: 100%;
    max-width: 480px;
    border-radius: var(--radius-md);
    border: 1px solid var(--line);
    background: color-mix(in srgb, var(--bg), var(--text) 8%);
  }

  .recommended-videos {
    margin-top: var(--space-7);
  }

  .recommended-videos h2 {
    font-size: var(--text-lg);
    margin-bottom: var(--space-md, 16px);
  }
</style>
