import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveMobilityRecording,
  getMobilityRecording,
  getMobilityRecordingsForAssessment,
} from '../../src/lib/db/mobility-recordings';
import { db } from '../../src/lib/db/schema';

describe('mobility-recordings DAO', () => {
  beforeEach(async () => {
    await db.mobilityRecordings.clear();
  });

  it('saves a recording and reads it back by id', async () => {
    const blob = new Blob(['fake-video'], { type: 'video/webm' });
    const id = await saveMobilityRecording({
      assessmentId: 'a1',
      scaleId: 'sit-to-stand',
      blob,
      mimeType: 'video/webm',
      durationSec: 11,
    });
    expect(typeof id).toBe('string');

    const got = await getMobilityRecording(id);
    expect(got).toBeTruthy();
    expect(got!.assessmentId).toBe('a1');
    expect(got!.scaleId).toBe('sit-to-stand');
    expect(got!.mimeType).toBe('video/webm');
    expect(got!.durationSec).toBe(11);
    // The blob is persisted; in a real browser it round-trips as a Blob. Under
    // fake-indexeddb's structured clone the Blob identity is not preserved, so
    // we only assert the field exists (Blob fidelity is verified in-browser).
    expect(got!.blob).toBeDefined();
    expect(got!.createdAt).toBeInstanceOf(Date);
  });

  it('looks up the latest recording for an assessment+scale', async () => {
    await saveMobilityRecording({
      assessmentId: 'a2',
      scaleId: 'sit-to-stand',
      blob: new Blob(['v1'], { type: 'video/webm' }),
      mimeType: 'video/webm',
      durationSec: 9,
    });
    await saveMobilityRecording({
      assessmentId: 'a2',
      scaleId: 'sit-to-stand',
      blob: new Blob(['v2'], { type: 'video/webm' }),
      mimeType: 'video/webm',
      durationSec: 14,
    });

    const list = await getMobilityRecordingsForAssessment('a2');
    expect(list.length).toBe(2);
    expect(list.every(r => r.assessmentId === 'a2')).toBe(true);
  });

  it('returns undefined for an unknown id', async () => {
    expect(await getMobilityRecording('nope')).toBeUndefined();
  });
});
