import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';
import EducationMatrix from '../../src/components/education/EducationMatrix.svelte';
import { buildCellViews } from '$lib/education/matrix-view';
import { buildMatrixData } from '$lib/education/matrix-data';

afterEach(() => cleanup());

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
