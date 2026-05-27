import { db, type Assessment, type AssessmentStatus, type Child, type PartialAnalysis } from './schema';
import type { CfsLevel } from '../utils/cfs-levels';

// ---- Child DAO ----
export async function createChild(child: Child): Promise<string> {
  await db.children.put(child);
  return child.id;
}

export async function getChild(id: string): Promise<Child | undefined> {
  return db.children.get(id);
}

export async function getAllChildren(): Promise<Child[]> {
  return db.children.orderBy('createdAt').reverse().toArray();
}

// ---- Assessment DAO ----
export async function createAssessment(
  childId: string,
  cfsLevel: CfsLevel,
  availability: { informantAvailable: boolean; patientAble: boolean },
  language = 'zh-TW',
): Promise<Assessment> {
  const now = new Date();
  const assessment: Assessment = {
    id: crypto.randomUUID(),
    childId,
    cfsLevel,
    informantAvailable: availability.informantAvailable,
    patientAble: availability.patientAble,
    status: 'started',
    language,
    // 評估在「基本資料填妥、進入問卷」時才建立（startNew），故起始步驟＝問卷(1)。
    // 若留 0，resume 會回到基本資料、使用者被迫重填並開新評估、進度全失。
    currentStep: 1,
    startedAt: now,
    fhirSubmitted: false,
    createdAt: now,
    updatedAt: now,
  };
  await db.assessments.put(assessment);
  return assessment;
}

export async function getAssessment(id: string): Promise<Assessment | undefined> {
  return db.assessments.get(id);
}

export async function getAssessmentsForChild(childId: string): Promise<Assessment[]> {
  return db.assessments.where('childId').equals(childId).reverse().sortBy('createdAt');
}

export async function updateAssessmentStatus(id: string, status: AssessmentStatus): Promise<void> {
  const update: Partial<Assessment> = { status, updatedAt: new Date() };
  if (status === 'completed') update.completedAt = new Date();
  if (status === 'paused') update.pausedAt = new Date();
  await db.assessments.update(id, update);
}

export async function updateAssessmentStep(id: string, step: number): Promise<void> {
  await db.assessments.update(id, { currentStep: step, updatedAt: new Date() });
}

/** 持久化問卷作答進度快照，供 resume 還原（避免重答）。 */
export async function updateAssessmentPartialAnalysis(
  id: string,
  partialAnalysis: PartialAnalysis,
): Promise<void> {
  await db.assessments.update(id, { partialAnalysis, updatedAt: new Date() });
}

export async function setTriageResult(id: string, result: Assessment['triageResult']): Promise<void> {
  await db.assessments.update(id, { triageResult: result, updatedAt: new Date() });
}

export async function markFhirSubmitted(id: string, fhirDiagnosticReportId: string): Promise<void> {
  await db.assessments.update(id, {
    fhirSubmitted: true,
    fhirDiagnosticReportId,
    updatedAt: new Date(),
  });
}

export async function getIncompleteAssessments(): Promise<Assessment[]> {
  return db.assessments.where('status').anyOf(['started', 'paused', 'resumed']).reverse().sortBy('createdAt');
}
