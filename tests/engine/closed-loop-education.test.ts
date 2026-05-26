/**
 * TDD: verify that ClosedLoopEngine.processResult correctly attaches
 * educationRecommended slugs that match the CLINICAL_EDUCATION map.
 *
 * getEducationRecommendations is private, so we test via the smallest
 * public surface: processResult — which sets alert.educationRecommended.
 *
 * Also directly tests the CLINICAL_EDUCATION constant for exact mapping parity.
 */

import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import { ClosedLoopEngine } from '../../src/engine/closed-loop';
import { db } from '../../src/lib/db/schema';
import { CLINICAL_EDUCATION } from '../../src/lib/education/clinical-education.generated';
import type { RiskAnalysisResult } from '../../src/engine/risk-analyzer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResult(
  indicators: string[],
  overallRisk: 'advisory' | 'warning' | 'critical' = 'advisory',
): RiskAnalysisResult {
  return {
    patientId: 'test-patient-01',
    overallRisk,
    ruleResult: {
      level: overallRisk,
      rationale: 'test',
      escalated: false,
      indicators: indicators.map(indicator => ({
        indicator,
        value: 1,
        level: overallRisk,
        range: null,
        rationale: `${indicator} out of range`,
      })),
    },
    mlResult: null,
    baselines: {},
    timestamp: new Date(),
    ruleVersion: 'v1',
  };
}

const engine = new ClosedLoopEngine({
  advisoryToWarningHours: 48,
  warningToCriticalHours: 24,
  windowMinutes: 60,
  alertAfterHours: 24,
});

// ---------------------------------------------------------------------------
// 1. CLINICAL_EDUCATION constant — exact mapping parity
// ---------------------------------------------------------------------------

describe('CLINICAL_EDUCATION constant', () => {
  it('maps sugar_intake to diet-control', () => {
    expect(CLINICAL_EDUCATION['sugar_intake']).toEqual(['diet-control']);
  });

  it('maps sleep_quality to sleep-hygiene', () => {
    expect(CLINICAL_EDUCATION['sleep_quality']).toEqual(['sleep-hygiene']);
  });

  it('maps spo2 to respiratory-care', () => {
    expect(CLINICAL_EDUCATION['spo2']).toEqual(['respiratory-care']);
  });

  it('maps activity_level to exercise-guide', () => {
    expect(CLINICAL_EDUCATION['activity_level']).toEqual(['exercise-guide']);
  });

  it('returns no entry for an unknown indicator', () => {
    expect(CLINICAL_EDUCATION['heart_rate']).toBeUndefined();
    expect(CLINICAL_EDUCATION['unknown_indicator']).toBeUndefined();
  });

  it('all 4 known indicators produce the expected slugs in order', () => {
    const indicators = ['sugar_intake', 'sleep_quality', 'spo2', 'activity_level'];
    const result = indicators.flatMap(ind => CLINICAL_EDUCATION[ind] ?? []);
    expect(result).toEqual([
      'diet-control',
      'sleep-hygiene',
      'respiratory-care',
      'exercise-guide',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. ClosedLoopEngine.processResult — educationRecommended via real behavior
// ---------------------------------------------------------------------------

describe('ClosedLoopEngine educationRecommended (via processResult)', () => {
  beforeEach(async () => {
    await db.alerts.clear();
    await db.patients.clear();
  });

  it('all 4 mapped indicators → correct slugs on alert', async () => {
    const result = makeResult(['sugar_intake', 'sleep_quality', 'spo2', 'activity_level']);
    const alert = await engine.processResult(result);

    expect(alert).not.toBeNull();
    expect(new Set(alert!.educationRecommended)).toEqual(
      new Set(['diet-control', 'sleep-hygiene', 'respiratory-care', 'exercise-guide']),
    );
  });

  it('unknown indicator returns empty educationRecommended', async () => {
    const result = makeResult(['heart_rate']);
    const alert = await engine.processResult(result);

    expect(alert).not.toBeNull();
    expect(alert!.educationRecommended ?? []).toEqual([]);
  });

  it('sugar_intake alone maps to diet-control', async () => {
    const result = makeResult(['sugar_intake']);
    const alert = await engine.processResult(result);

    expect(alert).not.toBeNull();
    expect(alert!.educationRecommended).toContain('diet-control');
    expect(alert!.educationRecommended).not.toContain('nutrition-grow-tall');
  });

  it('activity_level alone maps to exercise-guide', async () => {
    const result = makeResult(['activity_level']);
    const alert = await engine.processResult(result);

    expect(alert).not.toBeNull();
    expect(alert!.educationRecommended).toContain('exercise-guide');
  });
});
