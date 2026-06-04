import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import AssessmentHistory from '../../src/components/assess/AssessmentHistory.svelte';
import { db, type Child } from '../../src/lib/db/schema';
import { createAssessment } from '../../src/lib/db/assessments';

describe('AssessmentHistory 再次評估', () => {
  beforeEach(async () => {
    await db.assessments.clear();
    await db.children.clear();
  });

  it('renders a 再次評估 link to /assess?subject=<childId> per subject', async () => {
    const child: Child = { id: 'h1', nickName: '歷史阿公', gender: 'male', birthDate: '1947-07-07', createdAt: new Date('2026-01-01') };
    await db.children.put(child);
    await createAssessment('h1', 'cfs3', { informantAvailable: true, patientAble: true });

    render(AssessmentHistory);

    const link = await screen.findByRole('link', { name: /再次評估/ });
    expect(link.getAttribute('href')).toBe('/assess?subject=h1');
  });
});
