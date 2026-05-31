<script lang="ts">
  let online = $state(true);
  let mounted = $state(false);
  let updateAvailable = $state(false);

  $effect(() => {
    online = navigator.onLine;
    mounted = true;

    function onOnline() { online = true; }
    function onOffline() { online = false; }
    function onSwUpdate() { updateAvailable = true; }

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('sw-updated', onSwUpdate);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('sw-updated', onSwUpdate);
    };
  });

  function reload() {
    location.reload();
  }
</script>

{#if mounted && !online}
  <div class="banner banner-offline" role="status">
    離線模式 — 部分功能可能受限
  </div>
{/if}

{#if mounted && updateAvailable}
  <div class="banner banner-update" role="status">
    新版已可用
    <button type="button" onclick={reload}>重新整理套用</button>
  </div>
{/if}

<style>
  .banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 1000;
    padding: 0.5rem 1rem;
    text-align: center;
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
  }

  .banner-offline {
    background: var(--warn);
    color: white;
  }

  .banner-update {
    background: var(--warn);
    color: white;
  }

  .banner-update button {
    /* 用變暗 overlay 而非半透明白：白色 overlay 會把 --warn 背景提亮，
       使白字對比掉到 4.34（< AA 4.5）。變暗後對比穩定 ≥4.5。 */
    background: oklch(0 0 0 / 0.2);
    color: white;
    border: 1px solid oklch(1 0 0 / 0.55);
    border-radius: 4px;
    padding: 2px 8px;
    margin-left: 0.5rem;
    cursor: pointer;
    font: inherit;
  }
</style>
