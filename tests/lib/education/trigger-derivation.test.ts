import { describe, it, expect, vi } from 'vitest';
import { deriveCdsaTriggers, deriveCdssTriggers } from '../../../src/lib/education/trigger-derivation';
import type { TriageResult } from '../../../src/engine/cdsa/triage';
import type { IndicatorResult } from '../../../src/engine/workers/rule-engine.worker';

function makeTriage(category: 'normal' | 'monitor' | 'refer', anomalyDomains: string[]): TriageResult {
  return {
    category,
    confidence: 0.8,
    summary: 'test',
    anomalyCount: anomalyDomains.length,
    details: anomalyDomains.map(domain => ({
      domain, metric: 'x', value: 0, zScore: -2, directionalZ: -2,
      normMean: null, normStd: null, maxScore: null, isAnomaly: true,
    })),
  };
}

describe('deriveCdsaTriggers', () => {
  it('returns triage trigger for refer', () => {
    expect(deriveCdsaTriggers(makeTriage('refer', []), '13-24m')).toEqual([
      'cdsa.triage.refer.13-24m',
    ]);
  });

  it('skips triage when normal', () => {
    expect(deriveCdsaTriggers(makeTriage('normal', []), '13-24m')).toEqual([]);
  });

  it('emits both triage + domain triggers', () => {
    const triggers = deriveCdsaTriggers(makeTriage('monitor', ['fine_motor']), '25-36m');
    expect(triggers).toContain('cdsa.triage.monitor.25-36m');
    expect(triggers).toContain('cdsa.domain.fine_motor.anomaly.25-36m');
  });

  it('dedups fine_motor when both z-score and questionnaire emit', () => {
    const triage = makeTriage('monitor', ['fine_motor', 'fine_motor']);
    const triggers = deriveCdsaTriggers(triage, '13-24m');
    const domainTriggers = triggers.filter(t => t.startsWith('cdsa.domain.'));
    expect(domainTriggers).toHaveLength(1);
  });

  it('throws on unknown domain in DEV mode', () => {
    vi.stubEnv('DEV', true);
    expect(() => deriveCdsaTriggers(makeTriage('monitor', ['unknown_domain']), '13-24m')).toThrow(/Unknown CDSA domain/);
    vi.unstubAllEnvs();
  });

  it('warns and skips unknown domain in prod mode', () => {
    vi.stubEnv('DEV', false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const triggers = deriveCdsaTriggers(makeTriage('monitor', ['unknown_domain', 'fine_motor']), '13-24m');
    expect(triggers).not.toContain('cdsa.domain.unknown_domain.anomaly.13-24m');
    expect(triggers).toContain('cdsa.domain.fine_motor.anomaly.13-24m');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unknown domain'));
    warn.mockRestore();
    vi.unstubAllEnvs();
  });
});

describe('deriveCdssTriggers', () => {
  const mk = (indicator: string, level: IndicatorResult['level']): IndicatorResult => ({
    indicator, value: 0, level, range: [0, 0],
    rationale: 'test',
  });

  it('skips normal-level indicators', () => {
    expect(deriveCdssTriggers([mk('spo2', 'normal')], 'infant')).toEqual([]);
  });

  it('emits trigger for critical', () => {
    expect(deriveCdssTriggers([mk('spo2', 'critical')], 'infant')).toEqual([
      'cdss.spo2.critical.infant',
    ]);
  });

  it('emits multiple triggers from multiple indicators', () => {
    const triggers = deriveCdssTriggers([
      mk('spo2', 'warning'),
      mk('heart_rate', 'advisory'),
    ], 'toddler');
    expect(triggers).toContain('cdss.spo2.warning.toddler');
    expect(triggers).toContain('cdss.heart_rate.advisory.toddler');
  });

  it('throws on unknown indicator in DEV', () => {
    vi.stubEnv('DEV', true);
    expect(() => deriveCdssTriggers([mk('unknown', 'warning')], 'infant')).toThrow(/Unknown CDSS indicator/);
    vi.unstubAllEnvs();
  });
});
