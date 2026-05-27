import { describe, it, expect } from 'vitest';
import { applyOperatorGate } from '$lib/scales/tiering';
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

describe('applyOperatorGate', () => {
  it('family operator on requiresPatient scale → severity=incomplete, bandLabel 含「代理人」', () => {
    const result = applyOperatorGate(baseResult, 'family', patientRequiredDef);
    expect(result.severity).toBe('incomplete');
    expect(result.bandLabel).toMatch(/代理人/);
  });

  it('self operator on requiresPatient scale → unchanged (patient answered themselves)', () => {
    const result = applyOperatorGate(baseResult, 'self', patientRequiredDef);
    expect(result.severity).toBe('normal');
    expect(result.bandLabel).toBe('認知功能正常');
  });

  it('nurse operator on requiresPatient scale → unchanged (nurse reads questions to patient)', () => {
    const result = applyOperatorGate(baseResult, 'nurse', patientRequiredDef);
    expect(result.severity).toBe('normal');
  });

  it('self operator on requiresInformant scale → severity=incomplete', () => {
    const result = applyOperatorGate(baseResult, 'self', informantRequiredDef);
    expect(result.severity).toBe('incomplete');
    expect(result.bandLabel).toMatch(/代理人/);
  });

  it('nurse operator on requiresInformant scale → unchanged', () => {
    const result = applyOperatorGate(baseResult, 'nurse', informantRequiredDef);
    expect(result.severity).toBe('normal');
  });

  it('family operator on requiresInformant scale → unchanged (family IS the informant)', () => {
    const result = applyOperatorGate(baseResult, 'family', informantRequiredDef);
    expect(result.severity).toBe('normal');
  });

  it('no requirements → always unchanged regardless of operator', () => {
    expect(applyOperatorGate(baseResult, 'family', noRequirementsDef).severity).toBe('normal');
    expect(applyOperatorGate(baseResult, 'self', noRequirementsDef).severity).toBe('normal');
    expect(applyOperatorGate(baseResult, 'nurse', noRequirementsDef).severity).toBe('normal');
  });

  it('preserves all other fields when returning incomplete', () => {
    const result = applyOperatorGate(baseResult, 'family', patientRequiredDef);
    expect(result.scaleId).toBe('spmsq');
    expect(result.domain).toEqual({ top: 'psychological', sub: 'cognition' });
    expect(result.rawScore).toBe(8);
    expect(result.maxScore).toBe(10);
  });
});
