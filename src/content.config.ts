import { defineCollection, z } from 'astro:content';
import { glob, file } from 'astro/loaders';
import { CFS_LEVELS } from './lib/utils/cfs-levels';
import { DOMAIN_TOPS, DOMAIN_SUBS, isValidDomain } from './lib/domain/domain-tree';

// ---------- tuple helper ----------
const rangeTuple = z.tuple([z.number(), z.number()]);

const thresholdSchema = z.object({
  normal: rangeTuple,
  advisory: rangeTuple,
  warning: rangeTuple,
});

const indicatorSetSchema = z.object({
  heart_rate: thresholdSchema,
  spo2: thresholdSchema,
  respiratory_rate: thresholdSchema,
  temperature: thresholdSchema,
  sleep_quality: thresholdSchema,
  activity_level: thresholdSchema,
  sugar_intake: thresholdSchema,
});

// ---------- rules collection (file loader, object‑keyed) ----------
// YAML is structured as an object whose top-level keys become entry IDs.
// We store a single key "default" that holds the full rule set.
const rulesCollection = defineCollection({
  loader: file('./src/data/rules/pediatric-default.yaml'),
  schema: z.object({
    version: z.string(),
    age_groups: z.object({
      infant: indicatorSetSchema,
      toddler: indicatorSetSchema,
      preschool: indicatorSetSchema,
    }),
    escalation: z.object({
      advisory_to_warning_hours: z.number(),
      warning_to_critical_hours: z.number(),
    }),
    deduplication: z.object({
      window_minutes: z.number(),
    }),
    missing_data: z.object({
      alert_after_hours: z.number(),
    }),
    multi_indicator: z.object({
      advisory_count_for_warning: z.number(),
    }),
    trend: z.object({
      consecutive_days_for_escalation: z.number(),
    }),
  }),
});

// ---------- baselines collection (file loader, object‑keyed) ----------
const baselineIndicatorSchema = z.object({
  mean: z.number(),
  std: z.number(),
  min: z.number().optional(),
  max: z.number().optional(),
  p25: z.number().optional(),
  p75: z.number().optional(),
});

const baselineEntrySchema = z.object({
  heart_rate: baselineIndicatorSchema,
  spo2: baselineIndicatorSchema,
  respiratory_rate: baselineIndicatorSchema,
  temperature: baselineIndicatorSchema,
  sleep_quality: baselineIndicatorSchema,
  activity_level: baselineIndicatorSchema,
  sugar_intake: baselineIndicatorSchema,
});

const baselinesCollection = defineCollection({
  loader: file('./src/data/baselines/pediatric-baselines.json'),
  schema: baselineEntrySchema,
});

// ---------- education collection (glob loader, markdown) ----------
// Education markdown 為「純文章衛教」的單一來源。
// 影片資料（含 videoUrl / channel / trigger 對應）全部走 src/data/video-catalog/*.yaml
// 與 src/data/education/content-relevance.yaml — schema 已禁止 markdown 再帶 video 欄位
// 與 format='video'，防止雙資料來源死灰復燃。
const educationCollection = defineCollection({
  loader: glob({ pattern: ['**/*.md', '!**/README.md'], base: './src/data/education' }),
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    category: z.enum([
      'diet', 'sleep', 'respiratory', 'exercise',
      'milestone', 'general',
    ]),
    ageGroup: z.array(
      z.enum(['infant', 'toddler', 'preschool']),
    ),
    format: z.literal('article'),  // 移除 'video' / 'questionnaire' — 影片走 yaml catalog；CDSA 評估問卷在 /（不在衛教頁）
    // videoUrl / triggerIndicators 刻意不在 schema 中；任何 markdown 帶這兩個欄位
    // 將被 Astro Content Layer 視為 strict-mode 警告並被忽略。Build 不會 fail
    // 但 schema test 會抓到（見 tests/data/education-no-video-fields.test.ts）。
    publishedAt: z.date(),
    updatedAt: z.date().optional(),
    locale: z.string().default('zh-TW'),
  }),
});

// ---------- cards collection (file loader, array JSON) ----------
// Array JSON: each element is an entry with required `id` field.
// Schema describes a single card (not the array).
const cardsCollection = defineCollection({
  loader: file('./src/data/cards/index.json'),
  schema: z.object({
    domain: z.enum([
      'gross_motor', 'fine_motor', 'language_comp',
      'language_expr', 'cognition', 'social_emotional',
    ]),
    filename: z.string(),
    description: z.string(),
    ageGroups: z.array(z.string()).optional(),
    source: z.enum(['storyset', 'undraw', 'pexels', 'openverse', 'manual']),
    sourceUrl: z.string().url(),
    attribution: z.string().optional(),
    license: z.enum(['CC0', 'CC-BY', 'Pexels', 'MIT', 'custom']),
    reviewStatus: z.enum(['pending', 'approved', 'rejected']),
    reviewedAt: z.string().optional(),
  }),
});

// ---------- scales collection (glob loader, YAML) ----------
// Mirrors ScaleDef in src/lib/scales/scale.ts. Each YAML file is one validated
// CGA scale (GDS-15, SPMSQ, …). Cross-field refine guards top/sub legality.
const scaleBandSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  severity: z.enum(['normal', 'monitor', 'refer']),
  label: z.string(),
});

const scaleItemSchema = z.object({
  id: z.string(),
  text: z.string().optional(),
  prompt: z.string().optional(),
  mode: z.enum(['ask-patient', 'observe', 'ask-informant', 'measure']).optional(),
  subquestions: z.array(z.string()).optional(),
  options: z.array(z.object({ label: z.string(), score: z.number() })),
  redFlag: z.literal('self-harm').optional(),
});

const scalesCollection = defineCollection({
  loader: glob({ pattern: ['**/*.yaml', '!**/README.md'], base: './src/data/scales' }),
  schema: z.object({
    id: z.string(),
    domain: z.object({
      top: z.enum(DOMAIN_TOPS as [string, ...string[]]),
      sub: z.enum(DOMAIN_SUBS as [string, ...string[]]),
    }).refine(d => isValidDomain(d.top, d.sub), {
      message: 'domain.top/domain.sub 不是合法的二層域組合',
    }),
    /** Default 'screen' so existing YAMLs (which lack `tier`) still parse. */
    tier: z.enum(['screen', 'full']).default('screen'),
    expandsTo: z.string().optional(),
    applicableCfs: z.array(z.enum(CFS_LEVELS)),
    scoring: z.enum(['sum', 'weighted', 'error-count', 'measured-value', 'timed-task']),
    inputType: z.enum(['option', 'numeric', 'timed-task']),
    requiresPatient: z.boolean().optional(),
    requiresInformant: z.boolean().optional(),
    maxScore: z.number(),
    items: z.array(scaleItemSchema),
    bands: z.array(scaleBandSchema),
    clinicallyReviewed: z.boolean(),
  }),
});

// ---------- export ----------
export const collections = {
  rules: rulesCollection,
  baselines: baselinesCollection,
  education: educationCollection,
  cards: cardsCollection,
  scales: scalesCollection,
};
