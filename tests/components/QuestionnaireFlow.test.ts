import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/svelte';
import { tick } from 'svelte';
import QuestionnaireModule from '../../src/components/assess/QuestionnaireModule.svelte';
import { assessmentStore } from '../../src/lib/stores/assessment.svelte';
import { db } from '../../src/lib/db/schema';
import type { ScaleDef } from '../../src/lib/scales/scale';

/** Synthetic scale set spanning two domains, all applicable at cfs5.
 *  Both screen scales are alwaysRun:true so they appear directly in the triage
 *  phase without requiring a triage gate — testing the CFS-driven flow without
 *  depending on triage expansion. */
function makeScales(): ScaleDef[] {
  return [
    {
      id: 'mood-screen',
      domain: { top: 'psychological', sub: 'mood' },
      tier: 'screen',
      alwaysRun: true,
      applicableCfs: ['cfs5'],
      scoring: 'sum',
      inputType: 'option',
      maxScore: 2,
      items: [
        { id: 'm1', mode: 'patient', text: '情緒題一？', prompt: '情緒題一？', options: [{ label: '是', score: 1 }, { label: '否', score: 0 }] },
        { id: 'm2', mode: 'patient', text: '情緒題二？', prompt: '情緒題二？', options: [{ label: '是', score: 1 }, { label: '否', score: 0 }] },
      ],
      bands: [
        { max: 0, severity: 'normal', label: '正常' },
        { min: 1, severity: 'monitor', label: '待觀察' },
      ],
      clinicallyReviewed: false,
    },
    {
      id: 'adl-screen',
      domain: { top: 'functional', sub: 'adl' },
      tier: 'screen',
      alwaysRun: true,
      applicableCfs: ['cfs5'],
      scoring: 'sum',
      inputType: 'option',
      maxScore: 2,
      items: [
        { id: 'a1', mode: 'patient', text: 'ADL 題一？', prompt: 'ADL 題一？', options: [{ label: '可', score: 1 }, { label: '不可', score: 0 }] },
        { id: 'a2', mode: 'patient', text: 'ADL 題二？', prompt: 'ADL 題二？', options: [{ label: '可', score: 1 }, { label: '不可', score: 0 }] },
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
      { informantAvailable: true, patientAble: true },
    );
    assessmentStore.currentStepIndex = 1;

    const scales = makeScales();
    render(QuestionnaireModule, { scales });
    // Wait for the async restore (initPhase) to settle into the asking phase
    // (the module starts in a 'loading' phase) before installing fake timers.
    let waited = 0;
    while (!document.querySelector('button.option-btn') && waited++ < 50) {
      await tick();
      await new Promise(r => setTimeout(r, 5));
    }

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
    for (const scaleId of ['mood-screen', 'adl-screen']) {
      expect(Object.keys(scores)).toContain(scaleId);
      expect(maxScores[scaleId]).toBe(2);
      expect(scores[scaleId]).toBeLessThanOrEqual(maxScores[scaleId]);
    }
  }, 30000);

  it('excludes scales not applicable to the CFS level', async () => {
    await assessmentStore.startNew(
      { nickName: 'test', birthDate: '', gender: 'male' },
      'cfs1',
      { informantAvailable: true, patientAble: true },
    );
    assessmentStore.currentStepIndex = 1;

    const scales = makeScales(); // all applicable only at cfs5
    const { container } = render(QuestionnaireModule, { scales });
    await tick();
    await tick(); // allow initPhase (async restore) to settle into the empty state

    // No applicable scale → no option buttons rendered.
    expect(container.querySelector('button.option-btn')).toBeNull();
  });
});
