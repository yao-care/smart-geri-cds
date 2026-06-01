/**
 * Format date/time in zh-TW locale.
 */
export function formatDateTime(date: Date, locale = 'zh-TW'): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * Format date only (no time) in zh-TW locale.
 */
export function formatDate(date: Date, locale = 'zh-TW'): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * Calculate whole days between two dates.
 */
export function daysBetween(a: Date, b: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor(Math.abs(b.getTime() - a.getTime()) / msPerDay);
}

/**
 * Return a Date that is `hours` hours before now.
 */
export function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}
