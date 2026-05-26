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
