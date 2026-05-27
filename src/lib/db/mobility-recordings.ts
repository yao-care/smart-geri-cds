import { db, type MobilityRecording } from './schema';

/**
 * DAO for locally-stored mobility-task recordings (e.g. FTSTS).
 *
 * Privacy: the Blob is persisted ONLY in this browser's IndexedDB for clinician
 * review on the same device. It is never uploaded, never added to the PDF, and
 * never logged. No PII is stored here — only assessmentId / scaleId / timing.
 */
export async function saveMobilityRecording(
  rec: Omit<MobilityRecording, 'id' | 'createdAt'>,
): Promise<string> {
  const id = crypto.randomUUID();
  await db.mobilityRecordings.put({ ...rec, id, createdAt: new Date() });
  return id;
}

export async function getMobilityRecording(id: string): Promise<MobilityRecording | undefined> {
  return db.mobilityRecordings.get(id);
}

/** All recordings for an assessment, oldest first. */
export async function getMobilityRecordingsForAssessment(
  assessmentId: string,
): Promise<MobilityRecording[]> {
  return db.mobilityRecordings.where('assessmentId').equals(assessmentId).sortBy('createdAt');
}

/** Latest recording for an assessment+scale, or undefined if none. */
export async function getLatestMobilityRecording(
  assessmentId: string,
  scaleId: string,
): Promise<MobilityRecording | undefined> {
  const rows = await db.mobilityRecordings
    .where('[assessmentId+scaleId]')
    .equals([assessmentId, scaleId])
    .sortBy('createdAt');
  return rows.at(-1);
}
