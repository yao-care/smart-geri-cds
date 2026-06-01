import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('SW register', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('does not register in dev mode', async () => {
    vi.stubEnv('PROD', false);
    vi.stubEnv('BASE_URL', '/smart-geri-cds/');
    const reg = vi.mocked(navigator.serviceWorker.register);
    reg.mockClear();
    const mod = await import('../../../src/lib/sw/register');
    mod.registerSW();
    expect(reg).not.toHaveBeenCalled();
  });

  it('registers SW with correct base path in prod', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('BASE_URL', '/smart-geri-cds/');
    const reg = vi.mocked(navigator.serviceWorker.register);
    reg.mockClear();
    const mod = await import('../../../src/lib/sw/register');
    mod.registerSW();
    expect(reg).toHaveBeenCalledWith('/smart-geri-cds/sw.js');
  });

  it('handles SW register failure gracefully', async () => {
    vi.stubEnv('PROD', true);
    vi.stubEnv('BASE_URL', '/smart-geri-cds/');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const reg = vi.mocked(navigator.serviceWorker.register);
    reg.mockClear();
    reg.mockRejectedValueOnce(new Error('boom'));
    const mod = await import('../../../src/lib/sw/register');
    mod.registerSW();
    // Wait microtask
    await new Promise((r) => setTimeout(r, 0));
    expect(warnSpy).toHaveBeenCalledWith('SW register failed', expect.any(Error));
    warnSpy.mockRestore();
  });
});
