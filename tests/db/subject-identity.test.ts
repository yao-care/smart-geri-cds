import { describe, it, expect, beforeEach } from 'vitest';
import { updateChild, mergeChildren, createAssessment } from '../../src/lib/db/assessments';
import { db, type Child } from '../../src/lib/db/schema';

function makeChild(id: string, over: Partial<Child> = {}): Child {
  return { id, gender: 'male', birthDate: '', createdAt: new Date('2026-01-01'), ...over };
}

describe('updateChild', () => {
  beforeEach(async () => {
    await db.assessments.clear();
    await db.children.clear();
  });

  it('updates mutable fields while preserving id and createdAt', async () => {
    const created = new Date('2026-01-01');
    await db.children.put(makeChild('c1', { nickName: '舊', birthDate: '', createdAt: created }));

    await updateChild(makeChild('c1', { nickName: '新', birthDate: '1950-03-02', createdAt: created }));

    const got = await db.children.get('c1');
    expect(got!.id).toBe('c1');
    expect(got!.nickName).toBe('新');
    expect(got!.birthDate).toBe('1950-03-02');
    expect(got!.createdAt).toEqual(created);
  });
});

describe('mergeChildren', () => {
  beforeEach(async () => {
    await db.assessments.clear();
    await db.children.clear();
  });

  it('reassigns merged children assessments to primary and deletes merged children', async () => {
    await db.children.bulkPut([makeChild('primary'), makeChild('dup1'), makeChild('dup2')]);
    const avail = { informantAvailable: true, patientAble: true };
    await createAssessment('primary', 'cfs3', avail);
    await createAssessment('dup1', 'cfs4', avail);
    await createAssessment('dup2', 'cfs5', avail);

    await mergeChildren('primary', ['dup1', 'dup2']);

    const onPrimary = await db.assessments.where('childId').equals('primary').count();
    expect(onPrimary).toBe(3);
    expect(await db.children.get('dup1')).toBeUndefined();
    expect(await db.children.get('dup2')).toBeUndefined();
    expect(await db.children.get('primary')).toBeTruthy();
  });

  it('never deletes the primary even if it appears in mergedIds', async () => {
    await db.children.bulkPut([makeChild('primary'), makeChild('dup1')]);
    await mergeChildren('primary', ['primary', 'dup1']);
    expect(await db.children.get('primary')).toBeTruthy();
    expect(await db.children.get('dup1')).toBeUndefined();
  });

  it('is a no-op when there is nothing to merge', async () => {
    await db.children.put(makeChild('primary'));
    await mergeChildren('primary', ['primary']);
    expect(await db.children.get('primary')).toBeTruthy();
  });
});
