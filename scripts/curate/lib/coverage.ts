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
 * Specificity 門檻：classifier 給出 band size <= 此值視為「specific」（窄 band），優於廣譜 ALL_CFS。
 * 5 = 涵蓋常見窄 band：cfs7-9(3)、cfs5-7(3)、cfs3-6(4)、cfs1-4(4)、cfs6-9(4)、cfs5-9(5)、cfs3-7(5)；
 * 排除 ALL_CFS(9) 廣譜。提升此值會把更廣的 band 視為 specific（不建議）。
 */
const SPECIFIC_BAND_SIZE_MAX = 5;

/**
 * 每個 (domain, cfs) cell 從該域影片池挑：① specific 命中（窄 band，size ≤ SPECIFIC_BAND_SIZE_MAX）優先，
 * ② 廣譜命中（ALL_CFS 等）次之，③ 未命中以分數高者補滿（每組內按 catalog score 降冪、同分以 videoId 字典序）。
 *
 * 三層分流避免「廣譜片分數較高把窄 band specific 片擠掉 cap」— 否則所有 cfs cell 仍同 5 廣譜，
 * 無法真實差異化。每格仍保證 ≥1 支（fallback others）。
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
    const specific: string[] = [];
    const broad: string[] = [];
    const others: string[] = [];
    for (const v of all) {
      const bands = classify(v);
      if (bands.has(cfs)) {
        if (bands.size <= SPECIFIC_BAND_SIZE_MAX) specific.push(v);
        else broad.push(v);
      } else {
        others.push(v);
      }
    }
    specific.sort(byScore);
    broad.sort(byScore);
    others.sort(byScore);
    return { ...t, videoIds: [...specific, ...broad, ...others].slice(0, cap) };
  });
}
