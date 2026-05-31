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
