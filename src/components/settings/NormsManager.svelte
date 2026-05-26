<script lang="ts">
  /**
   * 常模管理（NormThreshold）— Phase 2 停用。
   *
   * 高齡周全性評估改採 per-scale 驗證過的固定切分點（cutoff）計分，
   * 計分與分層軸（CFS）解耦，不再以族群 z-score / 常模驅動。
   * 原 NormThreshold 表與此 UI 一併移除；常模重訓延 Phase 3
   * （新老年量測模組加回時再評估是否需要族群基準）。
   */
</script>

<section class="norms-disabled">
  <p class="note">
    常模管理已於高齡版停用。本系統改用各量表驗證過的固定切分點（cutoff）計分，
    不再需要 per ageGroup × metric 的族群常模。此功能延後至 Phase 3（感測/量測模組）再評估。
  </p>
</section>

<style>
  .norms-disabled {
    padding: var(--space-4);
    background: color-mix(in srgb, var(--bg), var(--text) 5%);
    border-radius: var(--radius-md);
  }

  .note {
    margin: 0;
    font-size: var(--text-sm);
    line-height: 1.7;
    color: color-mix(in srgb, var(--text), var(--bg) 25%);
  }
</style>
