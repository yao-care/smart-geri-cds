// Generate PWA + favicon icons — maskable-safe with 80% inner safe zone.
//
// Sizes:
//   16  — browser tab favicon (small)
//   32  — browser tab favicon (standard / high-dpi)
//   180 — iOS apple-touch-icon (Apple's home-screen target)
//   192 — PWA manifest minimum + Android home-screen
//   512 — PWA manifest large + splash
//
// Pure SVG → PNG via sharp.
//
// Brand mark: growth ring. A nearly-closed circular stroke (gap at upper-right
// ~12-2 o'clock) with a small filled dot at center.
//   - Ring  = ongoing observation / development tracking
//   - Gap   = the child's growth that is still to come (not yet completed)
//   - Dot   = the child being observed at the center of attention
//
// Palette matches tokens.css fallback hex:
//   green stroke --color-accent          #3d6b54 (deep eucalyptus, hue 155)
//   cream bg     --bg-base               #fbf8f2
//   center dot   --color-accent-strong   #264a37
//
// SPDX-License-Identifier: MIT

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

function makeSvg(size) {
  const cx = size / 2;
  const ringR = size * 0.32;           // ring radius (inside the 80% safe zone)
  const stroke = size * 0.08;          // bold stroke, visible at 16px favicon
  const dotR = size * 0.06;            // center dot
  const ringCirc = 2 * Math.PI * ringR;
  const gapFraction = 0.18;            // 18% of the ring is the open gap
  const dashLen = ringCirc * (1 - gapFraction);
  const gapLen = ringCirc * gapFraction;
  // dashoffset rotates the dash start; with rotate(-90) the stroke starts at
  // 12 o'clock, so to place the gap at ~1-2 o'clock we shift the dash back
  // a touch (negative offset). Adjusted empirically for the rotation below.
  const dashOffset = -ringCirc * 0.04;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}">
  <!-- Cream full-bleed background (covers maskable safe + bleed zones) -->
  <rect width="${size}" height="${size}" fill="#fbf8f2"/>
  <!-- Growth ring: rose stroke with a gap at upper-right -->
  <circle
    cx="${cx}" cy="${cx}" r="${ringR}"
    fill="none"
    stroke="#3d6b54"
    stroke-width="${stroke}"
    stroke-linecap="round"
    stroke-dasharray="${dashLen} ${gapLen}"
    stroke-dashoffset="${dashOffset}"
    transform="rotate(-90 ${cx} ${cx})"
  />
  <!-- Center dot: deeper rose for contrast against the cream field -->
  <circle cx="${cx}" cy="${cx}" r="${dotR}" fill="#264a37"/>
</svg>`;
}

async function generate() {
  // Each entry: [size, filename]. SVG is rendered at the target size
  // (sharp will produce a pixel-perfect raster from the vector source).
  const targets = [
    [16,  'favicon-16.png'],
    [32,  'favicon-32.png'],
    [180, 'apple-touch-icon.png'],
    [192, 'icon-192.png'],
    [512, 'icon-512.png'],
  ];
  for (const [size, filename] of targets) {
    const svg = makeSvg(size);
    const destPath = resolve(repoRoot, `public/icons/${filename}`);
    await sharp(Buffer.from(svg)).resize(size, size).png().toFile(destPath);
    console.log(`  ✓ public/icons/${filename}`);
  }
}

console.log('Generating PWA + favicon icons…');
await generate();
