import { getAssessment, getChild, markGcmSubmitted } from '../db/assessments';
import { getInstitution, type IntakeInstitution } from './intake-institutions';
import { buildAssessmentObservations, buildTriageDiagnosticReport } from './cga-resources';
import type { TriageResult } from '../../engine/cdsa/triage';

const GCM: IntakeInstitution = getInstitution('gcm')!;

const CLIENT_ID_KEY = 'gcm.clientId';
const BROWSER_CODE_KEY = 'gcm.browserCode';
const FLOW_KEY = 'gcm.flow';

/** 穩定的瀏覽器唯一碼（patient context match key 之一）。 */
export function browserCode(): string {
  let c = localStorage.getItem(BROWSER_CODE_KEY);
  if (!c) {
    c = crypto.randomUUID();
    localStorage.setItem(BROWSER_CODE_KEY, c);
  }
  return c;
}

/** url-safe base64（無 padding）。 */
export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 產生 PKCE verifier/challenge（S256）。 */
export async function makePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

/** 取得（並快取）client_id；forceReregister 用於 invalid_client 自癒。 */
export async function getClientId(
  redirectUri: string,
  opts: { forceReregister?: boolean } = {},
): Promise<string> {
  if (!opts.forceReregister) {
    const cached = localStorage.getItem(CLIENT_ID_KEY);
    if (cached) return cached;
  }
  const r = await fetch(`${GCM.base}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: 'none',
    }),
  });
  if (!r.ok) throw new Error(`register 失敗 ${r.status}`);
  const j = (await r.json()) as { client_id: string };
  localStorage.setItem(CLIENT_ID_KEY, j.client_id);
  return j.client_id;
}

export interface PendingUpload {
  assessmentId: string;
  nickname: string;
  email?: string;
  phone?: string;
}

interface GcmFlow {
  verifier: string;
  challenge: string;
  state: string;
  redirectUri: string;
  clientId: string;
  payload: PendingUpload;
}

/** Step 1：使用者選 GCM、填暱稱/email/電話後呼叫，導向授權。 */
export async function startGcmUpload(redirectUri: string, payload: PendingUpload): Promise<void> {
  const clientId = await getClientId(redirectUri);
  const { verifier, challenge } = await makePkce();
  const state = crypto.randomUUID();
  const flow: GcmFlow = { verifier, challenge, state, redirectUri, clientId, payload };
  sessionStorage.setItem(FLOW_KEY, JSON.stringify(flow));
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: GCM.scopes,
    state,
    aud: GCM.aud,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    login_hint: browserCode(),
    nickname: payload.nickname,
  });
  location.assign(`${GCM.base}/authorize?${q.toString()}`);
}

/** 用 authorization code 換 token；invalid_client 時自癒重註冊後重試一次。 */
async function exchangeToken(flow: GcmFlow, code: string): Promise<{ accessToken: string; caseId: string }> {
  const post = (clientId: string) =>
    fetch(`${GCM.base}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: flow.redirectUri,
        code_verifier: flow.verifier,
        client_id: clientId,
      }).toString(),
    });

  let resp = await post(flow.clientId);
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    if (resp.status === 400 && (body as { error?: string }).error === 'invalid_client') {
      const fresh = await getClientId(flow.redirectUri, { forceReregister: true });
      resp = await post(fresh);
    }
    if (!resp.ok) throw new Error(`token 失敗 ${resp.status}`);
  }
  const t = (await resp.json()) as { access_token: string; patient: string };
  return { accessToken: t.access_token, caseId: t.patient };
}

/** 組初診 QuestionnaireResponse（linkId 對齊 server，供 $extract 寫入 Patient.telecom）。 */
function intakeResponse(email?: string, phone?: string): object {
  const item: object[] = [];
  if (email) item.push({ linkId: 'email', item: [
    { linkId: 'email-system', answer: [{ valueString: 'email' }] },
    { linkId: 'email-value', answer: [{ valueString: email }] },
  ]});
  if (phone) item.push({ linkId: 'phone', item: [
    { linkId: 'phone-system', answer: [{ valueString: 'phone' }] },
    { linkId: 'phone-value', answer: [{ valueString: phone }] },
  ]});
  return { resourceType: 'QuestionnaireResponse', status: 'completed', questionnaire: GCM.intakeUrl, item };
}

/** Step 2：callback 頁偵測到 ?code 且 gcm.flow 存在時呼叫。 */
export async function completeGcmUpload(): Promise<{ caseId: string; result: unknown }> {
  const raw = sessionStorage.getItem(FLOW_KEY);
  if (!raw) throw new Error('找不到 GCM 流程狀態');
  const flow = JSON.parse(raw) as GcmFlow;

  const params = new URLSearchParams(window.location.search);
  if (params.get('state') !== flow.state) throw new Error('state 不符（CSRF）');
  const code = params.get('code');
  if (!code) throw new Error(params.get('error') ?? '授權未取得 code');

  // Rebuild FHIR resources from IndexedDB (flow only carried the assessmentId).
  const assessment = await getAssessment(flow.payload.assessmentId);
  if (!assessment) throw new Error('找不到評估紀錄');
  const child = await getChild(assessment.childId);
  if (!child) throw new Error('找不到受測者資料');
  if (!assessment.triageResult?.details) throw new Error('結果資料不完整，無法上傳');

  const { accessToken, caseId } = await exchangeToken(flow, code);

  const triage = assessment.triageResult as TriageResult;
  const observations = buildAssessmentObservations(assessment, child.id, triage);
  // 本地 placeholder 參照；server 端 transaction/$extract 會處理 subject 與參照。
  const observationIds = observations.map((_, i) => `obs-${i}`);
  const diagnosticReport = buildTriageDiagnosticReport(assessment, child.id, triage, observationIds);

  const entry: object[] = [];
  const { email, phone } = flow.payload;
  if (email || phone) entry.push({ resource: intakeResponse(email, phone) });
  for (const o of observations) entry.push({ resource: o });
  entry.push({ resource: diagnosticReport });

  const up = await fetch(`${GCM.base}/`, {
    method: 'POST',
    headers: { 'content-type': 'application/fhir+json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ resourceType: 'Bundle', type: 'transaction', entry }),
  });
  if (!up.ok) throw new Error(`上傳失敗 ${up.status}`);

  sessionStorage.removeItem(FLOW_KEY);
  await markGcmSubmitted(flow.payload.assessmentId, caseId);
  localStorage.setItem(`gcm.case.${browserCode()}.${flow.payload.nickname}`, caseId);
  return { caseId, result: await up.json() };
}
