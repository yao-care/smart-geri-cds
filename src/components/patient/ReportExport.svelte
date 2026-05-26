<script lang="ts">
  import { jsPDF } from 'jspdf';
  import { loadChineseFontInto } from '../../lib/pdf/font-loader';

  interface Props {
    patientId: string;
  }

  let { patientId }: Props = $props();

  let dateFrom = $state('');
  let dateTo = $state('');
  let isGenerating = $state(false);

  // Default date range: last 30 days
  $effect(() => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    dateTo = formatInputDate(now);
    dateFrom = formatInputDate(thirtyDaysAgo);
  });

  function formatInputDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  async function generateReport() {
    isGenerating = true;

    try {
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });
      await loadChineseFontInto(doc);

      const pageWidth = doc.internal.pageSize.getWidth();
      let y = 20;

      // Title
      doc.setFontSize(18);
      doc.setFont('NotoSansTC', 'bold');
      doc.text('高齡周全性評估（CGA）系統', pageWidth / 2, y, { align: 'center' });
      y += 10;
      doc.setFontSize(12);
      doc.setFont('NotoSansTC', 'normal');
      doc.text('個案健康評估報告', pageWidth / 2, y, { align: 'center' });
      y += 14;

      // Separator line
      doc.setDrawColor(200, 200, 200);
      doc.line(20, y, pageWidth - 20, y);
      y += 10;

      // Patient info
      doc.setFontSize(10);
      doc.text(`病人識別碼：${patientId}`, 20, y);
      y += 7;
      doc.text(`報告期間：${dateFrom} ~ ${dateTo}`, 20, y);
      y += 7;
      doc.text(`產製時間：${new Date().toISOString().split('T')[0]}`, 20, y);
      y += 14;

      // Trend charts placeholder
      doc.setFontSize(12);
      doc.setFont('NotoSansTC', 'bold');
      doc.text('趨勢圖表', 20, y);
      y += 8;

      doc.setFontSize(9);
      doc.setFont('NotoSansTC', 'normal');
      doc.setTextColor(140, 140, 140);
      doc.text('（趨勢圖表將於後續版本嵌入）', 20, y);
      y += 14;
      doc.setTextColor(0, 0, 0);

      // Alert summary table header
      doc.setFontSize(12);
      doc.setFont('NotoSansTC', 'bold');
      doc.text('警示摘要', 20, y);
      y += 8;

      doc.setFontSize(9);
      doc.setFont('NotoSansTC', 'normal');
      doc.setFillColor(240, 240, 240);
      doc.rect(20, y, pageWidth - 40, 7, 'F');
      doc.text('日期', 22, y + 5);
      doc.text('風險等級', 62, y + 5);
      doc.text('狀態', 102, y + 5);
      doc.text('依據', 132, y + 5);
      y += 10;

      // Placeholder row
      doc.setTextColor(140, 140, 140);
      doc.text('（警示資料將於後續版本從 Dexie 載入）', 22, y + 5);
      y += 10;
      doc.setTextColor(0, 0, 0);

      // Footer
      const footerY = doc.internal.pageSize.getHeight() - 15;
      doc.setFontSize(8);
      doc.setTextColor(160, 160, 160);
      doc.text(
        '由高齡周全性評估（CGA）智慧系統產製',
        pageWidth / 2,
        footerY,
        { align: 'center' },
      );

      // Save
      doc.save(`cdss-report-${patientId}-${dateFrom}-${dateTo}.pdf`);
    } finally {
      isGenerating = false;
    }
  }
</script>

<div class="report-export" aria-label="匯出報告">
  <h3 class="export-title">匯出報告</h3>

  <div class="date-range">
    <div class="date-field">
      <label for="date-from" class="date-label">開始日期</label>
      <input
        id="date-from"
        type="date"
        class="date-input"
        bind:value={dateFrom}
        aria-label="報告開始日期"
      />
    </div>
    <div class="date-field">
      <label for="date-to" class="date-label">結束日期</label>
      <input
        id="date-to"
        type="date"
        class="date-input"
        bind:value={dateTo}
        aria-label="報告結束日期"
      />
    </div>
  </div>

  <button
    class="export-btn"
    onclick={generateReport}
    disabled={isGenerating || !dateFrom || !dateTo}
    aria-label="產生 PDF 報告"
  >
    {isGenerating ? '產生中...' : '產生報告'}
  </button>
</div>

<style>
  .report-export {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding: var(--space-4);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background-color: var(--surface);
  }

  .export-title {
    margin: 0;
    font-size: var(--text-caption);
    font-weight: var(--font-medium);
    color: var(--text);
  }

  .date-range {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
  }

  .date-field {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .date-label {
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
  }

  .date-input {
    min-height: 44px;
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    font-size: var(--text-xs);
    color: var(--text);
    background-color: var(--bg);
  }

  .date-input:focus {
    outline: 2px solid var(--accent);
    outline-offset: -1px;
    border-color: var(--accent);
  }

  .export-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: var(--space-3) var(--space-6);
    border: none;
    border-radius: var(--radius-md);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    color: white;
    background-color: var(--accent);
    cursor: pointer;
    transition: background-color 0.2s ease;
    align-self: flex-start;
  }

  .export-btn:hover:not(:disabled) {
    background-color: color-mix(in srgb, var(--accent) 85%, black);
  }

  .export-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .export-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
