import { describe, it, expect } from 'vitest';
import { dedupeTriageResults } from '../../src/lib/domain/dedupe-triage-results';
import type { ScaleResult } from '../../src/lib/scales/scale';

const r = (scaleId: string, top: string, sub: string, severity: ScaleResult['severity']): ScaleResult =>
  ({ scaleId, domain: { top, sub } as ScaleResult['domain'], rawScore: 0, maxScore: 1, severity, bandLabel: '' });

describe('dedupeTriageResults', () => {
  it('drops triage when same top.sub has a screen result (deep wins)', () => {
    const out = dedupeTriageResults([
      { result: r('falls-triage', 'functional', 'falls', 'monitor'), tier: 'triage' },
      { result: r('steadi-falls', 'functional', 'falls', 'refer'), tier: 'screen' },
    ]);
    expect(out.map(x => x.scaleId)).toEqual(['steadi-falls']);
  });

  it('keeps triage when the domain was not expanded (cold-start normal marker)', () => {
    const out = dedupeTriageResults([
      { result: r('nutrition-triage', 'physical', 'nutrition', 'normal'), tier: 'triage' },
    ]);
    expect(out.map(x => x.scaleId)).toEqual(['nutrition-triage']);
  });

  it('leaves non-triage results untouched', () => {
    const out = dedupeTriageResults([
      { result: r('4at', 'psychological', 'delirium', 'normal'), tier: 'screen' },
      { result: r('cci', 'physical', 'comorbidity', 'monitor'), tier: 'full' },
    ]);
    expect(out.map(x => x.scaleId)).toEqual(['4at', 'cci']);
  });
});
