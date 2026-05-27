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

/** Canonical scale ids for the cognition screen pair (C-M2). */
const COGNITION_SCREEN_ID = 'cognition-screen'; // AD8, requiresInformant
const COGNITION_FALLBACK_ID = 'mini-cog';       // objective, requiresPatient

/**
 * C-M2 no-informant fallback for the cognition domain.
 *
 * The Tier-1 cognition screen is AD8 (`cognition-screen`, requiresInformant):
 * it asks a family member / caregiver about the patient. When NO informant is
 * present — i.e. the patient self-administers (`self`) or a nurse reads the
 * questions to the patient with no family present (`nurse`) — AD8 cannot be
 * validly answered. In that case cognition must instead be screened with
 * Mini-Cog (`mini-cog`, an objective, patient-performed test), so cognitively
 * impaired patients without insight are not silently skipped (C-S6).
 *
 * Rule:
 * - operator === 'family' (informant present) → keep AD8 (`cognition-screen`).
 * - operator 'self' | 'nurse' (no informant)  → replace the cognition screen
 *   slot with Mini-Cog.
 *
 * The Mini-Cog def is tier:'full' in source (it is also AD8's deep-expand peer),
 * so it is looked up from `allScales` when provided; otherwise from `screens`.
 * If neither contains it, or there is no cognition screen to replace, `screens`
 * is returned unchanged.
 *
 * Order is preserved: the cognition entry is swapped in place.
 */
export function resolveCognitionScreen(
  screens: ScaleDef[],
  operator: Operator,
  allScales: ScaleDef[] = screens,
): ScaleDef[] {
  // Informant present → AD8 is valid, no substitution.
  if (operator === 'family') return screens;

  const idx = screens.findIndex(s => s.id === COGNITION_SCREEN_ID);
  if (idx === -1) return screens; // no AD8 cognition screen to replace

  const fallback = allScales.find(s => s.id === COGNITION_FALLBACK_ID);
  if (!fallback) return screens; // Mini-Cog not available → leave as-is

  const next = screens.slice();
  next[idx] = fallback;
  return next;
}

/**
 * Select all tier:'screen' scales applicable to the given CFS level.
 *
 * When `operator` is supplied, the cognition screen is resolved through the
 * C-M2 no-informant fallback (AD8 ↔ Mini-Cog) — see `resolveCognitionScreen`.
 * The substituted Mini-Cog must also be applicable to `cfs`, so the fallback
 * is applied first and the CFS filter is re-checked afterwards. Omitting
 * `operator` keeps the legacy behaviour (no cognition substitution).
 */
export function selectScreenScales(all: ScaleDef[], cfs: CfsLevel, operator?: Operator): ScaleDef[] {
  const screens = all.filter(s => s.tier === 'screen' && s.applicableCfs.includes(cfs));
  if (!operator) return screens;
  // Apply the cognition fallback, then re-filter so a substituted scale that is
  // not applicable to this CFS level is dropped.
  return resolveCognitionScreen(screens, operator, all).filter(s => s.applicableCfs.includes(cfs));
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
