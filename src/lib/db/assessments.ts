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

/**
 * 更新既有受測者（沿用同 id）。
 * 注意：`db.children.put` 為「整筆覆寫」(full replace)——呼叫端必須帶上原 `id`
 * 與原 `createdAt`，否則會覆蓋建立時間。沿用流程（startForExisting）以
 * `{ ...selectedChild, …編輯欄位 }` 傳入，確保原值保留。
 */
export async function updateChild(child: Child): Promise<void> {
  await db.children.put(child);
}

/**
 * 把 mergedIds 的所有 assessment 轉移到 primaryId，並刪除 mergedIds 的 children。
 * 單一 transaction 確保原子性：任一步失敗則全部回滾，不留孤兒 assessment。
 */
export async function mergeChildren(primaryId: string, mergedIds: string[]): Promise<void> {
  const targets = mergedIds.filter((id) => id !== primaryId);
  if (targets.length === 0) return;
  await db.transaction('rw', db.children, db.assessments, async () => {
    const orphaned = await db.assessments.where('childId').anyOf(targets).toArray();
    await Promise.all(
      orphaned.map((a) => db.assessments.update(a.id, { childId: primaryId, updatedAt: new Date() })),
    );
    await db.children.bulkDelete(targets);
  });
}

export interface SubjectWithStats {
  child: Child;
  assessmentCount: number;
  lastAssessedAt: Date | null;
}

/** 受測者清單 + 統計，依 lastAssessedAt 倒序（無評估者殿後）。供選取清單與歷史頁共用。 */
export async function loadSubjectsWithStats(): Promise<SubjectWithStats[]> {
  const children = await getAllChildren();
  const rows = await Promise.all(
    children.map(async (child) => {
      const assessments = await getAssessmentsForChild(child.id);
      let lastAssessedAt: Date | null = null;
      for (const a of assessments) {
        const t = new Date(a.completedAt ?? a.startedAt);
        if (lastAssessedAt === null || t > lastAssessedAt) lastAssessedAt = t;
      }
      return { child, assessmentCount: assessments.length, lastAssessedAt };
    }),
  );
  return rows.sort((x, y) => {
    const tx = x.lastAssessedAt ? x.lastAssessedAt.getTime() : -Infinity;
    const ty = y.lastAssessedAt ? y.lastAssessedAt.getTime() : -Infinity;
    return ty - tx;
  });
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

/** 記錄 GCM 收案編號（病例唯一碼）。 */
export async function markGcmSubmitted(id: string, caseId: string): Promise<void> {
  await db.assessments.update(id, { gcmCaseId: caseId, updatedAt: new Date() });
}

export async function getIncompleteAssessments(): Promise<Assessment[]> {
  return db.assessments.where('status').anyOf(['started', 'paused', 'resumed']).reverse().sortBy('createdAt');
}
