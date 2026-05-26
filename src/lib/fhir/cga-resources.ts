import type { TriageResult } from '../../engine/cdsa/triage';
import type { Assessment, Child } from '../db/schema';
import type { CfsLevel } from '../utils/cfs-levels';
import { CFS_LABELS } from '../utils/cfs-levels';
import { domainLabel } from '../domain/domain-tree';

/** Project-owned coding/identifier systems.
 *  Avoids the prior LOINC mapping which used codes that don't actually
 *  exist in the LOINC code system. CGA is an in-house instrument; codes
 *  are namespaced under the project domain. */
export const CODE_SYSTEM = 'https://smart-geri-cds.yao.care/code';
export const ID_SYSTEM = 'https://smart-geri-cds.yao.care/assessment';
export const CONFIDENCE_EXT_URL = 'https://smart-geri-cds.yao.care/extension/triage-confidence';

/** Local code for the Clinical Frailty Scale level Observation.
 *  No single official LOINC/SNOMED concept for CFS exists; a project-owned
 *  code is used and standard-terminology mapping is a follow-up item. */
export const CFS_CODE = 'clinical-frailty-scale';

const REPORT_CODE = {
  system: CODE_SYSTEM,
  code: 'cga-assessment',
  display: '高齡周全性評估',
};

/**
 * Build a FHIR Patient resource from subject (Child) data.
 * Note: minimal — only what's needed for the assessment context.
 * birthDate is optional (DOB is record-only for CGA); omit when absent.
 */
export function buildSubjectPatient(child: Child): object {
  const patient: Record<string, unknown> = {
    resourceType: 'Patient',
    id: child.id,
    gender: child.gender === 'other' ? 'unknown' : child.gender,
  };
  if (child.birthDate) patient.birthDate = child.birthDate;
  return patient;
}

function observationCode(top: string, sub: string, scaleId: string) {
  return {
    system: CODE_SYSTEM,
    code: `cga-${top}-${sub}-${scaleId}`,
    display: `${domainLabel(top, sub)}（${scaleId}）`,
  };
}

/**
 * Build FHIR Observation resources for the assessment.
 * One Observation per ScaleResult, identified by
 * `${assessmentId}::${top}.${sub}::${scaleId}` under the project ID system so
 * the resolver can reverse-map a Bundle back to an Assessment. value=rawScore.
 * interpretation: normal=N, monitor|refer=A. An incomplete scale carries NO
 * interpretation — instead status='preliminary' + dataAbsentReason (never IE,
 * which is a HL7 antimicrobial-specific code with the wrong semantics).
 * A CFS-level Observation (local code system) is appended.
 */
export function buildAssessmentObservations(
  assessment: Assessment,
  childId: string,
  triageResult: TriageResult,
): object[] {
  const observations: object[] = [];

  for (const detail of triageResult.details) {
    const { top, sub } = detail.domain;
    const isIncomplete = detail.severity === 'incomplete';
    const isAbnormal = detail.severity === 'monitor' || detail.severity === 'refer';

    const obs: Record<string, unknown> = {
      resourceType: 'Observation',
      identifier: [
        {
          system: ID_SYSTEM,
          value: `${assessment.id}::${top}.${sub}::${detail.scaleId}`,
        },
      ],
      status: isIncomplete ? 'preliminary' : 'final',
      category: [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/observation-category',
              code: 'survey',
              display: 'Survey',
            },
          ],
        },
      ],
      code: {
        coding: [observationCode(top, sub, detail.scaleId)],
        text: `${domainLabel(top, sub)}（${detail.scaleId}）`,
      },
      subject: { reference: `Patient/${childId}` },
      effectiveDateTime: new Date().toISOString(),
    };

    if (isIncomplete) {
      // No score, no interpretation — flag the absence explicitly.
      obs.dataAbsentReason = {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/data-absent-reason',
            code: 'asked-unknown',
            display: 'Asked But Unknown',
          },
        ],
      };
    } else {
      obs.valueQuantity = { value: detail.rawScore, unit: 'score' };
      obs.interpretation = [
        {
          coding: [
            {
              system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation',
              code: isAbnormal ? 'A' : 'N',
              display: isAbnormal ? 'Abnormal' : 'Normal',
            },
          ],
        },
      ];
      obs.note = [{ text: `${detail.bandLabel}（${detail.rawScore}/${detail.maxScore}）` }];
    }

    observations.push(obs);
  }

  // CFS level Observation (clinical stratification axis).
  observations.push(buildCfsObservation(assessment, childId));

  return observations;
}

/** Build the Clinical Frailty Scale level Observation. */
export function buildCfsObservation(assessment: Assessment, childId: string): object {
  const cfs: CfsLevel = assessment.cfsLevel;
  const numeric = Number(cfs.replace('cfs', ''));
  return {
    resourceType: 'Observation',
    identifier: [
      { system: ID_SYSTEM, value: `${assessment.id}::cfs` },
    ],
    status: 'final',
    category: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/observation-category',
            code: 'survey',
            display: 'Survey',
          },
        ],
      },
    ],
    code: {
      coding: [
        { system: CODE_SYSTEM, code: CFS_CODE, display: '臨床衰弱量表 (Clinical Frailty Scale)' },
      ],
      text: '臨床衰弱量表 (Clinical Frailty Scale)',
    },
    subject: { reference: `Patient/${childId}` },
    effectiveDateTime: new Date().toISOString(),
    valueQuantity: { value: numeric, unit: 'level' },
    note: [{ text: `${cfs}：${CFS_LABELS[cfs]}` }],
  };
}

/**
 * Build a FHIR DiagnosticReport for the overall triage result.
 * Carries identifier (so resolver can find it) and effective period (so we
 * can reconstruct startedAt / completedAt). conclusion = overall category +
 * per-domain severities.
 */
export function buildTriageDiagnosticReport(
  assessment: Assessment,
  childId: string,
  triageResult: TriageResult,
  observationIds: string[],
): object {
  const startedAt = assessment.startedAt instanceof Date
    ? assessment.startedAt
    : new Date(assessment.startedAt);
  const completedAt = assessment.completedAt
    ? (assessment.completedAt instanceof Date
        ? assessment.completedAt
        : new Date(assessment.completedAt))
    : null;

  // FHIR requires effectivePeriod.end if present — degrade to effectiveDateTime
  // when the assessment hasn't completed.
  const effective = completedAt
    ? {
        effectivePeriod: {
          start: startedAt.toISOString(),
          end: completedAt.toISOString(),
        },
      }
    : { effectiveDateTime: startedAt.toISOString() };

  const category = triageResult.category;
  const conclusion = buildConclusion(triageResult);

  return {
    resourceType: 'DiagnosticReport',
    identifier: [
      { system: ID_SYSTEM, value: assessment.id },
    ],
    status: 'final',
    category: [
      {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/v2-0074',
            code: 'GE',
            display: 'Genetics',
          },
        ],
      },
    ],
    code: { coding: [REPORT_CODE] },
    subject: { reference: `Patient/${childId}` },
    ...effective,
    issued: new Date().toISOString(),
    result: observationIds.map(id => ({ reference: `Observation/${id}` })),
    conclusion,
    conclusionCode: [
      {
        coding: [
          {
            system: 'http://snomed.info/sct',
            code: category === 'normal' ? '17621005'
              : category === 'monitor' ? '394848005'
              : '3457005',
            display: category === 'normal' ? 'Normal'
              : category === 'monitor' ? 'Follow-up'
              : 'Referral',
          },
        ],
      },
    ],
  };
}

/** conclusion = overall summary + per-domain severity breakdown. */
function buildConclusion(triageResult: TriageResult): string {
  const SEV_CN: Record<string, string> = {
    normal: '正常', monitor: '待觀察', refer: '建議轉介', incomplete: '未完成',
  };
  const perDomain = triageResult.details
    .map(d => `${domainLabel(d.domain.top, d.domain.sub)}：${SEV_CN[d.severity] ?? d.severity}`)
    .join('；');
  return perDomain ? `${triageResult.summary}（${perDomain}）` : triageResult.summary;
}
