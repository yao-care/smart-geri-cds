import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { assessmentStore } from '../../src/lib/stores/assessment.svelte';
import { db } from '../../src/lib/db/schema';
import { getAssessment } from '../../src/lib/db/assessments';

/**
 * SOP availability is part of the tiered flow:
 * startNew records informantAvailable + patientAble on the Assessment; resume
 * restores them (alongside cfsLevel + partialAnalysis). These drive the
 * availability-validity gate and the AD8 ↔ Mini-Cog cognition swap — replacing
 * the old operator (nurse/family/self) mis-model.
 */
describe('assessmentStore availability + tiered flow', () => {
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

  it('startNew persists informantAvailable + patientAble and exposes them on the store', async () => {
    await assessmentStore.startNew(
      { nickName: 'avail-test', birthDate: '1948-03-02', gender: 'female' },
      'cfs5',
      { informantAvailable: true, patientAble: false },
    );
    expect(assessmentStore.informantAvailable).toBe(true);
    expect(assessmentStore.patientAble).toBe(false);

    const persisted = await getAssessment(assessmentStore.assessment!.id);
    expect(persisted?.informantAvailable).toBe(true);
    expect(persisted?.patientAble).toBe(false);
    expect(persisted?.cfsLevel).toBe('cfs5');
  });

  it('resume restores informantAvailable + patientAble + cfsLevel + partialAnalysis', async () => {
    await assessmentStore.startNew(
      { nickName: 'avail-resume', birthDate: '1948-03-02', gender: 'male' },
      'cfs6',
      { informantAvailable: false, patientAble: true },
    );
    const assessmentId = assessmentStore.assessment!.id;

    assessmentStore.addAnalysis({
      questionnaireScores: { 'mood-screen': 4 },
      questionnaireMaxScores: { 'mood-screen': 6 },
    });
    await assessmentStore.pause();

    assessmentStore.reset();
    expect(assessmentStore.informantAvailable).toBeNull();
    expect(assessmentStore.patientAble).toBeNull();

    await assessmentStore.resume(assessmentId);
    expect(assessmentStore.informantAvailable).toBe(false);
    expect(assessmentStore.patientAble).toBe(true);
    expect(assessmentStore.cfsLevel).toBe('cfs6');
    expect(assessmentStore.partialAnalysis.questionnaireScores).toEqual({ 'mood-screen': 4 });
  });

  it('resume on a record without the new fields (pre-v5) falls back to conservative defaults (true/true)', async () => {
    await assessmentStore.startNew(
      { nickName: 'avail-legacy', birthDate: '1948-03-02', gender: 'male' },
      'cfs5',
      { informantAvailable: false, patientAble: false },
    );
    const assessmentId = assessmentStore.assessment!.id;
    await db.assessments.update(assessmentId, { informantAvailable: undefined, patientAble: undefined });

    assessmentStore.reset();
    await assessmentStore.resume(assessmentId);

    expect(assessmentStore.informantAvailable).toBe(true);
    expect(assessmentStore.patientAble).toBe(true);
    expect(assessmentStore.error).toBeNull();
  });
});
