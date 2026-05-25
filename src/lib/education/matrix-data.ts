import { AGE_GROUPS_CDSA } from '$lib/utils/age-groups';
export { AGE_GROUPS_CDSA } from '$lib/utils/age-groups';

export const CDSA_DOMAINS = [
  'behavior', 'gross_motor', 'fine_motor', 'language',
  'language_comprehension', 'language_expression', 'cognition', 'social_emotional',
] as const;
export type CdsaDomain = typeof CDSA_DOMAINS[number];
export type AgeGroupCDSA = typeof AGE_GROUPS_CDSA[number];
export type MatrixKey = `${CdsaDomain}:${AgeGroupCDSA}`;

export type MatrixCellData = {
  inapplicable: boolean;
  articleSlugs: string[];
  videoIds: string[];
};

export type MatrixData = Record<MatrixKey, MatrixCellData>;

type TriggerMap   = Record<string, { videoIds: string[]; inapplicable: boolean }>;
type SlugToTriggers = Record<string, string[]>;

export function buildMatrixData(triggers: TriggerMap, slugToTriggers: SlugToTriggers): MatrixData {
  const data: Record<string, MatrixCellData> = {};

  // Initialise all cells as inapplicable
  for (const domain of CDSA_DOMAINS) {
    for (const age of AGE_GROUPS_CDSA) {
      data[`${domain}:${age}`] = { inapplicable: true, articleSlugs: [], videoIds: [] };
    }
  }

  // Populate from cdsa.domain.* triggers only
  for (const [trigger, entry] of Object.entries(triggers)) {
    const parts = trigger.split('.');
    if (parts[0] !== 'cdsa' || parts[1] !== 'domain' || parts[3] !== 'anomaly') continue;
    const cell = data[`${parts[2]}:${parts[4]}`];
    if (!cell) continue;
    cell.inapplicable = entry.inapplicable;
    if (!entry.inapplicable) cell.videoIds = [...entry.videoIds];
  }

  // Attach article slugs via cdsa.domain.* triggers only
  for (const [slug, triggerList] of Object.entries(slugToTriggers)) {
    for (const trigger of triggerList) {
      const parts = trigger.split('.');
      if (parts[0] !== 'cdsa' || parts[1] !== 'domain' || parts[3] !== 'anomaly') continue;
      const cell = data[`${parts[2]}:${parts[4]}`];
      if (cell && !cell.inapplicable && !cell.articleSlugs.includes(slug)) {
        cell.articleSlugs.push(slug);
      }
    }
  }

  return data as MatrixData;
}
