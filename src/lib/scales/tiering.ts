import type { ScaleResult, ScaleDef, Severity } from './scale';
import type { CfsLevel } from '$lib/utils/cfs-levels';

/** SOP-truth availability of the two assessment prerequisites. */
export interface Availability {
  /** A family member / caregiver familiar with the subject is present to inform. */
  informantAvailable: boolean;
  /** The subject can participate / be tested / self-report. */
  patientAble: boolean;
}

/**
 * Apply the availability validity gate to a ScaleResult.
 *
 * Real CGA SOP drivers (NOT "who clicks the mouse"):
 * - `requiresInformant` scale + no informant available → cannot be answered
 *   (e.g. Zarit caregiver burden, AD8) → severity=incomplete「無知情者，無法取得」.
 * - `requiresPatient` scale + the subject cannot participate → the
 *   cognitive/emotional test cannot be validly administered → severity=incomplete
 *   「需受測者本人，建議由專業評估」.
 * - otherwise unchanged.
 */
export function applyAvailabilityGate(
  r: ScaleResult,
  { informantAvailable, patientAble }: Availability,
  def: ScaleDef,
): ScaleResult {
  if (def.requiresInformant && !informantAvailable) {
    return { ...r, severity: 'incomplete', bandLabel: '無知情者，無法取得' };
  }
  if (def.requiresPatient && !patientAble) {
    return { ...r, severity: 'incomplete', bandLabel: '需受測者本人，建議由專業評估' };
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
 * available, AD8 cannot be validly answered. In that case cognition must
 * instead be screened with Mini-Cog (`mini-cog`, an objective, patient-performed
 * test), so cognitively impaired patients without insight are not silently
 * skipped (C-S6).
 *
 * Rule:
 * - informantAvailable === true  → keep AD8 (`cognition-screen`).
 * - informantAvailable === false → replace the cognition screen slot with Mini-Cog.
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
  informantAvailable: boolean,
  allScales: ScaleDef[] = screens,
): ScaleDef[] {
  // Informant available → AD8 is valid, no substitution.
  if (informantAvailable) return screens;

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
 * When `informantAvailable` is supplied, the cognition screen is resolved
 * through the C-M2 no-informant fallback (AD8 ↔ Mini-Cog) — see
 * `resolveCognitionScreen`. The substituted Mini-Cog must also be applicable to
 * `cfs`, so the fallback is applied first and the CFS filter is re-checked
 * afterwards. Omitting `informantAvailable` keeps the legacy behaviour (no
 * cognition substitution, i.e. AD8).
 */
export function selectScreenScales(all: ScaleDef[], cfs: CfsLevel, informantAvailable?: boolean): ScaleDef[] {
  const screens = all.filter(s => s.tier === 'screen' && s.applicableCfs.includes(cfs));
  if (informantAvailable === undefined) return screens;
  // Apply the cognition fallback, then re-filter so a substituted scale that is
  // not applicable to this CFS level is dropped.
  return resolveCognitionScreen(screens, informantAvailable, all).filter(s => s.applicableCfs.includes(cfs));
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
