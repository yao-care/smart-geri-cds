import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { assessmentStore } from '../../src/lib/stores/assessment.svelte';
import { db, type Child } from '../../src/lib/db/schema';

function makeChild(id: string, over: Partial<Child> = {}): Child {
  return { id, gender: 'male', birthDate: '', createdAt: new Date('2026-01-01'), ...over };
}

describe('assessmentStore.startForExisting', () => {
  beforeEach(async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await db.assessments.clear();
    await db.children.clear();
    assessmentStore.reset();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    assessmentStore.reset();
  });

  it('reuses the existing child id without creating a new child, and writes edits back', async () => {
    const created = new Date('2026-01-01');
    await db.children.put(makeChild('existing', { nickName: '舊', birthDate: '', createdAt: created }));

    await assessmentStore.startForExisting(
      makeChild('existing', { nickName: '新', birthDate: '1948-06-01', createdAt: created }),
      'cfs4',
      { informantAvailable: true, patientAble: true },
    );

    expect(await db.children.count()).toBe(1);
    const child = await db.children.get('existing');
    expect(child!.nickName).toBe('新');
    expect(child!.birthDate).toBe('1948-06-01');
    expect(child!.createdAt).toEqual(created);
    expect(assessmentStore.assessment!.childId).toBe('existing');
    const stored = await db.assessments.where('childId').equals('existing').count();
    expect(stored).toBe(1);
  });

  it('sets an error when the child no longer exists', async () => {
    await assessmentStore.startForExisting(
      makeChild('ghost'),
      'cfs3',
      { informantAvailable: true, patientAble: true },
    );
    expect(assessmentStore.error).toBeTruthy();
    expect(assessmentStore.assessment).toBeNull();
  });
});
