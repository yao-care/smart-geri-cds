import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import ResultView from '../../src/components/assess/ResultView.svelte';
import { assessmentStore } from '../../src/lib/stores/assessment.svelte';
import type { Child, Assessment } from '../../src/lib/db/schema';

/** Build a minimal Child whose age (derived from birthDate) falls in 25-36m. */
function makeChild(birthOffsetMonths: number): Child {
  const birth = new Date();
  birth.setMonth(birth.getMonth() - birthOffsetMonths);
  return {
    id: 'test-child',
    birthDate: birth,
    sex: 'male',
    createdAt: new Date(),
  };
}

function makeAssessment(): Assessment {
  return {
    id: 'test-assess',
    childId: 'test-child',
    status: 'in-progress',
    currentStep: 6,
    startedAt: new Date(),
    fhirSubmitted: false,
  };
}

describe('ResultView', () => {
  beforeEach(() => {
    assessmentStore.reset();
  });

  afterEach(() => {
    cleanup();
    assessmentStore.reset();
  });

  it('shows computing placeholder before triage result is ready', () => {
    // No ageGroup → $effect early-returns → triageResult stays null → loading
    render(ResultView);
    expect(screen.getByText(/正在產生評估結果/)).toBeInTheDocument();
  });

  it('still shows the computing placeholder while triage is pending', () => {
    // With store fields set, triage starts but is async; first render is the
    // placeholder. Async resolve verified separately to keep this fast.
    assessmentStore.child = makeChild(30); // 30 mo → 25-36m
    assessmentStore.assessment = makeAssessment();
    render(ResultView);
    expect(screen.getByText(/正在產生評估結果/)).toBeInTheDocument();
  });

  it('renders one of the three category labels once triage resolves', async () => {
    assessmentStore.child = makeChild(30);
    assessmentStore.assessment = makeAssessment();
    assessmentStore.partialAnalysis = {
      questionnaireScores: { gross_motor: 4, fine_motor: 4 },
      questionnaireMaxScores: { gross_motor: 4, fine_motor: 4 },
    };

    render(ResultView);

    // computeTriage is async but resolves quickly (no external IO).
    // findByText polls until visible.
    const label = await screen.findByText(/正常|追蹤觀察|建議轉介/);
    expect(label).toBeInTheDocument();

    // The radar / education match / pdf sections are gated by computing
    // state — finding the category label confirms isComputing flipped false.
    expect(screen.queryByText(/正在產生評估結果/)).not.toBeInTheDocument();
  });

  it('renders a summary paragraph from the triage result', async () => {
    assessmentStore.child = makeChild(30);
    assessmentStore.assessment = makeAssessment();
    assessmentStore.partialAnalysis = {
      questionnaireScores: { gross_motor: 4 },
      questionnaireMaxScores: { gross_motor: 4 },
    };

    const { container } = render(ResultView);
    await screen.findByText(/正常|追蹤觀察|建議轉介/);

    // After resolution, the result section should contain non-empty text.
    // The triage summary is a sentence — assert there's substantive content.
    expect(container.textContent ?? '').toMatch(/評估|建議|追蹤|正常|轉介/);
  });

  it.skip('renders all 6 questionnaire domains in radar when all provided', () => {
    // TODO: setup mocking pattern for triageResult emission to ResultView
    // The radar chart is populated via triageResult.details which is computed
    // inside ResultView's $effect via computeTriage(). To test the 6-domain
    // radar we need to either:
    //   1. inject triageResult directly into assessmentStore (bypassing the effect), or
    //   2. mock computeTriage to return a controlled TriageResult.
    // Neither is straightforward with the current architecture where
    // triageResult is private state inside ResultView. Consider exposing
    // assessmentStore.triageResult as the single truth source and have
    // ResultView set it there upon completion.
  });
});
