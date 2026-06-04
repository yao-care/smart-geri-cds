import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import AssessmentHistory from '../../src/components/assess/AssessmentHistory.svelte';
import { db, type Child } from '../../src/lib/db/schema';
import { createAssessment } from '../../src/lib/db/assessments';

async function seedDuplicate() {
  const mk = (id: string): Child => ({ id, nickName: '輝', gender: 'male', birthDate: '1982-04-30', createdAt: new Date('2026-01-01') });
  await db.children.bulkPut([mk('d1'), mk('d2')]);
  await createAssessment('d1', 'cfs3', { informantAvailable: true, patientAble: true });
  await createAssessment('d2', 'cfs4', { informantAvailable: true, patientAble: true });
}

describe('AssessmentHistory 合併模式', () => {
  beforeEach(async () => {
    await db.assessments.clear();
    await db.children.clear();
  });

  it('entering 合併 mode and selecting 2 subjects shows the merge action', async () => {
    await seedDuplicate();
    render(AssessmentHistory);

    await fireEvent.click(await screen.findByRole('button', { name: /管理.*合併|合併受測者/ }));
    const boxes = await screen.findAllByRole('checkbox', { name: /選取受測者/ });
    await fireEvent.click(boxes[0]);
    await fireEvent.click(boxes[1]);

    expect(screen.getByRole('button', { name: /合併 2 位/ })).toBeInTheDocument();
  });

  it('confirming the merge collapses two subjects into one', async () => {
    await seedDuplicate();
    render(AssessmentHistory);

    await fireEvent.click(await screen.findByRole('button', { name: /管理.*合併|合併受測者/ }));
    const boxes = await screen.findAllByRole('checkbox', { name: /選取受測者/ });
    await fireEvent.click(boxes[0]);
    await fireEvent.click(boxes[1]);
    await fireEvent.click(screen.getByRole('button', { name: /合併 2 位/ }));
    await fireEvent.click(screen.getByRole('button', { name: /確認合併/ }));

    await screen.findByText(/輝/);
    expect(await db.children.count()).toBe(1);
    expect(await db.assessments.count()).toBe(2);
  });
});
