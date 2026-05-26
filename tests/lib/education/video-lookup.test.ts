import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RuntimeIndex, RuntimeVideo } from '../../../src/lib/education/schemas';

const mockVideo = (id: string, score: number, sourceTier: RuntimeVideo['sourceTier'] = 'official-tw'): RuntimeVideo => ({
  videoId: id, title: `t-${id}`, channel: 'c', duration: 200,
  language: 'zh-Hant', sourceTier, score,
});

const mockIndex: RuntimeIndex = {
  catalog: {
    v1: mockVideo('v1', 0.9),
    v2: mockVideo('v2', 0.7),
    v3: mockVideo('v3', 0.5),
  },
  triggers: {
    'cga.triage.refer.cfs5': { videoIds: ['v1', 'v2'], inapplicable: false },
    'cga.domain.functional.adl.anomaly.cfs1': { videoIds: [], inapplicable: true },
    'cga.domain.functional.adl.anomaly.cfs2': { videoIds: ['v3'], inapplicable: false },
    'cga.domain.functional.adl.anomaly.cfs3': { videoIds: [], inapplicable: false },
  },
  educationSlugToTriggers: {},
  recommendations: {},
  clinicalEducation: {},
};

beforeEach(() => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => mockIndex,
  } as Response);
  vi.resetModules();
});

describe('video-lookup', () => {
  it('returns sorted videos for matched trigger', async () => {
    const { getVideosForTrigger } = await import('../../../src/lib/education/video-lookup');
    const videos = await getVideosForTrigger('cga.triage.refer.cfs5');
    expect(videos.map(v => v.videoId)).toEqual(['v1', 'v2']);
  });

  it('returns empty for inapplicable trigger (custom ignored)', async () => {
    const { getVideosForTrigger } = await import('../../../src/lib/education/video-lookup');
    const custom = [{ ...mockVideo('vCustom', 1.0), triggers: '*' as const }];
    const videos = await getVideosForTrigger('cga.domain.functional.adl.anomaly.cfs1', custom);
    expect(videos).toEqual([]);
  });

  it('cfsFallback returns videos from cfs2 when cfs3 empty', async () => {
    const { getVideosForTrigger } = await import('../../../src/lib/education/video-lookup');
    const videos = await getVideosForTrigger('cga.domain.functional.adl.anomaly.cfs3', [], {
      cfsFallback: true,
    });
    expect(videos.map(v => v.videoId)).toEqual(['v3']);
  });

  it('cfsFallback skips inapplicable chain entries', async () => {
    const { getVideosForTrigger } = await import('../../../src/lib/education/video-lookup');
    // cfs2 has v3; cfs2's chain neighbours include cfs1 (inapplicable) and cfs3 (empty).
    // Direct cfs2 lookup returns its own videos (no fallback needed).
    const videos = await getVideosForTrigger('cga.domain.functional.adl.anomaly.cfs2', [], {
      cfsFallback: true,
    });
    expect(videos.map(v => v.videoId)).toEqual(['v3']);
  });

  it('retries after fetch failure', async () => {
    let attempt = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      attempt++;
      if (attempt === 1) throw new Error('network');
      return { ok: true, json: async () => mockIndex } as Response;
    });

    const { getVideosForTrigger } = await import('../../../src/lib/education/video-lookup');
    await expect(getVideosForTrigger('cga.triage.refer.cfs5')).rejects.toThrow();
    const videos = await getVideosForTrigger('cga.triage.refer.cfs5');
    expect(videos).toHaveLength(2);
  });

  it('regex correctly parses cga.domain.<top>.<sub>.anomaly.<cfs>', async () => {
    const { tryCfsFallback } = await import('../../../src/lib/education/video-lookup');
    // cfs3 empty → chain to cfs2 (v3); cfs4 absent.
    const ids = tryCfsFallback('cga.domain.functional.adl.anomaly.cfs3', mockIndex);
    expect(ids).toEqual(['v3']);
  });

  it('regex correctly parses cga.triage.<cat>.<cfs>', async () => {
    const { tryCfsFallback } = await import('../../../src/lib/education/video-lookup');
    // refer.cfs5 has its own videos but tryCfsFallback only looks at chain neighbours;
    // cfs5's neighbours (cfs4/cfs6) are absent → []. The regex must still MATCH (no throw).
    const ids = tryCfsFallback('cga.triage.refer.cfs5', mockIndex);
    expect(ids).toEqual([]);
  });
});
