import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import AssessmentShell from '../../src/components/assess/AssessmentShell.svelte';
import { db, type Child } from '../../src/lib/db/schema';
import { assessmentStore } from '../../src/lib/stores/assessment.svelte';

describe('AssessmentShell ?subject= deep link', () => {
  beforeEach(async () => {
    await db.assessments.clear();
    await db.children.clear();
    assessmentStore.reset();
  });
  afterEach(() => {
    window.history.replaceState({}, '', '/');
    assessmentStore.reset();
  });

  it('prefills the subject when ?subject= points to a valid child', async () => {
    const child: Child = { id: 'deep1', nickName: '連結阿嬤', gender: 'female', birthDate: '1949-09-09', createdAt: new Date('2026-01-01') };
    await db.children.put(child);
    window.history.replaceState({}, '', '/assess?subject=deep1');

    render(AssessmentShell, { props: { scales: [] } });

    expect(await screen.findByDisplayValue('連結阿嬤')).toBeInTheDocument();
  });
});
