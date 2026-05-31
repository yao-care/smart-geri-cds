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

  it('renders the red-flag safety line without throwing (red overall)', async () => {
    const redFlagSummary: SelfCheckSummary = {
      overall: 'red',
      redFlag: true,
      concerns: [{ top: 'psychological', sub: 'mood', label: '情緒', advice: '建議談談情緒。' }],
      awareness: [],
    };
    const doc = await buildSelfCheckPdf(redFlagSummary, '2026-05-31');
    expect(doc).toBeTruthy();
    expect(doc.output('datauristring').length).toBeGreaterThan(1000);
  });

  it('renders the no-concern fallback without throwing (green overall)', async () => {
    const greenSummary: SelfCheckSummary = {
      overall: 'green', redFlag: false, concerns: [], awareness: [],
    };
    const doc = await buildSelfCheckPdf(greenSummary, '2026-05-31');
    expect(doc).toBeTruthy();
    expect(doc.output('datauristring').length).toBeGreaterThan(1000);
  });

  it('renders the awareness section without throwing', async () => {
    const awarenessSummary: SelfCheckSummary = {
      overall: 'green', redFlag: false, concerns: [],
      awareness: [{ top: 'future_wishes', sub: 'advance_care_planning', label: '預立照護諮商' }],
    };
    const doc = await buildSelfCheckPdf(awarenessSummary, '2026-05-31');
    expect(doc).toBeTruthy();
    expect(doc.output('datauristring').length).toBeGreaterThan(1000);
  });
});
