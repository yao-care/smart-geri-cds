import { describe, it, expect } from 'vitest';
import { REDIRECT_INSTITUTIONS, getInstitution } from '../../../src/lib/fhir/intake-institutions';

describe('intake institutions', () => {
  it('exposes the GCM institution', () => {
    const gcm = getInstitution('gcm');
    expect(gcm).toBeDefined();
    expect(gcm?.kind).toBe('redirect-pkce');
    expect(gcm?.base).toBe('https://gcm.fhir.yao.care');
    expect(gcm?.aud).toBe(gcm?.base);
    expect(gcm?.intakeUrl).toBe('https://gcm.org.tw/fhir/Questionnaire/gcm-intake');
  });

  it('GCM scopes exclude openid and fhirUser (GCM has no OIDC)', () => {
    const scopes = getInstitution('gcm')!.scopes.split(' ');
    expect(scopes).not.toContain('openid');
    expect(scopes).not.toContain('fhirUser');
    expect(scopes).toContain('launch/patient');
    expect(scopes).toContain('patient/Observation.c');
    expect(scopes).toContain('offline_access');
  });

  it('REDIRECT_INSTITUTIONS contains gcm', () => {
    expect(REDIRECT_INSTITUTIONS.some(i => i.id === 'gcm')).toBe(true);
  });
});
