# Education Matrix + Contribution Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/education/` card grid with an 8×7 age × domain matrix and add a no-GitHub-account contribution flow that creates issues via Cloudflare Worker + GitHub App (yao-care-app).

**Architecture:** Two independent parts. Part 1: Astro SSG matrix (0 JS) + Svelte `ContributionModal` island (client:load) + reused `CustomEducationList` island (client:idle). Part 2: Cloudflare Worker authenticates as GitHub App to create labelled issues with structured YAML hints. Modal is wired to Worker via `PUBLIC_CONTRIBUTION_WORKER_URL` env var.

**Tech Stack:** Astro 5 SSG, Svelte 5 runes, TypeScript strict, Cloudflare Workers, `universal-github-app-jwt`, vitest

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| **Create** | `src/lib/education/matrix-data.ts` | Pure fn: triggers → MatrixData |
| **Create** | `src/components/education/ContributionModal.svelte` | Contribution form island |
| **Rewrite** | `src/pages/education/index.astro` | Matrix table + islands |
| **Create** | `workers/education-contribution/src/index.ts` | Worker entry (CORS, validate, issue) |
| **Create** | `workers/education-contribution/src/github-app-auth.ts` | JWT + installation token |
| **Create** | `workers/education-contribution/src/issue-formatter.ts` | Pure fn: title + body |
| **Create** | `workers/education-contribution/wrangler.toml` | Worker config |
| **Create** | `workers/education-contribution/package.json` | Worker deps |
| **Create** | `workers/education-contribution/tsconfig.json` | Worker TS config |
| **Create** | `tests/education/matrix-data.test.ts` | matrix-data unit tests |
| **Create** | `workers/education-contribution/src/issue-formatter.test.ts` | formatter unit tests |
| **Create** | `.env.example` | Document PUBLIC_CONTRIBUTION_WORKER_URL |
| **Keep** | `src/components/education/CustomEducationList.svelte` | Reused unchanged at bottom |

---

## Part 1 — Frontend Matrix

---

### Task 1: `src/lib/education/matrix-data.ts` (TDD)

Pure function. No side effects. Test first.

**Files:**
- Create: `src/lib/education/matrix-data.ts`
- Create: `tests/education/matrix-data.test.ts`

- [ ] **Step 1.1 — Write failing tests**

```typescript
// tests/education/matrix-data.test.ts
import { describe, it, expect } from 'vitest';
import { buildMatrixData, CDSA_DOMAINS, AGE_GROUPS_CDSA } from '$lib/education/matrix-data';

const triggers = {
  'cdsa.domain.language.anomaly.13-24m': { videoIds: ['abc1234abcde'], inapplicable: false },
  'cdsa.domain.language.anomaly.2-6m':   { videoIds: [],              inapplicable: true  },
  'cdsa.domain.gross_motor.anomaly.13-24m': { videoIds: [],           inapplicable: false },
  // cdss.* and cdsa.triage.* should be ignored
  'cdss.sugar_intake.critical.toddler':  { videoIds: ['xyz'],          inapplicable: false },
  'cdsa.triage.refer.13-24m':            { videoIds: [],              inapplicable: false },
};

const slugToTriggers = {
  'language-stimulation': ['cdsa.domain.language.anomaly.13-24m'],
  'diet-control': ['cdss.sugar_intake.critical.toddler'],  // cdss — must NOT appear in matrix
};

describe('buildMatrixData', () => {
  it('initialises all domain×age combinations', () => {
    const data = buildMatrixData({}, {});
    for (const domain of CDSA_DOMAINS) {
      for (const age of AGE_GROUPS_CDSA) {
        expect(data[`${domain}:${age}`]).toBeDefined();
      }
    }
  });

  it('marks inapplicable cells', () => {
    const data = buildMatrixData(triggers, slugToTriggers);
    expect(data['language:2-6m'].inapplicable).toBe(true);
  });

  it('populates videoIds for applicable cells', () => {
    const data = buildMatrixData(triggers, slugToTriggers);
    expect(data['language:13-24m'].videoIds).toEqual(['abc1234abcde']);
  });

  it('attaches article slugs only via cdsa.domain triggers', () => {
    const data = buildMatrixData(triggers, slugToTriggers);
    expect(data['language:13-24m'].articleSlugs).toContain('language-stimulation');
  });

  it('ignores cdss and cdsa.triage slugs', () => {
    const data = buildMatrixData(triggers, slugToTriggers);
    for (const domain of CDSA_DOMAINS) {
      for (const age of AGE_GROUPS_CDSA) {
        expect(data[`${domain}:${age}`].articleSlugs).not.toContain('diet-control');
      }
    }
  });

  it('applicable cell with no resources has inapplicable=false', () => {
    const data = buildMatrixData(triggers, slugToTriggers);
    expect(data['gross_motor:13-24m'].inapplicable).toBe(false);
    expect(data['gross_motor:13-24m'].videoIds).toEqual([]);
    expect(data['gross_motor:13-24m'].articleSlugs).toEqual([]);
  });
});
```

- [ ] **Step 1.2 — Run to confirm failure**

```bash
cd /Users/lightman/yao.care/smart-geri-cds
pnpm test tests/education/matrix-data.test.ts
```

Expected: `FAIL — Cannot find module '$lib/education/matrix-data'`

- [ ] **Step 1.3 — Implement `src/lib/education/matrix-data.ts`**

```typescript
// src/lib/education/matrix-data.ts
import { AGE_GROUPS_CDSA } from '$lib/utils/age-groups';
export { AGE_GROUPS_CDSA } from '$lib/utils/age-groups';

export const CDSA_DOMAINS = [
  'behavior', 'gross_motor', 'fine_motor', 'language',
  'language_comprehension', 'language_expression', 'cognition', 'social_emotional',
] as const;
export type CdsaDomain = typeof CDSA_DOMAINS[number];
export type AgeGroupCDSA = typeof AGE_GROUPS_CDSA[number];
export type MatrixKey = `${CdsaDomain}:${AgeGroupCDSA}`;

export type MatrixCellData = {
  inapplicable: boolean;
  articleSlugs: string[];
  videoIds: string[];
};

export type MatrixData = Record<MatrixKey, MatrixCellData>;

type TriggerMap   = Record<string, { videoIds: string[]; inapplicable: boolean }>;
type SlugToTriggers = Record<string, string[]>;

export function buildMatrixData(triggers: TriggerMap, slugToTriggers: SlugToTriggers): MatrixData {
  const data: Record<string, MatrixCellData> = {};

  // Initialise all cells as inapplicable
  for (const domain of CDSA_DOMAINS) {
    for (const age of AGE_GROUPS_CDSA) {
      data[`${domain}:${age}`] = { inapplicable: true, articleSlugs: [], videoIds: [] };
    }
  }

  // Populate from cdsa.domain.* triggers only
  for (const [trigger, entry] of Object.entries(triggers)) {
    const parts = trigger.split('.');
    if (parts[0] !== 'cdsa' || parts[1] !== 'domain' || parts[3] !== 'anomaly') continue;
    const cell = data[`${parts[2]}:${parts[4]}`];
    if (!cell) continue;
    cell.inapplicable = entry.inapplicable;
    if (!entry.inapplicable) cell.videoIds = [...entry.videoIds];
  }

  // Attach article slugs via cdsa.domain.* triggers only
  for (const [slug, triggerList] of Object.entries(slugToTriggers)) {
    for (const trigger of triggerList) {
      const parts = trigger.split('.');
      if (parts[0] !== 'cdsa' || parts[1] !== 'domain' || parts[3] !== 'anomaly') continue;
      const cell = data[`${parts[2]}:${parts[4]}`];
      if (cell && !cell.inapplicable && !cell.articleSlugs.includes(slug)) {
        cell.articleSlugs.push(slug);
      }
    }
  }

  return data as MatrixData;
}
```

- [ ] **Step 1.4 — Run tests to confirm pass**

```bash
pnpm test tests/education/matrix-data.test.ts
```

Expected: `6 tests passed`

- [ ] **Step 1.5 — Commit**

```bash
git add src/lib/education/matrix-data.ts tests/education/matrix-data.test.ts
git commit -m "feat(education): buildMatrixData pure helper + tests"
```

---

### Task 2: `ContributionModal.svelte`

Svelte 5 island. Listens for `open-contribution` CustomEvent. POSTs to Worker.

**Files:**
- Create: `src/components/education/ContributionModal.svelte`

- [ ] **Step 2.1 — Create `.env.example`**

```bash
cat > .env.example << 'EOF'
# Cloudflare Worker URL for education contributions
# Set to the deployed Worker URL after Task 8
PUBLIC_CONTRIBUTION_WORKER_URL=https://<worker-name>.yao-care.workers.dev/education-contribution
EOF
```

- [ ] **Step 2.2 — Create `src/components/education/ContributionModal.svelte`**

```svelte
<script lang="ts">
  const DOMAIN_ZH: Record<string, string> = {
    behavior: '行為', gross_motor: '粗動作', fine_motor: '細動作',
    language: '語言', language_comprehension: '語言理解',
    language_expression: '語言表達', cognition: '認知', social_emotional: '社交情緒',
  };
  const AGE_ZH: Record<string, string> = {
    '2-6m': '2-6 個月', '7-12m': '7-12 個月', '13-24m': '1-2 歲',
    '25-36m': '2-3 歲', '37-48m': '3-4 歲', '49-60m': '4-5 歲', '61-72m': '5-6 歲',
  };

  let open      = $state(false);
  let domain    = $state('');
  let ageGroup  = $state('');
  let type      = $state<'youtube' | 'article' | 'external-link'>('youtube');
  let url       = $state('');
  let title     = $state('');
  let summary   = $state('');
  let content   = $state('');
  let notes     = $state('');
  let submitter = $state('');

  let submitting = $state(false);
  let issueUrl   = $state<string | null>(null);
  let errorMsg   = $state<string | null>(null);

  let videoPreviewId = $derived(type === 'youtube' ? extractYouTubeId(url) : null);

  function extractYouTubeId(raw: string): string | null {
    const patterns = [
      /youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})/,
      /youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/,
      /youtu\.be\/([A-Za-z0-9_-]{11})/,
    ];
    for (const p of patterns) {
      const m = raw.match(p);
      if (m) return m[1];
    }
    return null;
  }

  $effect(() => {
    function onOpen(e: Event) {
      const { domain: d, age } = (e as CustomEvent<{ domain: string; age: string }>).detail;
      domain = d; ageGroup = age;
      type = 'youtube'; url = title = summary = content = notes = submitter = '';
      issueUrl = null; errorMsg = null;
      open = true;
    }
    document.addEventListener('open-contribution', onOpen);
    return () => document.removeEventListener('open-contribution', onOpen);
  });

  function close() { open = false; }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    submitting = true; errorMsg = null;
    try {
      const workerUrl = import.meta.env.PUBLIC_CONTRIBUTION_WORKER_URL as string;
      const res = await fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, domain, ageGroup, url, title, summary, content, notes, submitter }),
      });
      const data = await res.json() as { issueUrl?: string; error?: string };
      if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
      issueUrl = data.issueUrl!;
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : '送出失敗，請稍後再試';
    } finally {
      submitting = false;
    }
  }
</script>

{#if open}
<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="新增衛教資源">
  <div class="modal">
    <header class="modal-header">
      <h2>新增衛教資源</h2>
      <button class="close-btn" onclick={close} aria-label="關閉">✕</button>
    </header>

    <p class="modal-context">
      情境：<strong>{DOMAIN_ZH[domain] ?? domain}</strong> × <strong>{AGE_ZH[ageGroup] ?? ageGroup}</strong>
    </p>

    {#if issueUrl}
      <div class="success">
        <p>已成功送出！</p>
        <a href={issueUrl} target="_blank" rel="noopener noreferrer">在 GitHub 查看 Issue →</a>
        <button class="btn-secondary" onclick={close}>關閉</button>
      </div>
    {:else}
      <form onsubmit={handleSubmit} class="contribution-form">
        <fieldset>
          <legend>資源類型</legend>
          <label><input type="radio" bind:group={type} value="youtube" /> YouTube 影片</label>
          <label><input type="radio" bind:group={type} value="article" /> Markdown 文章</label>
          <label><input type="radio" bind:group={type} value="external-link" /> 外部連結</label>
        </fieldset>

        {#if type === 'youtube'}
          <label class="field">
            <span>YouTube URL *</span>
            <input type="url" bind:value={url} required placeholder="https://www.youtube.com/watch?v=..." />
          </label>
          {#if videoPreviewId}
            <img
              class="video-preview"
              src="https://i.ytimg.com/vi/{videoPreviewId}/mqdefault.jpg"
              alt="影片預覽"
              referrerpolicy="no-referrer"
            />
          {/if}
          <label class="field">
            <span>標題（選填）</span>
            <input type="text" bind:value={title} placeholder="影片標題" />
          </label>

        {:else if type === 'article'}
          <label class="field">
            <span>標題 *</span>
            <input type="text" bind:value={title} required />
          </label>
          <label class="field">
            <span>摘要 *</span>
            <input type="text" bind:value={summary} required />
          </label>
          <label class="field">
            <span>內容（Markdown）*</span>
            <textarea bind:value={content} required rows="8"></textarea>
          </label>

        {:else}
          <label class="field">
            <span>URL *</span>
            <input type="url" bind:value={url} required />
          </label>
          <label class="field">
            <span>標題 *</span>
            <input type="text" bind:value={title} required />
          </label>
        {/if}

        <label class="field">
          <span>補充說明（選填）</span>
          <textarea bind:value={notes} rows="3" placeholder="為何適合此情境？"></textarea>
        </label>

        <label class="field">
          <span>提交者（選填）</span>
          <input type="text" bind:value={submitter} placeholder="姓名 / 科別" />
        </label>

        {#if errorMsg}
          <p class="error">{errorMsg}</p>
        {/if}

        <div class="modal-actions">
          <button type="button" class="btn-secondary" onclick={close}>取消</button>
          <button type="submit" class="btn-primary" disabled={submitting}>
            {submitting ? '送出中…' : '送出（開 GitHub Issue）'}
          </button>
        </div>
      </form>
    {/if}
  </div>
</div>
{/if}

<style>
  .modal-backdrop {
    position: fixed; inset: 0; z-index: 1000;
    background: color-mix(in srgb, var(--text) 40%, transparent);
    display: flex; align-items: center; justify-content: center;
    padding: var(--space-4);
  }
  .modal {
    background: var(--bg); border: 1px solid var(--line);
    border-radius: var(--radius-lg); padding: var(--space-6);
    width: 100%; max-width: 560px; max-height: 90vh;
    overflow-y: auto;
  }
  .modal-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: var(--space-4);
  }
  .modal-header h2 { font-size: var(--text-xl); margin: 0; }
  .close-btn {
    background: none; border: none; cursor: pointer;
    font-size: var(--text-lg); color: var(--text); line-height: 1;
    padding: var(--space-1);
  }
  .modal-context {
    font-size: var(--text-sm); color: color-mix(in srgb, var(--text), var(--bg) 30%);
    margin-bottom: var(--space-4);
  }
  fieldset { border: 1px solid var(--line); border-radius: var(--radius-sm); padding: var(--space-3); margin-bottom: var(--space-4); }
  legend { font-size: var(--text-sm); font-weight: var(--font-medium); padding: 0 var(--space-2); }
  fieldset label { display: inline-flex; align-items: center; gap: var(--space-2); margin-right: var(--space-4); }
  .field { display: flex; flex-direction: column; gap: var(--space-2); margin-bottom: var(--space-4); }
  .field span { font-size: var(--text-sm); font-weight: var(--font-medium); }
  .field input, .field textarea {
    border: 1px solid var(--line); border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-3); font-size: var(--text-base);
    background: var(--surface); color: var(--text); width: 100%;
    min-height: 44px;
  }
  .field textarea { min-height: 88px; resize: vertical; }
  .video-preview { width: 100%; aspect-ratio: 16/9; object-fit: cover; border-radius: var(--radius-sm); margin-bottom: var(--space-4); }
  .modal-actions { display: flex; justify-content: flex-end; gap: var(--space-3); margin-top: var(--space-4); }
  .btn-primary {
    background: var(--accent); color: var(--bg);
    border: none; border-radius: var(--radius-sm);
    padding: var(--space-2) var(--space-5); font-size: var(--text-base);
    cursor: pointer; min-height: 44px;
  }
  .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .btn-secondary {
    background: none; border: 1px solid var(--line);
    border-radius: var(--radius-sm); padding: var(--space-2) var(--space-5);
    font-size: var(--text-base); cursor: pointer; color: var(--text); min-height: 44px;
  }
  .error { color: var(--color-risk-critical); font-size: var(--text-sm); }
  .success { text-align: center; padding: var(--space-6); }
  .success a { color: var(--accent); text-decoration: underline; display: block; margin: var(--space-3) 0; }
</style>
```

- [ ] **Step 2.3 — Verify type-check passes**

```bash
pnpm check
```

Expected: no errors related to ContributionModal.svelte

- [ ] **Step 2.4 — Commit**

```bash
git add src/components/education/ContributionModal.svelte .env.example
git commit -m "feat(education): ContributionModal Svelte island"
```

---

### Task 3: Rewrite `src/pages/education/index.astro`

Static matrix table. 0 JS for the matrix itself.

**Files:**
- Rewrite: `src/pages/education/index.astro`

- [ ] **Step 3.1 — Rewrite the file**

```astro
---
import App from '../../layouts/App.astro';
import { getCollection } from 'astro:content';
import ContributionModal from '../../components/education/ContributionModal.svelte';
import CustomEducationList from '../../components/education/CustomEducationList.svelte';
import {
  buildMatrixData, CDSA_DOMAINS, AGE_GROUPS_CDSA,
  type MatrixCellData,
} from '../../lib/education/matrix-data';
import videoIndex from '../../../public/data/video-index.json';

const allEducation = await getCollection('education');

// Article lookup: slug → title
const articleTitles = new Map(allEducation.map(e => [e.id, e.data.title]));

// Catalog lookup: videoId → { title, channel, duration }
type CatalogEntry = { title: string; channel: string; duration: number; videoId: string };
const catalog = new Map<string, CatalogEntry>(
  Object.entries(
    videoIndex.catalog as Record<string, CatalogEntry>
  ).map(([id, v]) => [id, { ...v, videoId: id }])
);

const matrixData = buildMatrixData(
  videoIndex.triggers as Record<string, { videoIds: string[]; inapplicable: boolean }>,
  videoIndex.educationSlugToTriggers as Record<string, string[]>,
);

const DOMAIN_ZH: Record<string, string> = {
  behavior: '行為', gross_motor: '粗動作', fine_motor: '細動作',
  language: '語言', language_comprehension: '語言理解',
  language_expression: '語言表達', cognition: '認知', social_emotional: '社交情緒',
};
const AGE_ZH: Record<string, string> = {
  '2-6m': '2–6 月', '7-12m': '7–12 月', '13-24m': '1–2 歲',
  '25-36m': '2–3 歲', '37-48m': '3–4 歲', '49-60m': '4–5 歲', '61-72m': '5–6 歲',
};

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

type VideoInfo = CatalogEntry;

function cellVideos(cell: MatrixCellData): VideoInfo[] {
  return cell.videoIds.flatMap(id => {
    const v = catalog.get(id);
    return v ? [v] : [];
  });
}
---

<App title="衛教資源" description="老年醫學健康衛教資源（年齡 × 發展領域矩陣）">
  <h1>衛教資源</h1>

  <div class="matrix-scroll">
    <table class="education-matrix">
      <thead>
        <tr>
          <th class="domain-col">領域</th>
          {AGE_GROUPS_CDSA.map(age => (
            <th class="age-col">{AGE_ZH[age]}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {CDSA_DOMAINS.map(domain => (
          <tr>
            <th class="domain-header">{DOMAIN_ZH[domain]}</th>
            {AGE_GROUPS_CDSA.map(age => {
              const cell = matrixData[`${domain}:${age}`];
              if (cell.inapplicable) {
                return <td class="cell cell-na" aria-label="不適用">—</td>;
              }

              const articles = cell.articleSlugs.map(slug => ({
                slug,
                title: articleTitles.get(slug) ?? slug,
              }));
              const videos = cellVideos(cell);
              const isEmpty = articles.length === 0 && videos.length === 0;

              return (
                <td class="cell">
                  <details>
                    <summary class="cell-summary">
                      {articles.length > 0 && (
                        <span class="badge badge-article">📄 {articles.length}</span>
                      )}
                      {videos.length > 0 && (
                        <span class="badge badge-video">🎬 {videos.length}</span>
                      )}
                      {isEmpty && (
                        <span class="badge badge-empty">＋</span>
                      )}
                    </summary>

                    <div class="cell-detail">
                      {articles.length > 0 && (
                        <div class="detail-section">
                          <p class="detail-label">文章</p>
                          <ul class="resource-list">
                            {articles.map(a => (
                              <li>
                                <a href={`/education/${a.slug}/`} class="article-link">
                                  {a.title}
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {videos.length > 0 && (
                        <div class="detail-section">
                          <p class="detail-label">影片</p>
                          <ul class="resource-list video-list">
                            {videos.map(v => (
                              <li>
                                <a
                                  href={`https://www.youtube.com/watch?v=${v.videoId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  class="video-item"
                                >
                                  <img
                                    src={`https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`}
                                    alt={v.title}
                                    loading="lazy"
                                    referrerpolicy="no-referrer"
                                    class="video-thumb"
                                  />
                                  <span class="video-info">
                                    <span class="video-title">{v.title}</span>
                                    <span class="video-meta">{v.channel} · {fmtDuration(v.duration)}</span>
                                  </span>
                                </a>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      <button
                        class="contribute-btn"
                        data-domain={domain}
                        data-age={age}
                        type="button"
                      >
                        ＋ 新增資源至此情境
                      </button>
                    </div>
                  </details>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  </div>

  <ContributionModal client:load />
  <CustomEducationList client:idle />
</App>

<script>
  document.addEventListener('click', function(e) {
    var btn = e.target && (e.target as Element).closest('[data-domain][data-age]');
    if (!btn) return;
    document.dispatchEvent(new CustomEvent('open-contribution', {
      detail: {
        domain: btn.getAttribute('data-domain'),
        age: btn.getAttribute('data-age'),
      }
    }));
  });
</script>

<style>
  h1 { margin-bottom: var(--space-6); }

  .matrix-scroll {
    width: 100%;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .education-matrix {
    border-collapse: collapse;
    min-width: 700px;
    width: 100%;
  }

  .education-matrix th,
  .education-matrix td {
    border: 1px solid var(--line);
    padding: 0;
    vertical-align: top;
  }

  .domain-col {
    width: 7rem;
    white-space: nowrap;
    font-size: var(--text-sm);
    background: color-mix(in srgb, var(--bg), var(--text) 3%);
  }

  .age-col {
    font-size: var(--text-xs);
    text-align: center;
    padding: var(--space-2) var(--space-1);
    background: color-mix(in srgb, var(--bg), var(--text) 3%);
    white-space: nowrap;
  }

  .domain-header {
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    padding: var(--space-3);
    text-align: left;
    white-space: nowrap;
    background: color-mix(in srgb, var(--bg), var(--text) 2%);
  }

  .cell { min-width: 80px; }

  .cell-na {
    color: color-mix(in srgb, var(--text), var(--bg) 60%);
    text-align: center;
    font-size: var(--text-sm);
    padding: var(--space-3);
  }

  .cell-summary {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    padding: var(--space-2);
    cursor: pointer;
    list-style: none;
    min-height: 44px;
    align-items: center;
  }
  .cell-summary::-webkit-details-marker { display: none; }

  .badge {
    display: inline-block;
    font-size: var(--text-xs);
    border-radius: var(--radius-full);
    padding: 2px var(--space-2);
    white-space: nowrap;
  }
  .badge-article {
    background: color-mix(in srgb, var(--accent) 12%, var(--bg));
    color: var(--accent);
  }
  .badge-video {
    background: color-mix(in srgb, var(--warn) 15%, var(--bg));
    color: color-mix(in srgb, var(--warn), var(--text) 30%);
  }
  .badge-empty {
    background: color-mix(in srgb, var(--bg), var(--text) 5%);
    color: color-mix(in srgb, var(--text), var(--bg) 40%);
  }

  .cell-detail {
    padding: var(--space-3);
    border-top: 1px solid var(--line);
    background: var(--surface);
  }

  .detail-section { margin-bottom: var(--space-3); }
  .detail-label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    margin: 0 0 var(--space-2);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .resource-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .article-link {
    font-size: var(--text-sm);
    color: var(--accent);
    text-decoration: none;
    display: block;
    padding: var(--space-1) 0;
  }
  .article-link:hover { text-decoration: underline; }

  .video-item {
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
    text-decoration: none;
    color: inherit;
  }
  .video-thumb {
    width: 80px;
    aspect-ratio: 16/9;
    object-fit: cover;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
  }
  .video-info {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }
  .video-title {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: var(--text);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  .video-meta {
    font-size: var(--text-xs);
    color: color-mix(in srgb, var(--text), var(--bg) 40%);
  }

  .contribute-btn {
    display: block;
    width: 100%;
    margin-top: var(--space-3);
    padding: var(--space-2) var(--space-3);
    background: color-mix(in srgb, var(--accent) 8%, var(--bg));
    color: var(--accent);
    border: 1px dashed var(--accent);
    border-radius: var(--radius-sm);
    font-size: var(--text-xs);
    cursor: pointer;
    min-height: 44px;
    text-align: center;
  }
  .contribute-btn:hover {
    background: color-mix(in srgb, var(--accent) 15%, var(--bg));
  }
</style>
```

- [ ] **Step 3.2 — Build and check**

```bash
pnpm build
```

Expected: build succeeds, no TypeScript errors. Open `dist/education/index.html` and verify the matrix table exists with 8 rows × 7 columns.

- [ ] **Step 3.3 — Dev server smoke test**

```bash
pnpm dev
```

Open `http://localhost:4321/education/` in browser. Verify:
- Matrix table renders with 8 rows (領域) and 7 columns (年齡)
- Cells with content show 📄/🎬 badges
- Inapplicable cells show `—`
- Click a cell → details expands showing articles/videos
- Click `＋ 新增資源至此情境` → ContributionModal opens with pre-filled context

- [ ] **Step 3.4 — Commit**

```bash
git add src/pages/education/index.astro
git commit -m "feat(education): matrix page (age x domain, static SSG)"
```

---

## Part 2 — Cloudflare Worker

---

### Task 4: `issue-formatter.ts` (TDD)

Pure functions. Test first.

**Files:**
- Create: `workers/education-contribution/src/issue-formatter.ts`
- Create: `workers/education-contribution/src/issue-formatter.test.ts`

- [ ] **Step 4.1 — Create Worker project structure**

```bash
mkdir -p workers/education-contribution/src
```

- [ ] **Step 4.2 — Write `workers/education-contribution/src/issue-formatter.test.ts`**

```typescript
// workers/education-contribution/src/issue-formatter.test.ts
import { describe, it, expect } from 'vitest';
import { formatIssueTitle, formatIssueBody } from './issue-formatter';

describe('formatIssueTitle', () => {
  it('formats YouTube title correctly', () => {
    const title = formatIssueTitle({
      type: 'youtube', domain: 'language', ageGroup: '13-24m',
      url: 'https://youtu.be/abcdefghijk', title: '語言發展影片',
    });
    expect(title).toBe('[衛教貢獻] 語言 × 1-2 歲｜YouTube 影片｜語言發展影片');
  });

  it('falls back to URL when title missing', () => {
    const title = formatIssueTitle({
      type: 'youtube', domain: 'language', ageGroup: '13-24m',
      url: 'https://youtu.be/abcdefghijk',
    });
    expect(title).toContain('https://youtu.be/abcdefghijk');
  });

  it('handles unknown domain/age gracefully', () => {
    const title = formatIssueTitle({
      type: 'article', domain: 'unknown_domain', ageGroup: 'future-age',
      title: '測試文章',
    });
    expect(title).toContain('unknown_domain');
    expect(title).toContain('future-age');
  });
});

describe('formatIssueBody', () => {
  it('includes domain and ageGroup in body', () => {
    const body = formatIssueBody({
      type: 'youtube', domain: 'language', ageGroup: '13-24m',
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
    });
    expect(body).toContain('語言');
    expect(body).toContain('1-2 歲');
    expect(body).toContain('13-24m');
  });

  it('includes YouTube URL in body', () => {
    const body = formatIssueBody({
      type: 'youtube', domain: 'language', ageGroup: '13-24m',
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
    });
    expect(body).toContain('https://www.youtube.com/watch?v=abcdefghijk');
  });

  it('includes extracted video ID in yaml hint', () => {
    const body = formatIssueBody({
      type: 'youtube', domain: 'language', ageGroup: '13-24m',
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
    });
    expect(body).toContain('abcdefghijk');
  });

  it('includes article content in body', () => {
    const body = formatIssueBody({
      type: 'article', domain: 'cognition', ageGroup: '25-36m',
      title: '認知遊戲指南', summary: '促進認知發展的遊戲活動',
      content: '## 介紹\n\n這是內容',
    });
    expect(body).toContain('認知遊戲指南');
    expect(body).toContain('促進認知發展的遊戲活動');
  });

  it('includes submitter when provided', () => {
    const body = formatIssueBody({
      type: 'article', domain: 'cognition', ageGroup: '25-36m',
      title: '文章', submitter: 'Dr. Chen，台大老年醫學',
    });
    expect(body).toContain('Dr. Chen，台大老年醫學');
  });
});
```

- [ ] **Step 4.3 — Create `workers/education-contribution/package.json`**

```json
{
  "name": "education-contribution-worker",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "dev": "wrangler dev src/index.ts",
    "deploy": "wrangler deploy src/index.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "universal-github-app-jwt": "^2.2.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250124.0",
    "typescript": "^5.7.2",
    "vitest": "^3.1.4",
    "wrangler": "^4.13.2"
  }
}
```

- [ ] **Step 4.4 — Create `workers/education-contribution/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ES2022",
    "moduleResolution": "bundler",
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts"]
}
```

- [ ] **Step 4.5 — Install Worker dependencies**

```bash
cd workers/education-contribution
pnpm install
cd ../..
```

- [ ] **Step 4.6 — Run tests to confirm failure**

```bash
cd workers/education-contribution
pnpm test
```

Expected: `FAIL — Cannot find module './issue-formatter'`

- [ ] **Step 4.7 — Implement `workers/education-contribution/src/issue-formatter.ts`**

```typescript
// workers/education-contribution/src/issue-formatter.ts

export type ContributionPayload = {
  type: 'youtube' | 'article' | 'external-link';
  domain: string;
  ageGroup: string;
  url?: string;
  title?: string;
  summary?: string;
  content?: string;
  notes?: string;
  submitter?: string;
};

const DOMAIN_ZH: Record<string, string> = {
  behavior: '行為', gross_motor: '粗動作', fine_motor: '細動作',
  language: '語言', language_comprehension: '語言理解',
  language_expression: '語言表達', cognition: '認知', social_emotional: '社交情緒',
};

const AGE_ZH: Record<string, string> = {
  '2-6m': '2-6 個月', '7-12m': '7-12 個月', '13-24m': '1-2 歲',
  '25-36m': '2-3 歲', '37-48m': '3-4 歲', '49-60m': '4-5 歲', '61-72m': '5-6 歲',
};

const TYPE_ZH: Record<string, string> = {
  youtube: 'YouTube 影片', article: 'Markdown 文章', 'external-link': '外部連結',
};

function extractVideoId(url: string): string {
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/);
  return m?.[1] ?? '（請手動填入 11 碼 video ID）';
}

export function formatIssueTitle(p: ContributionPayload): string {
  const domain = DOMAIN_ZH[p.domain] ?? p.domain;
  const age    = AGE_ZH[p.ageGroup] ?? p.ageGroup;
  const type   = TYPE_ZH[p.type];
  const label  = p.title ?? p.url ?? '（無標題）';
  return `[衛教貢獻] ${domain} × ${age}｜${type}｜${label}`;
}

export function formatIssueBody(p: ContributionPayload): string {
  const domain = DOMAIN_ZH[p.domain] ?? p.domain;
  const age    = AGE_ZH[p.ageGroup] ?? p.ageGroup;
  const type   = TYPE_ZH[p.type];
  const now    = new Date().toISOString();

  let resourceLines = '';
  if (p.type === 'youtube') {
    resourceLines = `- YouTube URL: ${p.url ?? '（未填）'}\n- 標題: ${p.title ?? '（未填）'}`;
  } else if (p.type === 'article') {
    resourceLines = `- 標題: ${p.title ?? '（未填）'}\n- 摘要: ${p.summary ?? '（未填）'}`;
    if (p.content) resourceLines += `\n\n**內容預覽**:\n\`\`\`markdown\n${p.content.slice(0, 500)}\n\`\`\``;
  } else {
    resourceLines = `- URL: ${p.url ?? '（未填）'}\n- 標題: ${p.title ?? '（未填）'}`;
  }

  const yamlHint = p.type === 'youtube'
    ? `\`\`\`yaml\n# src/data/education-videos/cdsa-domains.yaml\n# 找到對應 trigger，將 videoId 加入 videoIds 清單：\n# - trigger: cdsa.domain.${p.domain}.anomaly.${p.ageGroup}\n#   videoIds:\n#     - ${extractVideoId(p.url ?? '')}   # 11 碼\n\`\`\``
    : `（文章/連結請依 README 建立對應的 .md 或 YAML entry）`;

  return `## 衛教貢獻申請

**類型**: ${type}
**年齡段**: ${age} (${p.ageGroup})
**發展領域**: ${domain} (${p.domain})

### 資源資訊

${resourceLines}

### 補充說明

> ${p.notes ?? '（無）'}

**提交者**: ${p.submitter ?? '（未填）'}
**提交時間**: ${now}

---

### 維護者操作區（copy-paste 至 YAML）

${yamlHint}`.trim();
}
```

- [ ] **Step 4.8 — Run tests to confirm pass**

```bash
cd workers/education-contribution
pnpm test
```

Expected: `8 tests passed`

- [ ] **Step 4.9 — Commit**

```bash
cd ../..
git add workers/education-contribution/
git commit -m "feat(worker): education-contribution project skeleton + issue-formatter (TDD)"
```

---

### Task 5: `github-app-auth.ts`

Exchanges GitHub App private key for an installation access token.

**Files:**
- Create: `workers/education-contribution/src/github-app-auth.ts`

- [ ] **Step 5.1 — Create `workers/education-contribution/src/github-app-auth.ts`**

```typescript
// workers/education-contribution/src/github-app-auth.ts
import { githubAppJwt } from 'universal-github-app-jwt';

export async function getInstallationToken(
  appId: string,
  privateKey: string,
  installationId: string,
): Promise<string> {
  const { token: jwt } = await githubAppJwt({ id: appId, privateKey });

  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${jwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'yao-care-smart-geri-cds/1.0',
      },
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub App auth failed ${res.status}: ${body}`);
  }

  const data = await res.json() as { token: string };
  return data.token;
}
```

- [ ] **Step 5.2 — Commit**

```bash
git add workers/education-contribution/src/github-app-auth.ts
git commit -m "feat(worker): github-app-auth — JWT + installation token"
```

---

### Task 6: Worker `index.ts`

Main handler: CORS preflight, input validation, GitHub issue creation.

**Files:**
- Create: `workers/education-contribution/src/index.ts`

- [ ] **Step 6.1 — Create `workers/education-contribution/src/index.ts`**

```typescript
// workers/education-contribution/src/index.ts
import { getInstallationToken } from './github-app-auth';
import { formatIssueTitle, formatIssueBody } from './issue-formatter';
import type { ContributionPayload } from './issue-formatter';

interface Env {
  GITHUB_APP_ID: string;
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_INSTALLATION_ID: string;
  ALLOWED_ORIGIN: string;
}

const VALID_TYPES = new Set(['youtube', 'article', 'external-link']);
const VALID_DOMAINS = new Set([
  'behavior', 'gross_motor', 'fine_motor', 'language',
  'language_comprehension', 'language_expression', 'cognition', 'social_emotional',
]);
const VALID_AGES = new Set([
  '2-6m', '7-12m', '13-24m', '25-36m', '37-48m', '49-60m', '61-72m',
]);

function validate(body: unknown): ContributionPayload | string {
  if (!body || typeof body !== 'object') return '請求格式錯誤';
  const b = body as Record<string, unknown>;
  if (!VALID_TYPES.has(b.type as string)) return `type 無效: ${b.type}`;
  if (!VALID_DOMAINS.has(b.domain as string)) return `domain 無效: ${b.domain}`;
  if (!VALID_AGES.has(b.ageGroup as string)) return `ageGroup 無效: ${b.ageGroup}`;
  return b as unknown as ContributionPayload;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    let payload: ContributionPayload;
    try {
      const body = await request.json();
      const result = validate(body);
      if (typeof result === 'string') {
        return new Response(JSON.stringify({ error: result }), {
          status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
        });
      }
      payload = result;
    } catch {
      return new Response(JSON.stringify({ error: '無效的 JSON' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    try {
      const token = await getInstallationToken(
        env.GITHUB_APP_ID,
        env.GITHUB_APP_PRIVATE_KEY,
        env.GITHUB_INSTALLATION_ID,
      );

      const issueRes = await fetch(
        'https://api.github.com/repos/yao-care/smart-geri-cds/issues',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
            'X-GitHub-Api-Version': '2022-11-28',
            'User-Agent': 'yao-care-smart-geri-cds/1.0',
          },
          body: JSON.stringify({
            title: formatIssueTitle(payload),
            body: formatIssueBody(payload),
            labels: ['education-contribution', payload.type],
          }),
        },
      );

      if (!issueRes.ok) {
        const text = await issueRes.text();
        throw new Error(`GitHub Issues API ${issueRes.status}: ${text}`);
      }

      const issue = await issueRes.json() as { html_url: string };
      return new Response(JSON.stringify({ issueUrl: issue.html_url }), {
        status: 201, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '伺服器錯誤';
      return new Response(JSON.stringify({ error: msg }), {
        status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }
  },
} satisfies ExportedHandler<Env>;
```

- [ ] **Step 6.2 — Commit**

```bash
git add workers/education-contribution/src/index.ts
git commit -m "feat(worker): Worker index — CORS + validate + create GitHub issue"
```

---

### Task 7: `wrangler.toml` + deploy

- [ ] **Step 7.1 — Create `workers/education-contribution/wrangler.toml`**

```toml
name = "education-contribution"
main = "src/index.ts"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]

[vars]
ALLOWED_ORIGIN = "https://smart-geri-cds.yao.care"
```

> Worker secrets (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_INSTALLATION_ID) are set via `wrangler secret put`, not in this file.

- [ ] **Step 7.2 — Set up GitHub App secrets**

Gather values from https://github.com/organizations/yao-care/settings/apps/yao-care-app:
- **App ID**: shown on the app settings page
- **Private Key**: click "Generate a private key", download the `.pem` file
- **Installation ID**: run the following to find it:

```bash
# Replace APP_ID and PEM_PATH with your values
APP_ID=<your-app-id>
PEM_PATH=<path-to-downloaded-pem>

# Generate JWT manually to find installation ID
node -e "
const fs = require('fs');
const { execSync } = require('child_process');
console.log('Check: GET https://api.github.com/app/installations  with Bearer JWT');
"
# Or: visit https://github.com/apps/yao-care-app → Installations → click 'Configure'
# The installation ID is in the URL: .../installations/{INSTALLATION_ID}
```

- [ ] **Step 7.3 — Store secrets in Cloudflare**

```bash
cd workers/education-contribution

# Login to Cloudflare if needed
pnpm wrangler login

pnpm wrangler secret put GITHUB_APP_ID
# Paste the App ID when prompted

pnpm wrangler secret put GITHUB_APP_PRIVATE_KEY
# Paste the FULL contents of the .pem file (including BEGIN/END lines)

pnpm wrangler secret put GITHUB_INSTALLATION_ID
# Paste the installation ID
```

- [ ] **Step 7.4 — Deploy Worker**

```bash
cd workers/education-contribution
pnpm deploy
```

Expected output includes:
```
Published education-contribution (Workers)
  https://education-contribution.<your-account>.workers.dev
```

Note the full Worker URL (e.g. `https://education-contribution.yao-care.workers.dev`).

- [ ] **Step 7.5 — Smoke test the deployed Worker**

```bash
curl -X POST https://education-contribution.yao-care.workers.dev/education-contribution \
  -H "Content-Type: application/json" \
  -d '{"type":"youtube","domain":"language","ageGroup":"13-24m","url":"https://youtu.be/yzRi9GlSptM","title":"測試","notes":"smoke test","submitter":"dev"}'
```

Expected: `{"issueUrl":"https://github.com/yao-care/smart-geri-cds/issues/..."}` and a new issue appears in the repo.

- [ ] **Step 7.6 — Configure the Astro env var**

Create `.env` in the project root (not committed):

```bash
echo "PUBLIC_CONTRIBUTION_WORKER_URL=https://education-contribution.yao-care.workers.dev/education-contribution" > .env
```

Update `astro.config.mjs` to expose it — Astro automatically exposes `PUBLIC_*` env vars to client scripts, no config change needed.

- [ ] **Step 7.7 — End-to-end test in dev**

```bash
cd /Users/lightman/yao.care/smart-geri-cds
pnpm dev
```

Open `http://localhost:4321/education/`, click a cell, click `＋ 新增資源`, fill in a YouTube URL, submit. Verify:
1. Modal shows spinning "送出中…"
2. On success, modal shows issue URL (blue link)
3. GitHub issue is created with correct title and body

- [ ] **Step 7.8 — Commit remaining files**

```bash
cd /Users/lightman/yao.care/smart-geri-cds
git add workers/education-contribution/wrangler.toml
git commit -m "feat(worker): wrangler config + deployment instructions"
```

---

## Self-review checklist

- [x] **Spec coverage**
  - ✓ 8×7 matrix (Task 3)
  - ✓ Inapplicable cells (Task 1 + 3)
  - ✓ Cell expand shows articles + videos with thumbnails (Task 3)
  - ✓ "+" button opens modal with pre-filled domain/age (Task 2 + 3)
  - ✓ Three resource types: YouTube, article, link (Task 2)
  - ✓ YouTube URL → preview thumbnail (Task 2)
  - ✓ POST → Cloudflare Worker (Task 2 + 6)
  - ✓ Worker creates GitHub Issue via GitHub App (Task 5 + 6)
  - ✓ CORS (Task 6)
  - ✓ Input validation (Task 6)
  - ✓ Issue body with YAML hint (Task 4)
  - ✓ Success UI with issue link (Task 2)
  - ✓ CustomEducationList below matrix (Task 3)

- [x] **No placeholders** — all code blocks are complete

- [x] **Type consistency**
  - `ContributionPayload` defined in `issue-formatter.ts`, imported in `index.ts`
  - `MatrixData` / `MatrixCellData` defined in `matrix-data.ts`, imported in `index.astro`
  - `CatalogEntry` type defined locally in `index.astro`
