import fs from 'node:fs/promises';
import path from 'node:path';
import type { Verdict } from './heuristics';

export interface ReportCandidate {
  videoId: string;
  title: string;
  channel: string;
  sourceTier: string;
  duration: number;
  subtitleType: 'human' | 'auto' | 'none';
  score: number;
  subtitleHead: string;
  subtitleTail: string;
  verdict: Verdict;
  notes?: string;
}

export interface ReportData {
  trigger: string;
  generatedAt: string;
  candidates: ReportCandidate[];
  pipelineNotes: string[];
}

const CHECKLIST = [
  '臨床正確性',
  '年齡適配',
  '症狀 vs 診斷區隔',
  '無商業推銷',
  '無偽科學',
  '家長語氣',
  '資訊密度',
  '無 PII 暴露',
  '頻道身分驗證',
  '時效性',
];

export async function writeReport(data: ReportData, reportsDir: string): Promise<string> {
  const lines: string[] = [];
  lines.push(`# Curate Report: ${data.trigger}`);
  lines.push('');
  lines.push(`- generated: ${data.generatedAt}`);
  if (data.pipelineNotes.length) {
    lines.push(`- pipeline: ${data.pipelineNotes.join(', ')}`);
  }
  lines.push('');

  if (data.candidates.length === 0) {
    lines.push('**No candidates remained after heuristics.**');
  }

  for (const c of data.candidates) {
    lines.push(`## Candidate: ${c.videoId} — ${c.title}`);
    lines.push(`- channel: ${c.channel} (${c.sourceTier})`);
    lines.push(`- duration: ${c.duration}s | subtitleType: ${c.subtitleType} | score: ${c.score.toFixed(2)}`);
    lines.push(`- Auto verdict: **${c.verdict}**`);
    lines.push('');
    lines.push('subtitle head (≤ 200 chars):');
    lines.push('```');
    lines.push(c.subtitleHead);
    lines.push('```');
    lines.push('');
    lines.push('subtitle tail (≤ 200 chars):');
    lines.push('```');
    lines.push(c.subtitleTail);
    lines.push('```');
    lines.push('');
    lines.push('### Claude Code 複審 Checklist');
    for (let i = 0; i < CHECKLIST.length; i++) {
      lines.push(`- [ ] ${i + 1}. ${CHECKLIST[i]}`);
    }
    lines.push('');
    lines.push('**Final Verdict**: <verified|rejected|needs-review>');
    lines.push('');
    lines.push(`**Notes**: ${c.notes ?? ''}`);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  await fs.mkdir(reportsDir, { recursive: true });
  const reportPath = path.join(reportsDir, `${data.trigger}.md`);
  await fs.writeFile(reportPath, lines.join('\n'));
  return reportPath;
}
