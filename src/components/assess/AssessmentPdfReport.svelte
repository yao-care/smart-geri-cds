<script lang="ts">
  import type { Assessment, Child } from '../../lib/db/schema';
  import { ageInMonths, CFS_LABELS } from '../../lib/utils/cfs-levels';
  import { loadChineseFontInto } from '../../lib/pdf/font-loader';

  interface Props {
    assessment: Assessment;
    child: Child;
    onGenerated?: () => void;
  }

  let { assessment, child, onGenerated }: Props = $props();

  let generating = $state(false);
  let error = $state<string | null>(null);

  const categoryLabelsCn: Record<string, string> = {
    normal: '正常',
    monitor: '追蹤觀察',
    refer: '建議轉介',
    incomplete: '尚未完成',
  };

  // Aligns with AssessmentStatus: started | paused | resumed | completed | incomplete
  const statusLabelsCn: Record<string, string> = {
    started: '已開始',
    paused: '已暫停',
    resumed: '已恢復',
    completed: '已完成',
    incomplete: '未完成',
  };

  function formatDate(d: Date | string): string {
    const date = typeof d === 'string' ? new Date(d) : d;
    return date.toLocaleDateString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }

  function formatTimestamp(d: Date): string {
    return d.toLocaleString('zh-TW', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function abbreviateId(id: string): string {
    return id.length > 8 ? id.slice(0, 8) + '...' : id;
  }

  async function generatePdf() {
    if (generating) return;
    generating = true;
    error = null;

    try {
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      await loadChineseFontInto(doc);

      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 20;
      const contentWidth = pageWidth - margin * 2;
      let y = margin;

      function drawLine(text: string, fontSize: number, fontStyle: 'normal' | 'bold' = 'normal', align: 'left' | 'center' = 'left') {
        doc.setFontSize(fontSize);
        doc.setFont('NotoSansTC', fontStyle);
        const x = align === 'center' ? pageWidth / 2 : margin;
        doc.text(text, x, y, { align });
        y += fontSize * 0.5 + 2;
      }

      function drawSeparator() {
        doc.setDrawColor(200, 200, 200);
        doc.line(margin, y, pageWidth - margin, y);
        y += 4;
      }

      // ===== Title =====
      drawLine('高齡周全性評估報告', 16, 'bold', 'center');
      y += 4;
      drawSeparator();

      // ===== Basic Info =====
      drawLine('評估資訊', 12, 'bold');
      y += 2;

      const assessDate = assessment.completedAt
        ? formatDate(assessment.completedAt)
        : formatDate(assessment.startedAt);
      // DOB is optional for CGA; ageInMonths returns 0 when absent.
      const monthsAtAssess = child.birthDate ? ageInMonths(child.birthDate) : 0;

      drawLine(`受測者識別碼：${abbreviateId(child.id)}`, 10);
      drawLine(`評估日期：${assessDate}`, 10);
      if (monthsAtAssess > 0) {
        drawLine(`年齡：約 ${Math.floor(monthsAtAssess / 12)} 歲`, 10);
      }
      drawLine(`臨床衰弱量表 (CFS)：${CFS_LABELS[assessment.cfsLevel] ?? assessment.cfsLevel}`, 10);
      drawLine(`狀態：${statusLabelsCn[assessment.status] ?? assessment.status}`, 10);
      y += 4;
      drawSeparator();

      // ===== Triage Result =====
      const triage = assessment.triageResult;
      if (triage) {
        drawLine('分流結果', 12, 'bold');
        y += 2;

        const catLabel = categoryLabelsCn[triage.category] ?? triage.category;
        drawLine(`分類：${catLabel}`, 10);
        const summaryLines = doc.splitTextToSize(`摘要：${triage.summary}`, contentWidth);
        doc.setFontSize(10);
        doc.setFont('NotoSansTC', 'normal');
        doc.text(summaryLines, margin, y);
        y += summaryLines.length * 5 + 2;
        y += 4;
        drawSeparator();
      }

      // ===== Disclaimer =====
      y += 4;
      doc.setFontSize(9);
      doc.setFont('NotoSansTC', 'bold');
      doc.text('免責聲明', pageWidth / 2, y, { align: 'center' });
      y += 5;
      doc.setFont('NotoSansTC', 'normal');
      doc.setFontSize(8);
      const disclaimer = '本評估結果僅供參考，不構成醫療診斷。如有疑慮請諮詢專業醫療人員。';
      const disclaimerLines = doc.splitTextToSize(disclaimer, contentWidth);
      doc.text(disclaimerLines, margin, y);
      y += disclaimerLines.length * 4 + 6;

      // ===== Footer =====
      drawSeparator();
      doc.setFontSize(8);
      doc.setFont('NotoSansTC', 'normal');
      doc.setTextColor(150, 150, 150);
      doc.text(`產製時間：${formatTimestamp(new Date())}`, margin, y);
      doc.text('高齡周全性評估 (CGA) 系統', pageWidth - margin, y, { align: 'right' });

      const filename = `cga-report-${abbreviateId(assessment.id)}-${assessDate.replace(/\//g, '')}.pdf`;
      doc.save(filename);

      onGenerated?.();
    } catch (err) {
      error = err instanceof Error ? err.message : 'PDF generation failed';
    } finally {
      generating = false;
    }
  }
</script>

<button class="btn-pdf" onclick={generatePdf} disabled={generating}>
  {#if generating}
    PDF 產生中...
  {:else}
    下載 PDF 報告
  {/if}
</button>

{#if error}
  <p class="pdf-error">{error}</p>
{/if}

<style>
  .btn-pdf {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-5);
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    cursor: pointer;
    min-height: 44px;
    transition: border-color 0.2s, background 0.2s;
  }

  .btn-pdf:hover:not(:disabled) {
    border-color: var(--accent);
    background: var(--accent);
    color: white;
  }

  .btn-pdf:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .pdf-error {
    font-size: var(--text-xs);
    color: var(--danger);
    margin-top: var(--space-2);
  }
</style>
