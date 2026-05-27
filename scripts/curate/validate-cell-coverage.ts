#!/usr/bin/env tsx
/**
 * validate-cell-coverage.ts
 *
 * 驗收：對 build 後的 runtime index（非 raw yaml，故經 verified-catalog 過濾），
 * 斷言每個適用（inapplicable:false）的 cga.domain.* trigger 至少有 1 支影片。
 * 有缺格 → 列出並 exit 1。
 */
import { buildContentIndex } from '../build-content-index.js';

async function main(): Promise<void> {
  const index = await buildContentIndex({ write: false });
  const domainTriggers = Object.entries(index.triggers).filter(
    ([k, t]) => /^cga\.domain\./.test(k) && !t.inapplicable,
  );
  const empty = domainTriggers.filter(([, t]) => t.videoIds.length === 0).map(([k]) => k);
  console.log(`適用 domain 格 ${domainTriggers.length}，有片 ${domainTriggers.length - empty.length}，缺 ${empty.length}`);
  if (empty.length) {
    console.error(`✗ 仍有空格：\n  ${empty.sort().join('\n  ')}`);
    process.exit(1);
  }
  console.log('✓ 每個適用格皆 ≥1 支已驗證影片');
}

main().catch(e => { console.error(e); process.exit(1); });
