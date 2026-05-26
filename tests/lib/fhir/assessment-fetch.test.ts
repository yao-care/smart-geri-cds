import { describe, it, expect, vi } from 'vitest';
import {
  bundleToAssessment,
  fetchAssessmentFromFhir,
  listAssessmentsFromFhir,
} from '../../../src/lib/fhir/assessment-fetch';
import { ID_SYSTEM, CODE_SYSTEM, CFS_CODE } from '../../../src/lib/fhir/cga-resources';

const ASSESSMENT_ID = 'aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee';

function makeReport(overrides: Record<string, any> = {}): Record<string, any> {
  return {
    resourceType: 'DiagnosticReport',
    id: 'fhir-report-1',
    status: 'final',
    identifier: [{ system: ID_SYSTEM, value: ASSESSMENT_ID }],
    code: { coding: [{ system: CODE_SYSTEM, code: 'cga-assessment' }] },
    subject: { reference: 'Patient/child-123' },
    effectivePeriod: { start: '2026-05-14T10:00:00Z', end: '2026-05-14T10:25:00Z' },
    conclusion: '部分領域需追蹤',
    conclusionCode: [{ coding: [{ system: 'http://snomed.info/sct', code: '394848005' }] }],
    ...overrides,
  };
}

function makeCfsObservation(value: number): Record<string, any> {
  return {
    resourceType: 'Observation',
    code: { coding: [{ system: CODE_SYSTEM, code: CFS_CODE }] },
    valueQuantity: { value, unit: 'level' },
  };
}

describe('bundleToAssessment', () => {
  it('reconstructs an Assessment from DiagnosticReport period + CFS observation', () => {
    const a = bundleToAssessment(makeReport(), [makeCfsObservation(5)]);
    expect(a.id).toBe(ASSESSMENT_ID);
    expect(a.childId).toBe('child-123');
    expect(a.cfsLevel).toBe('cfs5');
    expect(a.triageResult?.category).toBe('monitor');
    expect(a.triageResult?.summary).toBe('部分領域需追蹤');
    expect(a.fhirSubmitted).toBe(true);
    expect(a.fhirDiagnosticReportId).toBe('fhir-report-1');
    expect(a.status).toBe('completed');
    expect(a.completedAt).toBeInstanceOf(Date);
  });

  it('defaults cfsLevel to cfs1 when no CFS observation present', () => {
    const a = bundleToAssessment(makeReport(), []);
    expect(a.cfsLevel).toBe('cfs1');
  });

  it('non-final report status maps to incomplete (no in_progress leak)', () => {
    const a = bundleToAssessment(
      makeReport({ status: 'preliminary', effectivePeriod: undefined, effectiveDateTime: '2026-05-14T10:00:00Z' }),
      [],
    );
    expect(a.status).toBe('incomplete');
    expect(a.completedAt).toBeUndefined();
  });

  it('falls back to effectiveDateTime when effectivePeriod is absent', () => {
    const a = bundleToAssessment(
      makeReport({ effectivePeriod: undefined, effectiveDateTime: '2026-05-14T10:00:00Z' }),
      [],
    );
    expect(a.startedAt.toISOString()).toBe('2026-05-14T10:00:00.000Z');
    expect(a.completedAt).toBeUndefined();
  });

  it('strips legacy conclusion prefix', () => {
    const a = bundleToAssessment(
      makeReport({ conclusion: '部分領域需持續追蹤觀察（信心度 87%）。後續追蹤建議...' }),
      [],
    );
    expect(a.triageResult?.summary).toBe('後續追蹤建議...');
  });

  it('uses report.id as fallback when identifier is missing', () => {
    const a = bundleToAssessment(makeReport({ identifier: [] }), []);
    expect(a.id).toBe('fhir-report-1');
  });

  it('maps SNOMED codes to triage categories', () => {
    const cases: Array<[string, 'normal' | 'monitor' | 'refer']> = [
      ['17621005', 'normal'],
      ['394848005', 'monitor'],
      ['3457005', 'refer'],
    ];
    for (const [code, expected] of cases) {
      const a = bundleToAssessment(
        makeReport({ conclusionCode: [{ coding: [{ code }] }] }),
        [],
      );
      expect(a.triageResult?.category).toBe(expected);
    }
  });
});

describe('fetchAssessmentFromFhir', () => {
  it('returns null when no DiagnosticReport in bundle', async () => {
    const client = { request: vi.fn().mockResolvedValue({ entry: [] }) };
    expect(await fetchAssessmentFromFhir(ASSESSMENT_ID, client)).toBeNull();
  });

  it('passes the identifier-and-include query string', async () => {
    const client = { request: vi.fn().mockResolvedValue({ entry: [{ resource: makeReport() }] }) };
    await fetchAssessmentFromFhir(ASSESSMENT_ID, client);
    expect(client.request).toHaveBeenCalledWith(
      expect.stringContaining(`DiagnosticReport?identifier=${ID_SYSTEM}|${ASSESSMENT_ID}`),
    );
    expect(client.request.mock.calls[0][0]).toContain('_include=DiagnosticReport:result');
  });

  it('returns the parsed Assessment with CFS from observation', async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        entry: [{ resource: makeReport() }, { resource: makeCfsObservation(6) }],
      }),
    };
    const a = await fetchAssessmentFromFhir(ASSESSMENT_ID, client);
    expect(a?.id).toBe(ASSESSMENT_ID);
    expect(a?.triageResult?.category).toBe('monitor');
    expect(a?.cfsLevel).toBe('cfs6');
  });
});

describe('listAssessmentsFromFhir', () => {
  it('queries by patient subject and CGA report code', async () => {
    const client = { request: vi.fn().mockResolvedValue({ entry: [] }) };
    await listAssessmentsFromFhir('patient-1', client);
    const url = client.request.mock.calls[0][0];
    expect(url).toContain('subject=Patient/patient-1');
    expect(url).toContain(`code=${CODE_SYSTEM}|cga-assessment`);
    expect(url).toContain('_sort=-date');
  });

  it('returns summary rows', async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        entry: [{ resource: makeReport() }, { resource: makeReport({ id: 'fhir-report-2' }) }],
      }),
    };
    const list = await listAssessmentsFromFhir('patient-1', client);
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(ASSESSMENT_ID);
    expect(list[0].category).toBe('monitor');
  });
});
