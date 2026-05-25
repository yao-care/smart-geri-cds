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
