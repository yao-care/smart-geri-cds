import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { assessmentStore } from '../../src/lib/stores/assessment.svelte';
import { db } from '../../src/lib/db/schema';
import { getAssessment } from '../../src/lib/db/assessments';
import type { ScaleResult } from '../../src/lib/scales/scale';

/**
 * Store-level persist/restore for the resume UX fix:
 * pausing mid-questionnaire then resuming must NOT discard prior answers.
 * partialAnalysis (per-scale scores + timed-task ScaleResults) is persisted
 * on the Assessment record and restored by resume().
 */
describe('assessmentStore resume restores partialAnalysis', () => {
  beforeEach(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await db.assessmentEvents.clear();
    await db.assessments.clear();
    await db.children.clear();
    assessmentStore.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    assessmentStore.reset();
  });

  it('startNew → addAnalysis → pause → reset → resume restores prior answers/scores', async () => {
    await assessmentStore.startNew(
      { nickName: 'resume-test', birthDate: '1950-01-01', gender: 'male' },
      'cfs5',
      'nurse',
    );
    const assessmentId = assessmentStore.assessment!.id;

    // Simulate partial questionnaire progress: option-scale scores...
    assessmentStore.addAnalysis({
      questionnaireScores: { 'gds-15': 1 },
      questionnaireMaxScores: { 'gds-15': 2 },
    });
    // ...and a completed timed task (its recording Blob lives separately in IDB).
    const sitToStand: ScaleResult = {
      scaleId: 'sit-to-stand',
      domain: { top: 'functional', sub: 'mobility' },
      rawScore: 11,
      maxScore: 60,
      severity: 'monitor',
      bandLabel: '待觀察',
    };
    assessmentStore.addAnalysis({ scaleResults: { 'sit-to-stand': sitToStand } });

    // Pause awaits the snapshot write → deterministic persistence.
    await assessmentStore.pause();

    // The snapshot is on the persisted record.
    const persisted = await getAssessment(assessmentId);
    expect(persisted?.partialAnalysis?.questionnaireScores).toEqual({ 'gds-15': 1 });
    expect(persisted?.partialAnalysis?.scaleResults?.['sit-to-stand']).toEqual(sitToStand);

    // Simulate "later session": in-memory state cleared, then resume by id.
    assessmentStore.reset();
    expect(assessmentStore.partialAnalysis).toEqual({});

    await assessmentStore.resume(assessmentId);

    // partialAnalysis is restored verbatim — user does not re-answer.
    expect(assessmentStore.partialAnalysis.questionnaireScores).toEqual({ 'gds-15': 1 });
    expect(assessmentStore.partialAnalysis.questionnaireMaxScores).toEqual({ 'gds-15': 2 });
    // Timed-task ScaleResult survives resume (its recording isn't lost).
    expect(assessmentStore.partialAnalysis.scaleResults?.['sit-to-stand']).toEqual(sitToStand);
    // Step index also restored from the record.
    expect(assessmentStore.currentStepIndex).toBe(assessmentStore.assessment!.currentStep);
  });

  it('addAnalysis persists the merged snapshot (not just the last partial)', async () => {
    await assessmentStore.startNew(
      { nickName: 'merge-test', birthDate: '1950-01-01', gender: 'female' },
      'cfs5',
      'nurse',
    );
    const assessmentId = assessmentStore.assessment!.id;

    assessmentStore.addAnalysis({ questionnaireScores: { a: 1 }, questionnaireMaxScores: { a: 2 } });
    assessmentStore.addAnalysis({
      questionnaireScores: { a: 1, b: 2 },
      questionnaireMaxScores: { a: 2, b: 3 },
    });

    // Flush the fire-and-forget write deterministically.
    await assessmentStore.pause();

    const persisted = await getAssessment(assessmentId);
    expect(persisted?.partialAnalysis?.questionnaireScores).toEqual({ a: 1, b: 2 });
    expect(persisted?.partialAnalysis?.questionnaireMaxScores).toEqual({ a: 2, b: 3 });
  });

  it('resume on a record without partialAnalysis falls back to empty (legacy-safe)', async () => {
    await assessmentStore.startNew(
      { nickName: 'legacy-test', birthDate: '1950-01-01', gender: 'male' },
      'cfs5',
      'nurse',
    );
    const assessmentId = assessmentStore.assessment!.id;
    // Strip the field to simulate a pre-v3 record.
    await db.assessments.update(assessmentId, { partialAnalysis: undefined });

    assessmentStore.reset();
    await assessmentStore.resume(assessmentId);

    expect(assessmentStore.partialAnalysis).toEqual({});
    expect(assessmentStore.error).toBeNull();
  });
});
