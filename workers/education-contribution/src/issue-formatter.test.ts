import { describe, it, expect } from 'vitest';
import { formatIssueTitle, formatIssueBody } from './issue-formatter';

describe('formatIssueTitle', () => {
  it('formats YouTube title correctly', () => {
    const title = formatIssueTitle({
      type: 'youtube', domain: 'language', ageGroup: '13-24m',
      url: 'https://youtu.be/abcdefghijk', title: '語言發展影片',
    });
    expect(title).toBe('[衛教貢獻] 語言 × 1-2 歲｜YouTube 影片｜語言發展影片');
  });

  it('falls back to URL when title missing', () => {
    const title = formatIssueTitle({
      type: 'youtube', domain: 'language', ageGroup: '13-24m',
      url: 'https://youtu.be/abcdefghijk',
    });
    expect(title).toContain('https://youtu.be/abcdefghijk');
  });

  it('handles unknown domain/age gracefully', () => {
    const title = formatIssueTitle({
      type: 'article', domain: 'unknown_domain', ageGroup: 'future-age',
      title: '測試文章',
    });
    expect(title).toContain('unknown_domain');
    expect(title).toContain('future-age');
  });
});

describe('formatIssueBody', () => {
  it('includes domain and ageGroup in body', () => {
    const body = formatIssueBody({
      type: 'youtube', domain: 'language', ageGroup: '13-24m',
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
    });
    expect(body).toContain('語言');
    expect(body).toContain('1-2 歲');
    expect(body).toContain('13-24m');
  });

  it('includes YouTube URL in body', () => {
    const body = formatIssueBody({
      type: 'youtube', domain: 'language', ageGroup: '13-24m',
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
    });
    expect(body).toContain('https://www.youtube.com/watch?v=abcdefghijk');
  });

  it('includes extracted video ID in yaml hint', () => {
    const body = formatIssueBody({
      type: 'youtube', domain: 'language', ageGroup: '13-24m',
      url: 'https://www.youtube.com/watch?v=abcdefghijk',
    });
    expect(body).toContain('abcdefghijk');
  });

  it('includes article content in body', () => {
    const body = formatIssueBody({
      type: 'article', domain: 'cognition', ageGroup: '25-36m',
      title: '認知遊戲指南', summary: '促進認知發展的遊戲活動',
      content: '## 介紹\n\n這是內容',
    });
    expect(body).toContain('認知遊戲指南');
    expect(body).toContain('促進認知發展的遊戲活動');
  });

  it('includes submitter when provided', () => {
    const body = formatIssueBody({
      type: 'article', domain: 'cognition', ageGroup: '25-36m',
      title: '文章', submitter: 'Dr. Chen，台大兒科',
    });
    expect(body).toContain('Dr. Chen，台大兒科');
  });
});

describe('edit-article / delete-article / delete-video', () => {
  it('edit-article title starts with [衛教修改] and contains targetSlug', () => {
    const title = formatIssueTitle({
      type: 'edit-article', domain: 'language', ageGroup: '13-24m',
      targetSlug: 'language-delay-tips', title: '語言遲緩改版標題',
    });
    expect(title.startsWith('[衛教修改]')).toBe(true);
    expect(title).toContain('language-delay-tips');
  });

  it('edit-article body contains proposed title and targetSlug', () => {
    const body = formatIssueBody({
      type: 'edit-article', domain: 'language', ageGroup: '13-24m',
      targetSlug: 'language-delay-tips', title: '語言遲緩改版標題',
      summary: '更新摘要', notes: '原文有錯誤',
    });
    expect(body).toContain('語言遲緩改版標題');
    expect(body).toContain('language-delay-tips');
  });

  it('delete-article title starts with [衛教刪除文章]', () => {
    const title = formatIssueTitle({
      type: 'delete-article', domain: 'cognition', ageGroup: '25-36m',
      targetSlug: 'old-cognition-article', notes: '內容過時',
    });
    expect(title.startsWith('[衛教刪除文章]')).toBe(true);
    expect(title).toContain('old-cognition-article');
  });

  it('delete-video title starts with [衛教刪除影片] and shows videoTitle when provided', () => {
    const title = formatIssueTitle({
      type: 'delete-video', domain: 'gross_motor', ageGroup: '7-12m',
      targetVideoId: 'abc12345678', videoTitle: '爬行練習示範', notes: '影片連結失效',
    });
    expect(title.startsWith('[衛教刪除影片]')).toBe(true);
    expect(title).toContain('爬行練習示範');
  });

  it('delete-video title falls back to targetVideoId when videoTitle absent', () => {
    const title = formatIssueTitle({
      type: 'delete-video', domain: 'gross_motor', ageGroup: '7-12m',
      targetVideoId: 'abc12345678', notes: '影片連結失效',
    });
    expect(title).toContain('abc12345678');
  });

  it('delete-video body contains deletion reason', () => {
    const body = formatIssueBody({
      type: 'delete-video', domain: 'gross_motor', ageGroup: '7-12m',
      targetVideoId: 'abc12345678', videoTitle: '爬行練習示範',
      notes: '影片連結已失效，請移除',
    });
    expect(body).toContain('影片連結已失效，請移除');
    expect(body).toContain('abc12345678');
  });
});
