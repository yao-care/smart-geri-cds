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
