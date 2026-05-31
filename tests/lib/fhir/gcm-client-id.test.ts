import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getClientId } from '../../../src/lib/fhir/gcm-submit';

const REDIRECT = 'https://smart-geri-cds.yao.care/launch/';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('getClientId', () => {
  it('registers once then caches', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ client_id: 'cid-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const a = await getClientId(REDIRECT);
    const b = await getClientId(REDIRECT);
    expect(a).toBe('cid-1');
    expect(b).toBe('cid-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('gcm.clientId')).toBe('cid-1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://gcm.fhir.yao.care/register');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.redirect_uris).toEqual([REDIRECT]);
    expect(body.token_endpoint_auth_method).toBe('none');
  });

  it('forceReregister ignores cache and re-registers', async () => {
    localStorage.setItem('gcm.clientId', 'stale');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ client_id: 'cid-2' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const id = await getClientId(REDIRECT, { forceReregister: true });
    expect(id).toBe('cid-2');
    expect(localStorage.getItem('gcm.clientId')).toBe('cid-2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws on register failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(getClientId(REDIRECT)).rejects.toThrow(/register/);
  });
});
