import { describe, it, expect, vi } from 'vitest';

// 隔離字體載入（避免測試 fetch public/fonts）。
vi.mock('../../src/lib/pdf/font-loader', () => ({
  loadChineseFontInto: vi.fn(async () => {}),
}));

import { buildSelfCheckPdf } from '../../src/lib/self-check/self-check-pdf';
import type { SelfCheckSummary } from '../../src/lib/self-check/summarise';

const summary: SelfCheckSummary = {
  overall: 'amber',
  redFlag: false,
  concerns: [
    { top: 'physical', sub: 'pain', label: '疼痛', advice: '持續疼痛建議就醫。' },
    { top: 'functional', sub: 'falls', label: '平衡跌倒', advice: '建議評估跌倒風險。' },
  ],
  awareness: [],
};

describe('buildSelfCheckPdf', () => {
  it('returns a jsPDF doc with the concern labels rendered', async () => {
    const doc = await buildSelfCheckPdf(summary, '2026-05-31');
    expect(doc).toBeTruthy();
    // jsPDF 內部累積文字可由 output('datauristring') 長度間接驗證非空白頁
    const data = doc.output('datauristring');
    expect(typeof data).toBe('string');
    expect(data.length).toBeGreaterThan(1000);
  });
});
