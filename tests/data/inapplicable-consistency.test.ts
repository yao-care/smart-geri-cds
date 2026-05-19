import { describe, it } from 'vitest';
import { buildVideoIndex } from '../../scripts/build-video-index';

describe('inapplicable matrix consistency', () => {
  it('build-video-index passes (matrix ↔ yaml in sync)', async () => {
    await buildVideoIndex();
  });
});
