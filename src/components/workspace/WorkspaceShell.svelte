<script lang="ts">
  import AssessmentsTab from './AssessmentsTab.svelte';
  import GuideTab from './GuideTab.svelte';

  // The workspace exposes the CGA assessment surface + the guide. The earlier
  // roster/alert overview feed has been removed; a geriatric monitoring surface
  // can be reintroduced here when its model is defined.
  let activeTab = $state<'assessments' | 'guide'>('assessments');
</script>

<div class="workspace">
  <main class="workspace-main">
    <nav class="workspace-tabs" aria-label="工作區域切換">
      <button
        class="tab-btn"
        class:active={activeTab === 'assessments'}
        onclick={() => activeTab = 'assessments'}
      >
        評估
      </button>
      <button
        class="tab-btn"
        class:active={activeTab === 'guide'}
        onclick={() => activeTab = 'guide'}
      >
        使用說明
      </button>
    </nav>

    <div class="workspace-content">
      {#if activeTab === 'assessments'}
        <AssessmentsTab />
      {:else if activeTab === 'guide'}
        <GuideTab />
      {/if}
    </div>
  </main>
</div>

<style>
  .workspace {
    display: flex;
    height: 100%;
    position: relative;
  }

  .workspace-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .workspace-tabs {
    display: flex;
    border-bottom: 1px solid var(--line);
    padding: 0 var(--space-4);
    flex-shrink: 0;
  }

  .tab-btn {
    padding: var(--space-3) var(--space-5);
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    font-size: var(--text-sm);
    font-weight: var(--font-medium);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    cursor: pointer;
    min-height: 44px;
  }

  .tab-btn:hover:not(:disabled) {
    color: var(--text);
  }

  .tab-btn.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .tab-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .workspace-content {
    flex: 1;
    overflow-y: auto;
    padding: var(--space-4);
  }

  @media (max-width: 768px) {
    .workspace-content {
      padding: var(--space-3);
    }
  }
</style>
