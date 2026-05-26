import { z } from 'astro/zod';   // = zod v4
import { CFS_LEVELS } from '../utils/cfs-levels';
import { DOMAIN_TREE, DOMAIN_TOPS, DOMAIN_SUBS, isValidDomain } from '../domain/domain-tree';

// 領域樹單一源於 domain-tree；此處 re-export 供消費端沿用既有匯入路徑。
export { DOMAIN_TREE };

// --- 可重用列舉常數（單一源）---
// CDSS 生理指標（Phase 2 不啟用，schema 保留供 Phase 3）。
export const CDSS_INDICATOR_NAMES = [
  'heart_rate', 'spo2', 'respiratory_rate', 'temperature',
  'sleep_quality', 'activity_level', 'sugar_intake',
] as const;

// --- 影片元資料 ---
export const videoCatalogItemSchema = z.object({
  videoId: z.string().regex(/^[A-Za-z0-9_-]{11}$/),
  title: z.string().min(1),
  channel: z.string().min(1),
  channelId: z.string().regex(/^UC[A-Za-z0-9_-]{22}$/),
  duration: z.number().int().positive(),
  publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  language: z.enum(['zh-Hant', 'en']),
  subtitleType: z.enum(['human', 'auto', 'none']),
  sourceTier: z.enum(['official-tw', 'international', 'pro-kol']),
  viewCount: z.number().int().nonnegative(),
  curatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  lastValidatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  verifiedBy: z.enum(['claude-code', 'manual']),
  verificationStatus: z.enum(['verified', 'rejected']),
  score: z.number().min(0).max(1),
  notes: z.string().optional(),
});

// --- Trigger 映射（discriminatedUnion + cross-field refine）---
const DOMAIN_TOP_ENUM = z.enum(DOMAIN_TOPS as [string, ...string[]]);
const DOMAIN_SUB_ENUM = z.enum(DOMAIN_SUBS as [string, ...string[]]);
const CFS_ENUM = z.enum(CFS_LEVELS);
const CDSS_INDICATOR_ENUM = z.enum(CDSS_INDICATOR_NAMES);
const CDSS_LEVEL_ENUM = z.enum(['advisory', 'warning', 'critical']);
const videoIdsField = z.array(z.string().regex(/^[A-Za-z0-9_-]{11}$/)).default([]);

export const cgaTriageEntrySchema = z.object({
  trigger: z.string(),
  category: z.literal('triage'),
  triageCategory: z.enum(['monitor', 'refer']),
  cfsLevel: CFS_ENUM,
  educationSlug: z.string().optional(),
  inapplicable: z.literal(true).optional(),
  videoIds: videoIdsField,
}).refine(
  d => d.trigger === `cga.triage.${d.triageCategory}.${d.cfsLevel}`,
  { message: 'trigger 字串與 triageCategory + cfsLevel 不一致', path: ['trigger'] },
);

export const cgaDomainEntrySchema = z.object({
  trigger: z.string(),
  category: z.literal('domain'),
  top: DOMAIN_TOP_ENUM,
  sub: DOMAIN_SUB_ENUM,
  cfsLevel: CFS_ENUM,
  educationSlug: z.string().optional(),
  inapplicable: z.literal(true).optional(),
  videoIds: videoIdsField,
})
  .refine(
    d => isValidDomain(d.top, d.sub),
    { message: 'top/sub 不是合法的二層領域組合', path: ['sub'] },
  )
  .refine(
    d => d.trigger === `cga.domain.${d.top}.${d.sub}.anomaly.${d.cfsLevel}`,
    { message: 'trigger 字串與 top + sub + cfsLevel 不一致', path: ['trigger'] },
  );

export const cdssVitalSignEntrySchema = z.object({
  trigger: z.string(),
  category: z.literal('vital-sign'),
  indicator: CDSS_INDICATOR_ENUM,
  level: CDSS_LEVEL_ENUM,
  cfsLevel: CFS_ENUM,
  educationSlug: z.string().optional(),
  inapplicable: z.literal(true).optional(),
  videoIds: videoIdsField,
}).refine(
  d => d.trigger === `cga.vital.${d.indicator}.${d.level}.${d.cfsLevel}`,
  { message: 'trigger 字串與 indicator + level + cfsLevel 不一致', path: ['trigger'] },
);

export const triggerEntrySchema = z.discriminatedUnion('category', [
  cgaTriageEntrySchema,
  cgaDomainEntrySchema,
  cdssVitalSignEntrySchema,
]);

// --- Runtime slim shape（reproducible JSON）---
export const runtimeVideoSchema = videoCatalogItemSchema.pick({
  videoId: true,
  title: true,
  channel: true,
  duration: true,
  language: true,
  sourceTier: true,
  score: true,
});

export const runtimeIndexSchema = z.object({
  catalog: z.record(z.string(), runtimeVideoSchema),
  triggers: z.record(z.string(), z.object({
    videoIds: z.array(z.string()),
    inapplicable: z.boolean(),
    educationSlug: z.string().optional(),
  })),
  educationSlugToTriggers: z.record(z.string(), z.array(z.string())),
  recommendations: z.record(z.string(), z.array(z.object({
    source: z.enum(['internal', 'custom', 'external']),
    slug: z.string().optional(),
    customId: z.string().optional(),
    url: z.string().optional(),
    title: z.string().optional(),
    summary: z.string().optional(),
  }))),
  clinicalEducation: z.record(z.string(), z.array(z.string())),
  articleSlugs: z.array(z.string()).optional(),
});

// --- Content-relevance schema（單一源）---
export const SEVERITY_NAMES = ['normal', 'monitor', 'refer'] as const;

// cell / 情境導向：每個 trigger 列該格內容
const articleRefSchema = z.object({
  slug: z.string(),
  // 只有 cdsa.domain 格的文章需要；省略時投影端預設視為 [monitor, refer]
  severities: z.array(z.enum(SEVERITY_NAMES)).optional(),
  browse: z.boolean().optional(),   // true = this is the cell's matrix/browse article (was the old educationSlug)
});

export const triggerRelevanceSchema = z.object({
  trigger: z.string(),
  videoIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{11}$/)).default([]),
  articles: z.array(articleRefSchema).default([]),
});

export const contentRelevanceSchema = z.object({
  // key = `${top}.${sub}`（以 refine 驗合法二層領域組合）；value = 不適用的 CFS 等級。
  inapplicable: z.record(
    z.string().refine(
      k => {
        const [t, s] = k.split('.');
        return isValidDomain(t, s);
      },
      { message: 'inapplicable key 必須是合法的 top.sub 二層領域' },
    ),
    z.array(CFS_ENUM),
  ),
  triggers: z.array(triggerRelevanceSchema),
  clinicalAlertEducation: z.record(z.string(), z.array(z.string())).optional(),
});

export type ContentRelevance = z.infer<typeof contentRelevanceSchema>;
export type TriggerRelevance = z.infer<typeof triggerRelevanceSchema>;

// --- Types ---
export type VideoCatalogItem = z.infer<typeof videoCatalogItemSchema>;
export type TriggerEntry = z.infer<typeof triggerEntrySchema>;
export type RuntimeVideo = z.infer<typeof runtimeVideoSchema>;
export type RuntimeIndex = z.infer<typeof runtimeIndexSchema>;
export type CustomVideo = RuntimeVideo & { triggers: string[] | '*' };
