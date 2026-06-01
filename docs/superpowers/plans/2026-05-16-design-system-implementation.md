# Design System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current ~30-token namespaced CSS design system (with 9 known semantic misuses) with a minimal 7-color-token system plus typography tokens, where derived values come from `color-mix()` at the consumption site, and where 8 vitest tests enforce the rules at CI.

**Architecture:** Two-layer token system — 7 immutable color tokens + 14 typography tokens at the root; everything else (hover, soft bg, muted text, focus ring, badge bg) is derived via `color-mix()` inline. A 19-pattern CSS library defines what every component CSS may compose from. 8 vitest tests parse component `<style>` blocks via `postcss` AST and inline `style=` attributes via regex to block hex literals, rgb/rgba, hardcoded font-size, numeric font-weight, alert tokens in selection state contexts, and unauthorized new tokens.

**Tech Stack:** Astro 5 SSG + Svelte 5 + Vite 7 + Vitest 4. New: `postcss` promoted to explicit devDependency.

**Spec:** `docs/superpowers/specs/2026-05-16-design-system-spec.md` (approved after 5 rounds of independent Opus review).

---

## File Structure

**Files to rewrite:**
- `src/styles/tokens.css` — collapse from 25+ tokens to 7 color + 14 typography + existing spacing/radius/shadow
- `src/styles/global.css` — `:focus-visible` to spec pattern #12, `.prose a` to pattern #17, `.risk-*` utility classes to alert pattern #10

**Files to create:**
- `tests/design-system.test.ts` — 8 vitest enforcement tests
- `docs/superpowers/design-system.md` — one-page summary linking back to the spec

**Files to sweep mechanically:** 69 `.svelte` / `.astro` files referencing old `--color-*`, `--bg-*`, `--border-*`, `--state-*` tokens. List in Task 6.

**Files for hand-edit (9 audit findings + 4 dynamic interpolations + cleanups):** see Tasks 13-19.

**Files unchanged:**
- `src/styles/typography.css` (already matches spec)
- All TypeScript / Svelte logic / engine / FHIR / IndexedDB
- PDF jsPDF colors / Mermaid diagrams / Dark-mode tokens

---

## Migration approach summary (for context)

Token sweep is split into single-line mechanical renames (sed-safe) and multi-line `color-mix` replacements (per-file judgment). Audit findings get hand-mapped to specific pattern bindings. Dynamic `var(--color-risk-{level})` template interpolation needs script-side `LEVEL_TO_COLOR` lookup maps in 4 files. SVG `var(--token, #hex)` fallbacks lose the hex fallback (browsers targeted all support CSS vars in SVG).

---

## Task 1: Add `postcss` as explicit devDependency

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install postcss as devDependency**

Run:
```bash
cd /Users/lightman/yao.care/smart-geri-cds
pnpm add -D postcss
```

Expected: postcss is added to `devDependencies` in `package.json` and `pnpm-lock.yaml`. Existing version (transitively available via Vite) gets promoted to direct dep.

- [ ] **Step 2: Verify install**

Run:
```bash
pnpm list postcss | head -5
```

Expected: shows `postcss <version>` directly under the project (not just nested under vite).

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(deps): promote postcss to explicit devDependency for design-system tests"
```

---

## Task 2: Write the enforcement test suite (will fail against current tokens.css)

**Files:**
- Create: `tests/design-system.test.ts`

- [ ] **Step 1: Create the test file**

Create `tests/design-system.test.ts` with exactly this content:

```ts
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import postcss, { type Rule } from 'postcss';

// Vitest's import.meta.glob is project-root-relative. Modern Vite 5+ syntax
// uses { query: '?raw', import: 'default' } in place of the deprecated 'as: raw'.
const componentFiles = import.meta.glob('/src/**/*.{svelte,astro}', {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

// Normalize keys: vite may return either '/src/...' (root-relative) or absolute.
// Strip CWD if present so subsequent ALLOWLIST comparisons are predictable.
const CWD = process.cwd();
const COMPONENTS: Array<{ path: string; source: string }> = Object.entries(componentFiles)
  .map(([k, source]) => ({
    path: k.startsWith(CWD) ? k.slice(CWD.length) : k,
    source,
  }))
  .filter(({ path }) => !path.startsWith('/src/styles/'));

function styleBlock(content: string): string {
  return Array.from(
    content.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g),
    m => m[1]
  ).join('\n');
}

// Astro permits both style="..." and style={expr}; capture both.
function inlineStyles(content: string): string {
  return Array.from(
    content.matchAll(/\sstyle=(?:"([^"]*)"|\{([^}]*)\})/g),
    m => (m[1] ?? m[2] ?? '')
  ).join('\n');
}

// Skip a postcss node if its preceding comment node carries the allow marker.
function isAllowed(node: postcss.Node): boolean {
  const prev = node.prev();
  return prev?.type === 'comment'
    && /design-system-allow:/.test(prev.text);
}

// Build the full selector chain (parent > child) so native CSS nesting is
// understood. `.tab` nested with `&.active` produces `.tab.active`.
function fullSelector(rule: Rule): string {
  const chain: string[] = [];
  let node: postcss.Container | undefined = rule;
  while (node && 'selector' in node) {
    chain.unshift((node as Rule).selector);
    node = node.parent;
  }
  return chain.join(' ').replace(/\s*&/g, '');
}

function parseStyle(css: string): postcss.Root {
  return postcss.parse(css);
}

describe('design system enforcement', () => {

  it('1. no hex color in <style> blocks (CSS-aware, ignores comments)', () => {
    const offenders: string[] = [];
    for (const { path, source } of COMPONENTS) {
      const css = styleBlock(source);
      if (!css) continue;
      const root = parseStyle(css);
      root.walkDecls(decl => {
        if (isAllowed(decl)) return;
        const hex = decl.value.match(/#[0-9a-fA-F]{3,8}\b/g);
        if (hex) offenders.push(`${path}: ${decl.prop}: ${decl.value}`);
      });
    }
    expect(offenders, 'Use tokens or color-mix, not hex literals').toEqual([]);
  });

  it('2. no rgb() / rgba() in <style> blocks', () => {
    const offenders: string[] = [];
    for (const { path, source } of COMPONENTS) {
      const css = styleBlock(source);
      if (!css) continue;
      parseStyle(css).walkDecls(decl => {
        if (isAllowed(decl)) return;
        if (/\brgba?\(/.test(decl.value)) {
          offenders.push(`${path}: ${decl.prop}: ${decl.value}`);
        }
      });
    }
    expect(offenders, 'Use oklch() or color-mix() instead of rgb/rgba').toEqual([]);
  });

  it('3. no hardcoded font-size px / rem', () => {
    const offenders: string[] = [];
    for (const { path, source } of COMPONENTS) {
      const css = styleBlock(source);
      if (!css) continue;
      parseStyle(css).walkDecls('font-size', decl => {
        if (isAllowed(decl)) return;
        if (/\d+px|\d*\.?\d+rem/.test(decl.value)) {
          offenders.push(`${path}: ${decl.value}`);
        }
      });
    }
    expect(offenders, 'Use var(--text-*) tokens').toEqual([]);
  });

  it('4. --warn / --danger forbidden in selected/active/is-current rules (CSS-nesting aware)', () => {
    // walkRules descends into nested rules; outer non-state rules harmlessly
    // re-visit the same decls (false-positives prevented by the selector regex).
    // Note: catches state classes only — `.tab.active` matches `.active`. Tabs
    // use `--accent`, not `--warn`/`--danger`, so they pass. Legitimate tab
    // styling that needed `--danger` (e.g. an "errors" tab) would need an
    // explicit `design-system-allow:` comment, by design.
    const offenders: string[] = [];
    for (const { path, source } of COMPONENTS) {
      const css = styleBlock(source);
      if (!css) continue;
      parseStyle(css).walkRules(rule => {
        const sel = fullSelector(rule);
        // Explicit state classes only — :hover is reviewer-governed.
        if (!/\.(selected|active|is-current|chosen)\b/.test(sel)) return;
        rule.walkDecls(decl => {
          if (isAllowed(decl)) return;
          if (/var\(--(warn|danger)(?![\w-])/.test(decl.value)) {
            offenders.push(`${path}: ${sel} { ${decl.prop}: ${decl.value} }`);
          }
        });
      });
    }
    expect(offenders,
      '--warn / --danger are alert semantics. Use color-mix(var(--accent), ...) for state classes.'
    ).toEqual([]);
  });

  it('5. tokens.css color set is exactly the approved 7 (hex AND OKLCH blocks parity)', async () => {
    const css = await readFile('src/styles/tokens.css', 'utf8');

    const TYPOGRAPHY = new Set([
      '--text-caption','--text-xs','--text-sm','--text-base','--text-lg',
      '--text-xl','--text-2xl','--text-3xl','--text-display',
      '--lh-caption','--lh-xs','--lh-sm','--lh-base','--lh-lg','--lh-xl',
      '--lh-2xl','--lh-3xl','--lh-display',
      '--font-sans','--font-mono','--font-normal','--font-medium','--font-bold',
    ]);
    const isStructural = (t: string) => /^--(space|radius|shadow)(-|$)/.test(t);
    // Guard: only custom properties (--prefix). Standard CSS properties like
    // `accent-color` would otherwise be misclassified as tokens.
    const isColor = (t: string) => t.startsWith('--') && !TYPOGRAPHY.has(t) && !isStructural(t);
    const APPROVED = new Set(['--bg','--surface','--text','--line','--accent','--warn','--danger']);

    const root = postcss.parse(css);
    let hexColors: Set<string> | null = null;
    let oklchColors: Set<string> | null = null;

    root.walkRules(':root', rule => {
      const tokens = new Set(
        rule.nodes
          .filter((n): n is postcss.Declaration => n.type === 'decl')
          .map(d => d.prop)
          .filter(isColor)
      );
      // Outer :root = hex; inside @supports = oklch
      if (rule.parent?.type === 'root') hexColors = tokens;
      else oklchColors = tokens;
    });

    expect(hexColors, 'hex :root block found').not.toBeNull();
    expect(oklchColors, 'OKLCH :root block inside @supports found').not.toBeNull();

    const hex = [...(hexColors ?? new Set<string>())];
    const oklch = [...(oklchColors ?? new Set<string>())];

    const hexExtras = hex.filter(t => !APPROVED.has(t));
    const hexMissing = [...APPROVED].filter(t => !hex.includes(t));
    const oklchExtras = oklch.filter(t => !APPROVED.has(t));
    const oklchMissing = [...APPROVED].filter(t => !oklch.includes(t));

    expect({ hexExtras, hexMissing, oklchExtras, oklchMissing },
      'Color token set is locked at 7. Both hex fallback and OKLCH blocks must define exactly the approved set. Modifying requires spec amendment + this test update.'
    ).toEqual({ hexExtras: [], hexMissing: [], oklchExtras: [], oklchMissing: [] });
  });

  it('6. no hex / rgba in inline style="..." or style={...} attributes', () => {
    const offenders: string[] = [];
    for (const { path, source } of COMPONENTS) {
      const inline = inlineStyles(source);
      for (const segment of inline.split(/[;\n]/)) {
        if (/design-system-allow:/.test(segment)) continue;
        if (/#[0-9a-fA-F]{3,8}\b/.test(segment) || /\brgba?\(/.test(segment)) {
          offenders.push(`${path}: ${segment.trim()}`);
        }
      }
    }
    expect(offenders, 'Inline style attributes must reference tokens, not hex/rgba.').toEqual([]);
  });

  it('7. no numeric font-weight in <style> blocks', () => {
    const offenders: string[] = [];
    for (const { path, source } of COMPONENTS) {
      const css = styleBlock(source);
      if (!css) continue;
      parseStyle(css).walkDecls('font-weight', decl => {
        if (isAllowed(decl)) return;
        if (/^\d+$/.test(decl.value.trim())) {
          offenders.push(`${path}: ${decl.value}`);
        }
      });
    }
    expect(offenders, 'Use var(--font-normal|medium|bold)').toEqual([]);
  });

  it('8. no JS hex palettes leak through inline style interpolation (allow-list-only)', async () => {
    // SERIES_COLORS in AssessmentHistory.svelte is a chart palette — explicitly
    // allowed once. Any new file with a JS hex literal must add itself to the
    // allowlist here, forcing an explicit review.
    const ALLOWLIST = new Set([
      // Chart series palette — must be literal hex; resolved via inline style
      // interpolation. Cannot use CSS vars in JS array.
      '/src/components/assess/AssessmentHistory.svelte',
      // <meta name="theme-color"> requires literal hex; HTML meta attributes
      // do not resolve CSS variables. Sync with --accent hex manually.
      '/src/layouts/Base.astro',
      // Canvas 2D API (ctx.fillStyle / ctx.strokeStyle) requires string
      // literals. Refactor to getComputedStyle resolution is dark-mode work,
      // out of v1 scope.
      '/src/components/assess/GameModule.svelte',
      '/src/components/assess/DrawingModule.svelte',
    ]);
    const offenders: string[] = [];
    for (const { path, source } of COMPONENTS) {
      if (ALLOWLIST.has(path)) continue;
      const content = source;
      // Strip <style> blocks and inline styles — those have their own tests.
      const cleaned = content
        .replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
        .replace(/\sstyle=(?:"[^"]*"|\{[^}]*\})/g, '');
      const hex = cleaned.match(/#[0-9a-fA-F]{3,8}\b/g);
      if (hex) offenders.push(`${path}: ${hex.join(', ')}`);
    }
    expect(offenders,
      'JS-level hex literals must be added to the explicit ALLOWLIST in this test file with reviewer approval.'
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the new test suite — expect failures**

Run:
```bash
pnpm vitest run tests/design-system.test.ts
```

Expected: **Multiple test failures.** Test 5 will fail because current `tokens.css` declares `--color-accent`, `--bg-base`, `--border-default` etc. — none in the APPROVED set. Tests 1–4, 6, 7, 8 may pass at this stage (current codebase has been swept of hex once already), or fail individually depending on residual hex. Record the exact failure list — Task 3 fixes Test 5; the rest are addressed by Tasks 6–19.

- [ ] **Step 3: Commit**

```bash
git add tests/design-system.test.ts
git commit -m "test(design-system): add 8 enforcement tests (postcss-AST + inline-style regex)"
```

---

## Task 3: Rewrite `src/styles/tokens.css` to the spec appendix

**Files:**
- Rewrite: `src/styles/tokens.css`

- [ ] **Step 1: Replace tokens.css contents**

Replace the entire file with:

```css
/* ==========================================================================
   Design Tokens — Smart Pedi CDSS
   7 source-of-truth color tokens. Derived values via color-mix() at site.
   See: docs/superpowers/specs/2026-05-16-design-system-spec.md
   ========================================================================== */

:root {
  /* Color (7) — hex fallback */
  --bg:       #fbf8f2;
  --surface:  #f5efe5;
  --text:     #33291d;
  --line:     #c8b896;
  --accent:   #3d6b54;
  --warn:     #945a10;
  --danger:   #b62b1f;

  /* Native form-control accent (Pattern #18) — merged into main :root
     so Test 5 sees a single canonical hex block. */
  accent-color: var(--accent);

  /* Spacing (existing — out of scope of color rework) */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px;  --space-3-5: 14px;
  --space-4: 16px; --space-5: 20px; --space-6: 24px;  --space-7: 32px;
  --space-8: 40px; --space-9: 48px; --space-10: 64px; --space-11: 80px;
  --space-12: 96px;

  /* Radius (existing) */
  --radius-xs: 2px; --radius-sm: 4px; --radius-md: 8px;
  --radius-lg: 12px; --radius-xl: 16px; --radius-full: 9999px;

  /* Shadow (existing — warm shadows on text alpha) */
  --shadow-sm: 0 1px 2px rgba(51, 41, 29, 0.05), 0 1px 3px rgba(51, 41, 29, 0.08);
  --shadow-md: 0 2px 4px rgba(51, 41, 29, 0.06), 0 4px 8px rgba(51, 41, 29, 0.10);
  --shadow-lg: 0 4px 8px rgba(51, 41, 29, 0.08), 0 12px 24px rgba(51, 41, 29, 0.12);
  --shadow-xl: 0 8px 16px rgba(51, 41, 29, 0.10), 0 24px 48px rgba(51, 41, 29, 0.18);
}

@supports (color: oklch(0 0 0)) {
  :root {
    --bg:       oklch(0.985 0.006 85);
    --surface:  oklch(0.965 0.008 75);
    --text:     oklch(0.22  0.015 60);
    --line:     oklch(0.78  0.020 65);
    --accent:   oklch(0.48  0.08  155);
    --warn:     oklch(0.48  0.14  65);
    --danger:   oklch(0.48  0.20  25);

    /* Shadow OKLCH */
    --shadow-sm: 0 1px 2px oklch(0.22 0.015 60 / 0.05), 0 1px 3px oklch(0.22 0.015 60 / 0.08);
    --shadow-md: 0 2px 4px oklch(0.22 0.015 60 / 0.06), 0 4px 8px oklch(0.22 0.015 60 / 0.10);
    --shadow-lg: 0 4px 8px oklch(0.22 0.015 60 / 0.08), 0 12px 24px oklch(0.22 0.015 60 / 0.12);
    --shadow-xl: 0 8px 16px oklch(0.22 0.015 60 / 0.10), 0 24px 48px oklch(0.22 0.015 60 / 0.18);
  }
}

@keyframes pulse-critical {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.6; }
}
```

- [ ] **Step 2: Run Test 5 only — should now pass**

Run:
```bash
pnpm vitest run tests/design-system.test.ts -t "tokens.css color set"
```

Expected: PASS — both hex and OKLCH blocks declare exactly the 7 approved tokens.

- [ ] **Step 3: Run `pnpm check` — expect many errors (components still reference old tokens)**

Run:
```bash
pnpm check 2>&1 | head -40
```

Expected: errors (or none — TS doesn't check CSS), but `pnpm dev` would visually break because components still reference `--color-accent` etc. that no longer exist. This is intentional — fixed in Tasks 6–19.

- [ ] **Step 4: Commit**

```bash
git add src/styles/tokens.css
git commit -m "feat(design-system): collapse tokens.css to 7 source-of-truth colors"
```

---

## Task 4: Rewrite `src/styles/global.css` for new tokens + patterns #12 + #17 + #10

**Files:**
- Rewrite: `src/styles/global.css`

- [ ] **Step 1: Update global.css**

Replace contents with:

```css
/* ==========================================================================
   Global Styles — Smart Pedi CDSS
   Reset, prose, container utilities, accessibility helpers.
   ========================================================================== */

@import './tokens.css';
@import './typography.css';

/* ---------- Reset ---------- */

*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html {
  scroll-behavior: smooth;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-text-size-adjust: 100%;
}

body {
  background-color: var(--bg);
  color: var(--text);
  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: var(--lh-base);
  min-height: 100dvh;
}

img,
picture,
video,
canvas,
svg {
  display: block;
  max-width: 100%;
}

input,
button,
textarea,
select {
  font: inherit;
  color: inherit;
}

/* ---------- Focus ring — spec Pattern #12 ---------- */

:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--accent) 65%, transparent);
  outline-offset: 2px;
}

/* ---------- Skip to content link ---------- */

.skip-to-content {
  position: absolute;
  left: -9999px;
  top: var(--space-2);
  z-index: 9999;
  padding: var(--space-2) var(--space-4);
  background: var(--accent);
  color: white;
  font-weight: var(--font-bold);
  font-size: var(--text-sm);
  border-radius: var(--radius-md);
  text-decoration: none;
}

.skip-to-content:focus {
  left: var(--space-2);
}

/* ---------- Container ---------- */

.container {
  width: 100%;
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 var(--space-4);
}

/* ---------- Prose ---------- */

.prose {
  max-width: 72ch;
}

.prose p + p {
  margin-top: var(--space-4);
}

.prose ul,
.prose ol {
  margin-top: var(--space-3);
  margin-bottom: var(--space-3);
  padding-left: var(--space-6);
}

.prose ul {
  list-style-type: disc;
}

.prose ol {
  list-style-type: decimal;
}

.prose li + li {
  margin-top: var(--space-2);
}

.prose h1,
.prose h2,
.prose h3,
.prose h4,
.prose h5,
.prose h6 {
  margin-top: var(--space-8);
  margin-bottom: var(--space-4);
}

.prose h1:first-child,
.prose h2:first-child,
.prose h3:first-child {
  margin-top: 0;
}

/* Link — spec Pattern #17 */
.prose a {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.prose a:hover {
  color: color-mix(in srgb, var(--accent) 85%, black);
}

.prose a:visited {
  color: color-mix(in srgb, var(--accent), var(--text) 40%);
}

.prose blockquote {
  border-left: 3px solid color-mix(in srgb, var(--line), var(--text) 33%);
  padding-left: var(--space-4);
  color: color-mix(in srgb, var(--text), var(--bg) 30%);
  font-style: italic;
}

.prose code {
  font-family: var(--font-mono);
  font-size: 0.9em;
  background: color-mix(in srgb, var(--bg), var(--text) 5%);
  padding: 0.15em 0.35em;
  border-radius: var(--radius-sm);
}

.prose pre {
  background: color-mix(in srgb, var(--bg), var(--text) 5%);
  padding: var(--space-4);
  border-radius: var(--radius-md);
  overflow-x: auto;
}

.prose pre code {
  background: none;
  padding: 0;
}

/* ---------- Minimum touch target ---------- */

button,
a,
[role='button'] {
  min-height: 44px;
  min-width: 44px;
}

/* ---------- Utility: screen-reader only ---------- */

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

/* ---------- Utility: risk-level classes — spec Pattern #10 ---------- */

.risk-normal {
  background: color-mix(in srgb, var(--accent) 12%, var(--bg));
  color: var(--accent);
}

.risk-advisory,
.risk-warning {
  background: color-mix(in srgb, var(--warn) 12%, var(--bg));
  color: var(--warn);
}

.risk-critical {
  background: color-mix(in srgb, var(--danger) 14%, var(--bg));
  color: var(--danger);
}

/* ---------- Utility: pulse animation ---------- */

.pulse-critical {
  animation: pulse-critical 1.5s ease-in-out infinite;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/styles/global.css
git commit -m "feat(design-system): global.css to new tokens + patterns #10/#12/#17"
```

---

## Task 5: Verify `src/styles/typography.css` matches spec (no change expected)

**Files:**
- Verify only: `src/styles/typography.css`

- [ ] **Step 1: Verify size scale matches spec**

Run:
```bash
grep -E "^\s*--text-(caption|xs|sm|base|lg|xl|2xl|3xl|display):" /Users/lightman/yao.care/smart-geri-cds/src/styles/typography.css
```

Expected output (in any order, but all 9 must appear):
```
--text-caption: 16px;
--text-xs: 18px;
--text-sm: 20px;
--text-base: 22px;
--text-lg: 24px;
--text-xl: 28px;
--text-2xl: 32px;
--text-3xl: 40px;
--text-display: 48px;
```

If any is missing, add it. If anything else is present, the file is already current. **No commit if nothing changed.**

- [ ] **Step 2: Verify font weights**

Run:
```bash
grep -E "^\s*--font-(normal|medium|bold):" /Users/lightman/yao.care/smart-geri-cds/src/styles/typography.css
```

Expected: 3 lines, weights 400 / 500 / 700.

---

## Task 6: Mechanical single-line sweep (sed batch — 16 renames)

**Files:**
- Modify: All `.svelte` + `.astro` files in `src/` referencing old single-line tokens (~69 files)

This task replaces tokens that have a 1:1 mapping with no judgment required (the simple cases — color-mix mappings are in Tasks 7-12).

- [ ] **Step 1: Run the 16 single-line renames**

Run from project root:

```bash
cd /Users/lightman/yao.care/smart-geri-cds

# Renames where new value is a single `var(--token)` reference
find src -type f \( -name "*.svelte" -o -name "*.astro" \) -exec sed -i '' \
  -e 's|var(--color-accent)|var(--accent)|g' \
  -e 's|var(--color-text-base)|var(--text)|g' \
  -e 's|var(--color-text-inverse)|white|g' \
  -e 's|var(--bg-base)|var(--bg)|g' \
  -e 's|var(--bg-surface)|var(--surface)|g' \
  -e 's|var(--border-default)|var(--line)|g' \
  -e 's|var(--color-risk-normal)|var(--accent)|g' \
  -e 's|var(--color-risk-advisory)|var(--warn)|g' \
  -e 's|var(--color-risk-warning)|var(--warn)|g' \
  -e 's|var(--color-risk-critical)|var(--danger)|g' \
  {} +
```

- [ ] **Step 2: Verify no broken references introduced**

Run:
```bash
pnpm check 2>&1 | tail -10
```

Expected: same error count as before this task (TS doesn't check CSS).

- [ ] **Step 3: Verify some old tokens are gone**

Run:
```bash
grep -rE "var\(--(color-accent\)|color-text-base|bg-base\)|bg-surface\)|border-default\)|color-risk-normal\)|color-risk-advisory\)|color-risk-warning\)|color-risk-critical\))" src --include="*.svelte" --include="*.astro" | head -5
```

Expected: empty output (the 10 simple-rename tokens are gone).

- [ ] **Step 4: Run design-system tests**

Run:
```bash
pnpm vitest run tests/design-system.test.ts
```

Expected: Test 5 still passes. Tests 1–4, 6–8 may or may not be passing yet — the remaining `--color-*-hover`, `--color-*-soft`, `--color-*-light`, `--color-*-strong`, `--color-text-muted`, `--color-text-subtle`, `--bg-muted`, `--border-strong`, `--color-risk-*-bg`, `--state-*` are still in component CSS. Tasks 7–12 fix these.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(design-system): mechanical sed sweep — 10 single-line token renames"
```

---

## Task 7: Replace accent variants with `color-mix`

**Files:**
- Modify: All `.svelte` + `.astro` referencing `--color-accent-hover/-soft/-light/-strong`

- [ ] **Step 1: List affected files**

Run:
```bash
grep -rlE "var\(--color-accent-(hover|soft|light|strong)\)" src --include="*.svelte" --include="*.astro"
```

Record the file list — these need replacement.

- [ ] **Step 2: Apply replacements via sed**

Run:
```bash
find src -type f \( -name "*.svelte" -o -name "*.astro" \) -exec sed -i '' \
  -e 's|var(--color-accent-hover)|color-mix(in srgb, var(--accent) 85%, black)|g' \
  -e 's|var(--color-accent-soft)|color-mix(in srgb, var(--accent) 10%, var(--bg))|g' \
  -e 's|var(--color-accent-light)|color-mix(in srgb, var(--accent) 12%, var(--bg))|g' \
  -e 's|var(--color-accent-strong)|color-mix(in srgb, var(--accent) 85%, black)|g' \
  {} +
```

- [ ] **Step 3: Verify**

```bash
grep -rE "var\(--color-accent-(hover|soft|light|strong)\)" src --include="*.svelte" --include="*.astro"
```

Expected: empty.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(design-system): replace accent variants with color-mix"
```

---

## Task 8: Replace text variants with `color-mix`

**Files:**
- Modify: All referencing `--color-text-muted/-subtle`

- [ ] **Step 1: Apply sed**

```bash
find src -type f \( -name "*.svelte" -o -name "*.astro" \) -exec sed -i '' \
  -e 's|var(--color-text-muted)|color-mix(in srgb, var(--text), var(--bg) 30%)|g' \
  -e 's|var(--color-text-subtle)|color-mix(in srgb, var(--text), var(--bg) 45%)|g' \
  {} +
```

- [ ] **Step 2: Verify**

```bash
grep -rE "var\(--color-text-(muted|subtle)\)" src --include="*.svelte" --include="*.astro"
```

Expected: empty.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor(design-system): replace text variants with color-mix"
```

---

## Task 9: Replace `--bg-muted` (context-dependent — manual review per file)

**Files:**
- Modify: 48-ish files referencing `--bg-muted`

`--bg-muted` is **not** a simple sed target. Per the spec heuristic:
- **If the rule also sets `border:` or `box-shadow:` or references `--border-default`/`--line`** → it's a card/panel container → replace with `var(--surface)`.
- **Otherwise** (faded fills, disabled fills, progress tracks, input internal shading) → replace with `color-mix(in srgb, var(--bg), var(--text) 5%)`.

- [ ] **Step 1: List affected files**

```bash
grep -rlE "var\(--bg-muted\)" src --include="*.svelte" --include="*.astro" | sort > /tmp/bg-muted-files.txt
wc -l /tmp/bg-muted-files.txt
cat /tmp/bg-muted-files.txt
```

- [ ] **Step 2: For each file, manually apply the heuristic**

For each file in the list, open it, find each `var(--bg-muted)` usage, and:

```
Inspect the surrounding rule:
  - Does the rule have `border:` or `box-shadow:` or reference --line / --border-default? → replace with `var(--surface)`
  - Otherwise → replace with `color-mix(in srgb, var(--bg), var(--text) 5%)`
```

Use Edit tool per file. Do not script — judgment required.

- [ ] **Step 3: Verify all gone**

```bash
grep -rE "var\(--bg-muted\)" src --include="*.svelte" --include="*.astro"
```

Expected: empty.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(design-system): replace --bg-muted by heuristic — card/panel → --surface; other → color-mix bg+text 5%"
```

---

## Task 10: Replace `--border-strong`

**Files:**
- Modify: All referencing `--border-strong`

- [ ] **Step 1: Apply sed**

```bash
find src -type f \( -name "*.svelte" -o -name "*.astro" \) -exec sed -i '' \
  -e 's|var(--border-strong)|color-mix(in srgb, var(--line), var(--text) 33%)|g' \
  {} +
```

- [ ] **Step 2: Verify**

```bash
grep -rE "var\(--border-strong\)" src --include="*.svelte" --include="*.astro"
```

Expected: empty.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor(design-system): replace --border-strong with color-mix(--line, --text 33%)"
```

---

## Task 11: Replace risk-bg variants with `color-mix`

**Files:**
- Modify: All referencing `--color-risk-*-bg`

- [ ] **Step 1: Apply sed**

```bash
find src -type f \( -name "*.svelte" -o -name "*.astro" \) -exec sed -i '' \
  -e 's|var(--color-risk-normal-bg)|color-mix(in srgb, var(--accent) 12%, var(--bg))|g' \
  -e 's|var(--color-risk-advisory-bg)|color-mix(in srgb, var(--warn) 12%, var(--bg))|g' \
  -e 's|var(--color-risk-warning-bg)|color-mix(in srgb, var(--warn) 12%, var(--bg))|g' \
  -e 's|var(--color-risk-critical-bg)|color-mix(in srgb, var(--danger) 14%, var(--bg))|g' \
  {} +
```

- [ ] **Step 2: Verify**

```bash
grep -rE "var\(--color-risk-(normal|advisory|warning|critical)-bg\)" src --include="*.svelte" --include="*.astro"
```

Expected: empty.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor(design-system): replace risk-*-bg with color-mix"
```

---

## Task 12: Replace `--state-*` tokens with `color-mix`

**Files:**
- Modify: All referencing `--state-selected-bg/-hover-surface/-focus-ring/-disabled-bg/-disabled-text`

- [ ] **Step 1: Apply sed**

```bash
find src -type f \( -name "*.svelte" -o -name "*.astro" \) -exec sed -i '' \
  -e 's|var(--state-selected-bg)|color-mix(in srgb, var(--accent) 10%, var(--bg))|g' \
  -e 's|var(--state-hover-surface)|color-mix(in srgb, var(--accent) 4%, var(--bg))|g' \
  -e 's|var(--state-focus-ring)|color-mix(in srgb, var(--accent) 45%, transparent)|g' \
  -e 's|var(--state-disabled-bg)|color-mix(in srgb, var(--bg), var(--text) 5%)|g' \
  -e 's|var(--state-disabled-text)|color-mix(in srgb, var(--text), var(--bg) 55%)|g' \
  {} +
```

- [ ] **Step 2: Verify**

```bash
grep -rE "var\(--state-(selected-bg|hover-surface|focus-ring|disabled-bg|disabled-text)\)" src --include="*.svelte" --include="*.astro"
```

Expected: empty.

- [ ] **Step 3: Run design-system tests**

```bash
pnpm vitest run tests/design-system.test.ts
```

Expected: Tests 1, 2, 5, 7 should pass. Test 4 may still flag the 9 audit findings. Test 3 may flag remaining hardcoded font-sizes. Test 6 may flag inline-style hex (4 dynamic interpolation sites). Test 8 may flag remaining literal hex in non-allowlisted files. These are addressed in Tasks 13-19.

- [ ] **Step 4: Verify no orphan old tokens remain**

```bash
grep -rE "var\(--(color-|bg-|border-|state-)" src --include="*.svelte" --include="*.astro" | grep -v "var(--bg)\|var(--bg-base\|var(--bg-surface" | head -20
```

Expected: empty. If any reveal slipped through, repeat appropriate task or manual fix.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(design-system): replace --state-* tokens with color-mix"
```

---

## Task 13: Audit finding #1 — `QuestionnaireModule.svelte` `.option-btn.selected`

**Files:**
- Modify: `src/components/assess/QuestionnaireModule.svelte`

- [ ] **Step 1: Read the current rule**

Run:
```bash
grep -nA5 "\.option-btn\.selected" /Users/lightman/yao.care/smart-geri-cds/src/components/assess/QuestionnaireModule.svelte
```

Find the rule (around line 328 per spec). After Task 11/12, the `var(--color-risk-advisory-bg)` should have been swept to `color-mix(--warn 12%, --bg)` — but this is semantically wrong (selection state, not warn).

- [ ] **Step 2: Apply Pattern #4 (selected) — Edit the file**

Replace the `.option-btn.selected` rule with the Pattern #4 form. Using the Edit tool, find:

```css
.option-btn.selected {
```

And ensure the body is:

```css
.option-btn.selected {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, var(--bg));
  color: var(--accent);
}
```

Replace whatever was there (likely a stale `color-mix(--warn ...)` or similar).

- [ ] **Step 3: Verify Test 4 no longer flags this site**

```bash
pnpm vitest run tests/design-system.test.ts -t "warn / --danger forbidden"
```

Expected: this file no longer in offenders list.

- [ ] **Step 4: Commit**

```bash
git add src/components/assess/QuestionnaireModule.svelte
git commit -m "fix(design-system): QuestionnaireModule .option-btn.selected → Pattern #4"
```

---

## Task 14: Audit finding #2 — `NormsManager.svelte` `tr.custom`

**Files:**
- Modify: `src/components/settings/NormsManager.svelte`

- [ ] **Step 1: Find the rule**

```bash
grep -nA3 "tr\.custom\b" /Users/lightman/yao.care/smart-geri-cds/src/components/settings/NormsManager.svelte
```

- [ ] **Step 2: Apply Pattern #4**

Edit the `tr.custom` rule body to:

```css
tr.custom {
  background: color-mix(in srgb, var(--accent) 10%, var(--bg));
}
```

(Drop any `border-color` / `color` overrides if they were stale; selected-row pattern only needs background here unless the row also needs a left bar — keep the existing border if part of a `border-left` design.)

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/NormsManager.svelte
git commit -m "fix(design-system): NormsManager tr.custom → Pattern #4 (selected)"
```

---

## Task 15: Audit findings #3, #4 — `ModelManager.svelte` `.model-card.current` + `.version-item.is-current`

**Files:**
- Modify: `src/components/settings/ModelManager.svelte`

- [ ] **Step 1: Find both rules**

```bash
grep -nA4 "\.model-card\.current\|\.version-item\.is-current" /Users/lightman/yao.care/smart-geri-cds/src/components/settings/ModelManager.svelte
```

- [ ] **Step 2: Apply Pattern #4 to both**

Edit both rules to the Pattern #4 form:

```css
.model-card.current {
  background: color-mix(in srgb, var(--accent) 10%, var(--bg));
  border-color: var(--accent);
}

.version-item.is-current {
  background: color-mix(in srgb, var(--accent) 10%, var(--bg));
  border-color: var(--accent);
}
```

Preserve any `padding`, `margin`, etc. from the original rule. Only swap the color-related declarations.

- [ ] **Step 3: Commit**

```bash
git add src/components/settings/ModelManager.svelte
git commit -m "fix(design-system): ModelManager current model/version → Pattern #4"
```

---

## Task 16: Audit findings #5-#8 — badge bindings

**Files:**
- Modify:
  - `src/components/settings/RecommendationsManager.svelte` (`.badge-override`)
  - `src/components/workspace/AssessmentsTab.svelte` (`.mode-demo`)
  - `src/components/fhir/LaunchSelector.svelte` (`.ehr-icon`)
  - `src/components/education/ContentViewer.svelte` (`.format-badge--questionnaire`)

All four use Pattern #6 normal (`--accent` 12%):

- [ ] **Step 1: RecommendationsManager `.badge-override`**

Find the rule, replace body with:

```css
.badge-override {
  background: color-mix(in srgb, var(--accent) 12%, var(--bg));
  color: var(--accent);
}
```

- [ ] **Step 2: AssessmentsTab `.mode-demo`**

Find the rule, replace body with:

```css
.mode-demo {
  background: color-mix(in srgb, var(--accent) 12%, var(--bg));
  color: var(--accent);
}
```

- [ ] **Step 3: LaunchSelector `.ehr-icon`**

Find the rule, replace body with:

```css
.ehr-icon {
  background: color-mix(in srgb, var(--accent) 12%, var(--bg));
  color: var(--accent);
}
```

- [ ] **Step 4: ContentViewer `.format-badge--questionnaire`**

Find the rule, replace body with:

```css
.format-badge--questionnaire {
  background: color-mix(in srgb, var(--accent) 12%, var(--bg));
  color: var(--accent);
}
```

- [ ] **Step 5: Commit all 4 together**

```bash
git add src/components/settings/RecommendationsManager.svelte \
        src/components/workspace/AssessmentsTab.svelte \
        src/components/fhir/LaunchSelector.svelte \
        src/components/education/ContentViewer.svelte
git commit -m "fix(design-system): 4 badge sites → Pattern #6 normal (--accent 12% bg)"
```

---

## Task 17: Audit finding #9 — `VideoModule.svelte` `#ef4444` → `var(--danger)`

**Files:**
- Modify: `src/components/assess/VideoModule.svelte`

- [ ] **Step 1: Find the literals**

```bash
grep -nE "#ef4444" /Users/lightman/yao.care/smart-geri-cds/src/components/assess/VideoModule.svelte
```

Expected: 5 lines (per spec, lines 288, 321, 325, 336, 344).

- [ ] **Step 2: Replace all 5**

```bash
sed -i '' 's|#ef4444|var(--danger)|g' /Users/lightman/yao.care/smart-geri-cds/src/components/assess/VideoModule.svelte
```

- [ ] **Step 3: Verify**

```bash
grep -nE "#ef4444" /Users/lightman/yao.care/smart-geri-cds/src/components/assess/VideoModule.svelte
```

Expected: no output.

- [ ] **Step 4: Run Test 1**

```bash
pnpm vitest run tests/design-system.test.ts -t "no hex color"
```

Expected: VideoModule no longer in offenders.

- [ ] **Step 5: Commit**

```bash
git add src/components/assess/VideoModule.svelte
git commit -m "fix(design-system): VideoModule recording-indicator #ef4444 → var(--danger)"
```

---

## Task 18: Convert 4 dynamic `var(--color-risk-{level})` interpolations to `LEVEL_TO_COLOR` map

**Files:**
- Modify:
  - `src/components/alerts/AlertCard.svelte`
  - `src/components/dashboard/AlertFeed.svelte`
  - `src/components/dashboard/RiskSummary.svelte`
  - `src/components/dashboard/PatientList.svelte`

These 4 files build token names via Svelte template interpolation that mechanical search-and-replace cannot reach. Each needs a script-side `LEVEL_TO_COLOR` lookup map.

- [ ] **Step 1: Find the interpolation sites**

For each file, run:
```bash
grep -nE "var\(--color-risk-\{[^}]+\}" src/components/alerts/AlertCard.svelte src/components/dashboard/AlertFeed.svelte src/components/dashboard/RiskSummary.svelte src/components/dashboard/PatientList.svelte
```

This shows each interpolation site. There may be multiple per file.

- [ ] **Step 2: For each file, add a `LEVEL_TO_COLOR` constant in the `<script>` and replace inline interpolation**

For `AlertCard.svelte`, in the `<script lang="ts">` block (top of file), add (place near other constants):

```ts
const LEVEL_TO_COLOR: Record<string, string> = {
  normal:   'var(--accent)',
  advisory: 'var(--warn)',
  warning:  'var(--warn)',
  critical: 'var(--danger)',
};
```

Then replace each `style="--bar-color: var(--color-risk-{alert.riskLevel})"` (or similar) with:

```svelte
style="--bar-color: {LEVEL_TO_COLOR[alert.riskLevel]}"
```

Repeat for the other 3 files. **Use the actual prop name** for each file — `AlertFeed` uses `{alert.riskLevel}`, `RiskSummary` uses `{card.level}`, `PatientList` uses its own variable name. Read the surrounding context in each file before editing.

- [ ] **Step 3: Verify no orphan dynamic-name interpolations remain**

```bash
grep -rE "var\(--color-risk-\{" src --include="*.svelte"
```

Expected: empty.

- [ ] **Step 4: Run design-system tests**

```bash
pnpm vitest run tests/design-system.test.ts
```

Expected: Test 6 (inline-style hex/rgba) should pass — inline values are now `var(--...)` references, not constructed token names.

- [ ] **Step 5: Commit**

```bash
git add src/components/alerts/AlertCard.svelte \
        src/components/dashboard/AlertFeed.svelte \
        src/components/dashboard/RiskSummary.svelte \
        src/components/dashboard/PatientList.svelte
git commit -m "fix(design-system): 4 dynamic risk-level interpolations → LEVEL_TO_COLOR script-side map"
```

---

## Task 19: SVG inline attribute fallback cleanup

**Files:**
- Modify: `src/components/assess/AssessmentHistory.svelte` (known sites at lines 416, 430) + any others discovered by grep.

- [ ] **Step 1: Discover all `var(--token, #hex)` patterns**

```bash
grep -rnE "\bvar\(--[^,)]+,\s*#[0-9a-fA-F]+\)" src --include="*.svelte" --include="*.astro"
```

Record the list — these are SVG inline attrs (or CSS values) using hex fallback.

- [ ] **Step 2: Edit each occurrence — drop the hex fallback**

For each line found, change `var(--token, #hex)` to `var(--token)`. Use the Edit tool per occurrence.

Example:
```
Before:  stroke="var(--border-default, #e5e7eb)"
After:   stroke="var(--line)"
```
Note: also rename old token if it's a legacy name (e.g. `--border-default` → `--line`).

- [ ] **Step 3: Verify**

```bash
grep -rnE "\bvar\(--[^,)]+,\s*#[0-9a-fA-F]+\)" src --include="*.svelte" --include="*.astro"
```

Expected: empty.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(design-system): drop hex fallbacks from SVG inline var() — modern browsers all support CSS vars in SVG"
```

---

## Task 20: Font-size cleanup — `Toast.svelte`

**Files:**
- Modify: `src/components/ui/Toast.svelte`

- [ ] **Step 1: Find the hardcoded font-size**

```bash
grep -nE "font-size:\s*[0-9]" /Users/lightman/yao.care/smart-geri-cds/src/components/ui/Toast.svelte
```

Expected: at least line ~95 with `font-size: 0.875rem;` (or similar).

- [ ] **Step 2: Replace with token**

Use the Edit tool. Replace `font-size: 0.875rem;` with `font-size: var(--text-xs);`. If there are other numeric font-sizes in the file, apply the closest size token (16px → `var(--text-caption)`, 18px → `var(--text-xs)`, 20px → `var(--text-sm)`, 22px → `var(--text-base)`, etc.).

- [ ] **Step 3: Verify Test 3**

```bash
pnpm vitest run tests/design-system.test.ts -t "no hardcoded font-size"
```

Expected: no Toast.svelte in offenders.

- [ ] **Step 4: Search for any remaining hardcoded font-sizes in the codebase**

```bash
grep -rnE "font-size:\s*[0-9]+(px|rem|pt)" src --include="*.svelte" --include="*.astro"
```

For each hit (other than `0.9em` which is allowed), apply the closest `var(--text-*)` token via Edit tool.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix(design-system): hardcoded font-sizes → var(--text-*) tokens"
```

---

## Task 21: Run full enforcement test suite — all 8 must pass

**Files:**
- None modified — verification only.

- [ ] **Step 1: Run the full suite**

```bash
pnpm vitest run tests/design-system.test.ts
```

Expected: **all 8 tests pass**. If any fail:
- Test 1 (hex in style): locate offending file via the offenders list, replace hex with token, return to Task 17/20 pattern.
- Test 2 (rgb/rgba): same, use `oklch()` or `color-mix()`.
- Test 3 (font-size): replace with `var(--text-*)`.
- Test 4 (warn/danger in selected): rewrite to Pattern #4.
- Test 5 (token set): check tokens.css — extras or missing in approved set.
- Test 6 (inline style hex): rewrite to `var()` token reference.
- Test 7 (numeric font-weight): replace with `var(--font-normal|medium|bold)`.
- Test 8 (JS palette): either add to ALLOWLIST with rationale or convert to token-driven.

Fix each one, re-run, until all pass.

- [ ] **Step 2: Commit any test fixes**

If any per-file fixes were applied:
```bash
git add -A
git commit -m "fix(design-system): final compliance fixes for tests 1-8"
```

---

## Task 22: Run the verification scripts

**Files:**
- None modified.

- [ ] **Step 1: Hex sweep**

```bash
grep -rE "#[0-9a-fA-F]{3,8}" src --include="*.svelte" --include="*.astro" --include="*.css"
```

Expected: only matches in `src/styles/tokens.css` (the hex fallback `:root` block) and explicit ALLOWLIST files (`AssessmentHistory.svelte` SERIES_COLORS, `Base.astro` theme-color meta, `GameModule.svelte` + `DrawingModule.svelte` canvas literals). Any other match is a defect — go back and fix.

- [ ] **Step 2: RGB sweep**

```bash
grep -rE "rgba?\(" src --include="*.svelte" --include="*.astro"
```

Expected: empty (the `.css` files in `src/styles/` legitimately keep rgba fallbacks for shadow tokens).

- [ ] **Step 3: Type check**

```bash
pnpm check 2>&1 | tail -5
```

Expected: same baseline as before (0 errors / 0 warnings / 58 hints, or similar).

- [ ] **Step 4: Full test suite**

```bash
pnpm test
```

Expected: all design-system tests pass + all existing tests still pass.

- [ ] **Step 5: Build**

```bash
pnpm build 2>&1 | tail -10
```

Expected: build succeeds. Astro should not complain about any CSS.

---

## Task 23: Visual regression — manual check 6 key pages

**Files:**
- None modified.

This step is manual — run the dev server and inspect each page.

- [ ] **Step 1: Start dev server**

```bash
pnpm dev
```

Wait for `Local: http://localhost:4321/` (or similar).

- [ ] **Step 2: Open and inspect each page**

For each, visually confirm:
- Background is warm ivory (not gray or white)
- Primary buttons are eucalyptus green with white text
- Selected rows / chips have soft green tint
- Warn / danger badges are amber-brown / red
- Focus rings on tab + buttons are visible green
- No bright unintended colors

Pages to check:
1. `http://localhost:4321/` — home (Hero + nav)
2. `http://localhost:4321/assess/` — assessment shell, step 1 child profile form (sex chips, fieldset)
3. `http://localhost:4321/result/?id=<any-existing>` — result page (if you have data)
4. `http://localhost:4321/workspace/` — workspace dashboard (alert cards if any)
5. `http://localhost:4321/settings/` — settings tabs (system guide, FHIR config, etc.)
6. `http://localhost:4321/education/` — education filter chips + cards
7. `http://localhost:4321/history/` — assessment history + compare mode

If any page looks broken (text invisible, wrong color contrast, missing border), open DevTools, locate the broken style, and fix the token binding in the appropriate component file. Re-run `pnpm vitest run tests/design-system.test.ts` after each fix to ensure compliance.

- [ ] **Step 3: Commit any post-visual fixes**

```bash
git add -A
git commit -m "fix(design-system): visual regression fixes from manual page review"
```

(Skip this commit if no fixes were needed.)

---

## Task 24: Create `docs/superpowers/design-system.md` summary

**Files:**
- Create: `docs/superpowers/design-system.md`

This is the in-repo discoverability doc — short, links to the full spec for details.

- [ ] **Step 1: Create the file**

```markdown
# Smart Pedi CDSS — Design System

> **Spec:** `docs/superpowers/specs/2026-05-16-design-system-spec.md` (full reference)

## Quick reference for component authors

### 7 color tokens

```css
var(--bg)        /* page background — warm ivory */
var(--surface)   /* card / modal / sticky header */
var(--text)      /* primary type — warm dark brown */
var(--line)      /* decorative divider only (1.8:1 vs bg) */
var(--accent)    /* brand CTA + normal status — eucalyptus green */
var(--warn)      /* advisory + warning — amber-brown */
var(--danger)    /* critical / error — warm red */
```

### Derived via color-mix (do not create new tokens)

| Need | Use |
|---|---|
| Hover (CTA) | `color-mix(in srgb, var(--accent) 85%, black)` |
| Hover (row) | `color-mix(in srgb, var(--accent) 4%, var(--bg))` |
| Selected row | `color-mix(in srgb, var(--accent) 10%, var(--bg))` |
| Chip / accent badge bg | `color-mix(in srgb, var(--accent) 12%, var(--bg))` |
| Warn badge bg | `color-mix(in srgb, var(--warn) 12%, var(--bg))` |
| Danger badge bg | `color-mix(in srgb, var(--danger) 14%, var(--bg))` |
| Card / Input border | `color-mix(in srgb, var(--line), var(--text) 33%)` |
| Text muted | `color-mix(in srgb, var(--text), var(--bg) 30%)` |
| Focus ring (global) | `color-mix(in srgb, var(--accent) 65%, transparent)` |
| Inverse text (on accent fill) | `white` |

### Three rules

1. **Semantic-named.** Component asks "I need brand color", not "I need green".
2. **Single-context.** `--warn` only in alert / badge / form-error contexts.
3. **Borrow equals misuse.** Find no fit? Extend the pattern library — never borrow.

### 19 component patterns

See spec section "Component CSS Pattern Library" for full code. Quick index:

| # | Pattern | Use for |
|---|---|---|
| 1 | Button (primary / secondary / ghost / danger) | Actions |
| 2 | Card / Surface | Container with elevation |
| 3 | Input / Form field | Text inputs |
| 4 | Selected / Active (state class) | Chosen item in list |
| 5 | Hover surface (non-CTA) | Row hover |
| 6 | Status badge (normal / warn / danger) | Inline status |
| 7 | Text variants (muted / subtle / inverse) | Type hierarchy |
| 8 | Disabled | Disabled controls |
| 9 | Modal backdrop | Modal overlay |
| 10 | Alert / inline notice | Page-level notice |
| 11 | Tab (active = underline) | Page section nav |
| 12 | Focus ring (global) | `:focus-visible` |
| 13 | Toast notification | Floating feedback |
| 14 | Tooltip / popover | Hover hint |
| 15 | Progress bar | Determinate progress |
| 16 | Table (header / stripe / hover) | Data tables |
| 17 | Link | Inline navigation |
| 18 | Native form accent | Checkbox / radio / range |
| 19 | Stepper | Multi-step wizard |

### PR checklist (5 rules)

1. **No hardcoded color anywhere.** All `var(--bg|surface|text|line|accent|warn|danger)` or `color-mix(...)`.
2. **`--warn` / `--danger` only in alert / badge / validation contexts.** Selected/hover/focus → `color-mix(var(--accent), ...)`.
3. **No new top-level color or typography tokens.** Extend pattern library if needed.
4. **Disabled uses Pattern #8 only.** No `opacity:`.
5. **Tabs use Pattern #11 underline; selected/current uses Pattern #4 fill.** Don't mix.

Rules 1, 2, 3, 4 (font-weight), 5 (tabs vs selected) — partially CI-enforced via `tests/design-system.test.ts`. Reviewer-enforced for the rest.

### Adding a new pattern

When no pattern fits:
1. Open a spec amendment (`docs/superpowers/specs/2026-05-16-design-system-spec.md`)
2. Add the pattern under "Component CSS Pattern Library" with use case + rationale
3. If new color-mix percentages, add row to rationale table
4. Implement components against the new pattern

Do **not** invent inline — that's how the 9 audit findings happened.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/design-system.md
git commit -m "docs(design-system): add in-repo summary linking back to spec"
```

---

## Task 25: Final push + verification

**Files:**
- None modified.

- [ ] **Step 1: Final test + check sweep**

```bash
pnpm test 2>&1 | tail -20
pnpm check 2>&1 | tail -5
pnpm build 2>&1 | tail -5
```

All three commands should succeed.

- [ ] **Step 2: Final hex sweep**

```bash
grep -rE "#[0-9a-fA-F]{3,8}" src --include="*.svelte" --include="*.astro" --include="*.css" | grep -v "src/styles/tokens.css\|design-system-allow"
```

Expected: only the 4 ALLOWLIST files (`AssessmentHistory.svelte` SERIES_COLORS, `Base.astro` theme-color, `GameModule.svelte` canvas, `DrawingModule.svelte` canvas).

- [ ] **Step 3: Push to remote**

```bash
git push
```

- [ ] **Step 4: Confirm CI green**

Check GitHub Actions (or equivalent) — design-system tests should run and pass on push.

- [ ] **Step 5: Final report**

Print a summary of what was done:

```bash
git log --oneline main..HEAD | head -30
```

Verify the commit history shows all 22+ design-system commits.

---

## Out of scope (not implemented in this plan)

- TS / Svelte component logic — untouched
- PDF jsPDF colors — separate sync spec needed
- Mermaid diagrams — CLAUDE.md mandates hex, untouched
- Dark mode — deferred to a separate spec amendment
- New patterns (pagination / breadcrumb / accordion / drawer / skeleton / segmented control / popover positioning / file upload / chip input) — extend pattern library when needed
