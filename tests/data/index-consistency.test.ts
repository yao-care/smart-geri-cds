import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import { buildVideoIndex } from '../../scripts/build-video-index';

describe('generated index in sync', () => {
  it('public/data/video-index.json matches build output', async () => {
    const before = await fs.readFile('public/data/video-index.json');
    await buildVideoIndex();
    const after = await fs.readFile('public/data/video-index.json');
    expect(before.equals(after)).toBe(true);
  });
});
