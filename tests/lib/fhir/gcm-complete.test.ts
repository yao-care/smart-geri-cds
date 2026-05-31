import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '../../../src/lib/db/schema';
import type { Assessment, Child } from '../../../src/lib/db/schema';
import type { ScaleResult } from '../../../src/lib/scales/scale';
import { completeGcmUpload } from '../../../src/lib/fhir/gcm-submit';

const REDIRECT = 'https://smart-geri-cds.yao.care/launch/';

const detail: ScaleResult = {
  scaleId: 'tug',
  domain: { top: 'physical', sub: 'mobility' },
  severity: 'monitor',
  rawScore: 14,
  maxScore: 30,
  bandLabel: '待觀察',
} as unknown as ScaleResult;

function seedFlow(state: string, payload: object) {
  sessionStorage.setItem('gcm.flow', JSON.stringify({
    verifier: 'v', challenge: 'c', state, redirectUri: REDIRECT, clientId: 'cid-1', payload,
  }));
}

function setSearch(qs: string) {
  window.history.replaceState({}, '', `/launch/?${qs}`);
}

async function seedAssessment(id: string, withDetails = true) {
  const child: Child = { id: 'child-1', birthDate: '1950-01-01', gender: 'male', createdAt: new Date() };
  await db.children.put(child);
  const a: Assessment = {
    id, childId: 'child-1', cfsLevel: 'cfs4', status: 'completed', language: 'zh-TW',
    currentStep: 7, startedAt: new Date('2026-05-31T10:00:00Z'),
    completedAt: new Date('2026-05-31T10:20:00Z'),
    triageResult: { category: 'monitor', summary: 's', details: withDetails ? [detail] : undefined },
    fhirSubmitted: false, createdAt: new Date(), updatedAt: new Date(),
  };
  await db.assessments.put(a);
}

beforeEach(async () => {
  await db.assessments.clear();
  await db.children.clear();
  localStorage.clear();
  sessionStorage.clear();
  setSearch('');
  vi.restoreAllMocks();
});

describe('completeGcmUpload', () => {
  it('rejects when state mismatches (CSRF)', async () => {
    seedFlow('good-state', { assessmentId: 'a-1', nickname: '王' });
    setSearch('code=xyz&state=bad-state');
    await expect(completeGcmUpload()).rejects.toThrow(/state/);
  });

  it('rejects when the assessment has no triageResult.details', async () => {
    await seedAssessment('a-1', false);
    seedFlow('s', { assessmentId: 'a-1', nickname: '王' });
    setSearch('code=xyz&state=s');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, json: () => Promise.resolve({ access_token: 'tok', patient: 'GCM-0001' }),
    }));
    await expect(completeGcmUpload()).rejects.toThrow(/不完整/);
  });

  it('posts a fhir+json transaction Bundle and returns the case id', async () => {
    await seedAssessment('a-1', true);
    seedFlow('s', { assessmentId: 'a-1', nickname: '王小明', email: 'a@b.c', phone: '0912' });
    setSearch('code=the-code&state=s');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ access_token: 'tok', patient: 'GCM-0007' }) }) // /token
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ resourceType: 'Bundle', type: 'transaction-response' }) }); // POST /
    vi.stubGlobal('fetch', fetchMock);

    const out = await completeGcmUpload();
    expect(out.caseId).toBe('GCM-0007');

    // token call: urlencoded, carries code_verifier + redirect_uri
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
    expect(String(tokenUrl)).toBe('https://gcm.fhir.yao.care/token');
    expect((tokenInit as RequestInit).headers).toMatchObject({ 'content-type': 'application/x-www-form-urlencoded' });
    const tokenBody = new URLSearchParams((tokenInit as RequestInit).body as string);
    expect(tokenBody.get('grant_type')).toBe('authorization_code');
    expect(tokenBody.get('code')).toBe('the-code');
    expect(tokenBody.get('redirect_uri')).toBe(REDIRECT);
    expect(tokenBody.get('code_verifier')).toBe('v');

    // upload call: fhir+json transaction Bundle
    const [upUrl, upInit] = fetchMock.mock.calls[1];
    expect(String(upUrl)).toBe('https://gcm.fhir.yao.care/');
    expect((upInit as RequestInit).headers).toMatchObject({
      'content-type': 'application/fhir+json',
      authorization: 'Bearer tok',
    });
    const bundle = JSON.parse((upInit as RequestInit).body as string);
    expect(bundle.resourceType).toBe('Bundle');
    expect(bundle.type).toBe('transaction');

    const types = bundle.entry.map((e: { resource: { resourceType: string } }) => e.resource.resourceType);
    expect(types).toContain('QuestionnaireResponse');
    expect(types).toContain('DiagnosticReport');
    // CFS appears exactly once (buildAssessmentObservations already appends it)
    const cfsCount = bundle.entry.filter((e: { resource: { code?: { coding?: { code?: string }[] } } }) =>
      e.resource.code?.coding?.some(c => c.code === 'clinical-frailty-scale')).length;
    expect(cfsCount).toBe(1);

    // QuestionnaireResponse linkIds align with the server intake form
    const qr = bundle.entry.find((e: { resource: { resourceType: string } }) => e.resource.resourceType === 'QuestionnaireResponse').resource;
    const linkIds = qr.item.map((i: { linkId: string }) => i.linkId);
    expect(linkIds).toContain('email');
    expect(linkIds).toContain('phone');

    // side effects: flow cleared, case recorded
    expect(sessionStorage.getItem('gcm.flow')).toBeNull();
    expect((await db.assessments.get('a-1'))?.gcmCaseId).toBe('GCM-0007');
    expect(localStorage.getItem(`gcm.case.${localStorage.getItem('gcm.browserCode')}.王小明`)).toBe('GCM-0007');
  });

  it('self-heals on invalid_client: clears cached client_id, re-registers, retries token', async () => {
    await seedAssessment('a-1', true);
    localStorage.setItem('gcm.clientId', 'stale');
    seedFlow('s', { assessmentId: 'a-1', nickname: '王' });
    setSearch('code=the-code&state=s');

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 400, json: () => Promise.resolve({ error: 'invalid_client' }) }) // /token #1
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ client_id: 'cid-new' }) })                  // /register
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ access_token: 'tok2', patient: 'GCM-0009' }) }) // /token #2
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ resourceType: 'Bundle', type: 'transaction-response' }) }); // POST /
    vi.stubGlobal('fetch', fetchMock);

    const out = await completeGcmUpload();
    expect(out.caseId).toBe('GCM-0009');
    expect(localStorage.getItem('gcm.clientId')).toBe('cid-new');
    const retryBody = new URLSearchParams((fetchMock.mock.calls[2][1] as RequestInit).body as string);
    expect(retryBody.get('client_id')).toBe('cid-new');
  });
});
