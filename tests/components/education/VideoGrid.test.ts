import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import VideoGrid from '../../../src/components/education/VideoGrid.svelte';
import type { RuntimeVideo } from '../../../src/lib/education/schemas';

const mk = (id: string, score: number, tier: RuntimeVideo['sourceTier'] = 'official-tw'): RuntimeVideo => ({
  videoId: id, title: `t-${id}`, channel: 'c', duration: 200, language: 'zh-Hant', sourceTier: tier, score,
});

describe('VideoGrid', () => {
  it('renders top-3 by default when > 3', () => {
    const videos = ['a', 'b', 'c', 'd', 'e'].map((id, i) => mk(`vid${id}aaa1234`.slice(0, 11), 0.9 - i * 0.1));
    render(VideoGrid, { videos });
    expect(screen.getAllByRole('article')).toHaveLength(3);
  });

  it('renders all when ≤ 3', () => {
    const videos = [mk('vid1aaaaa11', 0.9), mk('vid2aaaaa22', 0.7)];
    render(VideoGrid, { videos });
    expect(screen.getAllByRole('article')).toHaveLength(2);
  });

  it('sorts by score descending', () => {
    const videos = [mk('vid1aaaaa11', 0.5), mk('vid2aaaaa22', 0.9)];
    render(VideoGrid, { videos });
    const articles = screen.getAllByRole('article');
    expect(articles[0].textContent).toContain('vid2aaaaa22'.slice(0, 8));
  });

  it('promotes official-tw on tie (score diff < 0.05)', () => {
    const videos = [mk('vid1aaaaa11', 0.81, 'international'), mk('vid2aaaaa22', 0.78, 'official-tw')];
    render(VideoGrid, { videos });
    const articles = screen.getAllByRole('article');
    expect(articles[0].textContent).toContain('vid2aaaaa22'.slice(0, 8));
  });
});
