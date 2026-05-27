#!/usr/bin/env tsx
/**
 * validate-cell-coverage.ts
 *
 * 驗收：矩陣「實際渲染」的每個適用格都有 ≥1 支已驗證影片。
 *
 * 真相源是「領域樹 × applicableCfs」（與矩陣渲染同源：各 scale 的 domain + applicableCfs
 * 聯集，扣除 content-relevance.inapplicable），而非 content-relevance.triggers 清單——
 * 後者可能整個漏掉某領域（如 physical.pain 曾無任何 trigger），用它驗收會假性通過。
 *
 * 對每個應有的格，檢查 build 後 runtime index 的 triggers[key]（缺鍵或 videoIds 空 = 未覆蓋）。
 */
import fs from 'node:fs/promises';
import yaml from 'js-yaml';
import fg from 'fast-glob';
import { buildContentIndex } from '../build-content-index.js';

const CFS_ALL = ['cfs1', 'cfs2', 'cfs3', 'cfs4', 'cfs5', 'cfs6', 'cfs7', 'cfs8', 'cfs9'];

/** 領域樹真相源：各 scale 的 top.sub → applicableCfs 聯集。 */
async function domainApplicableCfs(): Promise<Map<string, Set<string>>> {
  const tree = new Map<string, Set<string>>();
  for (const fp of (await fg('src/data/scales/*.yaml')).sort()) {
    const s = yaml.load(await fs.readFile(fp, 'utf8')) as {
      domain?: { top: string; sub: string };
      applicableCfs?: string[];
    };
    if (!s?.domain) continue;
    const key = `${s.domain.top}.${s.domain.sub}`;
    const set = tree.get(key) ?? new Set<string>();
    for (const c of s.applicableCfs ?? []) set.add(c);
    tree.set(key, set);
  }
  return tree;
}

async function inapplicableMap(): Promise<Record<string, string[]>> {
  const raw = yaml.load(
    await fs.readFile('src/data/education/content-relevance.yaml', 'utf8'),
  ) as { inapplicable?: Record<string, string[]> };
  return raw.inapplicable ?? {};
}

async function main(): Promise<void> {
  const [tree, inapp, index] = await Promise.all([
    domainApplicableCfs(),
    inapplicableMap(),
    buildContentIndex({ write: false }),
  ]);

  const expected: string[] = [];
  for (const [domain, cfsSet] of tree) {
    const dead = new Set(inapp[domain] ?? []);
    for (const cfs of CFS_ALL) {
      if (!cfsSet.has(cfs) || dead.has(cfs)) continue; // 不適用格不算
      expected.push(`cga.domain.${domain}.anomaly.${cfs}`);
    }
  }

  const uncovered = expected.filter(k => (index.triggers[k]?.videoIds.length ?? 0) === 0).sort();
  console.log(`矩陣應有適用格 ${expected.length}，有片 ${expected.length - uncovered.length}，缺 ${uncovered.length}`);
  if (uncovered.length) {
    console.error(`✗ 仍有空格：\n  ${uncovered.join('\n  ')}`);
    process.exit(1);
  }
  console.log('✓ 矩陣每個適用格皆 ≥1 支已驗證影片');
}

main().catch(e => { console.error(e); process.exit(1); });
