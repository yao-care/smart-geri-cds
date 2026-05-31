<script lang="ts">
interface Props { onStart: () => void; }
const { onStart }: Props = $props();
</script>

<section class="intro">
  <h1>高齡自我檢視</h1>
  <p class="lead">這是一份簡單的自我檢視，大約 2–3 分鐘。會用語音唸出問題，您只要點「有」或「沒有」。</p>
  <div class="disclaimer" role="note">
    <strong>請注意</strong>
    <p>這只是幫您看看哪些方面需要多留意，<u>不是醫療診斷</u>。檢視完會建議您找醫療人員做完整評估。</p>
  </div>
  <button class="start-btn" onclick={onStart}>開始檢視</button>
</section>

<style>
.intro { max-width: 620px; margin: 0 auto; text-align: center; padding: var(--space-6) var(--space-4); }
.intro h1 { font-size: var(--text-2xl); margin-bottom: var(--space-4); }
.lead { font-size: var(--text-lg); line-height: var(--lh-lg); margin-bottom: var(--space-5); }
.disclaimer { text-align: left; border: 2px solid var(--line); border-radius: var(--radius-md);
  padding: var(--space-4); margin-bottom: var(--space-6); background: var(--surface); }
.disclaimer p { font-size: var(--text-base); margin-top: var(--space-2); }
.start-btn { min-height: 64px; padding: 0 var(--space-8); font-size: var(--text-xl); font-weight: var(--font-bold);
  color: white; background: var(--accent); border: none; border-radius: var(--radius-md); cursor: pointer; }
</style>
