import { describe, it, expect, beforeEach, vi } from 'vitest';
import { startGcmUpload } from '../../../src/lib/fhir/gcm-submit';

const REDIRECT = 'https://smart-geri-cds.yao.care/launch/';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('startGcmUpload', () => {
  it('registers, stores flow, and redirects to /authorize with PKCE + identity params', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ client_id: 'cid-1' }),
    }));
    const assignMock = vi.fn();
    vi.stubGlobal('location', { origin: 'https://smart-geri-cds.yao.care', assign: assignMock } as unknown as Location);

    await startGcmUpload(REDIRECT, { assessmentId: 'a-1', nickname: '王小明', email: 'a@b.c' });

    // flow persisted with assessmentId only (no FHIR resources)
    const flow = JSON.parse(sessionStorage.getItem('gcm.flow')!);
    expect(flow.clientId).toBe('cid-1');
    expect(flow.redirectUri).toBe(REDIRECT);
    expect(flow.verifier).toBeTruthy();
    expect(flow.state).toBeTruthy();
    expect(flow.payload).toEqual({ assessmentId: 'a-1', nickname: '王小明', email: 'a@b.c' });

    // redirected to authorize with the right query params
    expect(assignMock).toHaveBeenCalledTimes(1);
    const url = new URL(assignMock.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://gcm.fhir.yao.care/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('cid-1');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('aud')).toBe('https://gcm.fhir.yao.care');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(flow.challenge);
    expect(url.searchParams.get('nickname')).toBe('王小明');
    expect(url.searchParams.get('login_hint')).toBe(localStorage.getItem('gcm.browserCode'));
    expect(url.searchParams.get('scope')!.split(' ')).not.toContain('openid');
  });
});
