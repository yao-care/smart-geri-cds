import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import RadarChart from '../../src/components/assess/RadarChart.svelte';

describe('RadarChart', () => {
  it('renders default title and legend', () => {
    render(RadarChart, { data: [{ domain: 'cognition', score: 80, hasAnomaly: false }] });
    expect(screen.getByText('各面向表現位階')).toBeTruthy();
    expect(screen.getByText(/100 = 表現傑出/)).toBeTruthy();
  });

  it('renders custom title', () => {
    render(RadarChart, {
      data: [{ domain: 'cognition', score: 80, hasAnomaly: false }],
      title: '自訂標題',
    });
    expect(screen.getByText('自訂標題')).toBeTruthy();
  });

  it('hides legend when showLegend=false', () => {
    render(RadarChart, {
      data: [{ domain: 'cognition', score: 80, hasAnomaly: false }],
      showLegend: false,
    });
    expect(screen.queryByText(/100 = 表現傑出/)).toBeNull();
  });

  it('renders score next to each domain label', () => {
    render(RadarChart, {
      data: [
        { domain: 'cognition', score: 100, hasAnomaly: false },
        { domain: 'fine_motor', score: 75, hasAnomaly: false, isHybrid: true },
      ],
    });
    expect(screen.getByText('100')).toBeTruthy();
    expect(screen.getByText('75')).toBeTruthy();
  });

  it('renders hybrid icon for isHybrid=true domains', () => {
    render(RadarChart, {
      data: [{ domain: 'fine_motor', score: 75, hasAnomaly: false, isHybrid: true }],
    });
    expect(screen.getByLabelText(/結合問卷.*測驗.*平均/)).toBeTruthy();
  });
});
