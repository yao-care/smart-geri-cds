/**
 * Content-Security-Policy — single source of truth。
 *
 * 部署於 GitHub Pages（靜態，無法設定 HTTP 回應標頭），因此 CSP 透過
 * `<meta http-equiv="Content-Security-Policy">` 投遞（見 src/layouts/Base.astro）。
 *
 * meta 投遞的限制（瀏覽器規格）：`frame-ancestors`、`report-uri`/`report-to`、
 * `sandbox` 於 meta 會被忽略——故點擊劫持改以 JS frame-busting 緩解（Base.astro），
 * 不在此處宣告 frame-ancestors。
 *
 * 為何保留 'unsafe-inline'：Astro 會內嵌關鍵 CSS 與島嶼水合腳本，且本層加入內嵌
 * frame-busting 腳本，移除後頁面會壞。因此 ZAP 10055 仍會就 unsafe-inline 提出
 * WARN——屬已知且接受的殘餘風險，其餘指令皆已收斂（見 .zap/rules.tsv）。
 *
 * connect-src 為何用 `https:`：SMART on FHIR 的醫院端 launch 會以醫院動態帶入的
 * `iss`（任意 FHIR server origin）發出頁內請求，無法事先列舉白名單；以 `https:`
 * 允許任意 HTTPS 後端，同時封鎖 http/ws/data: 等外洩管道。
 */

/** CSP 指令表（順序即輸出順序，便於審查與測試）。 */
export const CSP_DIRECTIVES: Record<string, string[]> = {
  'default-src': ["'self'"],
  // Astro 內嵌水合腳本 + 本層 frame-busting 內嵌腳本 → 需 unsafe-inline
  'script-src': ["'self'", "'unsafe-inline'"],
  // Astro 內嵌關鍵 CSS → 需 unsafe-inline
  'style-src': ["'self'", "'unsafe-inline'"],
  // data:/blob: 供 jsPDF、QR、產生圖；i.ytimg.com 為 YouTube 縮圖
  'img-src': ["'self'", 'data:', 'blob:', 'https://i.ytimg.com'],
  'font-src': ["'self'"],
  // public/sounds/critical-alert.mp3
  'media-src': ["'self'"],
  // 'self' + 任意 HTTPS（SMART launch 動態 FHIR origin / GCM 上傳）
  'connect-src': ["'self'", 'https:'],
  // 衛教影片 iframe
  'frame-src': ['https://www.youtube-nocookie.com', 'https://www.youtube.com'],
  // PWA service worker
  'worker-src': ["'self'"],
  // PWA manifest
  'manifest-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
};

/** 無值的布林指令。 */
export const CSP_BOOLEAN_DIRECTIVES: string[] = ['upgrade-insecure-requests'];

/** 組成可放入 meta `content` 的 CSP 字串。 */
export function buildCsp(): string {
  const valued = Object.entries(CSP_DIRECTIVES).map(
    ([name, values]) => `${name} ${values.join(' ')}`,
  );
  return [...valued, ...CSP_BOOLEAN_DIRECTIVES].join('; ');
}

/** 部署用 CSP（meta 投遞）。 */
export const CONTENT_SECURITY_POLICY: string = buildCsp();
