import { db, type Assessment, type AssessmentStatus, type Child } from './schema';
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
  language = 'zh-TW',
): Promise<Assessment> {
  const now = new Date();
  const assessment: Assessment = {
    id: crypto.randomUUID(),
    childId,
    cfsLevel,
    status: 'started',
    language,
    currentStep: 0,
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
