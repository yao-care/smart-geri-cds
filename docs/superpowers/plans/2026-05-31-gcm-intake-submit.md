# GCM 收案上傳整合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓患者在 `/result/` 結果頁透過統一「收案機構」選擇器，把 CGA 評估結果以 SMART on FHIR（動態註冊 + PKCE + transaction Bundle）上傳到 `https://gcm.fhir.yao.care`，並新建共用 `/launch/` callback 頁同時承接 GCM 與既有 fhirclient 回呼。

**Architecture:** 收案機構分兩 `kind`：`fhirclient`（已連線醫院，執行期動態項，走既有頁內 POST）與 `redirect-pkce`（GCM，靜態常數項，走 redirect）。GCM 跨 redirect 只把 `assessmentId` 等存進 `sessionStorage['gcm.flow']`，回呼後從 IndexedDB 重建 FHIR 資源再上傳。`/launch/` 以「有無 `gcm.flow`」分流，GCM 成功後務必 `removeItem('gcm.flow')`。

**Tech Stack:** Astro 5 + Svelte 5 runes、Dexie 4（IndexedDB）、原生 `fetch` + `crypto.subtle`（PKCE，不用 fhirclient，因要帶自訂 `login_hint`/`nickname`）、vitest（jsdom + fake-indexeddb）。

**Spec:** `docs/superpowers/specs/2026-05-31-gcm-intake-submit-design.md`

---

## File Structure

- Create `src/lib/fhir/intake-institutions.ts` — `IntakeInstitution` 型別 + GCM 靜態常數清單。
- Create `src/lib/fhir/gcm-submit.ts` — register/PKCE/token/transaction 流程；`startGcmUpload`、`completeGcmUpload` 及純函式 helper。
- Modify `src/lib/db/schema.ts` — `Assessment` 加 `gcmCaseId?: string`。
- Modify `src/lib/db/assessments.ts` — 加 `markGcmSubmitted(id, caseId)`。
- Create `src/components/fhir/LaunchCallback.svelte` — `/launch/` 的雙路 callback island。
- Create `src/pages/launch/index.astro` — `/launch/` 頁，掛載 `LaunchCallback`。
- Modify `src/components/fhir/StandaloneLaunch.svelte` — redirect 前存 `sessionStorage['fhir.return']`。
- Create `src/components/assess/IntakeSubmit.svelte` — 統一收案機構選擇器。
- Modify `src/components/assess/ResultView.svelte` — 以 `IntakeSubmit` 取代現有 result-actions 上傳區塊。
- Create tests under `tests/lib/fhir/` 與 `tests/lib/db/`。

---

## Task 1: schema + markGcmSubmitted

**Files:**
- Modify: `src/lib/db/schema.ts:156-157`（`Assessment` 的 `fhirSubmitted`/`fhirDiagnosticReportId` 附近）
- Modify: `src/lib/db/assessments.ts`（檔尾，`markFhirSubmitted` 之後）
- Test: `tests/lib/db/gcm-submitted.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/db/gcm-submitted.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../../../src/lib/db/schema';
import { markGcmSubmitted } from '../../../src/lib/db/assessments';
import type { Assessment } from '../../../src/lib/db/schema';

function makeAssessment(id: string): Assessment {
  return {
    id,
    childId: 'child-1',
    cfsLevel: 'cfs4',
    status: 'completed',
    language: 'zh-TW',
    currentStep: 7,
    startedAt: new Date('2026-05-31T10:00:00Z'),
    completedAt: new Date('2026-05-31T10:20:00Z'),
    fhirSubmitted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

beforeEach(async () => {
  await db.assessments.clear();
});

describe('markGcmSubmitted', () => {
  it('records the GCM case id on the assessment', async () => {
    await db.assessments.put(makeAssessment('a-1'));
    await markGcmSubmitted('a-1', 'GCM-0042');
    const got = await db.assessments.get('a-1');
    expect(got?.gcmCaseId).toBe('GCM-0042');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/lib/db/gcm-submitted.test.ts`
Expected: FAIL — `markGcmSubmitted` 未匯出 / `gcmCaseId` 不在型別。

- [ ] **Step 3: Add the schema field**

在 `src/lib/db/schema.ts` 的 `Assessment` interface，`fhirDiagnosticReportId?: string;`（第 157 行）之後新增：

```ts
  /** GCM（或其他 redirect 型收案機構）回傳的病例唯一碼（收案編號）。 */
  gcmCaseId?: string;
```

- [ ] **Step 4: Add the DAO function**

在 `src/lib/db/assessments.ts` 的 `markFhirSubmitted` 之後新增：

```ts
/** 記錄 GCM 收案編號（病例唯一碼）。 */
export async function markGcmSubmitted(id: string, caseId: string): Promise<void> {
  await db.assessments.update(id, { gcmCaseId: caseId, updatedAt: new Date() });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run tests/lib/db/gcm-submitted.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/db/schema.ts src/lib/db/assessments.ts tests/lib/db/gcm-submitted.test.ts
git commit -m "feat(db): Assessment.gcmCaseId + markGcmSubmitted"
```

---

## Task 2: intake-institutions 常數

**Files:**
- Create: `src/lib/fhir/intake-institutions.ts`
- Test: `tests/lib/fhir/intake-institutions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/fhir/intake-institutions.test.ts
import { describe, it, expect } from 'vitest';
import { REDIRECT_INSTITUTIONS, getInstitution } from '../../../src/lib/fhir/intake-institutions';

describe('intake institutions', () => {
  it('exposes the GCM institution', () => {
    const gcm = getInstitution('gcm');
    expect(gcm).toBeDefined();
    expect(gcm?.kind).toBe('redirect-pkce');
    expect(gcm?.base).toBe('https://gcm.fhir.yao.care');
    expect(gcm?.aud).toBe(gcm?.base);
    expect(gcm?.intakeUrl).toBe('https://gcm.org.tw/fhir/Questionnaire/gcm-intake');
  });

  it('GCM scopes exclude openid and fhirUser (GCM has no OIDC)', () => {
    const scopes = getInstitution('gcm')!.scopes.split(' ');
    expect(scopes).not.toContain('openid');
    expect(scopes).not.toContain('fhirUser');
    expect(scopes).toContain('launch/patient');
    expect(scopes).toContain('patient/Observation.c');
    expect(scopes).toContain('offline_access');
  });

  it('REDIRECT_INSTITUTIONS contains gcm', () => {
    expect(REDIRECT_INSTITUTIONS.some(i => i.id === 'gcm')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/lib/fhir/intake-institutions.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module**

```ts
// src/lib/fhir/intake-institutions.ts

/** redirect 型收案機構（動態註冊 + PKCE）。已連線的 fhirclient 醫院不在此清單，
 *  而是於執行期依 authStore.isAuthenticated 動態帶入。 */
export interface IntakeInstitution {
  id: string;
  kind: 'redirect-pkce';
  name: string;
  /** FHIR base = aud。 */
  base: string;
  /** 初診表單（SDC）canonical URL。 */
  intakeUrl: string;
  /** OAuth scope；不得含 openid/fhirUser（GCM 不支援 OIDC）。 */
  scopes: string;
  /** OAuth aud，必為 base。 */
  aud: string;
}

const GCM_BASE = 'https://gcm.fhir.yao.care';

export const REDIRECT_INSTITUTIONS: IntakeInstitution[] = [
  {
    id: 'gcm',
    kind: 'redirect-pkce',
    name: 'GCM 預防醫學發展協會',
    base: GCM_BASE,
    intakeUrl: 'https://gcm.org.tw/fhir/Questionnaire/gcm-intake',
    scopes:
      'launch/patient patient/Observation.c patient/DiagnosticReport.c patient/QuestionnaireResponse.c patient/Patient.u offline_access',
    aud: GCM_BASE,
  },
];

export function getInstitution(id: string): IntakeInstitution | undefined {
  return REDIRECT_INSTITUTIONS.find(i => i.id === id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/lib/fhir/intake-institutions.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/fhir/intake-institutions.ts tests/lib/fhir/intake-institutions.test.ts
git commit -m "feat(fhir): redirect-pkce intake institutions (GCM)"
```

---

## Task 3a: gcm-submit 純函式 helper（b64url / PKCE / browserCode）

**Files:**
- Create: `src/lib/fhir/gcm-submit.ts`
- Test: `tests/lib/fhir/gcm-submit-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/fhir/gcm-submit-helpers.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { b64url, makePkce, browserCode } from '../../../src/lib/fhir/gcm-submit';

beforeEach(() => {
  localStorage.clear();
});

describe('b64url', () => {
  it('encodes url-safe base64 without padding', () => {
    const out = b64url(new Uint8Array([251, 252, 253, 254, 255]));
    expect(out).not.toMatch(/[+/=]/);
    expect(out).toBe('-_z9_v8');
  });
});

describe('makePkce', () => {
  it('challenge equals base64url(SHA-256(verifier))', async () => {
    const { verifier, challenge } = await makePkce();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    expect(challenge).toBe(b64url(new Uint8Array(digest)));
    expect(verifier).not.toMatch(/[+/=]/);
  });
});

describe('browserCode', () => {
  it('persists a stable code in localStorage', () => {
    const a = browserCode();
    const b = browserCode();
    expect(a).toBe(b);
    expect(localStorage.getItem('gcm.browserCode')).toBe(a);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/lib/fhir/gcm-submit-helpers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the module with helpers**

```ts
// src/lib/fhir/gcm-submit.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/lib/fhir/gcm-submit-helpers.test.ts`
Expected: PASS

> 註：vitest 在 Node 環境提供 `globalThis.crypto`（webcrypto），`crypto.subtle`/`randomUUID`/`getRandomValues` 皆可用，無需 polyfill。

- [ ] **Step 5: Commit**

```bash
git add src/lib/fhir/gcm-submit.ts tests/lib/fhir/gcm-submit-helpers.test.ts
git commit -m "feat(fhir): gcm-submit PKCE/b64url/browserCode helpers"
```

---

## Task 3b: getClientId（含 invalid_client 自癒）

**Files:**
- Modify: `src/lib/fhir/gcm-submit.ts`
- Test: `tests/lib/fhir/gcm-client-id.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/fhir/gcm-client-id.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getClientId } from '../../../src/lib/fhir/gcm-submit';

const REDIRECT = 'https://smart-geri-cds.yao.care/launch/';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('getClientId', () => {
  it('registers once then caches', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ client_id: 'cid-1' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const a = await getClientId(REDIRECT);
    const b = await getClientId(REDIRECT);
    expect(a).toBe('cid-1');
    expect(b).toBe('cid-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('gcm.clientId')).toBe('cid-1');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://gcm.fhir.yao.care/register');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.redirect_uris).toEqual([REDIRECT]);
    expect(body.token_endpoint_auth_method).toBe('none');
  });

  it('forceReregister ignores cache and re-registers', async () => {
    localStorage.setItem('gcm.clientId', 'stale');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ client_id: 'cid-2' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const id = await getClientId(REDIRECT, { forceReregister: true });
    expect(id).toBe('cid-2');
    expect(localStorage.getItem('gcm.clientId')).toBe('cid-2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws on register failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(getClientId(REDIRECT)).rejects.toThrow(/register/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/lib/fhir/gcm-client-id.test.ts`
Expected: FAIL — `getClientId` 未匯出。

- [ ] **Step 3: Add getClientId to gcm-submit.ts**

在 `src/lib/fhir/gcm-submit.ts` 的 helper 之後新增：

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/lib/fhir/gcm-client-id.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/fhir/gcm-submit.ts tests/lib/fhir/gcm-client-id.test.ts
git commit -m "feat(fhir): gcm getClientId with re-register support"
```

---

## Task 3c: startGcmUpload（導向授權）

**Files:**
- Modify: `src/lib/fhir/gcm-submit.ts`
- Test: `tests/lib/fhir/gcm-start.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/fhir/gcm-start.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { startGcmUpload } from '../../../src/lib/fhir/gcm-submit';

const REDIRECT = 'https://smart-geri-cds.yao.care/launch/';

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('startGcmUpload', () => {
  it('registers, stores flow, and redirects to /authorize with PKCE + identity params', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ client_id: 'cid-1' }),
    }));
    const assignMock = vi.fn();
    vi.stubGlobal('location', { origin: 'https://smart-geri-cds.yao.care', assign: assignMock } as unknown as Location);

    await startGcmUpload(REDIRECT, { assessmentId: 'a-1', nickname: '王小明', email: 'a@b.c' });

    // flow persisted with assessmentId only (no FHIR resources)
    const flow = JSON.parse(sessionStorage.getItem('gcm.flow')!);
    expect(flow.clientId).toBe('cid-1');
    expect(flow.redirectUri).toBe(REDIRECT);
    expect(flow.verifier).toBeTruthy();
    expect(flow.state).toBeTruthy();
    expect(flow.payload).toEqual({ assessmentId: 'a-1', nickname: '王小明', email: 'a@b.c' });

    // redirected to authorize with the right query params
    expect(assignMock).toHaveBeenCalledTimes(1);
    const url = new URL(assignMock.mock.calls[0][0]);
    expect(url.origin + url.pathname).toBe('https://gcm.fhir.yao.care/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('cid-1');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT);
    expect(url.searchParams.get('aud')).toBe('https://gcm.fhir.yao.care');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(flow.challenge);
    expect(url.searchParams.get('nickname')).toBe('王小明');
    expect(url.searchParams.get('login_hint')).toBe(localStorage.getItem('gcm.browserCode'));
    expect(url.searchParams.get('scope')!.split(' ')).not.toContain('openid');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/lib/fhir/gcm-start.test.ts`
Expected: FAIL — `startGcmUpload` 未匯出。

- [ ] **Step 3: Add the PendingUpload type + startGcmUpload**

在 `src/lib/fhir/gcm-submit.ts` 新增：

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/lib/fhir/gcm-start.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/fhir/gcm-submit.ts tests/lib/fhir/gcm-start.test.ts
git commit -m "feat(fhir): startGcmUpload (register + PKCE + redirect)"
```

---

## Task 3d: completeGcmUpload（token → 重建 → transaction）

**Files:**
- Modify: `src/lib/fhir/gcm-submit.ts`
- Test: `tests/lib/fhir/gcm-complete.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/fhir/gcm-complete.test.ts
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
    // QuestionnaireResponse (email/phone) + Observations + DiagnosticReport
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/lib/fhir/gcm-complete.test.ts`
Expected: FAIL — `completeGcmUpload` 未匯出。

- [ ] **Step 3: Implement completeGcmUpload + helpers**

在 `src/lib/fhir/gcm-submit.ts` 新增（檔尾）：

```ts
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
  const observationIds = observations.map((_, i) => `obs-${i}`); // local placeholder refs; server overwrites subject/links
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
```

> 註：`buildTriageDiagnosticReport` 的 `result` 參照用本地 placeholder id；server 端 `$extract`/transaction 會處理參照與 subject，app 不必算對（spec §整合契約）。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/lib/fhir/gcm-complete.test.ts`
Expected: PASS（4 個案例全綠）

- [ ] **Step 5: Commit**

```bash
git add src/lib/fhir/gcm-submit.ts tests/lib/fhir/gcm-complete.test.ts
git commit -m "feat(fhir): completeGcmUpload (token + IDB rebuild + transaction)"
```

---

## Task 4: 共用 /launch/ callback 頁

**Files:**
- Create: `src/components/fhir/LaunchCallback.svelte`
- Create: `src/pages/launch/index.astro`

> 此頁主要為瀏覽器導向整合，邏輯薄（分流 + 呼叫已測過的函式）；不寫單元測試，改由 Task 8 的端到端線上驗證覆蓋。

- [ ] **Step 1: Create the LaunchCallback island**

```svelte
<!-- src/components/fhir/LaunchCallback.svelte -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { completeGcmUpload } from '$lib/fhir/gcm-submit';
  import { handleCallback } from '$lib/fhir/launch';
  import { authStore } from '$lib/stores/auth.svelte';

  type View =
    | { kind: 'working' }
    | { kind: 'gcm-done'; caseId: string }
    | { kind: 'error'; message: string };

  let view = $state<View>({ kind: 'working' });

  onMount(async () => {
    const params = new URLSearchParams(window.location.search);

    // 1. GCM redirect 流程：以 sessionStorage['gcm.flow'] 分流
    if (sessionStorage.getItem('gcm.flow')) {
      try {
        const { caseId } = await completeGcmUpload();
        view = { kind: 'gcm-done', caseId };
      } catch (e) {
        view = { kind: 'error', message: e instanceof Error ? e.message : '上傳失敗' };
      }
      return;
    }

    // 2. fhirclient 醫院 standalone callback
    if (params.has('code') || params.has('error')) {
      if (params.has('error')) {
        view = { kind: 'error', message: params.get('error') ?? '授權失敗' };
        return;
      }
      try {
        const { accessToken, fhirUser, scopes } = await handleCallback();
        // baseUrl 由 fhirclient state 提供；handleCallback 後 authStore 取 serverUrl
        authStore.setAuth(accessToken, getServerUrl(), fhirUser, scopes);
        const back = sessionStorage.getItem('fhir.return') ?? '/assess/';
        sessionStorage.removeItem('fhir.return');
        window.location.replace(back);
      } catch (e) {
        view = { kind: 'error', message: e instanceof Error ? e.message : '連線失敗' };
      }
      return;
    }

    // 3. 既非 GCM 也非 callback → 導回首頁
    window.location.replace('/');
  });

  function getServerUrl(): string {
    // fhirclient 把 server url 存在 client.state.serverUrl；handleCallback 已 ready()
    // 透過 client 取得（client.ts 已封裝），此處以 authStore 既有欄位為準。
    return authStore.fhirBaseUrl ?? '';
  }
</script>

{#if view.kind === 'working'}
  <p class="msg">處理中，請稍候…</p>
{:else if view.kind === 'gcm-done'}
  <div class="done">
    <h1>已上傳至 GCM 收案系統</h1>
    <p class="case">收案編號：<strong>{view.caseId}</strong></p>
    <p class="hint">請保留此編號供複診對照。</p>
    <a class="btn" href="/history/">查看評估紀錄</a>
  </div>
{:else}
  <div class="err" role="alert">
    <h1>上傳未完成</h1>
    <p>{view.message}</p>
    <a class="btn" href="/result/">返回結果頁</a>
  </div>
{/if}

<style>
  .msg, .done, .err {
    max-width: 480px;
    margin: var(--space-8) auto;
    padding: var(--space-6);
    text-align: center;
  }
  h1 { font-size: var(--text-xl); margin-bottom: var(--space-4); }
  .case { font-size: var(--text-lg); }
  .case strong { color: var(--accent); }
  .hint { color: color-mix(in srgb, var(--text), var(--bg) 30%); font-size: var(--text-sm); }
  .btn {
    display: inline-block;
    margin-top: var(--space-5);
    padding: var(--space-3) var(--space-6);
    background: var(--accent);
    color: white;
    border-radius: var(--radius-md);
    text-decoration: none;
    min-height: 44px;
    font-size: var(--text-base);
  }
  .err h1 { color: var(--danger); }
</style>
```

> ⚠️ 實作時請先確認 `handleCallback()` 回傳能取得 server base URL。檢視 `src/lib/fhir/client.ts` 的 `completeAuth()`/`getClient()`：fhirclient 的 `client.state.serverUrl` 即為 base。若 `handleCallback` 未回傳 serverUrl，請在 `src/lib/fhir/launch.ts` 的 `handleCallback` 回傳值加上 `serverUrl: client.state.serverUrl`，並在此處改用之（取代 `getServerUrl()` 暫接）。這是把既有未接線的醫院流程一併接起來所需。

- [ ] **Step 2: Create the page**

```astro
---
// src/pages/launch/index.astro
import Base from '../../layouts/Base.astro';
import LaunchCallback from '../../components/fhir/LaunchCallback.svelte';
---

<Base title="連線處理" description="SMART on FHIR 授權回呼處理">
  <meta slot="head" name="referrer" content="no-referrer" />
  <meta slot="head" name="robots" content="noindex" />
  <main id="main-content" class="launch-main">
    <LaunchCallback client:load />
  </main>
</Base>

<style>
  .launch-main {
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
  }
</style>
```

- [ ] **Step 3: Wire serverUrl into handleCallback (if needed)**

檢視 `src/lib/fhir/launch.ts:48-61`。若 `handleCallback` 未回傳 server base，改為：

```ts
export async function handleCallback(): Promise<{
  client: Client;
  accessToken: string;
  fhirUser: string;
  scopes: string[];
  serverUrl: string;
}> {
  const client = await completeAuth();
  return {
    client,
    accessToken: getAccessToken(),
    fhirUser: getFhirUser(),
    scopes: getScopes(),
    serverUrl: client.state.serverUrl ?? '',
  };
}
```

並把 `LaunchCallback.svelte` 的 `authStore.setAuth(accessToken, getServerUrl(), ...)` 改為使用解構出的 `serverUrl`，移除 `getServerUrl()` 暫接。

- [ ] **Step 4: Build smoke check**

Run: `pnpm check`
Expected: 無型別錯誤（svelte-check + astro check 通過）。

- [ ] **Step 5: Commit**

```bash
git add src/components/fhir/LaunchCallback.svelte src/pages/launch/index.astro src/lib/fhir/launch.ts
git commit -m "feat(fhir): shared /launch/ callback (GCM + fhirclient)"
```

---

## Task 5: StandaloneLaunch 記住 return URL

**Files:**
- Modify: `src/components/fhir/StandaloneLaunch.svelte:72`（`handleStandaloneLaunch` 呼叫前）

- [ ] **Step 1: Store fhir.return before redirect**

在 `src/components/fhir/StandaloneLaunch.svelte` 呼叫 `handleStandaloneLaunch(...)` 之前一行加入：

```ts
      sessionStorage.setItem('fhir.return', window.location.pathname + window.location.search);
```

（使 fhirclient 授權回到 `/launch/` 後能導回原頁，預設 `/assess/`。）

- [ ] **Step 2: Type check**

Run: `pnpm check`
Expected: 通過。

- [ ] **Step 3: Commit**

```bash
git add src/components/fhir/StandaloneLaunch.svelte
git commit -m "feat(fhir): remember return URL before standalone launch"
```

---

## Task 6: IntakeSubmit 統一選擇器 + 接入 ResultView

**Files:**
- Create: `src/components/assess/IntakeSubmit.svelte`
- Modify: `src/components/assess/ResultView.svelte:184-195`（result-actions 上傳區塊）

- [ ] **Step 1: Create IntakeSubmit.svelte**

```svelte
<!-- src/components/assess/IntakeSubmit.svelte -->
<script lang="ts">
  import { authStore } from '../../lib/stores/auth.svelte';
  import { getTenantDisplayName } from '../../lib/utils/tenant';
  import { REDIRECT_INSTITUTIONS } from '../../lib/fhir/intake-institutions';
  import { startGcmUpload } from '../../lib/fhir/gcm-submit';
  import { submitAssessmentToFhir } from '../../lib/fhir/cdsa-submit';
  import type { Assessment, Child } from '../../lib/db/schema';
  import type { TriageResult } from '../../engine/cdsa/triage';

  interface Props {
    assessment: Assessment;
    child: Child;
    triageResult: TriageResult;
  }
  let { assessment, child, triageResult }: Props = $props();

  // 結果資料不完整（舊紀錄無 details）→ 不給上傳
  const canUpload = $derived(Array.isArray(triageResult.details) && triageResult.details.length > 0);

  type Selection = null | { kind: 'gcm'; id: string } | { kind: 'hospital' };
  let selection = $state<Selection>(null);
  let nickname = $state('');
  let email = $state('');
  let phone = $state('');
  let busy = $state(false);
  let error = $state<string | null>(null);
  let hospitalDone = $state(false);

  async function submitHospital() {
    busy = true; error = null;
    try {
      const r = await submitAssessmentToFhir(assessment, child.id, triageResult);
      if (r.success) hospitalDone = true;
      else error = r.error ?? '傳送失敗';
    } catch {
      error = '傳送失敗，請稍後重試';
    } finally {
      busy = false;
    }
  }

  async function submitGcm() {
    if (!nickname.trim()) { error = '請輸入暱稱'; return; }
    busy = true; error = null;
    try {
      await startGcmUpload(window.location.origin + '/launch/', {
        assessmentId: assessment.id,
        nickname: nickname.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
      });
      // 正常情況此處不會 return（已 redirect）
    } catch {
      error = '無法開始上傳，請確認網路連線後重試';
      busy = false;
    }
  }
</script>

<section class="intake" aria-label="上傳評估結果">
  <h3>上傳評估結果至收案機構</h3>

  {#if !canUpload}
    <p class="note">此筆結果資料不完整，無法上傳。</p>
  {:else}
    <ul class="institutions">
      {#if authStore.isAuthenticated}
        <li>
          <button class="inst" onclick={() => { selection = { kind: 'hospital' }; }}>
            {getTenantDisplayName(authStore.fhirBaseUrl)}（已連線醫院）
          </button>
        </li>
      {/if}
      {#each REDIRECT_INSTITUTIONS as inst (inst.id)}
        <li>
          <button class="inst" onclick={() => { selection = { kind: 'gcm', id: inst.id }; }}>
            {inst.name}
          </button>
        </li>
      {/each}
    </ul>

    {#if selection?.kind === 'hospital'}
      {#if hospitalDone}
        <p class="success">已傳送至醫院 FHIR Server</p>
      {:else}
        <button class="primary" onclick={submitHospital} disabled={busy}>
          {busy ? '傳送中…' : '確認傳送至醫院'}
        </button>
      {/if}
    {:else if selection?.kind === 'gcm'}
      <form class="gcm-form" onsubmit={(e) => { e.preventDefault(); submitGcm(); }}>
        <label>暱稱（必填）
          <input type="text" bind:value={nickname} required />
        </label>
        <label>Email（選填）
          <input type="email" bind:value={email} />
        </label>
        <label>電話（選填）
          <input type="tel" bind:value={phone} />
        </label>
        <button class="primary" type="submit" disabled={busy}>
          {busy ? '前往授權…' : '上傳並建立收案'}
        </button>
      </form>
    {/if}

    {#if error}<p class="error" role="alert">{error}</p>{/if}
  {/if}
</section>

<style>
  .intake { display: flex; flex-direction: column; gap: var(--space-4); }
  .intake h3 { font-size: var(--text-lg); }
  .institutions { list-style: none; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); }
  .inst {
    width: 100%; text-align: left; padding: var(--space-3) var(--space-4);
    background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius-md);
    font-size: var(--text-base); min-height: 44px; cursor: pointer;
  }
  .inst:hover { background: color-mix(in srgb, var(--bg), var(--text) 5%); }
  .gcm-form { display: flex; flex-direction: column; gap: var(--space-3); }
  .gcm-form label { display: flex; flex-direction: column; gap: var(--space-2); font-size: var(--text-sm); }
  .gcm-form input {
    padding: var(--space-3); font-size: var(--text-base); min-height: 44px;
    border: 1px solid var(--line); border-radius: var(--radius-md); background: var(--bg); color: var(--text);
  }
  .primary {
    padding: var(--space-3) var(--space-6); background: var(--accent); color: white; border: none;
    border-radius: var(--radius-md); font-size: var(--text-base); min-height: 44px; cursor: pointer;
  }
  .primary:disabled { opacity: 0.6; cursor: default; }
  .success { color: var(--accent); font-weight: var(--font-medium); }
  .error { color: var(--danger); }
  .note { color: color-mix(in srgb, var(--text), var(--bg) 30%); font-size: var(--text-sm); }
</style>
```

- [ ] **Step 2: Wire into ResultView**

在 `src/components/assess/ResultView.svelte` 頂部 import 區（第 14 行 `TriggerVideoList` import 之後）加入：

```ts
  import IntakeSubmit from './IntakeSubmit.svelte';
```

然後把 `src/components/assess/ResultView.svelte:184-195`（`.result-actions` 內、`{#if authStore.isAuthenticated && !fhirSubmitted}` … `{/if}` 與 `{#if fhirError}…{/if}` 兩段）替換為：

```svelte
    {#if assessmentStore.assessment && assessmentStore.child && triageResult}
      <IntakeSubmit
        assessment={assessmentStore.assessment}
        child={assessmentStore.child}
        {triageResult}
      />
    {/if}
```

（移除舊的 `submitToFhir`/`fhirSubmitting`/`fhirSubmitted`/`fhirError` 狀態與 `btn-fhir`/`fhir-success`/`fhir-error` 區塊；`submitAssessmentToFhir` 改由 `IntakeSubmit` 引用。一併刪除 ResultView script 中不再使用的 `submitToFhir` 函式、相關 `$state` 與 `import { submitAssessmentToFhir }`。）

- [ ] **Step 3: Type + lint check**

Run: `pnpm check && pnpm lint`
Expected: 通過；ResultView 無未使用變數殘留。

- [ ] **Step 4: Full test run**

Run: `pnpm test`
Expected: 全綠（既有 + 新增測試）。

- [ ] **Step 5: Commit**

```bash
git add src/components/assess/IntakeSubmit.svelte src/components/assess/ResultView.svelte
git commit -m "feat(assess): unified intake-institution submit on result page"
```

---

## Task 7: 建置 + 完整驗證

**Files:** 無（驗證關卡）

- [ ] **Step 1: Full build**

Run: `pnpm build`
Expected: 成功；`dist/launch/index.html` 產生（確認 `/launch/` 進入路由表）。

- [ ] **Step 2: Drift check**

Run: `git status --porcelain`
Expected: 無未提交的產生檔（內容/量表未改，應無 drift）。

- [ ] **Step 3: 全套測試 + 型別 + lint**

Run: `pnpm test && pnpm check && pnpm lint`
Expected: 全綠。

- [ ] **Step 4: Commit any build artifacts (若有)**

```bash
git add -A && git commit -m "chore: build artifacts for GCM intake" || echo "nothing to commit"
```

---

## Task 8: 部署 + 截圖 + 線上 FHIR 上傳驗證

**Files:** 無（操作關卡，於本 session 由主導者執行）

- [ ] **Step 1: 線上 server 健康檢查（指引 §6 curl）**

```bash
curl -s -XPOST https://gcm.fhir.yao.care/register -H 'content-type: application/json' \
  -d '{"redirect_uris":["https://smart-geri-cds.yao.care/launch/"],"token_endpoint_auth_method":"none"}'
curl -s 'https://gcm.fhir.yao.care/Questionnaire?url=https://gcm.org.tw/fhir/Questionnaire/gcm-intake'
```
Expected: `/register` 回含 `client_id` 的 JSON；`Questionnaire` 回 SDC 表單 Bundle。

- [ ] **Step 2: 推送部署**

```bash
git push origin main
```
Expected: 觸發 `.github/workflows/deploy.yml`，部署到 GitHub Pages（`smart-geri-cds.yao.care`）。

- [ ] **Step 3: 等待部署完成**

```bash
gh run watch "$(gh run list --workflow=deploy.yml -L1 --json databaseId -q '.[0].databaseId')" --exit-status
```
Expected: 部署成功。

- [ ] **Step 4: 端到端 + 截圖（Playwright MCP，對線上站）**

於線上站 `https://smart-geri-cds.yao.care/` 走專業評估流程到 `/result/`，於「上傳評估結果至收案機構」選 GCM、填暱稱+email/電話、送出 → 完成授權 → 回 `/launch/` 顯示收案編號。沿途截圖：
- 結果頁的 IntakeSubmit 選擇器
- GCM 表單
- `/launch/` 收案編號頁

Expected: 取得收案編號 `GCM-XXXX`；截圖存檔。

- [ ] **Step 5: 驗證資料已進 FHIR server**

以 Step 4 取得的 access flow（或 conformance 腳本）確認 `Observation`/`DiagnosticReport`/`Patient.telecom` 已在 `https://gcm.fhir.yao.care` 建立。
Expected: server 端查得該 case 的資源。

---

## Self-Review

**Spec coverage：**
- 統一收案模型（醫院動態項 / GCM 靜態項）→ Task 2 + Task 6 ✅
- 共用 `/launch/` 雙路分流 → Task 4 ✅
- flow 只存 assessmentId、回呼重建 → Task 3c/3d ✅
- 三處指引修正（不重複 CFS / flow 只存 id / `/launch/` 新建）→ Task 3d 測試斷言 cfsCount===1、Task 3c flow.payload、Task 4 ✅
- 5 點務必確認：removeItem(gcm.flow) → 3d；redirect_uri 三處一致 → 3b/3c/3d 用同一 REDIRECT；linkId 對齊 → 3d intakeResponse + 測試；client_id 自癒 → 3d exchangeToken + 測試；fhir+json transaction-response 測試 → 3d ✅
- 錯誤處理（無 details 擋下 / state CSRF / PII 不進 console / 離線）→ 3d 測試 + IntakeSubmit canUpload；程式碼無 console PII ✅
- 測試策略 → Task 1/2/3a/3b/3c/3d；conformance 不進 CI（Task 8 手動）✅

**Placeholder scan：** 無 TBD/TODO；每個 code step 皆含完整程式碼。Task 4 的 `getServerUrl` 暫接已在 Step 3 明確要求替換為解構 `serverUrl`。

**Type consistency：** `PendingUpload`（3c 定義，3d/6 使用一致）；`IntakeInstitution`（Task 2 定義，3a/6 使用）；`GcmFlow`（3c 定義含 `challenge`，3d 使用）；`markGcmSubmitted`（Task 1 定義，3d 使用）；`completeGcmUpload`/`startGcmUpload` 簽名跨 Task 4/6 一致。
