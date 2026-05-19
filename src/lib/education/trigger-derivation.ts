import type { TriageResult } from '../../engine/cdsa/triage';
import type { AgeGroupCDSA } from '../utils/age-groups';
import type { IndicatorResult } from '../../engine/workers/rule-engine.worker';

type AgeGroupCDSS = 'infant' | 'toddler' | 'preschool';

const KNOWN_DOMAINS = new Set([
  'behavior', 'gross_motor', 'fine_motor', 'language',
  'cognition', 'language_comprehension', 'language_expression', 'social_emotional',
]);

const KNOWN_INDICATORS = new Set([
  'heart_rate', 'spo2', 'respiratory_rate', 'temperature',
  'sleep_quality', 'activity_level', 'sugar_intake',
]);

export function deriveCdsaTriggers(
  triage: TriageResult,
  ageGroup: AgeGroupCDSA,
): string[] {
  const triggers: string[] = [];
  if (triage.category !== 'normal') {
    triggers.push(`cdsa.triage.${triage.category}.${ageGroup}`);
  }
  const anomalyDomains = new Set(
    triage.details.filter(d => d.isAnomaly).map(d => d.domain),
  );
  for (const domain of anomalyDomains) {
    if (!KNOWN_DOMAINS.has(domain)) {
      if (import.meta.env.DEV) {
        throw new Error(`Unknown CDSA domain: ${domain}. Update KNOWN_DOMAINS + yaml.`);
      }
      console.warn(`[trigger-derivation] Unknown domain: ${domain}, skipping`);
      continue;
    }
    triggers.push(`cdsa.domain.${domain}.anomaly.${ageGroup}`);
  }
  return triggers;
}

export function deriveCdssTriggers(
  indicators: IndicatorResult[],
  ageGroup: AgeGroupCDSS,
): string[] {
  const triggers: string[] = [];
  for (const ir of indicators) {
    if (ir.level === 'normal') continue;
    if (!KNOWN_INDICATORS.has(ir.indicator)) {
      if (import.meta.env.DEV) {
        throw new Error(`Unknown CDSS indicator: ${ir.indicator}`);
      }
      console.warn(`[trigger-derivation] Unknown indicator: ${ir.indicator}, skipping`);
      continue;
    }
    triggers.push(`cdss.${ir.indicator}.${ir.level}.${ageGroup}`);
  }
  return triggers;
}
