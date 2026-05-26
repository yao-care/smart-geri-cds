import { describe, it, expect, vi } from 'vitest';
import { deriveCgaTriggers, deriveCdssTriggers } from '../../../src/lib/education/trigger-derivation';
import type { TriageResult } from '../../../src/engine/cdsa/triage';
import type { ScaleResult, Severity } from '../../../src/lib/scales/scale';
import type { IndicatorResult } from '../../../src/engine/workers/rule-engine.worker';

function mkResult(
  top: string,
  sub: string,
  severity: Severity,
): ScaleResult {
  return {
    scaleId: `${top}.${sub}-scale`,
    domain: { top: top as ScaleResult['domain']['top'], sub: sub as ScaleResult['domain']['sub'] },
    rawScore: severity === 'incomplete' ? null : 5,
    maxScore: 10,
    severity,
    bandLabel: severity,
  };
}

function makeTriage(category: TriageResult['category'], details: ScaleResult[]): TriageResult {
  return { category, details, summary: 'test' };
}

describe('deriveCgaTriggers', () => {
  it('returns triage trigger for refer', () => {
    const triage = makeTriage('refer', [mkResult('functional', 'adl', 'refer')]);
    const triggers = deriveCgaTriggers(triage, 'cfs5');
    expect(triggers).toContain('cga.triage.refer.cfs5');
  });

  it('skips triage trigger when overall normal', () => {
    const triage = makeTriage('normal', [mkResult('functional', 'adl', 'normal')]);
    expect(deriveCgaTriggers(triage, 'cfs3')).toEqual([]);
  });

  it('skips triage trigger when overall incomplete', () => {
    const triage = makeTriage('incomplete', [mkResult('functional', 'adl', 'incomplete')]);
    expect(deriveCgaTriggers(triage, 'cfs3')).toEqual([]);
  });

  it('emits both triage + per-domain triggers (two-level × cfs)', () => {
    const triage = makeTriage('monitor', [mkResult('functional', 'iadl', 'monitor')]);
    const triggers = deriveCgaTriggers(triage, 'cfs6');
    expect(triggers).toContain('cga.triage.monitor.cfs6');
    expect(triggers).toContain('cga.domain.functional.iadl.anomaly.cfs6');
  });

  it('does not emit a domain trigger for normal/incomplete scales', () => {
    const triage = makeTriage('monitor', [
      mkResult('functional', 'adl', 'normal'),
      mkResult('psychological', 'mood', 'monitor'),
      mkResult('physical', 'nutrition', 'incomplete'),
    ]);
    const triggers = deriveCgaTriggers(triage, 'cfs5');
    expect(triggers).toContain('cga.domain.psychological.mood.anomaly.cfs5');
    expect(triggers).not.toContain('cga.domain.functional.adl.anomaly.cfs5');
    expect(triggers.some(t => t.startsWith('cga.domain.physical.nutrition'))).toBe(false);
  });

  it('dedups the same top.sub when emitted twice', () => {
    const triage = makeTriage('refer', [
      mkResult('functional', 'mobility', 'refer'),
      mkResult('functional', 'mobility', 'monitor'),
    ]);
    const domainTriggers = deriveCgaTriggers(triage, 'cfs4').filter(t => t.startsWith('cga.domain.'));
    expect(domainTriggers).toEqual(['cga.domain.functional.mobility.anomaly.cfs4']);
  });

  it('throws on unknown top.sub in DEV mode', () => {
    vi.stubEnv('DEV', true);
    const triage = makeTriage('monitor', [mkResult('bogus', 'nope', 'monitor')]);
    expect(() => deriveCgaTriggers(triage, 'cfs5')).toThrow(/Unknown CGA domain/);
    vi.unstubAllEnvs();
  });

  it('warns and skips unknown top.sub in prod mode', () => {
    vi.stubEnv('DEV', false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const triage = makeTriage('monitor', [
      mkResult('bogus', 'nope', 'monitor'),
      mkResult('functional', 'falls', 'monitor'),
    ]);
    const triggers = deriveCgaTriggers(triage, 'cfs5');
    expect(triggers).not.toContain('cga.domain.bogus.nope.anomaly.cfs5');
    expect(triggers).toContain('cga.domain.functional.falls.anomaly.cfs5');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unknown domain'));
    warn.mockRestore();
    vi.unstubAllEnvs();
  });
});

describe('deriveCdssTriggers (kept, unused in questionnaire-only build)', () => {
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

  it('throws on unknown indicator in DEV', () => {
    vi.stubEnv('DEV', true);
    expect(() => deriveCdssTriggers([mk('unknown', 'warning')], 'infant')).toThrow(/Unknown CDSS indicator/);
    vi.unstubAllEnvs();
  });
});
