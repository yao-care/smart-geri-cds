<script lang="ts">
import { groupDomainScores, type DomainGroupRow } from '../../lib/domain/group-domain-scores';
import type { DomainScore } from '../../engine/cdsa/radar-scoring';
import type { Severity } from '../../lib/scales/scale';

interface Props {
  /** Raw per-scale-result scores; multiple rows per `top.sub` (screen + full)
   *  are collapsed to one most-severe row by groupDomainScores. */
  data: DomainScore[];
  title?: string;
  showLegend?: boolean;
}
const { data, title = '各面向評估結果', showLegend = true }: Props = $props();

const groups = $derived(groupDomainScores(data));

const SEVERITY_COLOR: Record<Severity, string> = {
  normal: 'var(--accent)',
  monitor: 'var(--warn)',
  refer: 'var(--danger)',
  incomplete: 'var(--line)',
};

/** Spoken severity so screen-reader users get the risk that colour conveys
 *  visually (WCAG 1.4.1 — colour must not be the only cue). */
const SEVERITY_LABEL: Record<Severity, string> = {
  normal: '正常',
  monitor: '需注意',
  refer: '建議轉介',
  incomplete: '未完成',
};

/** One spoken string per bar associating sub-domain, score and severity, so a
 *  screen reader announces「認知：80（正常）」instead of two adjacent text nodes. */
function rowAriaLabel(it: DomainGroupRow): string {
  const status =
    it.severity === 'incomplete'
      ? SEVERITY_LABEL.incomplete
      : `${it.score}（${SEVERITY_LABEL[it.severity]}）`;
  return `${it.label}：${status}`;
}
</script>

<div class="bars-wrap">
  <header class="bars-header">
    <h3>{title}</h3>
    {#if showLegend}
      <p class="legend">數值＝原始分占量表滿分百分比（依各量表切分點判讀嚴重度）；「—」為未完成</p>
    {/if}
  </header>

  {#each groups as g (g.top)}
    <section class="domain-group" aria-label={g.label}>
      <h4 class="group-title">{g.label}</h4>
      {#each g.items as it (it.sub + it.label)}
        <div class="bar-row" role="img" aria-label={rowAriaLabel(it)}>
          <span class="bar-label">{it.label}</span>
          <div class="bar-track">
            {#if it.severity !== 'incomplete'}
              <!-- floor at 2% so a 0/low score still shows a visible sliver; the numeric label always accompanies it -->
              <div
                class="bar-fill"
                style="width:{Math.max(it.score, 2)}%; background:{SEVERITY_COLOR[it.severity]}"
              ></div>
            {/if}
          </div>
          <span
            class="bar-val"
            class:incomplete={it.severity === 'incomplete'}
            style={it.severity === 'incomplete' ? '' : `color:${SEVERITY_COLOR[it.severity]}`}
          >
            {it.severity === 'incomplete' ? '—' : it.score}
          </span>
        </div>
      {/each}
    </section>
  {/each}
</div>

<style>
.bars-wrap { width: 100%; max-width: 560px; margin: 0 auto; }
.bars-header { text-align: center; }
.bars-header h3 { font-size: var(--text-lg); margin: 0 0 var(--space-1) 0; }
.bars-header .legend { font-size: var(--text-sm); color: var(--text); opacity: 0.7; margin: 0 0 var(--space-4) 0; }
.domain-group { margin-bottom: var(--space-3); }
.group-title { font-size: var(--text-sm); font-weight: var(--font-bold); margin: 0 0 var(--space-1) 0; color: var(--text); opacity: 0.75; }
.bar-row { display: flex; align-items: center; gap: var(--space-2); margin: var(--space-1) 0; min-height: 28px; }
.bar-label { flex: 0 0 8em; font-size: var(--text-sm); text-align: right; white-space: nowrap; }
.bar-track { flex: 1; height: 16px; background: var(--surface); border-radius: 8px; overflow: hidden; }
.bar-fill { height: 100%; border-radius: 8px; }
.bar-val { flex: 0 0 2.5em; font-size: var(--text-sm); font-weight: var(--font-bold); text-align: left; }
.bar-val.incomplete { color: color-mix(in srgb, var(--text), var(--bg) 45%); }
</style>
