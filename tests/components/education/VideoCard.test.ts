import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import VideoCard from '../../../src/components/education/VideoCard.svelte';
import type { RuntimeVideo } from '../../../src/lib/education/schemas';

const video: RuntimeVideo = {
  videoId: 'abc123XYZ45',
  title: '範例衛教',
  channel: '台大兒醫',
  duration: 245,
  language: 'zh-Hant',
  sourceTier: 'official-tw',
  score: 0.92,
};

describe('VideoCard', () => {
  it('renders thumbnail variant by default', () => {
    render(VideoCard, { video });
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toContain('i.ytimg.com');
    expect(img.getAttribute('src')).toContain('abc123XYZ45');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('shows duration in minutes', () => {
    render(VideoCard, { video });
    expect(screen.getByText(/4 分.*5/)).toBeTruthy();
  });

  it('shows sourceTier badge', () => {
    render(VideoCard, { video });
    expect(screen.getByText(/官方/)).toBeTruthy();
  });

  it('inserts iframe with nocookie URL on click', async () => {
    render(VideoCard, { video });
    await fireEvent.click(screen.getByRole('button'));
    const iframe = document.querySelector('iframe');
    expect(iframe?.src).toContain('youtube-nocookie.com');
    expect(iframe?.src).toContain('abc123XYZ45');
    expect(iframe?.src).toContain('cc_load_policy=1');
    expect(iframe?.getAttribute('title')).toBe('範例衛教');
  });

  it('switches to no-thumbnail variant on img error', async () => {
    render(VideoCard, { video });
    const img = screen.getByRole('img');
    await fireEvent.error(img);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByRole('button')).toBeTruthy();
  });
});
