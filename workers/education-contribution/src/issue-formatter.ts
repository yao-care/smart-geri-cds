export type ContributionPayload = {
  type: 'youtube' | 'article' | 'external-link' | 'edit-article' | 'delete-article' | 'delete-video';
  domain: string;
  ageGroup: string;
  url?: string;
  title?: string;
  summary?: string;
  content?: string;
  notes?: string;
  submitter?: string;
  targetSlug?: string;
  targetVideoId?: string;
  videoTitle?: string;
};

const DOMAIN_ZH: Record<string, string> = {
  behavior: '行為', gross_motor: '粗動作', fine_motor: '細動作',
  language: '語言', language_comprehension: '語言理解',
  language_expression: '語言表達', cognition: '認知', social_emotional: '社交情緒',
};

const AGE_ZH: Record<string, string> = {
  '2-6m': '2-6 個月', '7-12m': '7-12 個月', '13-24m': '1-2 歲',
  '25-36m': '2-3 歲', '37-48m': '3-4 歲', '49-60m': '4-5 歲', '61-72m': '5-6 歲',
};

const TYPE_ZH: Record<string, string> = {
  youtube: 'YouTube 影片', article: 'Markdown 文章', 'external-link': '外部連結',
};

function extractVideoId(url: string): string {
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/);
  return m?.[1] ?? '（請手動填入 11 碼 video ID）';
}

export function formatIssueTitle(p: ContributionPayload): string {
  const domain = DOMAIN_ZH[p.domain] ?? p.domain;
  const age    = AGE_ZH[p.ageGroup] ?? p.ageGroup;

  if (p.type === 'edit-article') {
    return `[衛教修改] ${domain} × ${age}｜${p.targetSlug ?? '（未填 slug）'}`;
  }
  if (p.type === 'delete-article') {
    return `[衛教刪除文章] ${domain} × ${age}｜${p.targetSlug ?? '（未填 slug）'}`;
  }
  if (p.type === 'delete-video') {
    return `[衛教刪除影片] ${domain} × ${age}｜${p.videoTitle ?? p.targetVideoId ?? '（未填）'}`;
  }

  const type  = TYPE_ZH[p.type];
  const label = p.title ?? p.url ?? '（無標題）';
  return `[衛教貢獻] ${domain} × ${age}｜${type}｜${label}`;
}

export function formatIssueBody(p: ContributionPayload): string {
  const domain = DOMAIN_ZH[p.domain] ?? p.domain;
  const age    = AGE_ZH[p.ageGroup] ?? p.ageGroup;
  const now    = new Date().toISOString();

  // ── edit-article ─────────────────────────────────────────────────────────
  if (p.type === 'edit-article') {
    let proposedContent = '';
    if (p.content) {
      proposedContent = `\n\n**建議內容預覽**:\n\`\`\`markdown\n${p.content.slice(0, 500)}\n\`\`\``;
    }
    return `## 衛教文章修改申請

**目標文章 slug**: \`${p.targetSlug ?? '（未填）'}\`
**年齡段**: ${age} (${p.ageGroup})
**發展領域**: ${domain} (${p.domain})

### 建議修改內容

- 建議標題: ${p.title ?? '（未填）'}
- 建議摘要: ${p.summary ?? '（未填）'}${proposedContent}

### 補充說明

> ${p.notes ?? '（無）'}

**提交者**: ${p.submitter ?? '（未填）'}
**提交時間**: ${now}

---

### 維護者操作提示

修改目標檔案：\`src/data/education/${p.targetSlug ?? '<slug>'}.md\``.trim();
  }

  // ── delete-article ────────────────────────────────────────────────────────
  if (p.type === 'delete-article') {
    return `## 衛教文章刪除申請

**目標文章 slug**: \`${p.targetSlug ?? '（未填）'}\`
**年齡段**: ${age} (${p.ageGroup})
**發展領域**: ${domain} (${p.domain})

### 刪除原因

> ${p.notes ?? '（未填）'}

**提交者**: ${p.submitter ?? '（未填）'}
**提交時間**: ${now}

---

### 維護者操作提示

1. 從 \`content-relevance.yaml\` 中移除 \`- slug: ${p.targetSlug ?? '<slug>'}\` 這行。
2. 若該 .md 不再被任何其他 cell 引用，可一併刪除 \`src/data/education/${p.targetSlug ?? '<slug>'}.md\`。
3. 注意：coverage test 要求每個適用 cell 至少保留 1 篇文章，請確認移除後仍符合。`.trim();
  }

  // ── delete-video ──────────────────────────────────────────────────────────
  if (p.type === 'delete-video') {
    const videoLabel = p.videoTitle ? `${p.targetVideoId ?? '（未填）'} (${p.videoTitle})` : (p.targetVideoId ?? '（未填）');
    return `## 衛教影片刪除申請

**目標影片 ID**: \`${videoLabel}\`
**年齡段**: ${age} (${p.ageGroup})
**發展領域**: ${domain} (${p.domain})

### 刪除原因

> ${p.notes ?? '（未填）'}

**提交者**: ${p.submitter ?? '（未填）'}
**提交時間**: ${now}

---

### 維護者操作提示

1. 從 \`content-relevance.yaml\` 對應 trigger 的 \`videoIds\` 清單中移除 \`${p.targetVideoId ?? '<videoId>'}\`。
2. 若該 videoId 不再被任何 cell 引用，可一併從 video-catalog 移除。
3. 注意：coverage test 要求每個適用 cell 至少保留 1 支影片，請確認移除後仍符合。`.trim();
  }

  // ── 原有三種類型（youtube / article / external-link）─────────────────────
  const type = TYPE_ZH[p.type];

  let resourceLines = '';
  if (p.type === 'youtube') {
    resourceLines = `- YouTube URL: ${p.url ?? '（未填）'}\n- 標題: ${p.title ?? '（未填）'}`;
  } else if (p.type === 'article') {
    resourceLines = `- 標題: ${p.title ?? '（未填）'}\n- 摘要: ${p.summary ?? '（未填）'}`;
    if (p.content) resourceLines += `\n\n**內容預覽**:\n\`\`\`markdown\n${p.content.slice(0, 500)}\n\`\`\``;
  } else {
    resourceLines = `- URL: ${p.url ?? '（未填）'}\n- 標題: ${p.title ?? '（未填）'}`;
  }

  const yamlHint = p.type === 'youtube'
    ? `\`\`\`yaml\n# src/data/education-videos/cdsa-domains.yaml\n# 找到對應 trigger，將 videoId 加入 videoIds 清單：\n# - trigger: cdsa.domain.${p.domain}.anomaly.${p.ageGroup}\n#   videoIds:\n#     - ${extractVideoId(p.url ?? '')}   # 11 碼\n\`\`\``
    : `（文章/連結請依 README 建立對應的 .md 或 YAML entry）`;

  return `## 衛教貢獻申請

**類型**: ${type}
**年齡段**: ${age} (${p.ageGroup})
**發展領域**: ${domain} (${p.domain})

### 資源資訊

${resourceLines}

### 補充說明

> ${p.notes ?? '（無）'}

**提交者**: ${p.submitter ?? '（未填）'}
**提交時間**: ${now}

---

### 維護者操作區（copy-paste 至 YAML）

${yamlHint}`.trim();
}
