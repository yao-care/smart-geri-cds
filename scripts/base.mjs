// Single source of truth for build-time constants.
// Imported by astro.config.mjs, build-sw.mjs, build-manifest.mjs.
// Must remain pure constants — no Astro-only logic.
//
// BASE_PATH = '' (empty) — site is hosted at the root of smart-geri-cds.yao.care.
export const BASE_PATH = '';
export const THEME_COLOR = '#3d6b54'; // matches tokens.css --color-accent hex fallback (deep eucalyptus, hue 155)
