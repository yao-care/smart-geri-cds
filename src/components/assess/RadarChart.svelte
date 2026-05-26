<script lang="ts">
import { domainLabel } from '../../lib/domain/domain-tree';
import type { Severity } from '../../lib/scales/scale';

interface Props {
  /** One entry per scored `top.sub`. */
  data: Array<{
    domain: string;
    score: number;
    severity: Severity;
  }>;
  size?: number;
  title?: string;
  showLegend?: boolean;
}
const { data, size = 320, title = '各面向評估結果', showLegend = true }: Props = $props();

/** `top.sub` → 子項中文標籤。 */
function labelFor(domain: string): string {
  const [top, sub] = domain.split('.');
  return sub ? domainLabel(top, sub) : domain;
}

const center = $derived(size / 2);
const radius = $derived(size / 2 - 60);
const angleStep = $derived(data.length > 0 ? (2 * Math.PI) / data.length : 0);

function polarToCartesian(angle: number, r: number): { x: number; y: number } {
  return {
    x: center + r * Math.cos(angle - Math.PI / 2),
    y: center + r * Math.sin(angle - Math.PI / 2),
  };
}
</script>

<div class="radar-wrap">
  <header class="radar-header">
    <h3>{title}</h3>
    {#if showLegend}
      <p class="legend">數值＝原始分占量表滿分百分比（依各量表切分點判讀嚴重度）</p>
    {/if}
  </header>
  <svg viewBox="0 0 {size} {size}" width={size} height={size} class="radar-chart" role="img" aria-label="各評估面向雷達圖">
    {#if data.length >= 3}
      <polygon
        points={data.map((_, i) => {
          const p = polarToCartesian(angleStep * i, radius);
          return `${p.x},${p.y}`;
        }).join(' ')}
        fill="none"
        stroke="var(--line)"
        stroke-width="1"
      />
      <polygon
        points={data.map((d, i) => {
          const p = polarToCartesian(angleStep * i, radius * d.score / 100);
          return `${p.x},${p.y}`;
        }).join(' ')}
        fill="var(--accent)"
        fill-opacity="0.2"
        stroke="var(--accent)"
        stroke-width="2"
      />
    {/if}

    {#each data as d, i}
      {@const labelPos = polarToCartesian(angleStep * i, radius + 20)}
      {@const scorePos = polarToCartesian(angleStep * i, radius + 38)}
      <text x={labelPos.x} y={labelPos.y} class="radar-label" text-anchor="middle">
        {labelFor(d.domain)}
      </text>
      <text
        x={scorePos.x}
        y={scorePos.y}
        class="radar-score"
        class:incomplete={d.severity === 'incomplete'}
        text-anchor="middle"
      >
        {d.severity === 'incomplete' ? '—' : d.score}
      </text>
    {/each}
  </svg>
</div>

<style>
.radar-wrap { display: flex; flex-direction: column; align-items: center; }
.radar-header { text-align: center; }
.radar-header h3 { font-size: var(--text-lg); margin: 0 0 var(--space-1) 0; }
.radar-header .legend {
  font-size: var(--text-sm);
  color: var(--text);
  opacity: 0.7;
  margin: 0 0 var(--space-4) 0;
}
.radar-chart { display: block; }
.radar-label { font-size: var(--text-sm); fill: var(--text); }
.radar-score { font-size: var(--text-sm); fill: var(--accent); font-weight: var(--font-bold); }
.radar-score.incomplete { fill: color-mix(in srgb, var(--text), var(--bg) 45%); }
</style>
