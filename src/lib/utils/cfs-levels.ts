export const CFS_LEVELS = [
  'cfs1','cfs2','cfs3','cfs4','cfs5','cfs6','cfs7','cfs8','cfs9',
] as const;
export type CfsLevel = typeof CFS_LEVELS[number];

export const CFS_LABELS: Record<CfsLevel, string> = {
  cfs1: '非常健壯', cfs2: '健壯', cfs3: '大致良好',
  cfs4: '極輕度衰弱', cfs5: '輕度衰弱', cfs6: '中度衰弱',
  cfs7: '重度衰弱', cfs8: '極重度衰弱', cfs9: '末期',
};

/** 臨床判定用的較長描述（暫譯） */
export const CFS_DESCRIPTIONS: Record<CfsLevel, string> = {
  cfs1: '規律運動，為同齡中最健壯者。',
  cfs2: '無活動性疾病症狀，偶爾運動。',
  cfs3: '健康問題控制良好，僅規律散步以外少運動。',
  cfs4: '症狀使活動受限，但尚能獨立（極輕度衰弱）。',
  cfs5: '工具性日常活動需協助（輕度衰弱）。',
  cfs6: '所有戶外活動與部分居家活動需協助（中度衰弱）。',
  cfs7: '個人照護完全依賴，但病情穩定（重度衰弱）。',
  cfs8: '完全依賴，接近生命終點（極重度衰弱）。',
  cfs9: '預期壽命 < 6 個月（末期）。',
};

/** 由 1..9 整數得 CFS 代碼，超界 clamp。 */
export function cfsFromScore(n: number): CfsLevel {
  const i = Math.min(9, Math.max(1, Math.round(n)));
  return (`cfs${i}`) as CfsLevel;
}

/** 月齡（DOB 選填；缺值回 0，供顯示用，呼叫端自行處理 0 的呈現）。 */
export function ageInMonths(birthDate: string | Date | undefined | null): number {
  if (!birthDate) return 0;
  const birth = typeof birthDate === 'string' ? new Date(birthDate) : birthDate;
  if (isNaN(birth.getTime())) return 0;
  const now = new Date();
  const months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
  const dayAdjust = now.getDate() < birth.getDate() ? -1 : 0;
  return Math.max(0, months + dayAdjust);
}
