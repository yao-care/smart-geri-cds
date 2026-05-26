import { db, type RecommendationOverlay, type RecommendationItem, type RecommendationCategory } from './schema';
import { getCustomEducation } from './custom-education';
import { loadVideoIndex } from '../education/index-loader';
import { CDSA_DOMAIN_NAMES } from '../education/schemas';
import type { AgeGroupCDSA } from '../utils/age-groups';

export const DOMAINS = CDSA_DOMAIN_NAMES;

export const CATEGORIES: RecommendationCategory[] = ['normal', 'monitor', 'refer'];

export type Domain = typeof DOMAINS[number];

function buildId(tenantId: string, category: RecommendationCategory, domain: string): string {
  return `${tenantId}::${category}::${domain}`;
}

/**
 * Get the default recommendation list for one cell (category × domain × ageGroup).
 * Reads from the unified video-index.json (age-aware).
 * Returns empty array if no default is defined.
 */
export async function getDefaultRecommendations(
  category: RecommendationCategory,
  domain: string,
  ageGroup: AgeGroupCDSA,
): Promise<RecommendationItem[]> {
  const idx = await loadVideoIndex();
  const key = `${category}::${domain}::${ageGroup}`;
  return (idx.recommendations[key] ?? []) as RecommendationItem[];
}

/**
 * Load the tenant overlay for one cell, if any.
 * Returns null when the tenant has not customised that cell.
 * Key is 3-part (tenant::category::domain) — age-independent.
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
 * Key remains 3-part (age-independent) — no IndexedDB migration required.
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
 * Merge default + tenant overlay for one cell (age-aware defaults, age-independent overlay).
 * - No overlay → default items (age-specific from index).
 * - Overlay with mergeWithDefault=true → default items + overlay items (deduped by source-key).
 * - Overlay with mergeWithDefault=false → overlay items only (full replace).
 */
export async function mergeRecommendations(
  tenantId: string,
  category: RecommendationCategory,
  domain: string,
  ageGroup: AgeGroupCDSA,
): Promise<RecommendationItem[]> {
  const overlay = await getOverlay(tenantId, category, domain);
  const defaults = await getDefaultRecommendations(category, domain, ageGroup);

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

/**
 * Merge across multiple domains for a single category — used by ResultView
 * (called once per assessment with the anomaly-domain list and the child's ageGroup).
 * Items are deduped across domains by the same composite key.
 */
export async function mergeRecommendationsForContext(
  tenantId: string,
  category: RecommendationCategory,
  domains: string[],
  ageGroup: AgeGroupCDSA,
): Promise<RecommendationItem[]> {
  const seen = new Set<string>();
  const out: RecommendationItem[] = [];
  for (const domain of domains) {
    const items = await mergeRecommendations(tenantId, category, domain, ageGroup);
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
