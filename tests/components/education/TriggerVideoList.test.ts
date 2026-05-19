import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import TriggerVideoList from '../../../src/components/education/TriggerVideoList.svelte';
import type { RuntimeIndex } from '../../../src/lib/education/schemas';

const mockIndex: RuntimeIndex = {
  catalog: {
    v1aaaaaaaa1: {
      videoId: 'v1aaaaaaaa1', title: '範例', channel: 'c',
      duration: 200, language: 'zh-Hant', sourceTier: 'official-tw', score: 0.9,
    },
  },
  triggers: {
    'cdsa.triage.refer.13-24m': { videoIds: ['v1aaaaaaaa1'], inapplicable: false },
  },
};

describe('TriggerVideoList', () => {
  it('fetches and renders videos for triggers', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => mockIndex,
    } as Response);

    render(TriggerVideoList, { triggers: ['cdsa.triage.refer.13-24m'] });
    await waitFor(() => expect(screen.getByText('範例')).toBeTruthy());
  });

  it('shows nothing when no triggers', () => {
    const { container } = render(TriggerVideoList, { triggers: [] });
    expect(container.textContent).toBe('');
  });
});
