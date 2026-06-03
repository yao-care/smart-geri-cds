import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import DetailPanel from '../../src/components/education/DetailPanel.svelte';
import type { CellView } from '$lib/education/matrix-view';

afterEach(() => cleanup());

const coverage = { withResources: 2, empty: 177, inapplicable: 1, total: 180 };
const cell: CellView = {
  inapplicable: false,
  articles: [{ slug: 'mood-care', title: '情緒照護' }],
  videos: [{ videoId: 'v1', title: '用藥安全', channel: 'CH', duration: 90 }],
};

describe('DetailPanel', () => {
  it('shows the empty state with coverage when nothing is selected', () => {
    render(DetailPanel, { selectedKey: null, cell: null, articleContent: {}, coverage });
    expect(screen.getByText(/點左側任一格子/)).toBeTruthy();
    expect(screen.getByText(/177/)).toBeTruthy(); // 待補格數
  });

  it('reads the selected cell: domain/cfs heading, article and video', () => {
    render(DetailPanel, { selectedKey: 'psychological.mood:cfs5', cell, articleContent: {}, coverage });
    expect(screen.getByText('情緒')).toBeTruthy();
    expect(screen.getByText(/CFS 5/)).toBeTruthy();
    expect(screen.getByText('情緒照護')).toBeTruthy();
    expect(screen.getByText('用藥安全')).toBeTruthy();
  });

  it('clicking ＋ 貢獻資源 switches to the contribution form', async () => {
    render(DetailPanel, { selectedKey: 'psychological.mood:cfs5', cell, articleContent: {}, coverage });
    await fireEvent.click(screen.getByText('＋ 貢獻資源'));
    expect(screen.getByText(/送出＝提交建議/)).toBeTruthy();
  });

  it('clicking 返回 in the form goes back to the reading view', async () => {
    render(DetailPanel, { selectedKey: 'psychological.mood:cfs5', cell, articleContent: {}, coverage });
    await fireEvent.click(screen.getByText('＋ 貢獻資源'));
    await fireEvent.click(screen.getByText('← 返回'));
    expect(screen.getByText('＋ 貢獻資源')).toBeTruthy();
  });

  it('clicking ✏️ opens the edit-article form prefilled from articleContent', async () => {
    render(DetailPanel, {
      selectedKey: 'psychological.mood:cfs5', cell,
      articleContent: { 'mood-care': { title: '情緒照護', summary: '摘要', content: '內文' } },
      coverage,
    });
    await fireEvent.click(screen.getByLabelText('修改文章'));
    expect(screen.getByText('修改文章（建議）')).toBeTruthy();
    expect((screen.getByDisplayValue('情緒照護') as HTMLInputElement).value).toBe('情緒照護');
  });

  it('clicking 🗑️ on a video opens the delete-video form', async () => {
    render(DetailPanel, { selectedKey: 'psychological.mood:cfs5', cell, articleContent: {}, coverage });
    await fireEvent.click(screen.getByLabelText('刪除影片'));
    expect(screen.getByText('刪除影片（建議）')).toBeTruthy();
  });
});
