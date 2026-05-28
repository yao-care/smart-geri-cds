export interface TriggerEntry {
  trigger: string;
  articles: unknown[];
  videoIds: string[];
  [k: string]: unknown;
}

/** 解析 cga.domain.<top>.<sub>.anomaly.<cfs> → "top.sub"；非 domain trigger → null。 */
export function domainOf(trigger: string): string | null {
  const m = trigger.match(/^cga\.domain\.([^.]+)\.([^.]+)\.anomaly\.[^.]+$/);
  return m ? `${m[1]}.${m[2]}` : null;
}

/**
 * 每個 domain：聯集其所有 trigger 的 videoIds，依 catalog score 降冪（同分 videoId 升冪）
 * 排序、取前 cap 支，套到該 domain 的「每一個」trigger。非 domain trigger 原樣保留。
 * 回傳新陣列，不變動輸入。
 */
export function broadcastDomainVideos(
  triggers: TriggerEntry[],
  scores: Record<string, number>,
  cap = 5,
): TriggerEntry[] {
  const byDomain = new Map<string, Set<string>>();
  for (const t of triggers) {
    const d = domainOf(t.trigger);
    if (!d) continue;
    const set = byDomain.get(d) ?? new Set<string>();
    for (const id of t.videoIds) set.add(id);
    byDomain.set(d, set);
  }
  const rankedByDomain = new Map<string, string[]>();
  for (const [d, set] of byDomain) {
    const ranked = [...set]
      .sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0) || a.localeCompare(b))
      .slice(0, cap);
    rankedByDomain.set(d, ranked);
  }
  return triggers.map(t => {
    const d = domainOf(t.trigger);
    if (!d) return t;
    return { ...t, videoIds: rankedByDomain.get(d) ?? t.videoIds };
  });
}

/** 仍為空（videoIds 長度 0）的 domain trigger 清單。 */
export function uncoveredDomainCells(triggers: TriggerEntry[]): string[] {
  return triggers
    .filter(t => domainOf(t.trigger) !== null && t.videoIds.length === 0)
    .map(t => t.trigger);
}

/** 解析 cga.domain.<top>.<sub>.anomaly.<cfs> 的 cfs 部分。 */
export function cfsOf(trigger: string): string | null {
  const m = trigger.match(/anomaly\.(cfs\d)$/);
  return m ? m[1] : null;
}

/**
 * 每個 (domain, cfs) cell 從該域影片池挑：① 該 cfs ∈ classifier(video) 的優先（按分數降冪），
 * ② 不足 cap 時以「未匹配但分數高」的補滿（fallback 確保每格 ≥1）。同分以 videoId 字典序穩定排序。
 * 結果：同域不同 CFS 格的影片排序／內容會差異化（在影片池本身有 band 多樣性時）。
 */
export function selectPerCellVideos(
  triggers: TriggerEntry[],
  catalogScores: Record<string, number>,
  classify: (videoId: string) => Set<string>,
  cap = 5,
): TriggerEntry[] {
  // Step 1: 每域聯集影片池
  const pool = new Map<string, Set<string>>();
  for (const t of triggers) {
    const d = domainOf(t.trigger);
    if (!d) continue;
    const set = pool.get(d) ?? new Set<string>();
    for (const id of t.videoIds) set.add(id);
    pool.set(d, set);
  }
  const byScore = (a: string, b: string) =>
    (catalogScores[b] ?? 0) - (catalogScores[a] ?? 0) || a.localeCompare(b);

  return triggers.map(t => {
    const d = domainOf(t.trigger);
    const cfs = cfsOf(t.trigger);
    if (!d || !cfs) return t;
    const all = [...(pool.get(d) ?? [])];
    const matched: string[] = [];
    const others: string[] = [];
    for (const v of all) {
      if (classify(v).has(cfs)) matched.push(v);
      else others.push(v);
    }
    matched.sort(byScore);
    others.sort(byScore);
    return { ...t, videoIds: [...matched, ...others].slice(0, cap) };
  });
}
