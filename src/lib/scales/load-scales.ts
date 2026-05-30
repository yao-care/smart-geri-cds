import type { ScaleDef } from './scale';
import type { DomainTop, DomainSub } from '../domain/domain-tree';
import type { CfsLevel } from '../utils/cfs-levels';

/** Shape of a `scales` content-collection entry's `data` (post-Zod-validation). */
interface ScaleEntryData {
  id: string;
  domain: { top: string; sub: string };
  tier: 'triage' | 'screen' | 'full';
  alwaysRun?: boolean;
  expandsTo?: string;
  applicableCfs: string[];
  scoring: ScaleDef['scoring'];
  inputType: ScaleDef['inputType'];
  requiresPatient?: boolean;
  requiresInformant?: boolean;
  maxScore: number;
  items: ScaleDef['items'];
  bands: ScaleDef['bands'];
  clinicallyReviewed: boolean;
}

/**
 * Convert validated `scales` content-collection entries into runtime ScaleDef.
 * The Zod schema (content.config.ts) already refined top/sub legality and the
 * cfs / scoring / inputType enums, so the narrowing casts are sound.
 */
export function toScaleDefs(entries: { data: ScaleEntryData }[]): ScaleDef[] {
  return entries.map(({ data }) => ({
    id: data.id,
    domain: { top: data.domain.top as DomainTop, sub: data.domain.sub as DomainSub },
    tier: data.tier,
    alwaysRun: data.alwaysRun,
    expandsTo: data.expandsTo,
    applicableCfs: data.applicableCfs as CfsLevel[],
    scoring: data.scoring,
    inputType: data.inputType,
    requiresPatient: data.requiresPatient,
    requiresInformant: data.requiresInformant,
    maxScore: data.maxScore,
    items: data.items,
    bands: data.bands,
    clinicallyReviewed: data.clinicallyReviewed,
  }));
}
