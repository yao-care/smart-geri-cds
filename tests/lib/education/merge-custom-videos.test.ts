import { describe, it, expect } from 'vitest';
import { mergeCustomVideos } from '../../../src/lib/education/merge-custom-videos';
import type { CustomVideo, RuntimeVideo } from '../../../src/lib/education/schemas';

const mk = (id: string, score: number): RuntimeVideo => ({
  videoId: id, title: `t-${id}`, channel: 'c', duration: 200,
  language: 'zh-Hant', sourceTier: 'official-tw', score,
});

const mkCustom = (id: string, score: number, triggers: string[] | '*' = '*'): CustomVideo => ({
  ...mk(id, score), triggers,
});

describe('mergeCustomVideos', () => {
  it('returns static videos when no custom', () => {
    const merged = mergeCustomVideos([mk('v1', 0.9), mk('v2', 0.7)], [], 'cga.triage.refer.cfs5', {});
    expect(merged.map(v => v.videoId)).toEqual(['v1', 'v2']);
  });

  it('prepends custom videos before static', () => {
    const merged = mergeCustomVideos(
      [mk('v1', 0.9)],
      [mkCustom('vCustom', 0.5)],
      'cga.triage.refer.cfs5',
      {},
    );
    expect(merged.map(v => v.videoId)).toEqual(['vCustom', 'v1']);
  });

  it('dedupes by videoId, keeping custom version', () => {
    const merged = mergeCustomVideos(
      [mk('v1', 0.9)],
      [mkCustom('v1', 0.3)],
      'cga.triage.refer.cfs5',
      {},
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].score).toBe(0.3);
  });

  it('filters custom videos by trigger when triggers is array', () => {
    const merged = mergeCustomVideos(
      [mk('v1', 0.9)],
      [
        mkCustom('vA', 0.5, ['cga.triage.refer.cfs5']),
        mkCustom('vB', 0.5, ['cga.domain.physical.nutrition.anomaly.cfs5']),
      ],
      'cga.triage.refer.cfs5',
      {},
    );
    expect(merged.map(v => v.videoId)).toEqual(['vA', 'v1']);
  });

  it('passes all custom when triggers is "*"', () => {
    const merged = mergeCustomVideos(
      [mk('v1', 0.9)],
      [mkCustom('vAll', 0.5, '*')],
      'cga.triage.refer.cfs5',
      {},
    );
    expect(merged.map(v => v.videoId)).toEqual(['vAll', 'v1']);
  });

  it('applies maxResults AFTER merge', () => {
    const merged = mergeCustomVideos(
      [mk('v1', 0.9), mk('v2', 0.7)],
      [mkCustom('vA', 0.5)],
      'cga.triage.refer.cfs5',
      { maxResults: 2 },
    );
    expect(merged.map(v => v.videoId)).toEqual(['vA', 'v1']);
  });

  it('sorts each segment by score descending internally', () => {
    const merged = mergeCustomVideos(
      [mk('v1', 0.7), mk('v2', 0.9)],
      [mkCustom('vA', 0.4), mkCustom('vB', 0.6)],
      'cga.triage.refer.cfs5',
      {},
    );
    expect(merged.map(v => v.videoId)).toEqual(['vB', 'vA', 'v2', 'v1']);
  });
});
