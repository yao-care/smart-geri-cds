import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import ContentViewer from '../../src/components/education/ContentViewer.svelte';
import { db } from '../../src/lib/db/schema';

describe('ContentViewer', () => {
  beforeEach(async () => {
    await db.educationInteractions.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders the title and the "影片" format badge for video format', () => {
    render(ContentViewer, {
      props: {
        slug: 'test-video',
        title: '高齡睡眠衛教',
        format: 'video',
        videoUrl: 'https://www.youtube.com/watch?v=abc12345678',
      },
    });

    expect(screen.getByText('高齡睡眠衛教')).toBeInTheDocument();
    expect(screen.getByText('影片')).toBeInTheDocument();
  });

  it('embeds the YouTube video via the youtube-nocookie iframe', () => {
    render(ContentViewer, {
      props: {
        slug: 'embed-test',
        title: 'Embed Title',
        format: 'video',
        videoUrl: 'https://www.youtube.com/watch?v=abc12345678',
      },
    });

    const iframe = screen.getByTitle('Embed Title') as HTMLIFrameElement;
    expect(iframe.src).toContain('youtube-nocookie.com/embed/');
    expect(iframe.src).toContain('abc12345678');
  });

  it('shows fallback placeholder when videoUrl is empty', () => {
    render(ContentViewer, {
      props: {
        slug: 'no-url',
        title: '無連結影片',
        format: 'video',
        videoUrl: '',
      },
    });

    expect(screen.queryByTitle('無連結影片')).not.toBeInTheDocument();
    expect(screen.getByText('影片連結未設定')).toBeInTheDocument();
  });

  it('shows the 「標記為已觀看」 button until marked read, then hides it', async () => {
    render(ContentViewer, {
      props: {
        slug: 'mark-read-test',
        title: 'mark read',
        format: 'video',
        videoUrl: 'https://youtu.be/abc12345678',
      },
    });

    const markBtn = await screen.findByText('標記為已觀看');
    expect(markBtn).toBeInTheDocument();
    expect(screen.queryByText('已讀')).not.toBeInTheDocument();

    await fireEvent.click(markBtn);

    // After click → IndexedDB write → isRead state flips → "已讀" appears,
    // mark-read button removed.
    await waitFor(() => {
      expect(screen.getByText('已讀')).toBeInTheDocument();
      expect(screen.queryByText('標記為已觀看')).not.toBeInTheDocument();
    });

    // Verify DB recorded the 'complete' action specifically — the embedded
    // InteractionTracker also writes a 'view' record, so filter by action.
    const completes = await db.educationInteractions
      .where('contentSlug')
      .equals('mark-read-test')
      .filter((r) => r.action === 'complete')
      .toArray();
    expect(completes.length).toBe(1);
  });

  it('starts with "已讀" badge if an existing "complete" record is in the DB', async () => {
    // Pre-seed DB with a completion for this slug
    await db.educationInteractions.add({
      id: 'seed-1',
      contentSlug: 'already-read',
      action: 'complete',
      createdAt: new Date(),
    });

    render(ContentViewer, {
      props: {
        slug: 'already-read',
        title: 'Seen before',
        format: 'video',
        videoUrl: 'https://youtu.be/abc12345678',
      },
    });

    // $effect resolves the count async → wait for the badge
    await waitFor(() => {
      expect(screen.getByText('已讀')).toBeInTheDocument();
    });
    // Mark-read button must be hidden in this state
    expect(screen.queryByText('標記為已觀看')).not.toBeInTheDocument();
  });

  it('renders the questionnaire placeholder for questionnaire format', () => {
    render(ContentViewer, {
      props: {
        slug: 'quiz',
        title: 'A quiz',
        format: 'questionnaire',
      },
    });

    expect(screen.getByText('問卷')).toBeInTheDocument();
    expect(screen.getByText(/互動式問卷.*開發中/)).toBeInTheDocument();
    // No iframe / mark-read in questionnaire mode
    expect(screen.queryByText('標記為已觀看')).not.toBeInTheDocument();
  });
});
