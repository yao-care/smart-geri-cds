import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import ResultView from '../../src/components/assess/ResultView.svelte';
import { assessmentStore } from '../../src/lib/stores/assessment.svelte';
import type { Child, Assessment } from '../../src/lib/db/schema';
import type { ScaleDef } from '../../src/lib/scales/scale';

function makeChild(): Child {
  return {
    id: 'test-child',
    birthDate: '',
    gender: 'male',
    createdAt: new Date(),
  };
}

function makeAssessment(): Assessment {
  return {
    id: 'test-assess',
    childId: 'test-child',
    cfsLevel: 'cfs5',
    status: 'started',
    language: 'zh-TW',
    currentStep: 2,
    startedAt: new Date(),
    fhirSubmitted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

const gds: ScaleDef = {
  id: 'gds-15',
  domain: { top: 'psychological', sub: 'mood' },
  applicableCfs: ['cfs5'],
  scoring: 'sum',
  inputType: 'option',
  maxScore: 15,
  items: [],
  bands: [
    { max: 4, severity: 'normal', label: '無憂鬱徵兆' },
    { min: 5, max: 9, severity: 'monitor', label: '疑似憂鬱' },
    { min: 10, severity: 'refer', label: '高度疑似' },
  ],
  clinicallyReviewed: false,
};

describe('ResultView', () => {
  beforeEach(() => {
    assessmentStore.reset();
  });

  afterEach(() => {
    cleanup();
    assessmentStore.reset();
  });

  it('shows computing placeholder when no cfsLevel is set', () => {
    // No cfsLevel → $effect early-returns → triageResult stays null → loading.
    render(ResultView, { scales: [gds] });
    expect(screen.getByText(/正在產生評估結果/)).toBeInTheDocument();
  });

  it('renders a category label once triage resolves', async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.cfsLevel = 'cfs5';
    assessmentStore.partialAnalysis = {
      questionnaireScores: { 'gds-15': 7 },
      questionnaireMaxScores: { 'gds-15': 15 },
    };

    render(ResultView, { scales: [gds] });

    const label = await screen.findByRole('heading', { name: /正常|追蹤觀察|建議轉介|尚未完成/ });
    expect(label).toBeInTheDocument();
    expect(screen.queryByText(/正在產生評估結果/)).not.toBeInTheDocument();
  });

  it('renders a summary paragraph from the triage result', async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.cfsLevel = 'cfs5';
    assessmentStore.partialAnalysis = {
      questionnaireScores: { 'gds-15': 2 },
      questionnaireMaxScores: { 'gds-15': 15 },
    };

    const { container } = render(ResultView, { scales: [gds] });
    await screen.findByRole('heading', { name: /正常|追蹤觀察|建議轉介|尚未完成/ });

    expect(container.textContent ?? '').toMatch(/評估|建議|追蹤|正常|轉介|領域/);
  });
});
