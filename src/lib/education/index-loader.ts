/**
 * index-loader.ts
 *
 * Shared singleton fetch+cache for public/data/video-index.json.
 * Both video-lookup.ts and recommendations.ts import from here so
 * there is exactly one in-flight request and one cached Promise.
 */

import type { RuntimeIndex } from './schemas';

let indexPromise: Promise<RuntimeIndex> | null = null;

export function loadVideoIndex(): Promise<RuntimeIndex> {
  if (!indexPromise) {
    indexPromise = fetch(`${import.meta.env.BASE_URL}data/video-index.json`)
      .then(r => {
        if (!r.ok) throw new Error(`video-index.json fetch failed: ${r.status}`);
        return r.json() as Promise<RuntimeIndex>;
      })
      .catch(err => {
        indexPromise = null;
        throw err;
      });
  }
  return indexPromise;
}
