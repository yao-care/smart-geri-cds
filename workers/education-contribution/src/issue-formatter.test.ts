import { describe, it, expect } from 'vitest';
import { formatIssueTitle, formatIssueBody } from './issue-formatter';

describe('formatIssueTitle', () => {
  it('formats YouTube title correctly (CGA axis)', () => {
    const title = formatIssueTitle({
      type: 'youtube', top: 'psychological', sub: 'mood', cfsLevel: 'cfs5',
      url: 'https://youtu.be/abcdefghijk', title: '老年憂鬱衛教影片',
    });
    expect(title).toBe('[衛教貢獻] 情緒 × CFS 5 輕度衰弱｜YouTube 影片｜老年憂鬱衛教影片');
  });

  it('falls back to URL when title missing', () => {
    const title = formatIssueTitle({
      type: 'youtube', top: 'psychological', sub: 'mood', cfsLevel: 'cfs5',
      url: 'https://youtu.be/abcdefghijk',
    });
    expect(title).toContain('https://youtu.be/abcdefghijk');
  });

  it('handles unknown domain/cfs gracefully', () => {
    const title = formatIssueTitle({
      type: 'article', top: 'unknown_top', sub: 'unknown_sub', cfsLevel: 'cfsX',
      title: '測試文章',
    });
    expect(title).toContain('unknown_top.unknown_sub');
    expect(title).toContain('cfsX');
  });
});

describe('formatIssueBody', () => {
  it('includes domain label and cfs level in body', () => {
    const body = formatIssueBody({
      type: 'youtube', top: 'psychological', sub: 'mood', cfsLevel: 'cfs5',
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
    });
    expect(body).toContain('情緒');
    expect(body).toContain('輕度衰弱');
    expect(body).toContain('cfs5');
    expect(body).toContain('psychological.mood');
  });

  it('includes YouTube URL in body', () => {
    const body = formatIssueBody({
      type: 'youtube', top: 'psychological', sub: 'mood', cfsLevel: 'cfs5',
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
    });
    expect(body).toContain('https://www.youtube.com/watch?v=abcdefghijk');
  });

  it('emits a cga.domain trigger in the yaml hint with extracted video ID', () => {
    const body = formatIssueBody({
      type: 'youtube', top: 'functional', sub: 'falls', cfsLevel: 'cfs6',
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
    });
    expect(body).toContain('cga.domain.functional.falls.anomaly.cfs6');
    expect(body).toContain('abcdefghijk');
    expect(body).toContain('content-relevance.yaml');
  });

  it('includes article content in body', () => {
    const body = formatIssueBody({
      type: 'article', top: 'psychological', sub: 'cognition', cfsLevel: 'cfs5',
      title: '認知促進活動指南', summary: '促進認知功能的活動',
      content: '## 介紹\n\n這是內容',
    });
    expect(body).toContain('認知促進活動指南');
    expect(body).toContain('促進認知功能的活動');
  });

  it('includes submitter when provided', () => {
    const body = formatIssueBody({
      type: 'article', top: 'psychological', sub: 'cognition', cfsLevel: 'cfs5',
      title: '文章', submitter: 'Dr. Chen，老年醫學科',
    });
    expect(body).toContain('Dr. Chen，老年醫學科');
  });
});

describe('edit-article / delete-article / delete-video', () => {
  it('edit-article title starts with [衛教修改] and contains targetSlug', () => {
    const title = formatIssueTitle({
      type: 'edit-article', top: 'psychological', sub: 'mood', cfsLevel: 'cfs5',
      targetSlug: 'late-life-depression-tips', title: '老年憂鬱改版標題',
    });
    expect(title.startsWith('[衛教修改]')).toBe(true);
    expect(title).toContain('late-life-depression-tips');
  });

  it('edit-article body contains proposed title and targetSlug', () => {
    const body = formatIssueBody({
      type: 'edit-article', top: 'psychological', sub: 'mood', cfsLevel: 'cfs5',
      targetSlug: 'late-life-depression-tips', title: '老年憂鬱改版標題',
      summary: '更新摘要', notes: '原文有錯誤',
    });
    expect(body).toContain('老年憂鬱改版標題');
    expect(body).toContain('late-life-depression-tips');
  });

  it('delete-article title starts with [衛教刪除文章]', () => {
    const title = formatIssueTitle({
      type: 'delete-article', top: 'psychological', sub: 'cognition', cfsLevel: 'cfs5',
      targetSlug: 'old-cognition-article', notes: '內容過時',
    });
    expect(title.startsWith('[衛教刪除文章]')).toBe(true);
    expect(title).toContain('old-cognition-article');
  });

  it('delete-video title starts with [衛教刪除影片] and shows videoTitle when provided', () => {
    const title = formatIssueTitle({
      type: 'delete-video', top: 'functional', sub: 'mobility', cfsLevel: 'cfs6',
      targetVideoId: 'abc12345678', videoTitle: '步態訓練示範', notes: '影片連結失效',
    });
    expect(title.startsWith('[衛教刪除影片]')).toBe(true);
    expect(title).toContain('步態訓練示範');
  });

  it('delete-video title falls back to targetVideoId when videoTitle absent', () => {
    const title = formatIssueTitle({
      type: 'delete-video', top: 'functional', sub: 'mobility', cfsLevel: 'cfs6',
      targetVideoId: 'abc12345678', notes: '影片連結失效',
    });
    expect(title).toContain('abc12345678');
  });

  it('delete-video body contains deletion reason', () => {
    const body = formatIssueBody({
      type: 'delete-video', top: 'functional', sub: 'mobility', cfsLevel: 'cfs6',
      targetVideoId: 'abc12345678', videoTitle: '步態訓練示範',
      notes: '影片連結已失效，請移除',
    });
    expect(body).toContain('影片連結已失效，請移除');
    expect(body).toContain('abc12345678');
  });
});
