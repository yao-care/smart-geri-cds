import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../src/lib/db/schema';
import { markGcmSubmitted } from '../../../src/lib/db/assessments';
import type { Assessment } from '../../../src/lib/db/schema';

function makeAssessment(id: string): Assessment {
  return {
    id,
    childId: 'child-1',
    cfsLevel: 'cfs4',
    status: 'completed',
    language: 'zh-TW',
    currentStep: 7,
    startedAt: new Date('2026-05-31T10:00:00Z'),
    completedAt: new Date('2026-05-31T10:20:00Z'),
    fhirSubmitted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

beforeEach(async () => {
  await db.assessments.clear();
});

describe('markGcmSubmitted', () => {
  it('records the GCM case id on the assessment', async () => {
    await db.assessments.put(makeAssessment('a-1'));
    await markGcmSubmitted('a-1', 'GCM-0042');
    const got = await db.assessments.get('a-1');
    expect(got?.gcmCaseId).toBe('GCM-0042');
  });
});
