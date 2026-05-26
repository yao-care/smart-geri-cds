import { CFS_LEVELS, type CfsLevel } from '$lib/utils/cfs-levels';
import { DOMAIN_TREE, DOMAIN_TOPS, type DomainTop, type DomainSub } from '$lib/domain/domain-tree';

export { CFS_LEVELS } from '$lib/utils/cfs-levels';

/** 矩陣列＝全部二層子項（`top.sub`）；單一源於 domain-tree。 */
export const CDSA_DOMAINS: string[] = DOMAIN_TOPS.flatMap(
  top => DOMAIN_TREE[top].map(sub => `${top}.${sub}`),
);

export type MatrixKey = `${string}:${CfsLevel}`;

export type MatrixCellData = {
  inapplicable: boolean;
  articleSlugs: string[];
  videoIds: string[];
};

export type MatrixData = Record<MatrixKey, MatrixCellData>;

type TriggerMap = Record<string, { videoIds: string[]; inapplicable: boolean; educationSlug?: string }>;

export function buildMatrixData(triggers: TriggerMap): MatrixData {
  const data: Record<string, MatrixCellData> = {};

  // Initialise all `top.sub × cfs` cells as applicable (empty → contributable).
  // Source of truth for inapplicability is src/data/education/content-relevance.yaml,
  // whose inapplicable section is compiled into cga.domain triggers with
  // inapplicable:true; only those flip a cell back to inapplicable below.
  for (const top of DOMAIN_TOPS as DomainTop[]) {
    for (const sub of DOMAIN_TREE[top] as readonly DomainSub[]) {
      for (const cfs of CFS_LEVELS) {
        data[`${top}.${sub}:${cfs}`] = { inapplicable: false, articleSlugs: [], videoIds: [] };
      }
    }
  }

  // Populate from cga.domain.* triggers only. Articles (educationSlug) and videos
  // are independent — a cell may have an article, a video, both, or neither.
  // Trigger shape: cga.domain.<top>.<sub>.anomaly.<cfs>
  //   parts[0]=cga  parts[1]=domain  parts[2]=top  parts[3]=sub
  //   parts[4]=anomaly  parts[5]=cfs
  for (const [trigger, entry] of Object.entries(triggers)) {
    const parts = trigger.split('.');
    if (parts.length !== 6) continue;
    if (parts[0] !== 'cga' || parts[1] !== 'domain' || parts[4] !== 'anomaly') continue;
    const cell = data[`${parts[2]}.${parts[3]}:${parts[5]}`];
    if (!cell) continue;
    cell.inapplicable = entry.inapplicable;
    if (!entry.inapplicable) {
      cell.videoIds = [...entry.videoIds];
      if (entry.educationSlug) cell.articleSlugs = [entry.educationSlug];
    }
  }

  return data as MatrixData;
}
