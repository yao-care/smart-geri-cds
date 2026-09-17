import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import EducationMatrix from '../../src/components/education/EducationMatrix.svelte';
import { buildCellViews } from '$lib/education/matrix-view';
import { buildMatrixData } from '$lib/education/matrix-data';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** 手機 bottom sheet 的行為由 media query 決定，jsdom 不會自己回報寬度，故明確 stub。 */
function stubViewport(isMobile: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: isMobile,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

const cells = buildCellViews(
  buildMatrixData({ 'cga.domain.physical.comorbidity.anomaly.cfs5': { videoIds: [], inapplicable: false, educationSlug: 'comorb' } }),
  { comorb: '共病照護' }, {},
);

describe('EducationMatrix', () => {
  it('shows the empty-state panel before any selection', () => {
    render(EducationMatrix, { cells, articleContent: {} });
    expect(screen.getByText(/點左側任一格子/)).toBeTruthy();
  });

  it('selecting a cell swaps the panel to that cell content', async () => {
    render(EducationMatrix, { cells, articleContent: {} });
    await fireEvent.click(screen.getByRole('button', { name: /多重共病.*CFS 5/ }));
    expect(screen.getByText('共病照護')).toBeTruthy();
  });

  it('Escape clears the selection back to empty state', async () => {
    render(EducationMatrix, { cells, articleContent: {} });
    await fireEvent.click(screen.getByRole('button', { name: /多重共病.*CFS 5/ }));
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByText(/點左側任一格子/)).toBeTruthy();
  });

  it('announces the selected context in a concise live region', async () => {
    render(EducationMatrix, { cells, articleContent: {} });
    await fireEvent.click(screen.getByRole('button', { name: /多重共病.*CFS 5/ }));
    expect(screen.getByText(/已選取 多重共病/)).toBeTruthy();
  });
});

describe('EducationMatrix — 手機 bottom sheet a11y', () => {
  // Svelte 把 inert 當 DOM property 設定（瀏覽器會自動反映成屬性，jsdom 未實作 inert
  // 故看不到屬性）——因此斷言 property 而非 attribute。
  const isInert = (el: Element | null) => (el as HTMLElement & { inert?: boolean } | null)?.inert === true;

  it('開啟時 sheet 具 dialog 語意，背後的矩陣設為 inert', async () => {
    stubViewport(true);
    const { container } = render(EducationMatrix, { cells, articleContent: {} });
    expect(isInert(container.querySelector('.grid-col'))).toBe(false);

    await fireEvent.click(screen.getByRole('button', { name: /多重共病.*CFS 5/ }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(isInert(container.querySelector('.grid-col'))).toBe(true);
  });

  it('桌機並排面板不套 dialog 語意，也不 inert 矩陣', async () => {
    stubViewport(false);
    const { container } = render(EducationMatrix, { cells, articleContent: {} });
    await fireEvent.click(screen.getByRole('button', { name: /多重共病.*CFS 5/ }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(isInert(container.querySelector('.grid-col'))).toBe(false);
  });

  it('開啟時焦點移入 sheet，關閉後還給原本的格子', async () => {
    stubViewport(true);
    render(EducationMatrix, { cells, articleContent: {} });
    const trigger = screen.getByRole('button', { name: /多重共病.*CFS 5/ });
    trigger.focus();
    await fireEvent.click(trigger);

    expect(document.activeElement).toBe(screen.getByRole('button', { name: '關閉面板' }));

    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(document.activeElement).toBe(trigger);
  });

  it('Tab 在 sheet 內循環，不會跑到背後的矩陣', async () => {
    stubViewport(true);
    render(EducationMatrix, { cells, articleContent: {} });
    await fireEvent.click(screen.getByRole('button', { name: /多重共病.*CFS 5/ }));

    const closeBtn = screen.getByRole('button', { name: '關閉面板' });
    const sheet = screen.getByRole('dialog');
    const focusables = [...sheet.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
    const last = focusables[focusables.length - 1];

    last.focus();
    await fireEvent.keyDown(window, { key: 'Tab' });
    expect(document.activeElement).toBe(closeBtn);

    await fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});
