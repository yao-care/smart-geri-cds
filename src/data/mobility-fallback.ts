import type { ScaleDef } from '../lib/scales/scale';

/**
 * 行動能力自述短篩（fallback）— Mobility self-report fallback.
 *
 * 當「五次坐立自測計時」（sit-to-stand.yaml）因無相機、權限被拒、或受測者選擇
 * 「無法錄影或不便」而無法執行時，MobilityTaskModule 改以這組自述題目計分，
 * 仍產出一致的 functional.mobility ScaleResult，確保流程不會卡住。
 *
 * ⚠ 內容與 src/data/scales/mobility-screen.yaml 完全一致（同題目、同分段），
 *    兩處需手動保持同步。mobility-screen.yaml 是給 cfs7 的 content-collection 量表；
 *    本檔則是非 collection 的純資料，供 cfs2–cfs6 fallback 路徑在執行期直接 scoreScale。
 *
 * 計分沿用 mobility-screen：每題 0–2，4 題總分 0–8，higher = worse。
 * clinicallyReviewed: false（題目/切分點待臨床最終簽核）。
 */
export const MOBILITY_FALLBACK_SCALE: ScaleDef = {
  id: 'mobility-screen',
  domain: { top: 'functional', sub: 'mobility' },
  // applicableCfs 在 fallback 情境不參與篩選（元件僅在 sit-to-stand 無法執行時使用），
  // 列出與 sit-to-stand 一致的 cfs2–cfs6 以表意。
  applicableCfs: ['cfs2', 'cfs3', 'cfs4', 'cfs5', 'cfs6'],
  scoring: 'sum',
  inputType: 'option',
  maxScore: 8,
  items: [
    {
      id: 'mob_walk',
      text: '過去一週，您在平地行走是否感到困難？',
      options: [
        { label: '沒有困難', score: 0 },
        { label: '有點困難', score: 1 },
        { label: '明顯困難或無法獨立行走', score: 2 },
      ],
    },
    {
      id: 'mob_chair',
      text: '您從椅子上站起來是否感到困難（未扶手）？',
      options: [
        { label: '沒有困難', score: 0 },
        { label: '需用手撐才能站起', score: 1 },
        { label: '需他人協助才能站起', score: 2 },
      ],
    },
    {
      id: 'mob_stairs',
      text: '您上下一層樓梯是否感到困難？',
      options: [
        { label: '沒有困難', score: 0 },
        { label: '需扶扶手或休息', score: 1 },
        { label: '無法自行上下樓梯', score: 2 },
      ],
    },
    {
      id: 'mob_aid',
      text: '您行走時是否需要使用輔具（拐杖、助行器、輪椅）？',
      options: [
        { label: '不需要', score: 0 },
        { label: '偶爾或室外需要', score: 1 },
        { label: '隨時都需要', score: 2 },
      ],
    },
  ],
  bands: [
    { min: 0, max: 1, severity: 'normal', label: '行動能力大致良好' },
    { min: 2, max: 4, severity: 'monitor', label: '輕度行動困難，建議追蹤與運動介入' },
    { min: 5, max: 8, severity: 'refer', label: '明顯行動困難，建議轉介物理治療或評估' },
  ],
  clinicallyReviewed: false,
};
