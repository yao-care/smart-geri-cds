<script lang="ts">
import type { SelfCheckStore } from '$lib/stores/self-check.svelte';
import { buildSelfCheckPdf } from '$lib/self-check/self-check-pdf';

interface Props { store: SelfCheckStore; }
const { store }: Props = $props();

const s = $derived(store.summary);

const HEADLINE: Record<typeof s.overall, string> = {
  green: '目前看起來都還好 🟢',
  amber: '有幾項建議多留意 🟡',
  red: '建議盡快尋求協助 🔴',
};

let saving = $state(false);
async function downloadPdf(): Promise<void> {
  saving = true;
  try {
    const dateText = new Date().toLocaleDateString('zh-TW');
    const doc = await buildSelfCheckPdf(s, dateText);
    doc.save('高齡自我檢視摘要.pdf');
  } finally {
    saving = false;
  }
}
</script>

<section class="result">
  <h1 class="headline" data-overall={s.overall}>{HEADLINE[s.overall]}</h1>

  {#if s.redFlag}
    <div class="safety" role="alert">
      <strong>請立即尋求協助</strong>
      <p>您提到有不想活下去或傷害自己的念頭，請馬上聯絡安心專線 <a href="tel:1925">1925</a>（24 小時）或就醫。</p>
    </div>
  {/if}

  {#if s.concerns.length > 0}
    <h2>建議多留意的方面</h2>
    <ul class="concerns">
      {#each s.concerns as c (c.sub)}
        <li><span class="dot amber" aria-hidden="true"></span><strong>{c.label}</strong>：{c.advice}</li>
      {/each}
    </ul>
  {:else}
    <p class="all-clear">各方面目前都沒有需要特別留意的地方，請繼續保持。</p>
  {/if}

  {#if s.awareness.length > 0}
    <h2>您有興趣進一步了解</h2>
    <ul class="awareness">
      {#each s.awareness as a (a.sub)}
        <li>{a.label}（可與醫療團隊討論）</li>
      {/each}
    </ul>
  {/if}

  <p class="disclaimer">本工具為自我檢視，非醫療診斷。建議攜此結果找醫療人員做完整評估。</p>

  <div class="actions">
    <button class="pdf-btn" onclick={downloadPdf} disabled={saving}>
      {saving ? '產生中…' : '下載摘要（PDF）'}
    </button>
    <button class="restart-btn" onclick={() => store.reset()}>重新檢視</button>
  </div>
</section>

<style>
.result { max-width: 640px; margin: 0 auto; padding: var(--space-6) var(--space-4); }
.headline { font-size: var(--text-2xl); text-align: center; margin-bottom: var(--space-5); }
.headline[data-overall='red'] { color: var(--danger); }
h2 { font-size: var(--text-lg); margin: var(--space-5) 0 var(--space-2); }
.concerns, .awareness { list-style: none; padding: 0; }
.concerns li, .awareness li { font-size: var(--text-base); line-height: var(--lh-base); margin-bottom: var(--space-3);
  display: flex; gap: var(--space-2); align-items: baseline; }
.dot { flex: 0 0 12px; width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
.dot.amber { background: var(--warn); }
.all-clear { font-size: var(--text-lg); text-align: center; color: var(--accent); }
.safety { border: 2px solid var(--danger); border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--danger) 10%, var(--bg)); padding: var(--space-4); margin-bottom: var(--space-5); }
.disclaimer { font-size: var(--text-sm); opacity: 0.75; margin-top: var(--space-6); }
.actions { display: flex; flex-direction: column; gap: var(--space-3); margin-top: var(--space-5); }
.pdf-btn { min-height: 56px; font-size: var(--text-lg); font-weight: var(--font-bold); color: white;
  background: var(--accent); border: none; border-radius: var(--radius-md); cursor: pointer; }
.restart-btn { min-height: 48px; font-size: var(--text-base); background: var(--surface);
  border: 1px solid var(--line); border-radius: var(--radius-md); cursor: pointer; }
</style>
