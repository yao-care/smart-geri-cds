# P0: Project Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete Astro 5 project skeleton with design system, content layer, layouts, page routes, SEO, and CI/CD — so all subsequent phases have a foundation.

**Architecture:** Astro 5 SSG + Svelte 5 islands + CSS Custom Properties (OKLCH) + Content Layer API (Zod) + Dexie.js 4.x IndexedDB + GitHub Pages deployment.

**Tech Stack:** Astro 5, Svelte 5 (runes), TypeScript strict, pnpm, Pagefind, GitHub Actions

---

## Dependency Graph

```
P0-1 (done) ──┬── P0-2 (design tokens) ──┐
              ├── P0-3 (content layer)    ├── P0-6 (layouts + blocks) ── P0-7 (pages) ── P0-8 (SEO/CI)
              ├── P0-4 (IndexedDB)        │
              └── P0-5 (utils)  ──────────┘
```

Wave 1 (parallel): P0-2, P0-3, P0-4, P0-5
Wave 2 (parallel): P0-6 (needs P0-2)
Wave 3 (sequential): P0-7 (needs P0-6)
Wave 4 (parallel): P0-8, P0-9

---

### Task 2: Design System (CSS Tokens + Typography + Global)

**Files:**
- Create: `src/styles/tokens.css`
- Create: `src/styles/typography.css`
- Create: `src/styles/global.css`

**Requirements:**
- OKLCH color tokens with hex fallback via `@supports`
- Risk level tokens: `--color-risk-normal`, `--color-risk-advisory`, `--color-risk-warning`, `--color-risk-critical`
- Risk level L values 0.45-0.55 for WCAG AA contrast on light backgrounds
- Typography: minimum 18px (`--text-xs`), scale from xs to 3xl
- Global: reset, prose styles, container utility
- Light theme: background L 0.90-0.97, text L 0.20-0.60
- Critical level pulse animation keyframe
- A11y: focus ring visible, 44px minimum touch target

---

### Task 3: Content Layer Schemas + Seed Data

**Files:**
- Create: `src/content.config.ts`
- Create: `src/data/rules/geriatric-default.yaml`
- Create: `src/data/baselines/geriatric-baselines.json`
- Create: `src/data/education/diet-control.md`
- Create: `src/data/education/sleep-hygiene.md`
- Create: `src/data/education/respiratory-care.md`
- Create: `src/data/education/exercise-guide.md`
- Create: `src/data/education/milestones/0-6m.md`
- Create: `src/data/education/milestones/6-12m.md`
- Create: `src/data/education/milestones/1-2y.md`
- Create: `src/data/education/milestones/2-3y.md`
- Create: `src/data/education/milestones/3-6y.md`

**Requirements:**

Content Layer schemas must match spec section 4.4 exactly:

**educationCollection:** glob loader, `**/*.md` from `./src/data/education`, schema with title, summary, category (enum: diet/sleep/respiratory/exercise/milestone/general), ageGroup (array of enum infant/toddler/preschool), format (enum: article/video/questionnaire), videoUrl optional, triggerIndicators optional array of strings, publishedAt date, updatedAt optional date, locale default zh-TW.

**rulesCollection:** file loader from `./src/data/rules/geriatric-default.yaml`. Schema: version string, age_groups record of objects per indicator (heart_rate, spo2, respiratory_rate, temperature, sleep_quality, activity_level, sugar_intake) each with normal/advisory/warning as [number, number] tuples. Plus escalation, deduplication, missing_data, multi_indicator, trend config objects per spec.

**baselinesCollection:** file loader from `./src/data/baselines/geriatric-baselines.json`. Schema per spec: 9 keys (infant, infant:male, infant:female, toddler, toddler:male, toddler:female, preschool, preschool:male, preschool:female), each with 7 indicators having mean, std, optional min/max/p25/p75.

**Seed data:**
- Rules YAML: realistic geriatric thresholds for 3 age groups x 7 indicators x 3 levels
- Baselines JSON: realistic geriatric baselines for 9 groups x 7 indicators
- Education MD: each with proper frontmatter matching schema, Chinese content (real geriatric health education)

---

### Task 4: IndexedDB Schema (Dexie.js)

**Files:**
- Create: `src/lib/db/schema.ts`

**Requirements:**
- Implement `CdssDatabase` class extending Dexie exactly per spec section 4.5
- 9 tables: patients, observations, alerts, baselines, syncQueue, serverConfigs, educationInteractions, ruleVersions, webhookHistory
- All TypeScript interfaces as defined in spec
- Compound indexes: `[patientId+indicator]` on observations, `[patientId+status]` on alerts, `[patientId+indicator]` as primary on baselines
- Export singleton `db` instance
- Export all interfaces

---

### Task 5: Utility Libraries

**Files:**
- Create: `src/lib/utils/risk-levels.ts`
- Create: `src/lib/utils/loinc-map.ts`
- Create: `src/lib/utils/date.ts`

**Requirements:**

**risk-levels.ts:**
- Type `RiskLevel = 'normal' | 'advisory' | 'warning' | 'critical'`
- `RISK_LEVELS` ordered array: `['normal', 'advisory', 'warning', 'critical']`
- `riskSeverity(level: RiskLevel): number` — returns 0-3
- `maxRisk(...levels: RiskLevel[]): RiskLevel` — returns highest severity
- `isEscalation(from: RiskLevel, to: RiskLevel): boolean`
- `riskColor(level: RiskLevel): string` — returns CSS variable name

**loinc-map.ts:**
- `LOINC_CODES` map: heart_rate='8867-4', spo2='2708-6', respiratory_rate='9279-1', temperature='8310-5', sleep_quality='93832-4', activity_level='82290-8', sugar_intake='2339-0'
- `indicatorByLoinc(code: string): string | undefined` — reverse lookup
- `loincByIndicator(indicator: string): string | undefined`
- Type `IndicatorName` = union of 7 indicator names

**date.ts:**
- `ageGroup(birthDate: string | Date): 'infant' | 'toddler' | 'preschool'` — <1y infant, 1-3y toddler, 3-6y preschool
- `formatDateTime(date: Date, locale?: string): string` — zh-TW locale format
- `daysBetween(a: Date, b: Date): number`
- `hoursAgo(hours: number): Date`

---

### Task 6: Layouts + Block Components

**Files:**
- Create: `src/layouts/Base.astro`
- Create: `src/layouts/App.astro`
- Create: `src/layouts/Education.astro`
- Create: `src/components/blocks/Header.astro`
- Create: `src/components/blocks/Footer.astro`
- Create: `src/components/blocks/Hero.astro`
- Create: `src/components/blocks/Breadcrumb.astro`

**Requirements:**

**Base.astro:** Accept `title`, `description`, `canonical` props. Include: charset, viewport, canonical link, OG tags, Twitter Card, JSON-LD slot, global CSS imports (tokens.css, typography.css, global.css), skip-to-content link, slot for body.

**App.astro:** Extend Base.astro. Include Header, slot for main content, Footer. Main content area with id="main-content" for skip link.

**Education.astro:** Extend Base.astro. Include Header, sidebar navigation slot, main content area, Footer. Breadcrumb.

**Header.astro:** Site title "CDSS 老年醫學臨床決策輔助系統", nav links (首頁, 儀表板, 預警, 衛教, 設定, 關於), responsive nav (hamburger on mobile). Zero JS — pure CSS responsive nav.

**Footer.astro:** Copyright, version, link to GitHub repo, "Powered by SMART on FHIR" badge.

**Hero.astro:** Accept `title`, `subtitle`, `ctaText`, `ctaHref` props. Landing page hero section.

**Breadcrumb.astro:** Accept `items: {label: string, href?: string}[]` prop. ARIA breadcrumb semantics. JSON-LD BreadcrumbList.

---

### Task 7: All Page Routes (Shells)

**Files:**
- Create/Modify: `src/pages/index.astro` (replace placeholder)
- Create: `src/pages/launch.astro`
- Create: `src/pages/dashboard.astro`
- Create: `src/pages/patient.astro`
- Create: `src/pages/alerts.astro`
- Create: `src/pages/education/index.astro`
- Create: `src/pages/education/[...slug].astro`
- Create: `src/pages/settings.astro`
- Create: `src/pages/about.astro`
- Create: `src/pages/report.astro`

**Requirements:**
- Each page uses App.astro layout (education pages use Education.astro)
- Each page has appropriate `title` and `description`
- index.astro: Hero + product intro + launch entry points
- launch.astro: SMART on FHIR launch page shell (Svelte island placeholder `<div id="launch-app">`)
- dashboard.astro: Shell with placeholders for PatientList, RiskSummary, AlertFeed Svelte islands
- patient.astro: Shell with placeholders for TrendChart, AlertTimeline, BaselineCard
- alerts.astro: Shell with placeholders for AlertFilter, AlertCard list
- education/index.astro: List all education content from collection, with Pagefind search UI
- education/[...slug].astro: Render education content from collection with ContentViewer placeholder
- settings.astro: Shell with tabs for FHIR, Rules, Webhook, Notifications, Model
- about.astro: Usage guide, FAQPage JSON-LD
- report.astro: Shell for PDF report preview + download

---

### Task 8: SEO + CI/CD + Pagefind + llms.txt

**Files:**
- Create: `.github/workflows/deploy.yml`
- Create: `public/llms.txt`
- Create: `public/llms-full.txt`
- Create: `pagefind.yml`
- Modify: `astro.config.mjs` (if needed for RSS)

**Requirements:**
- deploy.yml: exact match to spec section 6 GitHub Actions workflow
- llms.txt: brief system description for LLMs
- llms-full.txt: comprehensive system description
- pagefind.yml: configure Chinese language support
- RSS feed for education content (use @astrojs/rss if needed)

---

### Task 9: CLAUDE.md + Project Memory

**Files:**
- Create: `CLAUDE.md`
- Create/Update: memory files

**Requirements:**
- CLAUDE.md: project-specific dev rules, tech stack, coding conventions, testing guidelines
- Memory: save project structure and key decisions
