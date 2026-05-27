import type { Assessment, AssessmentStatus } from '../db/schema';
import type { CfsLevel } from '../utils/cfs-levels';
import { cfsFromScore } from '../utils/cfs-levels';
import { CODE_SYSTEM, ID_SYSTEM, CFS_CODE } from './cga-resources';

export interface AssessmentSummary {
  id: string;
  fhirReportId: string;
  /** FHIR Patient reference (e.g. "Patient/abc123"). Useful for the
   *  cross-patient workspace list to show which subject each row is for. */
  patientRef: string;
  date: Date;
  category: 'normal' | 'monitor' | 'refer';
  summary: string;
}

interface FhirClient {
  request(query: string): Promise<unknown>;
}

/** Minimal FHIR shapes — only the fields this parser reads. */
interface FhirCoding {
  system?: string;
  code?: string;
}

interface FhirCodeableConcept {
  coding?: FhirCoding[];
}

interface FhirIdentifier {
  system?: string;
  value?: string;
}

interface FhirPeriod {
  start?: string;
  end?: string;
}

interface FhirReference {
  reference?: string;
}

/** Observation resource — we only read its CFS code + value. */
interface FhirObservation {
  resourceType?: string;
  code?: FhirCodeableConcept;
  valueQuantity?: { value?: number };
}

/** DiagnosticReport resource — the CGA assessment carrier. */
interface FhirDiagnosticReport {
  resourceType?: string;
  id?: string;
  status?: string;
  identifier?: FhirIdentifier[];
  conclusion?: string;
  conclusionCode?: FhirCodeableConcept[];
  subject?: FhirReference;
  effectivePeriod?: FhirPeriod;
  effectiveDateTime?: string;
}

/** Any resource we may encounter in a bundle entry. */
type FhirResource = (FhirObservation | FhirDiagnosticReport) & { resourceType?: string };

/** Lightweight Bundle entry shape we rely on. */
interface BundleEntry {
  resource: FhirResource;
}

interface Bundle {
  entry?: BundleEntry[];
}

/**
 * Map SNOMED conclusionCode → triage category. Falls back to 'monitor'
 * when the code is unrecognised so reverse-mapped reports stay usable.
 */
function snomedToCategory(code: string | undefined): 'normal' | 'monitor' | 'refer' {
  switch (code) {
    case '17621005': return 'normal';
    case '394848005': return 'monitor';
    case '3457005': return 'refer';
    default: return 'monitor';
  }
}

/** Strip backward-compat conclusion prefix「<分類>（信心度 X%）。 」if present. */
function stripLegacyConclusionPrefix(conclusion: string): string {
  return conclusion.replace(/^.+?（信心度\s*\d+%）。\s*/, '');
}

/**
 * Read the CFS level from a CFS Observation (local code system) in the bundle.
 * Falls back to cfs1 when no CFS Observation is present (legacy / partial data).
 */
function readCfsLevel(observations: FhirObservation[]): CfsLevel {
  for (const obs of observations) {
    const coding = obs.code?.coding;
    const isCfs = coding?.some(c => c.system === CODE_SYSTEM && c.code === CFS_CODE);
    if (isCfs) {
      const value = obs.valueQuantity?.value;
      if (typeof value === 'number') return cfsFromScore(value);
    }
  }
  return 'cfs1';
}

/**
 * Reconstruct a local-shape Assessment from a FHIR DiagnosticReport plus
 * its Observation resources. Used by the physician detail view when the
 * record is not in IndexedDB.
 */
export function bundleToAssessment(
  report: FhirDiagnosticReport,
  observations: FhirObservation[],
): Assessment {
  const identifiers = report.identifier ?? [];
  const idVal = identifiers.find((i) => i.system === ID_SYSTEM)?.value ?? report.id;

  const conclusionCode = report.conclusionCode?.[0]?.coding?.[0]?.code;
  const category = snomedToCategory(conclusionCode);

  const period = report.effectivePeriod;
  const startedAtStr = period?.start ?? report.effectiveDateTime;
  const startedAt = startedAtStr ? new Date(startedAtStr) : new Date(0);
  const completedAt = period?.end ? new Date(period.end) : undefined;

  const conclusion = report.conclusion ?? '';
  const summary = stripLegacyConclusionPrefix(conclusion);

  const subjectRef = report.subject?.reference ?? '';
  const childId = subjectRef.replace(/^Patient\//, '');

  const cfsLevel = readCfsLevel(observations);

  // FHIR DiagnosticReport.status='final' → completed; otherwise treat as
  // incomplete (a reconstructed report without an end period never resumes).
  const status: AssessmentStatus = report.status === 'final' ? 'completed' : 'incomplete';

  return {
    id: idVal,
    childId,
    cfsLevel,
    status,
    language: 'zh-TW',
    currentStep: 3,
    startedAt,
    completedAt,
    triageResult: {
      category,
      summary,
    },
    fhirSubmitted: true,
    fhirDiagnosticReportId: report.id,
    createdAt: startedAt,
    updatedAt: completedAt ?? startedAt,
  } as Assessment;
}

/**
 * Look up one assessment on the FHIR server by its CDSA UUID.
 * Uses _include to fetch the referenced Observations in a single request.
 */
export async function fetchAssessmentFromFhir(
  id: string,
  client: FhirClient,
): Promise<Assessment | null> {
  const bundle = (await client.request(
    `DiagnosticReport?identifier=${ID_SYSTEM}|${id}&_include=DiagnosticReport:result`,
  )) as Bundle;
  const entries = bundle.entry ?? [];
  const reportEntry = entries.find((e) => e.resource.resourceType === 'DiagnosticReport');
  if (!reportEntry) return null;
  const observations = entries
    .filter((e) => e.resource.resourceType === 'Observation')
    .map((e) => e.resource as FhirObservation);
  return bundleToAssessment(reportEntry.resource as FhirDiagnosticReport, observations);
}

/**
 * List CDSA assessments on the FHIR server.
 * - With `patientId`: scoped to that patient (per-patient history view).
 * - Without `patientId`: every CDSA report the user can read (workspace
 *   roster view, grouped by triage category).
 * Returns a summary row per DiagnosticReport — full metric values are
 * not loaded here; the detail page calls resolveAssessment(id) on click.
 */
export async function listAssessmentsFromFhir(
  patientId: string | undefined,
  client: FhirClient,
): Promise<AssessmentSummary[]> {
  const subjectClause = patientId ? `subject=Patient/${patientId}&` : '';
  const bundle = (await client.request(
    `DiagnosticReport?${subjectClause}` +
      `code=${CODE_SYSTEM}|cga-assessment` +
      `&_sort=-date`,
  )) as Bundle;
  return (bundle.entry ?? []).map((e) => {
    const r = e.resource as FhirDiagnosticReport;
    const identifiers = r.identifier ?? [];
    const idVal = identifiers.find((i) => i.system === ID_SYSTEM)?.value ?? r.id ?? '';
    const period = r.effectivePeriod;
    const dateStr = period?.start ?? r.effectiveDateTime;
    const conclusionCode = r.conclusionCode?.[0]?.coding?.[0]?.code;
    const patientRef = r.subject?.reference ?? '';
    return {
      id: idVal,
      fhirReportId: r.id ?? '',
      patientRef,
      date: new Date(dateStr ?? 0),
      category: snomedToCategory(conclusionCode),
      summary: stripLegacyConclusionPrefix(r.conclusion ?? ''),
    };
  });
}
