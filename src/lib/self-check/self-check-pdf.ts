import { jsPDF } from 'jspdf';
import { loadChineseFontInto } from '$lib/pdf/font-loader';
import type { SelfCheckSummary } from './summarise';

const OVERALL_LABEL: Record<SelfCheckSummary['overall'], string> = {
  green: '綠燈：目前看起來都還好',
  amber: '黃燈：有幾項建議多留意',
  red: '紅燈：建議盡快尋求協助',
};

/**
 * 產生可帶去門診的自我檢視摘要 PDF。中文以 Noto Sans TC subset 渲染。
 * 不含任何臨床分數（民眾版），只列整體燈號、建議關注領域與免責。
 * @param dateText 由呼叫端傳入（scripts 不可用 Date.now，UI 端以 new Date().toLocaleDateString 傳入）。
 */
export async function buildSelfCheckPdf(summary: SelfCheckSummary, dateText: string): Promise<jsPDF> {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  await loadChineseFontInto(doc);

  const left = 56;
  let y = 72;

  doc.setFont('NotoSansTC', 'bold');
  doc.setFontSize(20);
  doc.text('高齡自我檢視摘要', left, y);
  y += 28;

  doc.setFont('NotoSansTC', 'normal');
  doc.setFontSize(12);
  doc.text(`檢視日期：${dateText}`, left, y);
  y += 28;

  doc.setFont('NotoSansTC', 'bold');
  doc.setFontSize(14);
  doc.text(OVERALL_LABEL[summary.overall], left, y);
  y += 26;

  doc.setFont('NotoSansTC', 'normal');
  doc.setFontSize(12);
  if (summary.redFlag) {
    doc.text('※ 您在情緒題目提到不想活下去或想傷害自己——請立即聯絡 1925 安心專線或就醫。', left, y, { maxWidth: 480 });
    y += 30;
  }

  if (summary.concerns.length > 0) {
    doc.setFont('NotoSansTC', 'bold');
    doc.text('建議多留意的方面：', left, y);
    y += 22;
    doc.setFont('NotoSansTC', 'normal');
    for (const c of summary.concerns) {
      doc.text(`• ${c.label}：${c.advice}`, left + 12, y, { maxWidth: 468 });
      y += 24;
    }
  } else {
    doc.text('各方面目前都沒有需要特別留意的地方。', left, y);
    y += 24;
  }

  if (summary.awareness.length > 0) {
    y += 6;
    doc.setFont('NotoSansTC', 'bold');
    doc.text('您表示有興趣進一步了解：', left, y);
    y += 22;
    doc.setFont('NotoSansTC', 'normal');
    for (const a of summary.awareness) {
      doc.text(`• ${a.label}（可與醫療團隊討論）`, left + 12, y, { maxWidth: 468 });
      y += 24;
    }
  }

  y += 12;
  doc.setFontSize(10);
  doc.text('本工具為自我檢視，非醫療診斷。建議攜此摘要找醫療人員做完整評估。', left, y, { maxWidth: 480 });

  return doc;
}
