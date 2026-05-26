import { isAuthorized, getAccessToken } from './client';
import { buildAssessmentObservations, buildTriageDiagnosticReport } from './cga-resources';
import { markFhirSubmitted } from '../db/assessments';
import { authStore } from '../stores/auth.svelte';
import type { Assessment } from '../db/schema';
import type { TriageResult } from '../../engine/cdsa/triage';

export interface SubmitResult {
  success: boolean;
  observationIds: string[];
  diagnosticReportId: string | null;
  error?: string;
}

/** POST a FHIR resource using fetch (avoids fhirclient type issues). */
async function postFhirResource(
  baseUrl: string,
  resourceType: string,
  resource: object,
  accessToken: string,
): Promise<{ id: string } | null> {
  const url = `${baseUrl.replace(/\/$/, '')}/${resourceType}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/fhir+json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify(resource),
  });
  if (!resp.ok) throw new Error(`FHIR POST ${resourceType} failed: ${resp.status}`);
  return resp.json();
}

/**
 * Submit CDSA assessment results to the FHIR server.
 * Creates Observation resources for each metric + a DiagnosticReport.
 */
export async function submitAssessmentToFhir(
  assessment: Assessment,
  childId: string,
  triageResult: TriageResult,
): Promise<SubmitResult> {
  if (!isAuthorized() || !authStore.fhirBaseUrl) {
    return { success: false, observationIds: [], diagnosticReportId: null, error: '未連線 FHIR Server' };
  }

  const baseUrl = authStore.fhirBaseUrl;
  const token = getAccessToken();
  const observationIds: string[] = [];

  try {
    // 1. Create Observations for each metric
    const observations = buildAssessmentObservations(assessment, childId, triageResult);

    for (const obs of observations) {
      const result = await postFhirResource(baseUrl, 'Observation', obs, token);
      if (result?.id) {
        observationIds.push(result.id);
      }
    }

    // 2. Create DiagnosticReport referencing the Observations
    const report = buildTriageDiagnosticReport(assessment, childId, triageResult, observationIds);
    const reportResult = await postFhirResource(baseUrl, 'DiagnosticReport', report, token);
    const diagnosticReportId = reportResult?.id ?? null;

    // 3. Mark assessment as submitted (records the FHIR report id for later resolution)
    if (diagnosticReportId) {
      await markFhirSubmitted(assessment.id, diagnosticReportId);
    }

    return { success: true, observationIds, diagnosticReportId };
  } catch (err) {
    return {
      success: false,
      observationIds,
      diagnosticReportId: null,
      error: err instanceof Error ? err.message : '傳送失敗，請稍後重試',
    };
  }
}
