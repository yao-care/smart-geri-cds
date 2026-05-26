import { describe, it, expect, beforeEach } from 'vitest';
import { analyzeAssessment } from '../../src/engine/cdsa/assessment-analyzer';
import { recordEvents } from '../../src/lib/db/assessment-events';
import { db } from '../../src/lib/db/schema';

/**
 * Integration test for `analyzeAssessment` (questionnaire-only, post-sensor-removal).
 * Uses fake-indexeddb (set up in tests/setup.ts) to seed questionnaire events,
 * then asserts the pipeline questionnaire events → ScaleResult[] → computeTriage
 * runs to completion. No sensor modules remain.
 */
describe('analyzeAssessment (questionnaire-only)', () => {
  const assessmentId = 'test-assess-001';
  const childId = 'test-child-001';

  beforeEach(async () => {
    await db.assessmentEvents.clear();
  });

  it('runs end-to-end on an empty assessment (no events) → incomplete', async () => {
    const result = await analyzeAssessment(assessmentId, 'cfs5');
    expect(result.triageResult).toBeDefined();
    expect(result.triageResult.category).toBe('incomplete');
    expect(result.triageResult.details).toEqual([]);
    expect(result.analyzedAt).toBeInstanceOf(Date);
  });

  it('aggregates questionnaire scores per top.sub scale into ScaleResult[]', async () => {
    await recordEvents([
      {
        assessmentId, childId, moduleType: 'questionnaire',
        eventType: 'questionnaire_answer', timestamp: new Date(),
        data: { scaleId: 'gds-15', top: 'psychological', sub: 'mood', score: 2, maxScore: 15 },
      },
      {
        assessmentId, childId, moduleType: 'questionnaire',
        eventType: 'questionnaire_answer', timestamp: new Date(),
        data: { scaleId: 'gds-15', top: 'psychological', sub: 'mood', score: 1, maxScore: 0 },
      },
      {
        assessmentId, childId, moduleType: 'questionnaire',
        eventType: 'questionnaire_answer', timestamp: new Date(),
        data: { scaleId: 'barthel', top: 'functional', sub: 'adl', score: 80, maxScore: 100 },
      },
    ]);

    const result = await analyzeAssessment(assessmentId, 'cfs5');
    expect(result.triageResult.details).toHaveLength(2);
    const mood = result.triageResult.details.find(d => d.scaleId === 'gds-15');
    expect(mood?.domain).toEqual({ top: 'psychological', sub: 'mood' });
    expect(mood?.rawScore).toBe(3); // 2 + 1
    expect(mood?.maxScore).toBe(15); // 15 + 0
  });

  it('isolates results by assessmentId (no cross-talk)', async () => {
    await recordEvents([
      {
        assessmentId: 'A', childId, moduleType: 'questionnaire',
        eventType: 'questionnaire_answer', timestamp: new Date(),
        data: { scaleId: 'gds-15', top: 'psychological', sub: 'mood', score: 3, maxScore: 15 },
      },
      {
        assessmentId: 'B', childId, moduleType: 'questionnaire',
        eventType: 'questionnaire_answer', timestamp: new Date(),
        data: { scaleId: 'barthel', top: 'functional', sub: 'adl', score: 50, maxScore: 100 },
      },
    ]);

    const a = await analyzeAssessment('A', 'cfs5');
    const b = await analyzeAssessment('B', 'cfs5');
    expect(a.triageResult.details).toHaveLength(1);
    expect(a.triageResult.details[0].scaleId).toBe('gds-15');
    expect(b.triageResult.details).toHaveLength(1);
    expect(b.triageResult.details[0].scaleId).toBe('barthel');
  });
});
