import type { ScaleResult, ScaleDef, Operator, Severity } from './scale';
import type { CfsLevel } from '$lib/utils/cfs-levels';

/**
 * Apply operator validity gate to a ScaleResult.
 *
 * Rules:
 * - `requiresPatient`: only valid when operator is 'self' or 'nurse'.
 *   - 'nurse' reads questions to the patient → valid (patient still answers).
 *   - 'family' answers on behalf of patient for cognitive/emotional tests → invalid.
 * - `requiresInformant`: only valid when operator is 'nurse' or 'family'.
 *   - 'self' cannot be their own informant for caregiver burden scales → invalid.
 */
export function applyOperatorGate(r: ScaleResult, operator: Operator, def: ScaleDef): ScaleResult {
  // family proxy-answering a patient-required scale (cognitive/emotional) → invalid
  const proxyInvalid = def.requiresPatient && operator === 'family';
  // patient self-answering an informant-required scale (e.g. Zarit caregiver) → invalid
  const informantInvalid = def.requiresInformant && operator === 'self';

  if (proxyInvalid || informantInvalid) {
    return { ...r, severity: 'incomplete', bandLabel: '代理人作答，效度存疑' };
  }
  return r;
}

/**
 * Select all tier:'screen' scales applicable to the given CFS level.
 */
export function selectScreenScales(all: ScaleDef[], cfs: CfsLevel): ScaleDef[] {
  return all.filter(s => s.tier === 'screen' && s.applicableCfs.includes(cfs));
}

/** Severities that indicate a flagged (abnormal) screen result. */
const WORSE = (s: Severity): boolean => s === 'monitor' || s === 'refer';

/**
 * Given the screen results, return the full-tier ScaleDef objects to expand into.
 * Only expands scales whose screen result was flagged (severity ≥ monitor).
 * Scales with no `expandsTo` or whose full scale isn't in `all` are silently skipped.
 */
export function expandedFullScales(all: ScaleDef[], screenResults: ScaleResult[]): ScaleDef[] {
  const out: ScaleDef[] = [];
  for (const r of screenResults) {
    if (!WORSE(r.severity)) continue;
    const screen = all.find(s => s.id === r.scaleId);
    if (screen?.expandsTo) {
      const full = all.find(s => s.id === screen.expandsTo);
      if (full) out.push(full);
    }
  }
  return out;
}
