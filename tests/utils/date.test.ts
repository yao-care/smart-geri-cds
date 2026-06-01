import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  formatDate,
  formatDateTime,
  daysBetween,
  hoursAgo,
} from '../../src/lib/utils/date';

describe('date utils', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('formatDate', () => {
    it('formats in zh-TW with leading zeros', () => {
      const out = formatDate(new Date('2026-03-09T12:00:00Z'));
      expect(out).toMatch(/2026/);
      expect(out).toMatch(/03/);
      expect(out).toMatch(/09/);
    });
  });

  describe('formatDateTime', () => {
    it('includes hour and minute', () => {
      const out = formatDateTime(new Date('2026-03-09T12:34:00Z'));
      expect(out).toMatch(/\d{2}:\d{2}/);
    });
  });

  describe('daysBetween', () => {
    it('counts whole days regardless of order', () => {
      const a = new Date('2026-05-14');
      const b = new Date('2026-05-17');
      expect(daysBetween(a, b)).toBe(3);
      expect(daysBetween(b, a)).toBe(3);
    });
  });

  describe('hoursAgo', () => {
    it('returns Date in past', () => {
      const past = hoursAgo(2);
      const diff = Date.now() - past.getTime();
      expect(diff).toBeCloseTo(2 * 60 * 60 * 1000, -2);
    });
  });
});
