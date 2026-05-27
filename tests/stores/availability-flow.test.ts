import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { assessmentStore } from '../../src/lib/stores/assessment.svelte';
import { db } from '../../src/lib/db/schema';
import { getAssessment } from '../../src/lib/db/assessments';

/**
 * C1 — operator identity is part of the tiered flow:
 * startNew records the operator on the Assessment; resume restores it
 * (alongside cfsLevel + partialAnalysis). The operator drives the
 * operator-validity gate (C-M6) and ask-informant "無法取得" handling.
 */
describe('assessmentStore operator + tiered flow', () => {
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

  it('startNew persists operator and exposes it on the store', async () => {
    await assessmentStore.startNew(
      { nickName: 'op-test', birthDate: '1948-03-02', gender: 'female' },
      'cfs5',
      'family',
    );
    expect(assessmentStore.operator).toBe('family');

    const persisted = await getAssessment(assessmentStore.assessment!.id);
    expect(persisted?.operator).toBe('family');
    expect(persisted?.cfsLevel).toBe('cfs5');
  });

  it('resume restores operator + cfsLevel + partialAnalysis', async () => {
    await assessmentStore.startNew(
      { nickName: 'op-resume', birthDate: '1948-03-02', gender: 'male' },
      'cfs6',
      'nurse',
    );
    const assessmentId = assessmentStore.assessment!.id;

    assessmentStore.addAnalysis({
      questionnaireScores: { 'mood-screen': 4 },
      questionnaireMaxScores: { 'mood-screen': 6 },
    });
    await assessmentStore.pause();

    assessmentStore.reset();
    expect(assessmentStore.operator).toBeNull();

    await assessmentStore.resume(assessmentId);
    expect(assessmentStore.operator).toBe('nurse');
    expect(assessmentStore.cfsLevel).toBe('cfs6');
    expect(assessmentStore.partialAnalysis.questionnaireScores).toEqual({ 'mood-screen': 4 });
  });

  it('resume on a record without operator (pre-v4) falls back to null', async () => {
    await assessmentStore.startNew(
      { nickName: 'op-legacy', birthDate: '1948-03-02', gender: 'male' },
      'cfs5',
      'self',
    );
    const assessmentId = assessmentStore.assessment!.id;
    await db.assessments.update(assessmentId, { operator: undefined });

    assessmentStore.reset();
    await assessmentStore.resume(assessmentId);

    expect(assessmentStore.operator).toBeNull();
    expect(assessmentStore.error).toBeNull();
  });
});
