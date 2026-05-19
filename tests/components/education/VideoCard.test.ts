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
  it('renders thumbnail wrapped in YouTube link', () => {
    render(VideoCard, { video });
    const img = screen.getByRole('img');
    expect(img.getAttribute('src')).toContain('i.ytimg.com');
    expect(img.getAttribute('src')).toContain('abc123XYZ45');
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');

    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe('https://www.youtube.com/watch?v=abc123XYZ45');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('shows duration in minutes', () => {
    render(VideoCard, { video });
    expect(screen.getByText(/4 分.*5/)).toBeTruthy();
  });

  it('shows sourceTier badge', () => {
    render(VideoCard, { video });
    expect(screen.getByText(/官方/)).toBeTruthy();
  });

  it('falls back to no-thumbnail when img errors', async () => {
    render(VideoCard, { video });
    const img = screen.getByRole('img');
    await fireEvent.error(img);
    expect(screen.queryByRole('img')).toBeNull();
    // link still exists, opens YouTube directly
    expect(screen.getByRole('link').getAttribute('href')).toBe(
      'https://www.youtube.com/watch?v=abc123XYZ45',
    );
  });
});
