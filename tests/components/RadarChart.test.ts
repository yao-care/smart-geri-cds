import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import RadarChart from '../../src/components/assess/RadarChart.svelte';

describe('RadarChart', () => {
  it('renders default title and legend', () => {
    render(RadarChart, { data: [{ domain: 'psychological.cognition', score: 80, severity: 'normal' }] });
    expect(screen.getByText('各面向評估結果')).toBeTruthy();
    expect(screen.getByText(/原始分占量表滿分百分比/)).toBeTruthy();
  });

  it('renders custom title', () => {
    render(RadarChart, {
      data: [{ domain: 'psychological.cognition', score: 80, severity: 'normal' }],
      title: '自訂標題',
    });
    expect(screen.getByText('自訂標題')).toBeTruthy();
  });

  it('hides legend when showLegend=false', () => {
    render(RadarChart, {
      data: [{ domain: 'psychological.cognition', score: 80, severity: 'normal' }],
      showLegend: false,
    });
    expect(screen.queryByText(/原始分占量表滿分百分比/)).toBeNull();
  });

  it('renders two-level domain label (sub) instead of raw key', () => {
    render(RadarChart, {
      data: [{ domain: 'psychological.cognition', score: 80, severity: 'normal' }],
    });
    expect(screen.getByText('認知')).toBeTruthy();
  });

  it('renders score next to each domain label', () => {
    render(RadarChart, {
      data: [
        { domain: 'psychological.cognition', score: 100, severity: 'normal' },
        { domain: 'functional.adl', score: 75, severity: 'monitor' },
      ],
    });
    expect(screen.getByText('100')).toBeTruthy();
    expect(screen.getByText('75')).toBeTruthy();
  });

  it('renders an em-dash for incomplete scales instead of a score', () => {
    render(RadarChart, {
      data: [{ domain: 'psychological.mood', score: 0, severity: 'incomplete' }],
    });
    expect(screen.getByText('—')).toBeTruthy();
  });
});
