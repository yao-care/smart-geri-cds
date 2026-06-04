import { describe, it, expect, beforeEach } from 'vitest';
import { updateChild } from '../../src/lib/db/assessments';
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
