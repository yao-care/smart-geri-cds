import type { DomainTop, DomainSub } from '$lib/domain/domain-tree';
import type { SelfCheckScale, SelfCheckItem, SelfCheckBand } from './self-check';

/** Shape of one `selfChecks` collection entry (mirrors the Zod schema). */
export interface SelfCheckEntry {
  data: {
    id: string;
    domain: { top: string; sub: string };
    category: 'scored' | 'awareness';
    maxScore: number;
    items: SelfCheckItem[];
    bands: SelfCheckBand[];
    clinicallyReviewed: boolean;
  };
}

export function toSelfCheckScales(entries: SelfCheckEntry[]): SelfCheckScale[] {
  return entries.map(({ data }) => ({
    id: data.id,
    domain: { top: data.domain.top as DomainTop, sub: data.domain.sub as DomainSub },
    category: data.category,
    maxScore: data.maxScore,
    items: data.items,
    bands: data.bands,
    clinicallyReviewed: data.clinicallyReviewed,
  }));
}
