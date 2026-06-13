import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { CFS_LEVELS } from './lib/utils/cfs-levels';
import { DOMAIN_TOPS, DOMAIN_SUBS, isValidDomain } from './lib/domain/domain-tree';

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
    category: z.enum(['general']),
    format: z.literal('article'),  // 移除 'video' / 'questionnaire' — 影片走 yaml catalog；CGA 評估問卷在 /assess/（不在衛教頁）
    // videoUrl / triggerIndicators 刻意不在 schema 中；任何 markdown 帶這兩個欄位
    // 將被 Astro Content Layer 視為 strict-mode 警告並被忽略。Build 不會 fail
    // 但 schema test 會抓到（見 tests/data/education-no-video-fields.test.ts）。
    publishedAt: z.date(),
    updatedAt: z.date().optional(),
    locale: z.string().default('zh-TW'),
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
  mode: z.enum(['patient', 'observe', 'ask-either', 'ask-informant', 'measure']).optional(),
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
    tier: z.enum(['triage', 'screen', 'full']).default('screen'),
    alwaysRun: z.boolean().optional(),
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

// ---------- self-check collection (glob loader, YAML) ----------
// 民眾自評層題庫。獨立於 scales（專業層）：無 CFS/mode/tier/expandsTo。
// 題目取材自既有 triage 代表題，全 clinicallyReviewed:true（自我檢視非診斷）。
const selfCheckItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  options: z.array(z.object({ label: z.string(), score: z.number() })),
  redFlag: z.literal('self-harm').optional(),
});

const selfCheckBandSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  light: z.enum(['green', 'amber']),
  advice: z.string(),
});

const selfChecksCollection = defineCollection({
  loader: glob({ pattern: ['**/*.yaml', '!**/README.md'], base: './src/data/self-check' }),
  schema: z.object({
    id: z.string(),
    domain: z.object({
      top: z.enum(DOMAIN_TOPS as [string, ...string[]]),
      sub: z.enum(DOMAIN_SUBS as [string, ...string[]]),
    }).refine(d => isValidDomain(d.top, d.sub), {
      message: 'domain.top/domain.sub 不是合法的二層域組合',
    }),
    category: z.enum(['scored', 'awareness']),
    maxScore: z.number(),
    items: z.array(selfCheckItemSchema),
    bands: z.array(selfCheckBandSchema),
    clinicallyReviewed: z.boolean(),
  }),
});

// ---------- export ----------
export const collections = {
  education: educationCollection,
  scales: scalesCollection,
  selfChecks: selfChecksCollection,
};
