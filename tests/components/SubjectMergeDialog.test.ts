import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import SubjectMergeDialog from '../../src/components/assess/SubjectMergeDialog.svelte';
import type { SubjectWithStats } from '../../src/lib/db/assessments';
import type { Child } from '../../src/lib/db/schema';

function subj(id: string, nickName: string, count: number): SubjectWithStats {
  const child: Child = { id, nickName, gender: 'male', birthDate: '1950-01-01', createdAt: new Date('2026-01-01') };
  return { child, assessmentCount: count, lastAssessedAt: new Date('2026-05-20') };
}

describe('SubjectMergeDialog', () => {
  it('defaults primary to the subject with most assessments and confirms with its id', async () => {
    const onConfirm = vi.fn();
    render(SubjectMergeDialog, {
      props: { subjects: [subj('a', '甲', 1), subj('b', '乙', 3)], onConfirm, onCancel: vi.fn() },
    });
    expect(screen.getByText(/無法復原/)).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: /確認合併/ }));
    expect(onConfirm).toHaveBeenCalledWith('b');
  });

  it('lets the user pick a different primary', async () => {
    const onConfirm = vi.fn();
    render(SubjectMergeDialog, {
      props: { subjects: [subj('a', '甲', 1), subj('b', '乙', 3)], onConfirm, onCancel: vi.fn() },
    });
    await fireEvent.click(screen.getByRole('radio', { name: /甲/ }));
    await fireEvent.click(screen.getByRole('button', { name: /確認合併/ }));
    expect(onConfirm).toHaveBeenCalledWith('a');
  });

  it('cancel calls onCancel', async () => {
    const onCancel = vi.fn();
    render(SubjectMergeDialog, {
      props: { subjects: [subj('a', '甲', 1), subj('b', '乙', 3)], onConfirm: vi.fn(), onCancel },
    });
    await fireEvent.click(screen.getByRole('button', { name: /取消/ }));
    expect(onCancel).toHaveBeenCalled();
  });
});
