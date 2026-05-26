import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';
import type { RuntimeIndex } from '../src/lib/education/schemas';

// ---------------------------------------------------------------------------
// Global fetch stub — returns a minimal video-index.json for any URL that
// ends with /data/video-index.json, preventing ERR_INVALID_URL in jsdom.
// Individual test files may override fetch with vi.stubGlobal() + vi.resetModules().
// WARNING: returns an EMPTY index. Tests needing real index data must vi.resetModules() + vi.stubGlobal('fetch', ...) themselves (see recommendations-age.test.ts).
// ---------------------------------------------------------------------------

const EMPTY_INDEX: RuntimeIndex = {
  catalog: {},
  triggers: {},
  educationSlugToTriggers: {},
  recommendations: {},
  clinicalEducation: {},
  articleSlugs: [],
};

globalThis.fetch = vi.fn().mockImplementation((url: string | URL | Request) => {
  const href = url instanceof Request ? url.url : String(url);
  if (href.includes('video-index.json')) {
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(EMPTY_INDEX),
    } as Response);
  }
  // Fall through for other URLs (e.g. FHIR tests use vi.stubGlobal separately)
  return Promise.reject(new Error(`fetch not mocked for: ${href}`));
});

Object.defineProperty(globalThis.navigator, 'serviceWorker', {
  configurable: true,
  writable: true,
  value: {
    register: vi.fn().mockResolvedValue({
      addEventListener: vi.fn(),
      installing: null,
      waiting: null,
      active: null,
    }),
    addEventListener: vi.fn(),
    ready: Promise.resolve({}),
  },
});

Object.defineProperty(globalThis.navigator, 'onLine', {
  configurable: true,
  writable: true,
  value: true,
});
