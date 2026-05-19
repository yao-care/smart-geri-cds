export interface ScoreInput {
  channelTier: 'official-tw' | 'international' | 'pro-kol';
  subtitleType: 'human' | 'auto' | 'none';
  medicalTermDensity: number;
  viewCount: number;
  dangerKeywordHits: number;
  publishedAt: string;
  duration: number;
  minDuration: number;
  maxDuration: number;
  timeSensitive: boolean;
  todayIsoDate: string;
}

function yearsBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / (365.25 * 24 * 3600 * 1000);
}

export function computeScore(i: ScoreInput): number {
  const ageY = yearsBetween(i.publishedAt, i.todayIsoDate);
  if (ageY > 8 && i.timeSensitive) return 0;
  if (i.dangerKeywordHits > 0) return 0;

  let score = 0.20;
  score += { 'official-tw': 0.40, international: 0.35, 'pro-kol': 0.20 }[i.channelTier];
  score += { human: 0.15, auto: 0.05, none: 0 }[i.subtitleType];
  score += Math.max(0, Math.min(0.15, i.medicalTermDensity));
  score += Math.max(0, Math.min(0.10, Math.log10(i.viewCount + 1) * 0.02));

  if (ageY > 3 && ageY <= 8) score -= ((ageY - 3) / 5) * 0.15;

  if (i.duration < i.minDuration || i.duration > i.maxDuration) {
    const factor = i.duration < i.minDuration
      ? i.minDuration / Math.max(1, i.duration)
      : i.duration / i.maxDuration;
    score -= Math.min(0.20, 0.05 * factor);
  }

  return Math.max(0, Math.min(1, score));
}

export type Verdict = 'auto-verified' | 'auto-rejected' | 'needs-review';

export function classifyVerdict(i: ScoreInput, score: number): Verdict {
  if (i.dangerKeywordHits > 0) return 'auto-rejected';
  if (score < 0.30) return 'auto-rejected';
  if (
    score >= 0.80 &&
    i.subtitleType === 'human' &&
    (i.channelTier === 'official-tw' || i.channelTier === 'international')
  ) {
    return 'auto-verified';
  }
  return 'needs-review';
}
