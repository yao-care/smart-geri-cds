import type { TriageResult } from '../../engine/cdsa/triage';
import type { CfsLevel } from '../utils/cfs-levels';
import type { IndicatorResult } from '../../engine/workers/rule-engine.worker';
import { CDSS_INDICATOR_NAMES } from './schemas';
import { isValidDomain } from '../domain/domain-tree';

type AgeGroupCDSS = 'infant' | 'toddler' | 'preschool';

const KNOWN_INDICATORS = new Set<string>(CDSS_INDICATOR_NAMES);

/**
 * 投影 CGA 分流結果為 trigger 字串集合（二層域 × CFS 軸）。
 *   - 整體分流（非 normal / 非 incomplete）→ `cga.triage.${category}.${cfsLevel}`
 *   - 每一筆有異常的量表（severity ≠ normal / incomplete）→
 *     `cga.domain.${top}.${sub}.anomaly.${cfsLevel}`
 * incomplete 量表不產生 trigger（作答不全不假裝異常）；同一 top.sub 去重。
 */
export function deriveCgaTriggers(
  triage: TriageResult,
  cfsLevel: CfsLevel,
): string[] {
  const triggers: string[] = [];

  if (triage.category !== 'normal' && triage.category !== 'incomplete') {
    triggers.push(`cga.triage.${triage.category}.${cfsLevel}`);
  }

  const anomalyDomains = new Set<string>();
  for (const d of triage.details) {
    if (d.severity === 'normal' || d.severity === 'incomplete') continue;
    const { top, sub } = d.domain;
    if (!isValidDomain(top, sub)) {
      if (import.meta.env.DEV) {
        throw new Error(`Unknown CGA domain: ${top}.${sub}. Update DOMAIN_TREE + yaml.`);
      }
      console.warn(`[trigger-derivation] Unknown domain: ${top}.${sub}, skipping`);
      continue;
    }
    anomalyDomains.add(`${top}.${sub}`);
  }
  for (const key of anomalyDomains) {
    const [top, sub] = key.split('.');
    triggers.push(`cga.domain.${top}.${sub}.anomaly.${cfsLevel}`);
  }

  return triggers;
}

/**
 * CDSS 生理指標 trigger（兒科年齡軸，純問卷版停用，不被呼叫）。
 * 保留供 Phase 3 老年量測模組重新接入。
 */
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
