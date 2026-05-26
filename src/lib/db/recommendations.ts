import { db, type RecommendationOverlay, type RecommendationItem, type RecommendationCategory } from './schema';
import { getCustomEducation } from './custom-education';
import { loadVideoIndex } from '../education/index-loader';
import { DOMAIN_TREE, DOMAIN_TOPS } from '../domain/domain-tree';
import type { CfsLevel } from '../utils/cfs-levels';

// 全部二層子項（`top.sub`）為 recommendations 維度；單一源於 domain-tree。
export const DOMAINS: string[] = DOMAIN_TOPS.flatMap(
  top => DOMAIN_TREE[top].map(sub => `${top}.${sub}`),
);

// RecommendationCategory 即 severity 列舉（normal | monitor | refer）。
// incomplete 不進此處（排除於 recommendations 查詢）。
export const CATEGORIES: RecommendationCategory[] = ['normal', 'monitor', 'refer'];

export type Domain = string;

function buildId(tenantId: string, category: RecommendationCategory, domain: string): string {
  return `${tenantId}::${category}::${domain}`;
}

/**
 * Get the default recommendation list for one cell (severity × top.sub × cfsLevel).
 * Reads from the unified video-index.json (cfs-aware).
 * Returns empty array if no default is defined.
 * Key: `${severity}::${top.sub}::${cfsLevel}`.
 */
export async function getDefaultRecommendations(
  category: RecommendationCategory,
  domain: string,
  cfsLevel: CfsLevel,
): Promise<RecommendationItem[]> {
  const idx = await loadVideoIndex();
  const key = `${category}::${domain}::${cfsLevel}`;
  return (idx.recommendations[key] ?? []) as RecommendationItem[];
}

/**
 * Load the tenant overlay for one cell, if any.
 * Returns null when the tenant has not customised that cell.
 * Key is 3-part (tenant::category::top.sub) — cfs-independent.
 */
export async function getOverlay(
  tenantId: string,
  category: RecommendationCategory,
  domain: string,
): Promise<RecommendationOverlay | null> {
  const id = buildId(tenantId, category, domain);
  return (await db.recommendationOverlays.get(id)) ?? null;
}

/**
 * Save (upsert) a tenant overlay.
 * Key remains 3-part (cfs-independent) — no IndexedDB migration required.
 */
export async function saveOverlay(
  tenantId: string,
  category: RecommendationCategory,
  domain: string,
  items: RecommendationItem[],
  mergeWithDefault: boolean,
): Promise<void> {
  const overlay: RecommendationOverlay = {
    id: buildId(tenantId, category, domain),
    tenantId,
    category,
    domain,
    items: JSON.parse(JSON.stringify(items)) as RecommendationItem[],
    mergeWithDefault,
    updatedAt: new Date(),
  };
  await db.recommendationOverlays.put(overlay);
}

/**
 * Remove the tenant overlay for one cell — that cell falls back fully to default.
 */
export async function clearOverlay(
  tenantId: string,
  category: RecommendationCategory,
  domain: string,
): Promise<void> {
  await db.recommendationOverlays.delete(buildId(tenantId, category, domain));
}

/**
 * Load all overlays for a tenant (used by settings UI).
 */
export async function getAllOverlays(tenantId: string): Promise<RecommendationOverlay[]> {
  return db.recommendationOverlays.where('tenantId').equals(tenantId).toArray();
}

/**
 * Merge default + tenant overlay for one cell (cfs-aware defaults, cfs-independent overlay).
 * - No overlay → default items (cfs-specific from index).
 * - Overlay with mergeWithDefault=true → default items + overlay items (deduped by source-key).
 * - Overlay with mergeWithDefault=false → overlay items only (full replace).
 */
export async function mergeRecommendations(
  tenantId: string,
  category: RecommendationCategory,
  domain: string,
  cfsLevel: CfsLevel,
): Promise<RecommendationItem[]> {
  const overlay = await getOverlay(tenantId, category, domain);
  const defaults = await getDefaultRecommendations(category, domain, cfsLevel);

  if (!overlay) return defaults;

  if (!overlay.mergeWithDefault) {
    return overlay.items;
  }

  // Merge: defaults first, then overlay items, deduped by composite key.
  const seen = new Set<string>();
  const out: RecommendationItem[] = [];
  for (const list of [defaults, overlay.items]) {
    for (const item of list) {
      const key = itemKey(item);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(item);
      }
    }
  }
  return out;
}

/** Per-domain severity input for {@link mergeRecommendationsForContext}. */
export interface PerDomainSeverity {
  /** `${top}.${sub}` key. */
  domain: string;
  /** Per-domain severity. `incomplete` is excluded from the query. */
  severity: RecommendationCategory | 'incomplete';
}

/**
 * Merge recommendations across multiple domains, each with its OWN severity —
 * used by the result page (called once per assessment with the per-domain
 * severity list and the subject's CFS level).
 *
 * New axis model (M4): the result page produces one severity per `top.sub`,
 * so we query each domain at its own severity, not a single overall category.
 * `incomplete` domains are EXCLUDED (no recommendation query). Items are
 * deduped across domains by the same composite source key.
 */
export async function mergeRecommendationsForContext(
  tenantId: string,
  perDomain: PerDomainSeverity[],
  cfsLevel: CfsLevel,
): Promise<RecommendationItem[]> {
  const seen = new Set<string>();
  const out: RecommendationItem[] = [];
  for (const { domain, severity } of perDomain) {
    if (severity === 'incomplete') continue;
    const items = await mergeRecommendations(tenantId, severity, domain, cfsLevel);
    for (const item of items) {
      const key = itemKey(item);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(item);
      }
    }
  }
  return out;
}

export function itemKey(item: RecommendationItem): string {
  switch (item.source) {
    case 'internal': return `internal::${item.slug ?? ''}`;
    case 'custom': return `custom::${item.customId ?? ''}`;
    case 'external': return `external::${item.url ?? ''}`;
  }
}

/**
 * Resolve a recommendation item to display-ready data, looking up titles
 * from custom education when not embedded in the overlay.
 */
export async function resolveItemDisplay(
  item: RecommendationItem,
  tenantId: string,
): Promise<{ href: string; title: string; summary: string; isExternal: boolean }> {
  if (item.source === 'external') {
    return {
      href: item.url ?? '#',
      title: item.title ?? item.url ?? '外部資源',
      summary: item.summary ?? '',
      isExternal: true,
    };
  }
  if (item.source === 'internal') {
    return {
      href: `/education/${item.slug}/`,
      title: item.title ?? item.slug ?? '',
      summary: item.summary ?? '',
      isExternal: false,
    };
  }
  // custom
  if (item.customId) {
    const all = await getCustomEducation(tenantId);
    const found = all.find((c) => c.id === item.customId);
    if (found) {
      return {
        href: found.videoUrl ?? `/education/custom/${found.id}/`,
        title: item.title ?? found.title,
        summary: item.summary ?? found.summary,
        isExternal: !!found.videoUrl,
      };
    }
  }
  return {
    href: '#',
    title: item.title ?? '（找不到自訂衛教）',
    summary: item.summary ?? '',
    isExternal: false,
  };
}
