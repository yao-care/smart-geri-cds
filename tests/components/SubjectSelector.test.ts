import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import SubjectSelector from '../../src/components/assess/SubjectSelector.svelte';
import type { SubjectWithStats } from '../../src/lib/db/assessments';
import type { Child } from '../../src/lib/db/schema';

function subj(id: string, nickName: string): SubjectWithStats {
  const child: Child = { id, nickName, gender: 'male', birthDate: '1950-01-01', createdAt: new Date('2026-01-01') };
  return { child, assessmentCount: 2, lastAssessedAt: new Date('2026-05-20') };
}

describe('SubjectSelector', () => {
  it('defaults to 新增 mode; choosing 沿用既有 reveals the subject list', async () => {
    const onSelect = vi.fn();
    render(SubjectSelector, { props: { subjects: [subj('a', '阿嬤')], selectedId: null, onSelect } });
    expect(screen.queryByText('阿嬤')).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('radio', { name: /沿用既有/ }));
    expect(screen.getByText('阿嬤')).toBeInTheDocument();
  });

  it('clicking a subject row calls onSelect with that child', async () => {
    const onSelect = vi.fn();
    render(SubjectSelector, { props: { subjects: [subj('a', '阿嬤')], selectedId: null, onSelect } });
    await fireEvent.click(screen.getByRole('radio', { name: /沿用既有/ }));
    await fireEvent.click(screen.getByRole('button', { name: /阿嬤/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
  });

  it('switching back to 新增 calls onSelect(null)', async () => {
    const onSelect = vi.fn();
    render(SubjectSelector, { props: { subjects: [subj('a', '阿嬤')], selectedId: 'a', onSelect } });
    await fireEvent.click(screen.getByRole('radio', { name: /新增/ }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('disables 沿用既有 with a notice when there are no subjects', () => {
    render(SubjectSelector, { props: { subjects: [], selectedId: null, onSelect: vi.fn() } });
    const reuse = screen.getByRole('radio', { name: /沿用既有/ }) as HTMLInputElement;
    expect(reuse.disabled).toBe(true);
    expect(screen.getByText(/尚無既有受測者/)).toBeInTheDocument();
  });
});
