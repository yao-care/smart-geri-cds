<script lang="ts">
  /**
   * Education list filter island.
   *
   * The page itself SSGs the full card grid (each card carries
   * data-category and data-format attributes). This island reads
   * ?cat= and ?format= from the URL, toggles `display: none` on
   * cards that don't match, and writes filter changes back to the URL.
   * No re-fetching — pure DOM operations on the static grid.
   */

  type CategoryFilter = 'all' | 'diet' | 'sleep' | 'respiratory' | 'exercise' | 'milestone' | 'general';
  type FormatFilter = 'all' | 'article' | 'video';

  const CATEGORY_LABELS: Record<CategoryFilter, string> = {
    all: '全部',
    diet: '飲食',
    sleep: '睡眠',
    respiratory: '呼吸',
    exercise: '運動',
    milestone: '里程碑',
    general: '高齡照護',
  };

  const FORMAT_LABELS: Record<FormatFilter, string> = {
    all: '全部',
    article: '📄 文章',
    video: '🎬 影片',
  };

  let category = $state<CategoryFilter>('all');
  let format = $state<FormatFilter>('all');
  let visibleCount = $state(0);
  let totalCount = $state(0);

  $effect(() => {
    const params = new URLSearchParams(window.location.search);
    const cat = params.get('cat') as CategoryFilter | null;
    const fmt = params.get('format') as FormatFilter | null;
    if (cat && cat in CATEGORY_LABELS) category = cat;
    if (fmt && fmt in FORMAT_LABELS) format = fmt;
    applyFilter();
  });

  function applyFilter(): void {
    const cards = document.querySelectorAll<HTMLElement>('[data-edu-card]');
    totalCount = cards.length;
    let visible = 0;
    cards.forEach((card) => {
      const cat = card.dataset.category ?? '';
      const fmt = card.dataset.format ?? '';
      const matchCat = category === 'all' || cat === category;
      const matchFmt = format === 'all' || fmt === format;
      const shown = matchCat && matchFmt;
      card.style.display = shown ? '' : 'none';
      if (shown) visible++;
    });
    visibleCount = visible;
  }

  function updateUrl(): void {
    const params = new URLSearchParams(window.location.search);
    if (category === 'all') params.delete('cat'); else params.set('cat', category);
    if (format === 'all') params.delete('format'); else params.set('format', format);
    const qs = params.toString();
    const newUrl = window.location.pathname + (qs ? `?${qs}` : '');
    window.history.replaceState(null, '', newUrl);
  }

  function chooseCategory(c: CategoryFilter): void {
    category = c;
    applyFilter();
    updateUrl();
  }

  function chooseFormat(f: FormatFilter): void {
    format = f;
    applyFilter();
    updateUrl();
  }
</script>

<section class="filter-bar" aria-label="衛教內容篩選">
  <div class="row">
    <span class="row-label">分類</span>
    <div class="chips" role="tablist" aria-label="分類">
      {#each Object.entries(CATEGORY_LABELS) as [key, label]}
        <button
          type="button"
          class="chip"
          class:active={category === key}
          onclick={() => chooseCategory(key as CategoryFilter)}
          role="tab"
          aria-selected={category === key}
        >
          {label}
        </button>
      {/each}
    </div>
  </div>

  <div class="row">
    <span class="row-label">格式</span>
    <div class="chips" role="tablist" aria-label="格式">
      {#each Object.entries(FORMAT_LABELS) as [key, label]}
        <button
          type="button"
          class="chip"
          class:active={format === key}
          onclick={() => chooseFormat(key as FormatFilter)}
          role="tab"
          aria-selected={format === key}
        >
          {label}
        </button>
      {/each}
    </div>
  </div>

  {#if totalCount > 0 && visibleCount < totalCount}
    <p class="count">顯示 {visibleCount} / {totalCount} 篇</p>
  {/if}
</section>

<style>
  .filter-bar {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    margin-bottom: var(--space-6);
    padding: var(--space-3) var(--space-4);
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    flex-wrap: wrap;
  }

  .row-label {
    font-size: var(--text-xs);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    min-width: 36px;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .chip {
    border: 1.5px solid color-mix(in srgb, var(--line), var(--text) 33%);
    background: var(--bg);
    padding: var(--space-1) var(--space-3);
    min-height: 32px;
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    cursor: pointer;
    color: var(--text);
    transition: background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease;
  }

  .chip.active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .chip:hover:not(.active) {
    background: color-mix(in srgb, var(--accent) 4%, var(--bg));
    border-color: var(--accent);
    color: var(--accent);
  }

  .count {
    margin: 0;
    font-size: var(--text-xs);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
  }
</style>
