import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import QuestionnaireModule from '../../src/components/assess/QuestionnaireModule.svelte';
import { assessmentStore } from '../../src/lib/stores/assessment.svelte';
import { db } from '../../src/lib/db/schema';
import type { ScaleDef } from '../../src/lib/scales/scale';

/** Synthetic scale set spanning two domains, all applicable at cfs5. */
function makeScales(): ScaleDef[] {
  return [
    {
      id: 'gds-15',
      domain: { top: 'psychological', sub: 'mood' },
      applicableCfs: ['cfs5'],
      scoring: 'sum',
      inputType: 'option',
      maxScore: 2,
      items: [
        { id: 'm1', text: '情緒題一？', options: [{ label: '是', score: 1 }, { label: '否', score: 0 }] },
        { id: 'm2', text: '情緒題二？', options: [{ label: '是', score: 1 }, { label: '否', score: 0 }] },
      ],
      bands: [
        { max: 0, severity: 'normal', label: '正常' },
        { min: 1, severity: 'monitor', label: '待觀察' },
      ],
      clinicallyReviewed: false,
    },
    {
      id: 'barthel',
      domain: { top: 'functional', sub: 'adl' },
      applicableCfs: ['cfs5'],
      scoring: 'sum',
      inputType: 'option',
      maxScore: 2,
      items: [
        { id: 'a1', text: 'ADL 題一？', options: [{ label: '可', score: 1 }, { label: '不可', score: 0 }] },
        { id: 'a2', text: 'ADL 題二？', options: [{ label: '可', score: 1 }, { label: '不可', score: 0 }] },
      ],
      bands: [
        { max: 1, severity: 'refer', label: '需協助' },
        { min: 2, severity: 'normal', label: '獨立' },
      ],
      clinicallyReviewed: false,
    },
  ];
}

describe('QuestionnaireModule flow (CFS-driven, per-scale emission)', () => {
  beforeEach(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await db.assessmentEvents.clear();
    await db.assessments.clear();
    await db.children.clear();
    assessmentStore.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    cleanup();
    assessmentStore.reset();
  });

  it('emits one score per applicable scale (keyed by scaleId) at cfs5', async () => {
    await assessmentStore.startNew(
      { nickName: 'test', birthDate: '', gender: 'male' },
      'cfs5',
    );
    assessmentStore.currentStepIndex = 1;

    const scales = makeScales();
    render(QuestionnaireModule, { scales });
    await tick();

    vi.useFakeTimers();

    // Answer every item with the first option (score 1).
    let safety = 30;
    while (safety-- > 0) {
      const btn = document.querySelector<HTMLButtonElement>('button.option-btn');
      if (!btn) break;
      if (btn.disabled) {
        await vi.advanceTimersByTimeAsync(100);
        await tick();
        continue;
      }
      await fireEvent.click(btn);
      await vi.advanceTimersByTimeAsync(550);
      await tick();
    }
    vi.useRealTimers();

    const scores = assessmentStore.partialAnalysis.questionnaireScores ?? {};
    const maxScores = assessmentStore.partialAnalysis.questionnaireMaxScores ?? {};

    // Both applicable scales must be scored, keyed by scaleId.
    for (const scaleId of ['gds-15', 'barthel']) {
      expect(Object.keys(scores)).toContain(scaleId);
      expect(maxScores[scaleId]).toBe(2);
      expect(scores[scaleId]).toBeLessThanOrEqual(maxScores[scaleId]);
    }
  }, 30000);

  it('excludes scales not applicable to the CFS level', async () => {
    await assessmentStore.startNew(
      { nickName: 'test', birthDate: '', gender: 'male' },
      'cfs1',
    );
    assessmentStore.currentStepIndex = 1;

    const scales = makeScales(); // all applicable only at cfs5
    const { container } = render(QuestionnaireModule, { scales });
    await tick();

    // No applicable scale → no option buttons rendered.
    expect(container.querySelector('button.option-btn')).toBeNull();
  });
});
