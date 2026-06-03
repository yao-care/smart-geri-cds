import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import MatrixGrid from '../../src/components/education/MatrixGrid.svelte';
import { buildCellViews } from '$lib/education/matrix-view';
import { buildMatrixData } from '$lib/education/matrix-data';

afterEach(() => cleanup());

const triggers = {
  'cga.domain.physical.comorbidity.anomaly.cfs5': { videoIds: ['v1','v2'], inapplicable: false, educationSlug: 'comorb' },
  'cga.domain.physical.comorbidity.anomaly.cfs1': { videoIds: [],          inapplicable: true  },
};
const cells = buildCellViews(buildMatrixData(triggers), { comorb: '共病照護' }, {
  v1: { title: 'A', channel: 'C', duration: 1, videoId: 'v1' },
  v2: { title: 'B', channel: 'C', duration: 1, videoId: 'v2' },
});

describe('MatrixGrid', () => {
  it('renders a top-group header (生理/醫療) and a sub-domain row (多重共病)', () => {
    render(MatrixGrid, { cells, selectedKey: null, onselect: () => {} });
    expect(screen.getByText('生理/醫療')).toBeTruthy();
    expect(screen.getByText('多重共病')).toBeTruthy();
  });

  it('shows the resource count (3) for a populated cell', () => {
    render(MatrixGrid, { cells, selectedKey: null, onselect: () => {} });
    // comorbidity:cfs5 = 1 article + 2 videos = 3
    expect(screen.getByRole('button', { name: '多重共病，CFS 5（輕度衰弱），3 項資源' })).toBeTruthy();
  });

  it('renders an inapplicable cell as non-button "–"', () => {
    render(MatrixGrid, { cells, selectedKey: null, onselect: () => {} });
    expect(screen.queryByRole('button', { name: /多重共病.*CFS 1/ })).toBeNull();
  });

  it('calls onselect with the cell key when a cell is clicked', async () => {
    const onselect = vi.fn();
    render(MatrixGrid, { cells, selectedKey: null, onselect });
    await fireEvent.click(screen.getByRole('button', { name: /多重共病.*CFS 5/ }));
    expect(onselect).toHaveBeenCalledWith('physical.comorbidity:cfs5');
  });

  it('collapses a group when its header is clicked', async () => {
    render(MatrixGrid, { cells, selectedKey: null, onselect: () => {} });
    expect(screen.getByText('多重共病')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: /生理\/醫療/ }));
    expect(screen.queryByText('多重共病')).toBeNull();
  });

  it('ArrowRight moves focus to the next cell in the same row', async () => {
    const all = buildCellViews(buildMatrixData({}), {}, {});
    render(MatrixGrid, { cells: all, selectedKey: null, onselect: () => {} });
    const first = screen.getByRole('button', { name: /多重共病.*CFS 1/ });
    first.focus();
    await fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /多重共病.*CFS 2/ }));
  });

  it('ArrowDown moves focus to the same column in the next sub-domain row', async () => {
    const all = buildCellViews(buildMatrixData({}), {}, {});
    render(MatrixGrid, { cells: all, selectedKey: null, onselect: () => {} });
    const a = screen.getByRole('button', { name: /多重共病.*CFS 1/ });
    a.focus();
    await fireEvent.keyDown(a, { key: 'ArrowDown' });
    // physical 的第二個 sub 是「多重用藥」(polypharmacy)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /多重用藥.*CFS 1/ }));
  });

  it('marks the selected cell with aria-current', () => {
    render(MatrixGrid, { cells, selectedKey: 'physical.comorbidity:cfs5', onselect: () => {} });
    expect(screen.getByRole('button', { name: /多重共病.*CFS 5/ }).getAttribute('aria-current')).toBe('true');
  });

  it('flips aria-expanded when the group toggles', async () => {
    render(MatrixGrid, { cells, selectedKey: null, onselect: () => {} });
    const toggle = screen.getByRole('button', { name: /生理\/醫療/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    await fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('ArrowUp moves focus to the previous sub-domain row', async () => {
    const all = buildCellViews(buildMatrixData({}), {}, {});
    render(MatrixGrid, { cells: all, selectedKey: null, onselect: () => {} });
    const b = screen.getByRole('button', { name: /多重用藥.*CFS 1/ });
    b.focus();
    await fireEvent.keyDown(b, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /多重共病.*CFS 1/ }));
  });

  it('ArrowLeft at the first column keeps focus (boundary, no crash)', async () => {
    const all = buildCellViews(buildMatrixData({}), {}, {});
    render(MatrixGrid, { cells: all, selectedKey: null, onselect: () => {} });
    const first = screen.getByRole('button', { name: /多重共病.*CFS 1/ });
    first.focus();
    await fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(first);
  });
});
