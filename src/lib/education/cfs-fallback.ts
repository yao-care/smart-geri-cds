import { type CfsLevel } from '../utils/cfs-levels';

/** 某 CFS 級該格無內容時向相鄰級遞補（cfs5 → cfs4 / cfs6）；衛教鄰近性 > 嚴格分級。
 *  Fallback 永遠不跨越 inapplicable: true（由 tryCfsFallback 實施）。 */
export const CFS_FALLBACK_CHAIN: Record<CfsLevel, CfsLevel[]> = {
  cfs1: ['cfs2'],
  cfs2: ['cfs1', 'cfs3'],
  cfs3: ['cfs2', 'cfs4'],
  cfs4: ['cfs3', 'cfs5'],
  cfs5: ['cfs4', 'cfs6'],
  cfs6: ['cfs5', 'cfs7'],
  cfs7: ['cfs6', 'cfs8'],
  cfs8: ['cfs7', 'cfs9'],
  cfs9: ['cfs8'],
};
