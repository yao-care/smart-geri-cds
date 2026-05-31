import { describe, it, expect, beforeEach } from 'vitest';
import { b64url, makePkce, browserCode } from '../../../src/lib/fhir/gcm-submit';

beforeEach(() => {
  localStorage.clear();
});

describe('b64url', () => {
  it('encodes url-safe base64 without padding', () => {
    const out = b64url(new Uint8Array([251, 252, 253, 254, 255]));
    expect(out).not.toMatch(/[+/=]/);
    expect(out).toBe('-_z9_v8');
  });
});

describe('makePkce', () => {
  it('challenge equals base64url(SHA-256(verifier))', async () => {
    const { verifier, challenge } = await makePkce();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    expect(challenge).toBe(b64url(new Uint8Array(digest)));
    expect(verifier).not.toMatch(/[+/=]/);
  });
});

describe('browserCode', () => {
  it('persists a stable code in localStorage', () => {
    const a = browserCode();
    const b = browserCode();
    expect(a).toBe(b);
    expect(localStorage.getItem('gcm.browserCode')).toBe(a);
  });
});
