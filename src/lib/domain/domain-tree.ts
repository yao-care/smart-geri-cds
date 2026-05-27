export const DOMAIN_TREE = {
  physical: ['comorbidity','polypharmacy','nutrition','continence','sensory','pain'],
  psychological: ['cognition','mood','delirium'],
  functional: ['adl','iadl','mobility','falls'],
  social: ['social_support','caregiver','financial'],
  environmental: ['home_safety','accessibility'],
  future_wishes: ['advance_care_planning','treatment_preferences'],
} as const;

export type DomainTop = keyof typeof DOMAIN_TREE;
export type DomainSub = typeof DOMAIN_TREE[DomainTop][number];
export const DOMAIN_TOPS = Object.keys(DOMAIN_TREE) as DomainTop[];
export const DOMAIN_SUBS = DOMAIN_TOPS.flatMap(t => DOMAIN_TREE[t]) as DomainSub[];

export function isValidDomain(top: string, sub: string): top is DomainTop {
  return top in DOMAIN_TREE && (DOMAIN_TREE[top as DomainTop] as readonly string[]).includes(sub);
}

export const DOMAIN_TOP_LABELS: Record<DomainTop, string> = {
  physical: '生理/醫療', psychological: '心理/精神', functional: '功能',
  social: '社會', environmental: '環境', future_wishes: '預立醫療',
};
const SUB_LABELS: Record<string, string> = {
  comorbidity:'多重共病', polypharmacy:'多重用藥', nutrition:'營養', continence:'失禁', sensory:'感官(視/聽)', pain:'疼痛',
  cognition:'認知', mood:'情緒', delirium:'譫妄',
  adl:'基本日常', iadl:'工具性日常', mobility:'行動步態', falls:'平衡跌倒',
  social_support:'社會支持', caregiver:'照顧者負荷', financial:'經濟',
  home_safety:'居家安全', accessibility:'可及性/輔具',
  advance_care_planning:'預立照護諮商', treatment_preferences:'治療偏好',
};
export function domainLabel(top: string, sub: string): string {
  return SUB_LABELS[sub] ?? `${top}.${sub}`;
}
export function domainKey(top: string, sub: string): string { return `${top}.${sub}`; }
