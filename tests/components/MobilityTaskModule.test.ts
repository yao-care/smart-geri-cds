import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import MobilityTaskModule from '../../src/components/assess/MobilityTaskModule.svelte';
import { MOBILITY_FALLBACK_SCALE } from '../../src/data/mobility-fallback';
import type { ScaleDef, ScaleResult } from '../../src/lib/scales/scale';

const sitToStand: ScaleDef = {
  id: 'sit-to-stand',
  domain: { top: 'functional', sub: 'mobility' },
  applicableCfs: ['cfs2', 'cfs3', 'cfs4', 'cfs5', 'cfs6'],
  scoring: 'measured-value',
  inputType: 'timed-task',
  maxScore: 30,
  items: [],
  bands: [
    { max: 12, severity: 'normal', label: '順暢完成' },
    { min: 13, max: 15, severity: 'monitor', label: '略慢，建議追蹤' },
    { min: 16, severity: 'refer', label: '吃力或需扶，建議評估' },
  ],
  clinicallyReviewed: false,
};

afterEach(() => cleanup());

describe('MobilityTaskModule (camera absent → fallback)', () => {
  it('feature-detects no camera and shows the self-report fallback', async () => {
    // jsdom has no navigator.mediaDevices / MediaRecorder.
    render(MobilityTaskModule, {
      scale: sitToStand,
      fallbackScale: MOBILITY_FALLBACK_SCALE,
      onResult: vi.fn(),
    });
    // Falls back: the first self-report question is shown.
    await waitFor(() => {
      expect(screen.getByText(MOBILITY_FALLBACK_SCALE.items[0].text)).toBeInTheDocument();
    });
  });

  it('produces a functional.mobility ScaleResult after the fallback questions', async () => {
    let received: ScaleResult | null = null;
    render(MobilityTaskModule, {
      scale: sitToStand,
      fallbackScale: MOBILITY_FALLBACK_SCALE,
      onResult: (r: ScaleResult) => { received = r; },
    });

    // Answer every fallback item by clicking the first option each time.
    const total = MOBILITY_FALLBACK_SCALE.items.length;
    for (let i = 0; i < total; i++) {
      await waitFor(() => {
        const btn = screen.queryAllByRole('button').find(b => b.classList.contains('option-btn'));
        expect(btn).toBeTruthy();
      });
      const btn = screen.getAllByRole('button').find(b => b.classList.contains('option-btn'))!;
      await fireEvent.click(btn);
    }

    await waitFor(() => {
      expect(received).not.toBeNull();
    });
    const r = received as unknown as ScaleResult;
    expect(r.scaleId).toBe('mobility-screen');
    expect(r.domain.top).toBe('functional');
    expect(r.domain.sub).toBe('mobility');
    // All first options score 0 → total 0 → normal band.
    expect(r.rawScore).toBe(0);
    expect(r.severity).toBe('normal');
  });
});
