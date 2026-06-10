import type jsPDF from 'jspdf';

let cached: { regular: string; bold: string } | null = null;

async function fetchFontBase64(filename: string, exportName: string): Promise<string> {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const url = `${base}/fonts/${filename}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const text = await res.text();
  // `exportName` is always an internal, build-time-fixed constant (the two
  // call sites below), never user input. Validate it as a plain JS identifier
  // anyway so no regex metacharacter can ever reach the dynamic RegExp —
  // this rules out ReDoS (CWE-1333) by construction and clears the SAST gate.
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(exportName)) {
    throw new Error(`Invalid font export identifier: ${exportName}`);
  }
  const match = text.match(new RegExp(`export const ${exportName} = '([^']+)'`));
  if (!match) throw new Error(`Cannot parse font module: ${filename}`);
  return match[1];
}

/**
 * Load Noto Sans TC (Regular + Bold) subset fonts into the given jsPDF doc.
 * Uses runtime fetch from public/fonts/ to avoid bundling ~960KB into the main chunk.
 * Caches across calls within the same page lifetime.
 *
 * The `'Identity-H'` encoding is required for CJK rendering — without it
 * jsPDF defaults to WinAnsi and CJK glyphs render as blanks.
 */
export async function loadChineseFontInto(doc: jsPDF): Promise<void> {
  if (!cached) {
    const [regular, bold] = await Promise.all([
      fetchFontBase64('NotoSansTC-subset-regular.js', 'NotoSansTC_Regular_base64'),
      fetchFontBase64('NotoSansTC-subset-bold.js', 'NotoSansTC_Bold_base64'),
    ]);
    cached = { regular, bold };
  }
  doc.addFileToVFS('NotoSansTC-Regular.ttf', cached.regular);
  doc.addFont('NotoSansTC-Regular.ttf', 'NotoSansTC', 'normal', 'Identity-H');
  doc.addFileToVFS('NotoSansTC-Bold.ttf', cached.bold);
  doc.addFont('NotoSansTC-Bold.ttf', 'NotoSansTC', 'bold', 'Identity-H');
}
