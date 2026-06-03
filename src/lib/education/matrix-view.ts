import { DOMAIN_TOPS, DOMAIN_TREE, type DomainTop, type DomainSub } from '$lib/domain/domain-tree';
import { CFS_LEVELS } from '$lib/utils/cfs-levels';
import type { MatrixData } from './matrix-data';

export type CellArticle = { slug: string; title: string };
export type CellVideo = { videoId: string; title: string; channel: string; duration: number };
export type CellView = { inapplicable: boolean; articles: CellArticle[]; videos: CellVideo[] };
export type CellViews = Record<string, CellView>;

type CatalogEntry = { title: string; channel: string; duration: number; videoId: string };

/**
 * 把 build 期的 MatrixData 打平成可序列化、含標題的視圖，供 island props 使用。
 * slug→title 與 videoId→catalog 的查表都在此完成，island 端不再需要 Map。
 */
export function buildCellViews(
  matrix: MatrixData,
  articleTitles: Record<string, string>,
  catalog: Record<string, CatalogEntry>,
): CellViews {
  const out: CellViews = {};
  for (const top of DOMAIN_TOPS as DomainTop[]) {
    for (const sub of DOMAIN_TREE[top] as readonly DomainSub[]) {
      for (const cfs of CFS_LEVELS) {
        const key = `${top}.${sub}:${cfs}`;
        const cell = matrix[key as keyof MatrixData];
        if (!cell || cell.inapplicable) {
          out[key] = { inapplicable: true, articles: [], videos: [] };
          continue;
        }
        out[key] = {
          inapplicable: false,
          articles: cell.articleSlugs.map(slug => ({ slug, title: articleTitles[slug] ?? slug })),
          videos: cell.videoIds.flatMap(id => {
            const v = catalog[id];
            return v ? [{ videoId: id, title: v.title, channel: v.channel, duration: v.duration }] : [];
          }),
        };
      }
    }
  }
  return out;
}

export function cellResourceCount(cell: CellView): number {
  return cell.articles.length + cell.videos.length;
}

export type HeatBucket = 0 | 1 | 2 | 3 | 4;

/** 固定閾值 4 檔：1 / 2–3 / 4–5 / 6+；0 為空（另以淡點呈現）。 */
export function heatBucket(count: number): HeatBucket {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 5) return 3;
  return 4;
}

export type Coverage = { withResources: number; empty: number; inapplicable: number; total: number };

export function matrixCoverage(cells: CellViews): Coverage {
  let withResources = 0, empty = 0, inapplicable = 0, total = 0;
  for (const cell of Object.values(cells)) {
    total++;
    if (cell.inapplicable) inapplicable++;
    else if (cellResourceCount(cell) > 0) withResources++;
    else empty++;
  }
  return { withResources, empty, inapplicable, total };
}
