/**
 * 決定收到 Service Worker 更新通知（SW_UPDATED）時該採取的動作：
 * 自動重載一次套用新版，或退回手動「新版已可用」橫幅。
 *
 * 規則（皆為避免干擾或迴圈）：
 * - 同一版本本分頁 session 已自動重載過 → 改顯示橫幅（防 reload 迴圈）。
 * - 使用者正在輸入（填表中）→ 不打斷，改顯示橫幅。
 * - 其餘 → 自動重載一次。
 *
 * 純函式，副作用（location.reload / sessionStorage / 讀 activeElement）由呼叫端處理。
 */
export function decideSwUpdateAction(opts: {
  version: string;
  alreadyReloadedVersion: string | null;
  isEditing: boolean;
}): 'reload' | 'banner' {
  const version = opts.version || 'unknown';
  if (opts.alreadyReloadedVersion === version) return 'banner';
  if (opts.isEditing) return 'banner';
  return 'reload';
}
