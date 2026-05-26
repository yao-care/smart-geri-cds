import { z } from 'astro/zod';   // = zod v4
import { AGE_GROUPS_CDSA } from '../utils/age-groups';

// --- 可重用列舉常數（單一源）---
export const CDSA_DOMAIN_NAMES = [
  'behavior', 'gross_motor', 'fine_motor', 'language',
  'cognition', 'language_comprehension', 'language_expression', 'social_emotional',
] as const;
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
const KNOWN_DOMAIN_ENUM = z.enum(CDSA_DOMAIN_NAMES);
const CDSS_INDICATOR_ENUM = z.enum(CDSS_INDICATOR_NAMES);
const CDSS_LEVEL_ENUM = z.enum(['advisory', 'warning', 'critical']);
const CDSS_AGE_ENUM = z.enum(['infant', 'toddler', 'preschool']);
const videoIdsField = z.array(z.string().regex(/^[A-Za-z0-9_-]{11}$/)).default([]);

export const cdsaTriageEntrySchema = z.object({
  trigger: z.string(),
  category: z.literal('triage'),
  triageCategory: z.enum(['monitor', 'refer']),
  ageGroup: z.enum(AGE_GROUPS_CDSA),
  educationSlug: z.string().optional(),
  inapplicable: z.literal(true).optional(),
  videoIds: videoIdsField,
}).refine(
  d => d.trigger === `cdsa.triage.${d.triageCategory}.${d.ageGroup}`,
  { message: 'trigger 字串與 triageCategory + ageGroup 不一致', path: ['trigger'] },
);

export const cdsaDomainEntrySchema = z.object({
  trigger: z.string(),
  category: z.literal('domain'),
  domain: KNOWN_DOMAIN_ENUM,
  ageGroup: z.enum(AGE_GROUPS_CDSA),
  educationSlug: z.string().optional(),
  inapplicable: z.literal(true).optional(),
  videoIds: videoIdsField,
}).refine(
  d => d.trigger === `cdsa.domain.${d.domain}.anomaly.${d.ageGroup}`,
  { message: 'trigger 字串與 domain + ageGroup 不一致', path: ['trigger'] },
);

export const cdssVitalSignEntrySchema = z.object({
  trigger: z.string(),
  category: z.literal('vital-sign'),
  indicator: CDSS_INDICATOR_ENUM,
  level: CDSS_LEVEL_ENUM,
  ageGroup: CDSS_AGE_ENUM,
  educationSlug: z.string().optional(),
  inapplicable: z.literal(true).optional(),
  videoIds: videoIdsField,
}).refine(
  d => d.trigger === `cdss.${d.indicator}.${d.level}.${d.ageGroup}`,
  { message: 'trigger 字串與 indicator + level + ageGroup 不一致', path: ['trigger'] },
);

export const triggerEntrySchema = z.discriminatedUnion('category', [
  cdsaTriageEntrySchema,
  cdsaDomainEntrySchema,
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
  inapplicable: z.record(z.enum(CDSA_DOMAIN_NAMES), z.array(z.enum(AGE_GROUPS_CDSA))),
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
