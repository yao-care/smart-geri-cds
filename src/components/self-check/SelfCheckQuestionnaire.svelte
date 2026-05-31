<script lang="ts">
import type { SelfCheckStore } from '$lib/stores/self-check.svelte';
import type { SelfCheckItem } from '$lib/self-check/self-check';
import { speak, cancelSpeech, hasZhTwVoice } from '$lib/tts/speak';

interface Props { store: SelfCheckStore; }
const { store }: Props = $props();

let ttsAvailable = $state(true);

$effect(() => {
  // 首次掛載後查詢語音（getVoices 在某些瀏覽器需稍候，但降級僅影響是否顯示提示）。
  ttsAvailable = hasZhTwVoice();
});

// 進新題自動朗讀；元件卸載/換題前取消在途語音。
$effect(() => {
  const item: SelfCheckItem | null = store.currentItem;
  if (item) speak(item.text);
  return () => cancelSpeech();
});

function choose(score: number): void {
  cancelSpeech();
  store.answer(score);
}
</script>

{#if store.currentItem}
  <section class="q" aria-live="polite">
    <div class="progress" aria-hidden="true">
      <div class="progress-fill" style="width:{Math.round(store.progress * 100)}%"></div>
    </div>

    {#if store.redFlagActive}
      <div class="safety" role="alert">
        <strong>請立即尋求協助</strong>
        <p>如果您有不想活下去或傷害自己的念頭，請馬上聯絡：</p>
        <ul>
          <li>安心專線 <a href="tel:1925">1925</a>（24 小時）</li>
          <li>生命線 <a href="tel:1995">1995</a></li>
        </ul>
      </div>
    {/if}

    <h2 class="stem">{store.currentItem.text}</h2>

    <button type="button" class="replay" onclick={() => speak(store.currentItem!.text)}>🔊 再唸一次</button>
    {#if !ttsAvailable}
      <p class="no-tts">（此裝置沒有中文語音，請直接閱讀題目）</p>
    {/if}

    <div class="options">
      {#each store.currentItem.options as opt (opt.label)}
        <button type="button" class="opt-btn" onclick={() => choose(opt.score)}>{opt.label}</button>
      {/each}
    </div>

    {#if store.index > 0}
      <button type="button" class="back" onclick={() => store.back()}>← 上一題</button>
    {/if}
  </section>
{/if}

<style>
.q { max-width: 620px; margin: 0 auto; padding: var(--space-5) var(--space-4); text-align: center; }
.progress { height: 8px; background: var(--surface); border-radius: 4px; overflow: hidden; margin-bottom: var(--space-6); }
.progress-fill { height: 100%; background: var(--accent); }
.stem { font-size: var(--text-xl); line-height: var(--lh-xl); margin-bottom: var(--space-4); }
.replay { min-height: 44px; padding: 0 var(--space-4); font-size: var(--text-base); background: var(--surface);
  border: 1px solid var(--line); border-radius: var(--radius-md); cursor: pointer; margin-bottom: var(--space-2); }
.no-tts { font-size: var(--text-sm); color: var(--text); opacity: 0.7; margin-bottom: var(--space-4); }
.options { display: flex; flex-direction: column; gap: var(--space-3); margin: var(--space-5) 0; }
.opt-btn { min-height: 64px; font-size: var(--text-lg); font-weight: var(--font-bold); color: var(--text);
  background: var(--bg); border: 2px solid var(--accent); border-radius: var(--radius-md); cursor: pointer; }
.opt-btn:active { background: color-mix(in srgb, var(--accent) 15%, var(--bg)); }
.back { min-height: 44px; font-size: var(--text-base); background: none; border: none; color: var(--text);
  opacity: 0.7; cursor: pointer; }
.safety { text-align: left; border: 2px solid var(--danger); border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--danger) 10%, var(--bg)); padding: var(--space-4); margin-bottom: var(--space-5); }
.safety a { font-weight: var(--font-bold); }
</style>
