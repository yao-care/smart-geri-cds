import { describe, it, expect } from 'vitest';
import { applyAvailabilityGate } from '$lib/scales/tiering';
import type { ScaleResult, ScaleDef } from '$lib/scales/scale';

const baseResult: ScaleResult = {
  scaleId: 'spmsq',
  domain: { top: 'psychological', sub: 'cognition' },
  rawScore: 8,
  maxScore: 10,
  severity: 'normal',
  bandLabel: '認知功能正常',
};

const patientRequiredDef = {
  requiresPatient: true,
  requiresInformant: false,
} as unknown as ScaleDef;

const informantRequiredDef = {
  requiresPatient: false,
  requiresInformant: true,
} as unknown as ScaleDef;

const noRequirementsDef = {
  requiresPatient: false,
  requiresInformant: false,
} as unknown as ScaleDef;

describe('applyAvailabilityGate', () => {
  // ---- requiresInformant + informant availability ----
  it('requiresInformant scale + no informant available → incomplete「無知情者，無法取得」', () => {
    const r = applyAvailabilityGate(baseResult, { informantAvailable: false, patientAble: true }, informantRequiredDef);
    expect(r.severity).toBe('incomplete');
    expect(r.bandLabel).toMatch(/無知情者/);
  });

  it('requiresInformant scale + informant available → unchanged', () => {
    const r = applyAvailabilityGate(baseResult, { informantAvailable: true, patientAble: true }, informantRequiredDef);
    expect(r.severity).toBe('normal');
    expect(r.bandLabel).toBe('認知功能正常');
  });

  // ---- requiresPatient + patient ability ----
  it('requiresPatient scale + patient cannot participate → incomplete「需受測者本人」', () => {
    const r = applyAvailabilityGate(baseResult, { informantAvailable: true, patientAble: false }, patientRequiredDef);
    expect(r.severity).toBe('incomplete');
    expect(r.bandLabel).toMatch(/需受測者本人/);
  });

  it('requiresPatient scale + patient able → unchanged (even without informant)', () => {
    const r = applyAvailabilityGate(baseResult, { informantAvailable: false, patientAble: true }, patientRequiredDef);
    expect(r.severity).toBe('normal');
    expect(r.bandLabel).toBe('認知功能正常');
  });

  // ---- no requirements ----
  it('no requirements → always unchanged regardless of availability', () => {
    expect(applyAvailabilityGate(baseResult, { informantAvailable: false, patientAble: false }, noRequirementsDef).severity).toBe('normal');
    expect(applyAvailabilityGate(baseResult, { informantAvailable: true, patientAble: true }, noRequirementsDef).severity).toBe('normal');
  });

  // ---- informant gate takes precedence over patient gate when both fail ----
  it('requiresInformant scale + no informant → informant label even if patientAble=false', () => {
    const r = applyAvailabilityGate(baseResult, { informantAvailable: false, patientAble: false }, informantRequiredDef);
    expect(r.severity).toBe('incomplete');
    expect(r.bandLabel).toMatch(/無知情者/);
  });

  // ---- field preservation ----
  it('preserves all other fields when returning incomplete', () => {
    const r = applyAvailabilityGate(baseResult, { informantAvailable: false, patientAble: true }, informantRequiredDef);
    expect(r.scaleId).toBe('spmsq');
    expect(r.domain).toEqual({ top: 'psychological', sub: 'cognition' });
    expect(r.rawScore).toBe(8);
    expect(r.maxScore).toBe(10);
  });
});
