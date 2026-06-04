import { describe, it, expect, beforeEach } from 'vitest';
import { updateChild, mergeChildren, createAssessment, loadSubjectsWithStats } from '../../src/lib/db/assessments';
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

describe('loadSubjectsWithStats', () => {
  beforeEach(async () => {
    await db.assessments.clear();
    await db.children.clear();
  });

  it('computes count and lastAssessedAt, sorted most-recent first', async () => {
    await db.children.bulkPut([makeChild('a'), makeChild('b'), makeChild('c')]);
    const avail = { informantAvailable: true, patientAble: true };

    const a1 = await createAssessment('a', 'cfs3', avail);
    await db.assessments.update(a1.id, { completedAt: new Date('2026-02-01') });
    const a2 = await createAssessment('a', 'cfs3', avail);
    await db.assessments.update(a2.id, { completedAt: new Date('2026-03-10') });
    const b1 = await createAssessment('b', 'cfs4', avail);
    await db.assessments.update(b1.id, { completedAt: new Date('2026-05-20') });
    // c: 0 次

    const list = await loadSubjectsWithStats();
    const byId = Object.fromEntries(list.map((s) => [s.child.id, s]));

    expect(byId['a'].assessmentCount).toBe(2);
    expect(byId['a'].lastAssessedAt).toEqual(new Date('2026-03-10'));
    expect(byId['b'].assessmentCount).toBe(1);
    expect(byId['c'].assessmentCount).toBe(0);
    expect(byId['c'].lastAssessedAt).toBeNull();
    expect(list.map((s) => s.child.id)).toEqual(['b', 'a', 'c']);
  });
});
