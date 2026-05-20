import { describe, it, expect, vi } from 'vitest';
import { computeTriage, type TriageInput } from '../../src/engine/cdsa/triage';
import type { BehaviorMetrics } from '../../src/engine/cdsa/behavior-analysis';
import type { VoiceMetrics } from '../../src/engine/cdsa/voice-analysis';
import type { DrawingAnalysisResult } from '../../src/engine/cdsa/drawing-analysis';

function makeBehavior(overrides: Partial<BehaviorMetrics> = {}): BehaviorMetrics {
  return {
    responseTimeDistribution: { p50: 1500, p95: 3000, std: 500 },
    interactionRhythm: 0.5,
    operationConsistency: 0.75,
    retryCount: 1,
    interruptionPattern: 0.05,
    reactionLatency: 2000,
    completionRate: 0.8,
    ...overrides,
  };
}

function makeVoice(overrides: Partial<VoiceMetrics> = {}): VoiceMetrics {
  return {
    voiceDurationTotal: 10,
    pitchMean: 200,
    pitchStd: 30,
    energyMean: 0.5,
    energyStd: 0.1,
    mfccMean: [],
    silenceRatio: 0.2,
    voiceActivityCount: 5,
    ...overrides,
  };
}

function makeDrawing(overrides: Partial<DrawingAnalysisResult> = {}): DrawingAnalysisResult {
  return {
    overallScore: 60,
    strokeCount: 5,
    closure: 0.8,
    smoothness: 0.7,
    classification: 'typical',
    confidence: 0.85,
    ...overrides,
  };
}

const baseInput: TriageInput = {
  ageGroup: '25-36m',
  behavior: makeBehavior(),
  voice: makeVoice(),
  drawing: makeDrawing(),
};

describe('computeTriage', () => {
  it('returns normal when no metrics breach thresholds', async () => {
    const result = await computeTriage(baseInput);
    expect(result.category).toBe('normal');
    expect(result.anomalyCount).toBe(0);
    expect(result.summary).toContain('正常範圍');
  });

  it('returns monitor when 1-2 anomalies present', async () => {
    const result = await computeTriage({
      ...baseInput,
      // Push completion rate well below normal
      behavior: makeBehavior({ completionRate: 0.2 }),
    });
    expect(['monitor', 'refer']).toContain(result.category);
    expect(result.anomalyCount).toBeGreaterThanOrEqual(1);
  });

  it('returns refer when >=3 anomalies span >=2 domains', async () => {
    const result = await computeTriage({
      ...baseInput,
      // 3 behavior anomalies + 1 drawing anomaly = 2 domains
      behavior: makeBehavior({
        completionRate: 0.1,
        operationConsistency: 0.2,
        reactionLatency: 8000,
      }),
      drawing: makeDrawing({ overallScore: 10 }),
    });
    expect(result.category).toBe('refer');
    expect(result.anomalyCount).toBeGreaterThanOrEqual(3);
    expect(result.summary).toContain('專業評估');
  });

  it('stays monitor when 3+ anomalies all live in the same domain', async () => {
    const result = await computeTriage({
      ...baseInput,
      // 3 behavior-only anomalies, drawing fine → 1 domain affected
      behavior: makeBehavior({
        completionRate: 0.1,
        operationConsistency: 0.2,
        reactionLatency: 8000,
      }),
    });
    // 3 anomalies but only 1 domain → caught by the dual-axis gate
    expect(result.category).toBe('monitor');
  });

  it('honours questionnaireMaxScores when provided', async () => {
    const result = await computeTriage({
      ...baseInput,
      questionnaireScores: { cognition: 8 },
      questionnaireMaxScores: { cognition: 20 }, // 8/20 = 40% → anomaly
    });
    const cog = result.details.find((d) => d.metric === 'questionnaireScore');
    expect(cog?.isAnomaly).toBe(true);
  });

  it('falls back to maxScore=10 when no questionnaireMaxScores supplied', async () => {
    const result = await computeTriage({
      ...baseInput,
      questionnaireScores: { cognition: 8 }, // 8/10 = 80% → normal
    });
    const cog = result.details.find((d) => d.metric === 'questionnaireScore');
    expect(cog?.isAnomaly).toBe(false);
  });

  it('confidence rises with more anomalies', async () => {
    const normalResult = await computeTriage(baseInput);
    const referResult = await computeTriage({
      ...baseInput,
      behavior: makeBehavior({
        completionRate: 0.1,
        operationConsistency: 0.2,
        reactionLatency: 8000,
      }),
      drawing: makeDrawing({ overallScore: 5 }),
    });
    expect(referResult.confidence).toBeGreaterThan(normalResult.confidence);
  });

  it('includes drawing detail in result', async () => {
    const result = await computeTriage(baseInput);
    const drawingDetail = result.details.find((d) => d.metric === 'drawingScore');
    expect(drawingDetail).toBeDefined();
    expect(drawingDetail?.value).toBe(60);
  });

  it('skips voice metrics when voiceDurationTotal is 0', async () => {
    const result = await computeTriage({
      ...baseInput,
      voice: makeVoice({ voiceDurationTotal: 0 }),
    });
    expect(result.details.find((d) => d.metric === 'voiceDuration')).toBeUndefined();
  });

  it('flags gross_motor anomaly when classification === delayed', async () => {
    const result = await computeTriage({
      ...baseInput,
      grossMotor: { classification: 'delayed', confidence: 0.9, features: {} },
    });
    const gmDetail = result.details.find((d) => d.domain === 'gross_motor');
    expect(gmDetail?.isAnomaly).toBe(true);
  });

  it('directionalZ is negative when reactionLatency is high (worse than norm)', async () => {
    const result = await computeTriage({
      ...baseInput,
      behavior: makeBehavior({ reactionLatency: 6000 }), // far above mean 2000
    });
    const detail = result.details.find((d) => d.metric === 'reactionLatency');
    expect(detail).toBeDefined();
    expect(detail?.zScore).toBeGreaterThan(0); // raw z positive (high)
    expect(detail?.directionalZ).toBeLessThan(0); // directionalZ flipped: negative = worse
  });

  it('directionalZ matches zScore for non-reversed metrics (drawingScore)', async () => {
    const result = await computeTriage({
      ...baseInput,
      drawing: makeDrawing({ overallScore: 10 }), // far below mean 55
    });
    const detail = result.details.find((d) => d.metric === 'drawingScore');
    expect(detail?.zScore).toBeLessThan(0);
    expect(detail?.directionalZ).toBe(detail?.zScore); // same sign
  });

  it('questionnaireScore detail has directionalZ === null', async () => {
    const result = await computeTriage({
      ...baseInput,
      questionnaireScores: { cognition: 3 },
    });
    const detail = result.details.find((d) => d.metric === 'questionnaireScore');
    expect(detail?.directionalZ).toBeNull();
  });

  it('includes questionnaire anomaly when score below 50% of max', async () => {
    const result = await computeTriage({
      ...baseInput,
      questionnaireScores: { cognition: 3, language_comprehension: 8 },
    });
    const cognitionDetail = result.details.find((d) => d.domain === 'cognition' && d.metric === 'questionnaireScore');
    expect(cognitionDetail?.isAnomaly).toBe(true);
    const langDetail = result.details.find((d) => d.domain === 'language_comprehension' && d.metric === 'questionnaireScore');
    expect(langDetail?.isAnomaly).toBe(false);
  });
});

describe('triage dev-mode warnings', () => {
  it('warns on unknown questionnaire domain', async () => {
    vi.stubEnv('DEV', true);
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await computeTriage({
      ...baseInput,
      questionnaireScores: { unknown_domain: 5 },
      questionnaireMaxScores: { unknown_domain: 10 },
    });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('Unknown questionnaire domain'));
    spy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('warns when questionnaireScores has no questionnaireMaxScores', async () => {
    vi.stubEnv('DEV', true);
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await computeTriage({
      ...baseInput,
      questionnaireScores: { cognition: 3 },
    });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('without questionnaireMaxScores'));
    spy.mockRestore();
    vi.unstubAllEnvs();
  });

  it('does not warn in prod (DEV=false)', async () => {
    vi.stubEnv('DEV', false);
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await computeTriage({
      ...baseInput,
      questionnaireScores: { unknown_domain: 5 },
    });
    expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('Unknown'));
    spy.mockRestore();
    vi.unstubAllEnvs();
  });
});
