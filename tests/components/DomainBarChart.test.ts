import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import DomainBarChart from '../../src/components/assess/DomainBarChart.svelte';

afterEach(() => cleanup());

describe('DomainBarChart', () => {
  it('renders default title and legend', () => {
    render(DomainBarChart, { data: [{ domain: 'psychological.cognition', score: 80, severity: 'normal' }] });
    expect(screen.getByText('各面向評估結果')).toBeTruthy();
    expect(screen.getByText(/原始分占量表滿分百分比/)).toBeTruthy();
  });

  it('renders custom title', () => {
    render(DomainBarChart, {
      data: [{ domain: 'psychological.cognition', score: 80, severity: 'normal' }],
      title: '自訂標題',
    });
    expect(screen.getByText('自訂標題')).toBeTruthy();
  });

  it('hides legend when showLegend=false', () => {
    render(DomainBarChart, {
      data: [{ domain: 'psychological.cognition', score: 80, severity: 'normal' }],
      showLegend: false,
    });
    expect(screen.queryByText(/原始分占量表滿分百分比/)).toBeNull();
  });

  it('renders the top-category group header', () => {
    render(DomainBarChart, {
      data: [{ domain: 'psychological.cognition', score: 80, severity: 'normal' }],
    });
    expect(screen.getByText('心理/精神')).toBeTruthy();
  });

  it('renders two-level domain label (sub) instead of raw key', () => {
    render(DomainBarChart, {
      data: [{ domain: 'psychological.cognition', score: 80, severity: 'normal' }],
    });
    expect(screen.getByText('認知')).toBeTruthy();
  });

  it('renders the score next to each domain label', () => {
    render(DomainBarChart, {
      data: [
        { domain: 'psychological.cognition', score: 100, severity: 'normal' },
        { domain: 'functional.adl', score: 75, severity: 'monitor' },
      ],
    });
    expect(screen.getByText('100')).toBeTruthy();
    expect(screen.getByText('75')).toBeTruthy();
  });

  it('renders an em-dash for incomplete scales instead of a score', () => {
    render(DomainBarChart, {
      data: [{ domain: 'psychological.mood', score: 0, severity: 'incomplete' }],
    });
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('exposes a per-row aria-label with sub-domain, score and spoken severity', () => {
    render(DomainBarChart, {
      data: [{ domain: 'psychological.cognition', score: 80, severity: 'normal' }],
    });
    expect(screen.getByRole('img', { name: '認知：80（正常）' })).toBeTruthy();
  });

  it('per-row aria-label says 未完成 (not a score) for incomplete scales', () => {
    render(DomainBarChart, {
      data: [{ domain: 'psychological.mood', score: 0, severity: 'incomplete' }],
    });
    expect(screen.getByRole('img', { name: '情緒：未完成' })).toBeTruthy();
  });
});
