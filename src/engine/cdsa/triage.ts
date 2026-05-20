import type { BehaviorMetrics } from './behavior-analysis';
import type { VoiceMetrics } from './voice-analysis';
import type { DrawingAnalysisResult } from './drawing-analysis';
import type { AgeGroupCDSA } from '../../lib/utils/age-groups';
import { db } from '../../lib/db/schema';

const KNOWN_QUESTIONNAIRE_DOMAINS = new Set([
  'cognition', 'fine_motor', 'gross_motor',
  'language_comprehension', 'language_expression', 'social_emotional',
]);

export interface TriageInput {
  ageGroup: AgeGroupCDSA;
  behavior: BehaviorMetrics;
  voice: VoiceMetrics;
  drawing: DrawingAnalysisResult;
  questionnaireScores?: Record<string, number>; // domain -> score
  /** Domain → maximum possible score in the questionnaire (questions × 2).
   *  When absent the engine falls back to a conservative 10/domain default
   *  but the radar's normalisation may be inaccurate. */
  questionnaireMaxScores?: Record<string, number>;
  grossMotor?: { classification: string; confidence: number; features: Record<string, number> };
}

export interface TriageResult {
  category: 'normal' | 'monitor' | 'refer';
  confidence: number;
  summary: string;
  anomalyCount: number;
  details: Array<{
    domain: string;
    metric: string;
    value: number;
    zScore: number | null;
    /** Direction-normalised z-score. Negative = worse than norm, positive = better.
     *  Differs from `zScore` because some metrics (reactionLatency, interactionRhythm)
     *  are "higher is worse" — we flip their sign so the radar / summary code can
     *  treat all metrics uniformly. null when zScore is null (e.g. questionnaire).
     */
    directionalZ: number | null;
    /** Norm mean/std this metric was scored against (null for non-z metrics).
     *  Exposed so the physician detail view can show what the value was
     *  compared to without re-loading norms client-side. */
    normMean?: number | null;
    normStd?: number | null;
    /** Per-metric maximum used to compute isAnomaly for questionnaire rows
     *  (null for z-based metrics). */
    maxScore?: number | null;
    isAnomaly: boolean;
  }>;
}

/** Load norms from DB, fall back to hardcoded defaults */
async function loadNorms(ageGroup: AgeGroupCDSA): Promise<Record<string, { mean: number; std: number }>> {
  const defaults: Record<string, { mean: number; std: number }> = {
    'completionRate': { mean: 0.75, std: 0.15 },
    'operationConsistency': { mean: 0.70, std: 0.15 },
    'reactionLatency': { mean: 2000, std: 800 },
    'interactionRhythm': { mean: 0.5, std: 0.2 },
    'drawingScore': { mean: 55, std: 20 },
    'voiceDuration': { mean: 8, std: 4 },
  };

  try {
    const dbNorms = await db.normThresholds
      .where('ageGroup')
      .equals(ageGroup)
      .toArray();

    if (dbNorms.length > 0) {
      const result = { ...defaults };
      for (const norm of dbNorms) {
        result[norm.metric] = { mean: norm.mean, std: norm.std };
      }
      return result;
    }
  } catch {
    // DB not available, use defaults
  }

  return defaults;
}

function zScore(value: number, mean: number, std: number): number {
  if (std === 0) return 0;
  return (value - mean) / std;
}

export async function computeTriage(input: TriageInput): Promise<TriageResult> {
  const NORMS = await loadNorms(input.ageGroup);
  const details: TriageResult['details'] = [];

  // Behavior metrics
  const behaviorMetrics = [
    { domain: 'behavior', metric: 'completionRate', value: input.behavior.completionRate },
    { domain: 'behavior', metric: 'operationConsistency', value: input.behavior.operationConsistency },
    { domain: 'behavior', metric: 'reactionLatency', value: input.behavior.reactionLatency },
    { domain: 'behavior', metric: 'interactionRhythm', value: input.behavior.interactionRhythm },
  ];

  for (const m of behaviorMetrics) {
    const norm = NORMS[m.metric];
    if (!norm) continue;
    const z = zScore(m.value, norm.mean, norm.std);
    // For latency and rhythm, higher is worse (reverse direction)
    const isReversed = m.metric === 'reactionLatency' || m.metric === 'interactionRhythm';
    const effectiveZ = isReversed ? z : -z; // positive effectiveZ = worse
    details.push({
      domain: m.domain,
      metric: m.metric,
      value: m.value,
      zScore: z,
      directionalZ: isReversed ? -z : z, // negative = worse than norm; uniform across metrics
      normMean: norm.mean,
      normStd: norm.std,
      isAnomaly: effectiveZ >= 1.5, // 1.5 SD worse than mean
    });
  }

  // Drawing
  const drawingNorm = NORMS['drawingScore'];
  const drawingZ = zScore(input.drawing.overallScore, drawingNorm.mean, drawingNorm.std);
  details.push({
    domain: 'fine_motor',
    metric: 'drawingScore',
    value: input.drawing.overallScore,
    zScore: drawingZ,
    directionalZ: drawingZ,
    normMean: drawingNorm.mean,
    normStd: drawingNorm.std,
    isAnomaly: drawingZ <= -1.5,
  });

  // Voice
  if (input.voice.voiceDurationTotal > 0) {
    const voiceNorm = NORMS['voiceDuration'];
    const voiceZ = zScore(input.voice.voiceDurationTotal, voiceNorm.mean, voiceNorm.std);
    details.push({
      domain: 'language',
      metric: 'voiceDuration',
      value: input.voice.voiceDurationTotal,
      zScore: voiceZ,
      directionalZ: voiceZ,
      normMean: voiceNorm.mean,
      normStd: voiceNorm.std,
      isAnomaly: voiceZ <= -1.5,
    });
  }

  // Questionnaire scores (if available)
  if (input.questionnaireScores && import.meta.env?.DEV) {
    for (const domain of Object.keys(input.questionnaireScores)) {
      if (!KNOWN_QUESTIONNAIRE_DOMAINS.has(domain)) {
        console.warn(`[triage] Unknown questionnaire domain: ${domain}`);
      }
    }
    if (!input.questionnaireMaxScores) {
      console.warn('[triage] questionnaireScores provided without questionnaireMaxScores');
    }
  }
  if (input.questionnaireScores) {
    for (const [domain, score] of Object.entries(input.questionnaireScores)) {
      // Use the actual per-domain maximum when caller supplies it
      // (questions × 2). Fall back to 10 only when the caller didn't.
      const maxScore = input.questionnaireMaxScores?.[domain] ?? 10;
      const normalized = maxScore > 0 ? score / maxScore : 0;
      details.push({
        domain,
        metric: 'questionnaireScore',
        value: score,
        zScore: null,
        directionalZ: null, // questionnaire 不走 z；radar 改路徑識別 (ResultView)
        maxScore,
        isAnomaly: normalized < 0.5,
      });
    }
  }

  // Gross motor (from MediaPipe Pose analysis)
  if (input.grossMotor && input.grossMotor.classification === 'delayed') {
    details.push({
      domain: 'gross_motor',
      metric: 'poseClassification',
      value: input.grossMotor.confidence,
      zScore: null,
      directionalZ: null, // classification, not a continuous z; radar skips
      isAnomaly: true,
    });
  }

  // Triage decision — gate by both number of anomalous metrics AND how
  // many distinct domains they spread across. Six low scores all under
  // "behavior" is one signal; six low scores across six domains is six
  // independent signals. The dual-axis threshold avoids over-referring
  // when a single domain misfires and under-referring when many domains
  // each flag only one metric.
  const anomalousDetails = details.filter((d) => d.isAnomaly);
  const anomalyCount = anomalousDetails.length;
  const anomalyDomainCount = new Set(anomalousDetails.map((d) => d.domain)).size;

  let category: TriageResult['category'];
  let confidence: number;

  if (anomalyCount >= 3 && anomalyDomainCount >= 2) {
    category = 'refer';
    confidence = Math.min(0.95, 0.7 + 0.04 * anomalyCount + 0.05 * anomalyDomainCount);
  } else if (anomalyCount >= 1) {
    category = 'monitor';
    confidence = Math.min(0.90, 0.6 + 0.08 * anomalyCount + 0.04 * anomalyDomainCount);
  } else {
    category = 'normal';
    confidence = 0.85;
  }

  // Summary — translate domain ids to user-facing Chinese labels so the
  // sentence doesn't leak technical identifiers like "behavior, fine_motor".
  const DOMAIN_LABELS: Record<string, string> = {
    behavior: '行為',
    gross_motor: '粗動作',
    fine_motor: '細動作',
    language: '語言',
    language_comprehension: '語言理解',
    language_expression: '語言表達',
    cognition: '認知',
    social_emotional: '社交情緒',
    diet: '飲食',
  };
  const anomalyDomains = [...new Set(details.filter(d => d.isAnomaly).map(d => d.domain))];
  const anomalyLabels = anomalyDomains.map(d => DOMAIN_LABELS[d] ?? d);
  const summaryMap: Record<TriageResult['category'], string> = {
    'normal': '各面向發展在正常範圍內。',
    'monitor': `${anomalyLabels.join('、')}面向有待觀察。建議持續追蹤。`,
    'refer': `${anomalyLabels.join('、')}面向顯示異常。建議進一步專業評估。`,
  };

  return {
    category,
    confidence,
    summary: summaryMap[category],
    anomalyCount,
    details,
  };
}
