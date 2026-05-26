import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import QuestionnaireModule from '../../src/components/assess/QuestionnaireModule.svelte';
import { assessmentStore } from '../../src/lib/stores/assessment.svelte';
import { db } from '../../src/lib/db/schema';
import type { Child, Assessment } from '../../src/lib/db/schema';
import type { ScaleDef } from '../../src/lib/scales/scale';

function makeChild(): Child {
  return { id: 'q-test-child', birthDate: '', gender: 'male', createdAt: new Date() };
}

function makeAssessment(): Assessment {
  return {
    id: 'q-test-assess',
    childId: 'q-test-child',
    cfsLevel: 'cfs5',
    status: 'started',
    language: 'zh-TW',
    currentStep: 1,
    startedAt: new Date(),
    fhirSubmitted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** Two-item scale applicable at cfs5. */
const scale: ScaleDef = {
  id: 'gds-15',
  domain: { top: 'psychological', sub: 'mood' },
  applicableCfs: ['cfs5'],
  scoring: 'sum',
  inputType: 'option',
  maxScore: 2,
  items: [
    { id: 'q1', text: '題目一？', options: [{ label: '是', score: 1 }, { label: '否', score: 0 }] },
    { id: 'q2', text: '題目二？', options: [{ label: '是', score: 1 }, { label: '否', score: 0 }] },
  ],
  bands: [
    { max: 0, severity: 'normal', label: '正常' },
    { min: 1, severity: 'monitor', label: '待觀察' },
  ],
  clinicallyReviewed: false,
};

describe('QuestionnaireModule', () => {
  beforeEach(async () => {
    assessmentStore.reset();
    await db.assessmentEvents.clear();
  });

  afterEach(() => {
    cleanup();
    assessmentStore.reset();
  });

  it('renders without crashing when no scales / cfsLevel are set', () => {
    const { container } = render(QuestionnaireModule, { scales: [] });
    expect(container).toBeDefined();
  });

  it('renders progress bar + first question for an applicable scale', () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.cfsLevel = 'cfs5';

    render(QuestionnaireModule, { scales: [scale] });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('題目一？')).toBeInTheDocument();
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('only renders scales whose applicableCfs includes the cfsLevel', () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.cfsLevel = 'cfs1'; // scale applies only to cfs5

    render(QuestionnaireModule, { scales: [scale] });
    // No applicable scale → empty state, not a question.
    expect(screen.getByText(/沒有可施測的量表/)).toBeInTheDocument();
  });

  it('records a questionnaire_answer event after clicking an answer', async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.cfsLevel = 'cfs5';

    render(QuestionnaireModule, { scales: [scale] });

    const optionBtn = screen.getAllByRole('button').find(b => b.classList.contains('option-btn'));
    expect(optionBtn).toBeTruthy();
    await fireEvent.click(optionBtn!);

    await waitFor(
      async () => {
        const events = await db.assessmentEvents.where('moduleType').equals('questionnaire').toArray();
        expect(events.length).toBeGreaterThan(0);
        expect(events[0].eventType).toBe('questionnaire_answer');
        expect(events[0].data.scaleId).toBe('gds-15');
        expect(events[0].data.score).toBeGreaterThanOrEqual(0);
      },
      { timeout: 2000 },
    );
  });

  it('persists per-scale scores (keyed by scaleId) after answering all items', { timeout: 15000 }, async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.cfsLevel = 'cfs5';

    render(QuestionnaireModule, { scales: [scale] });

    const MAX_ITERATIONS = 10;
    for (let i = 0; i < MAX_ITERATIONS; i++) {
      if (screen.queryByText('問卷完成！')) break;
      const optionBtn = screen.queryAllByRole('button').find(b => b.classList.contains('option-btn'));
      if (!optionBtn) break;
      await fireEvent.click(optionBtn);
      await new Promise(r => setTimeout(r, 600));
    }

    await waitFor(() => {
      expect(screen.getByText('問卷完成！')).toBeInTheDocument();
    }, { timeout: 3000 });

    const scores = assessmentStore.partialAnalysis.questionnaireScores;
    const maxScores = assessmentStore.partialAnalysis.questionnaireMaxScores;
    expect(scores).toBeDefined();
    expect(maxScores).toBeDefined();
    expect(scores?.['gds-15']).toBeDefined();
    expect(maxScores?.['gds-15']).toBe(2);
    expect(scores!['gds-15']).toBeLessThanOrEqual(maxScores!['gds-15']);
  });
});
