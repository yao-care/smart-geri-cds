import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/svelte';
import QuestionnaireModule from '../../src/components/assess/QuestionnaireModule.svelte';
import { assessmentStore } from '../../src/lib/stores/assessment.svelte';
import { db } from '../../src/lib/db/schema';
import type { Child, Assessment } from '../../src/lib/db/schema';
import type { ScaleDef } from '../../src/lib/scales/scale';

function makeChild(): Child {
  return { id: 'q-test-child', birthDate: '', gender: 'male', createdAt: new Date() };
}

function makeAssessment(
  availability: { informantAvailable: boolean; patientAble: boolean } = { informantAvailable: true, patientAble: true },
): Assessment {
  return {
    id: 'q-test-assess',
    childId: 'q-test-child',
    cfsLevel: 'cfs5',
    informantAvailable: availability.informantAvailable,
    patientAble: availability.patientAble,
    status: 'started',
    language: 'zh-TW',
    currentStep: 1,
    startedAt: new Date(),
    fhirSubmitted: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// ---- Triage-tier fixtures (Task 4 三階段展開) ----
const fallsTriage: ScaleDef = {
  id: 'falls-triage', domain: { top: 'functional', sub: 'falls' }, tier: 'triage',
  expandsTo: 'falls-screen', applicableCfs: ['cfs5'], scoring: 'sum', inputType: 'option', maxScore: 1,
  items: [{ id: 'ft', mode: 'ask-either', prompt: 'FALLS_TRIAGE_Q', text: 'FALLS_TRIAGE_Q',
    options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] }],
  bands: [{ min: 0, max: 0, severity: 'normal', label: 'ok' }, { min: 1, max: 1, severity: 'monitor', label: 'concern' }],
  clinicallyReviewed: false,
};
const fallsScreen: ScaleDef = {
  id: 'falls-screen', domain: { top: 'functional', sub: 'falls' }, tier: 'screen', expandsTo: 'falls-full',
  applicableCfs: ['cfs5'], scoring: 'sum', inputType: 'option', maxScore: 1,
  items: [{ id: 'fs', mode: 'ask-either', prompt: 'FALLS_SCREEN_Q', text: 'FALLS_SCREEN_Q',
    options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] }],
  bands: [{ min: 0, max: 0, severity: 'normal', label: 'ok' }, { min: 1, max: 1, severity: 'monitor', label: 'flag' }],
  clinicallyReviewed: false,
};
const fallsFull: ScaleDef = {
  id: 'falls-full', domain: { top: 'functional', sub: 'falls' }, tier: 'full',
  applicableCfs: ['cfs5'], scoring: 'sum', inputType: 'option', maxScore: 1,
  items: [{ id: 'ff', mode: 'ask-either', prompt: 'FALLS_FULL_Q', text: 'FALLS_FULL_Q',
    options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] }],
  bands: [{ min: 0, max: 0, severity: 'normal', label: 'ok' }, { min: 1, max: 1, severity: 'monitor', label: 'x' }],
  clinicallyReviewed: false,
};
const alwaysRunScreen: ScaleDef = {
  id: 'delirium-always', domain: { top: 'psychological', sub: 'delirium' }, tier: 'screen', alwaysRun: true,
  applicableCfs: ['cfs5'], scoring: 'sum', inputType: 'option', maxScore: 1,
  items: [{ id: 'ar', mode: 'observe', prompt: 'ALWAYS_RUN_Q', text: 'ALWAYS_RUN_Q',
    options: [{ label: '正常', score: 0 }, { label: '異常', score: 1 }] }],
  bands: [{ min: 0, max: 0, severity: 'normal', label: 'ok' }, { min: 1, max: 1, severity: 'monitor', label: 'x' }],
  clinicallyReviewed: false,
};

/** Minimal triage scale pointing to mood-screen (used by tests that need to reach moodScreen). */
const moodTriage: ScaleDef = {
  id: 'mood-triage', domain: { top: 'psychological', sub: 'mood' }, tier: 'triage',
  expandsTo: 'mood-screen', applicableCfs: ['cfs5'], scoring: 'sum', inputType: 'option', maxScore: 1,
  items: [{ id: 'mt', mode: 'ask-either', prompt: 'MOOD_TRIAGE_Q', text: 'MOOD_TRIAGE_Q',
    options: [{ label: '無', score: 0 }, { label: '有', score: 1 }] }],
  bands: [{ min: 0, max: 0, severity: 'normal', label: 'ok' }, { min: 1, max: 1, severity: 'monitor', label: 'concern' }],
  clinicallyReviewed: false,
};

/** Mood screen (tier:screen) → expands to the GDS-15-like full scale.
 *  Item 2 carries the self-harm red flag. requiresPatient (情緒測驗). */
const moodScreen: ScaleDef = {
  id: 'mood-screen',
  domain: { top: 'psychological', sub: 'mood' },
  tier: 'screen',
  expandsTo: 'mood-full',
  applicableCfs: ['cfs5'],
  scoring: 'sum',
  inputType: 'option',
  requiresPatient: true,
  maxScore: 6,
  items: [
    {
      id: 'phq2_anhedonia', mode: 'patient',
      prompt: '請唸給受測者：做事提不起勁的頻率？', text: '提不起勁',
      options: [{ label: '完全沒有', score: 0 }, { label: '幾乎每天', score: 3 }],
    },
    {
      id: 'phq2_depressed', mode: 'patient',
      prompt: '請唸給受測者：心情低落或絕望的頻率？', text: '心情低落',
      redFlag: 'self-harm',
      options: [{ label: '完全沒有', score: 0 }, { label: '幾乎每天', score: 3 }],
    },
  ],
  bands: [
    { min: 0, max: 2, severity: 'normal', label: '無明顯憂鬱' },
    { min: 3, max: 6, severity: 'monitor', label: '疑似憂鬱' },
  ],
  clinicallyReviewed: false,
};

/** Mood full (tier:full) — only appears when the screen flags. */
const moodFull: ScaleDef = {
  id: 'mood-full',
  domain: { top: 'psychological', sub: 'mood' },
  tier: 'full',
  applicableCfs: ['cfs5'],
  scoring: 'sum',
  inputType: 'option',
  requiresPatient: true,
  maxScore: 2,
  items: [
    { id: 'gds_1', mode: 'patient', prompt: 'GDS 深評題一', text: 'GDS 深評題一', options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] },
    { id: 'gds_2', mode: 'patient', prompt: 'GDS 深評題二', text: 'GDS 深評題二', options: [{ label: '否', score: 0 }, { label: '是', score: 1 }] },
  ],
  bands: [
    { min: 0, max: 0, severity: 'normal', label: '正常' },
    { min: 1, max: 2, severity: 'monitor', label: '待觀察' },
  ],
  clinicallyReviewed: false,
};

/** A caregiver-burden screen with an ask-informant item (for the 無法取得 path
 *  and informant-mode framing). Not delirium/cognition → 無法取得 allowed.
 *  alwaysRun:true so it appears immediately in the triage phase without a triage gate. */
const caregiverScreen: ScaleDef = {
  id: 'caregiver-screen',
  domain: { top: 'social', sub: 'caregiver' },
  tier: 'screen',
  alwaysRun: true,
  applicableCfs: ['cfs5'],
  scoring: 'sum',
  inputType: 'option',
  requiresInformant: true,
  maxScore: 2,
  items: [
    {
      id: 'cg_burden', mode: 'ask-informant',
      prompt: '請詢問照顧者：照顧負荷是否沉重？', text: '照顧負荷',
      options: [{ label: '不會', score: 0 }, { label: '經常', score: 2 }],
    },
  ],
  bands: [
    { min: 0, max: 0, severity: 'normal', label: '無明顯負荷' },
    { min: 1, max: 2, severity: 'monitor', label: '負荷偏重' },
  ],
  clinicallyReviewed: false,
};

/** Click the option button whose label matches (waits for it to appear). */
async function clickOption(label: string): Promise<void> {
  let btn: HTMLElement | undefined;
  await waitFor(() => {
    btn = screen.queryAllByRole('button').find(b => b.textContent?.trim() === label);
    expect(btn).toBeTruthy();
  });
  await fireEvent.click(btn!);
  await new Promise(r => setTimeout(r, 600));
}

describe('QuestionnaireModule (tiered)', () => {
  beforeEach(async () => {
    assessmentStore.reset();
    await db.assessmentEvents.clear();
  });

  afterEach(() => {
    cleanup();
    assessmentStore.reset();
  });

  it('renders without crashing when no scales / cfsLevel are set', () => {
    const { container } = render(QuestionnaireModule, { scales: [] });
    expect(container).toBeDefined();
  });

  it('shows the empty state when no screen scale applies to the CFS level', async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.cfsLevel = 'cfs1'; // all fixtures apply only to cfs5
    render(QuestionnaireModule, { scales: [moodScreen, moodFull] });
    await waitFor(() => expect(screen.getByText(/沒有可施測的量表/)).toBeInTheDocument());
  });

  it('renders the patient-source mode frame for the first screen item (SOP wording)', async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.informantAvailable = true;
    assessmentStore.patientAble = true;
    assessmentStore.cfsLevel = 'cfs5';
    // moodTriage (ask-either mode) → concern → moodScreen (patient mode) appears.
    render(QuestionnaireModule, { scales: [moodTriage, moodScreen, moodFull] });
    // First the triage question appears. Answer triage with concern to expand the mood-screen.
    await waitFor(() => expect(screen.getByText('MOOD_TRIAGE_Q')).toBeInTheDocument());
    await clickOption('有');    // triage concern → expand mood-screen
    // Now the screen item appears with patient mode frame.
    await waitFor(() => expect(screen.getByText('由受測者本人作答')).toBeInTheDocument());
    expect(screen.getByText('請唸給受測者：做事提不起勁的頻率？')).toBeInTheDocument();
  });

  it('renders the ask-informant mode frame as「向熟悉受測者的家屬／照顧者詢問」(informant present)', async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment({ informantAvailable: true, patientAble: true });
    assessmentStore.informantAvailable = true;
    assessmentStore.patientAble = true;
    assessmentStore.cfsLevel = 'cfs5';
    // caregiverScreen is alwaysRun:true → appears directly in the triage phase.
    render(QuestionnaireModule, { scales: [caregiverScreen] });
    // caregiver item is ask-informant → informant-source header.
    await waitFor(() => expect(screen.getByText('向熟悉受測者的家屬／照顧者詢問')).toBeInTheDocument());
    // 無法取得 path is offered for non-delirium/cognition informant scales.
    expect(screen.getByText(/無法取得/)).toBeInTheDocument();
  });

  it('ask-either item header is patient-OR-family (NOT the operator-blind「請詢問家屬」)', async () => {
    // Regression for the original contradiction: an ask-either item must read
    // 「向受測者本人或家屬…」, not「請詢問家屬／照顧者」.
    // fallsTriage has mode:ask-either and appears directly in the triage phase.
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.informantAvailable = true;
    assessmentStore.patientAble = true;
    assessmentStore.cfsLevel = 'cfs5';
    render(QuestionnaireModule, { scales: [fallsTriage, fallsScreen, fallsFull] });
    await waitFor(() => expect(screen.getByText('向受測者本人或家屬／照顧者詢問')).toBeInTheDocument());
    expect(screen.queryByText('請詢問家屬／照顧者')).toBeNull();
  });

  it('does NOT expand the full scale when the screen result is normal', async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.cfsLevel = 'cfs5';
    render(QuestionnaireModule, { scales: [moodTriage, moodScreen, moodFull] });

    // Triage concern → expand mood-screen, then answer both screen items 「完全沒有」(0) → normal.
    await clickOption('有');            // mood-triage concern → expand mood-screen
    await waitFor(() => expect(screen.getByText('請唸給受測者：做事提不起勁的頻率？')).toBeInTheDocument());
    await clickOption('完全沒有');       // screen item 1 normal
    await clickOption('完全沒有');       // screen item 2 normal → screen normal → no full expand

    // 答完→自動 finalise 並前進結果步驟（不再停留在「問卷完成！」摘要頁）。
    await waitFor(() => expect(assessmentStore.assessment?.status).toBe('completed'), { timeout: 3000 });
    expect(screen.queryByText('問卷完成！')).toBeNull();
    // No GDS full question was ever rendered.
    expect(screen.queryByText('GDS 深評題一')).toBeNull();
  });

  it('expands the full scale when the screen result is flagged (monitor)', async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.cfsLevel = 'cfs5';
    render(QuestionnaireModule, { scales: [moodTriage, moodScreen, moodFull] });

    // Triage concern → expand mood-screen, then flag the screen → expand mood-full.
    await clickOption('有');            // mood-triage concern → expand mood-screen
    await waitFor(() => expect(screen.getByText('請唸給受測者：做事提不起勁的頻率？')).toBeInTheDocument());
    // Screen item 1: 0, item 2: 3 (also triggers red flag) → screen score 3 → monitor → expand.
    await clickOption('完全沒有');
    await clickOption('幾乎每天');

    // The expanded full scale's questions now appear.
    await waitFor(() => expect(screen.getByText('GDS 深評題一')).toBeInTheDocument(), { timeout: 3000 });
    await clickOption('否');
    await clickOption('否');
    await waitFor(() => expect(assessmentStore.assessment?.status).toBe('completed'), { timeout: 3000 });
  });

  it('shows the self-harm safety notice when a redFlag item gets a concerning answer (non-blocking)', async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.cfsLevel = 'cfs5';
    render(QuestionnaireModule, { scales: [moodTriage, moodScreen, moodFull] });

    await clickOption('有');           // mood-triage concern → expand mood-screen
    await waitFor(() => expect(screen.getByText('請唸給受測者：做事提不起勁的頻率？')).toBeInTheDocument());
    await clickOption('完全沒有'); // screen item 1
    await clickOption('幾乎每天'); // screen item 2 = redFlag affirmative

    // Safety notice appears (non-blocking: flow continued into the expanded scale).
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText(/自傷風險/)).toBeInTheDocument();
    expect(screen.getByText(/1925/)).toBeInTheDocument();
  });

  it('records a questionnaire_answer event after clicking an answer', async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.cfsLevel = 'cfs5';
    // moodTriage appears first; clicking '有' records a triage answer, then mood-screen appears.
    render(QuestionnaireModule, { scales: [moodTriage, moodScreen, moodFull] });

    await clickOption('有'); // answer the triage question (first in triage phase)

    await waitFor(async () => {
      const events = await db.assessmentEvents.where('moduleType').equals('questionnaire').toArray();
      const answers = events.filter(e => e.eventType === 'questionnaire_answer');
      expect(answers.length).toBeGreaterThan(0);
      // 不依位置（always-run 先行時第一筆可能是 always-run 題）；驗 triage answer 確有記錄。
      expect(answers.some(e => e.data.scaleId === 'mood-triage')).toBe(true);
    }, { timeout: 2000 });
  });

  it('patientAble=false + requiresPatient screen → result severity becomes incomplete (availability gate)', async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment({ informantAvailable: true, patientAble: false });
    assessmentStore.cfsLevel = 'cfs5';
    assessmentStore.informantAvailable = true;
    assessmentStore.patientAble = false;
    // moodTriage (ask-either, no patient requirement) → concern → moodScreen (requiresPatient).
    render(QuestionnaireModule, { scales: [moodTriage, moodScreen, moodFull] });

    // Answer triage concern to expand mood-screen, then answer both screen items.
    // Patient cannot validly perform a patient-required test → severity=incomplete.
    await clickOption('有');       // triage concern → expand mood-screen
    await waitFor(() => expect(screen.getByText('請唸給受測者：做事提不起勁的頻率？')).toBeInTheDocument());
    await clickOption('完全沒有');
    await clickOption('完全沒有');

    await waitFor(() => {
      const sr = assessmentStore.partialAnalysis.scaleResults;
      expect(sr?.['mood-screen']).toBeDefined();
      expect(sr?.['mood-screen'].severity).toBe('incomplete');
      expect(sr?.['mood-screen'].bandLabel).toMatch(/需受測者本人/);
    }, { timeout: 3000 });
  });

  it('informantAvailable=false + requiresInformant screen → incomplete「無知情者」(availability gate)', async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment({ informantAvailable: false, patientAble: true });
    assessmentStore.cfsLevel = 'cfs5';
    assessmentStore.informantAvailable = false;
    assessmentStore.patientAble = true;
    // caregiverScreen is alwaysRun:true → appears directly in the triage phase.
    render(QuestionnaireModule, { scales: [caregiverScreen] });

    // The ask-informant header degrades to「查無可詢問的知情者」.
    await waitFor(() => expect(screen.getByText('查無可詢問的知情者')).toBeInTheDocument());
    await clickOption('不會');

    await waitFor(() => {
      const sr = assessmentStore.partialAnalysis.scaleResults;
      expect(sr?.['caregiver-screen']).toBeDefined();
      expect(sr?.['caregiver-screen']?.severity).toBe('incomplete');
      expect(sr?.['caregiver-screen']?.bandLabel).toMatch(/無知情者/);
    }, { timeout: 3000 });
  });

  it('informantAvailable=false → cognition screen swaps AD8 (cognition-screen) for Mini-Cog', async () => {
    const ad8: ScaleDef = {
      id: 'cognition-screen',
      domain: { top: 'psychological', sub: 'cognition' },
      tier: 'screen',
      alwaysRun: true, // always-run: appears in triage phase without triage gate (C-S6)
      expandsTo: 'spmsq',
      applicableCfs: ['cfs5'],
      scoring: 'sum',
      inputType: 'option',
      requiresInformant: true,
      maxScore: 2,
      items: [
        { id: 'ad8_1', mode: 'ask-informant', prompt: 'AD8 知情者題', text: 'AD8 知情者題', options: [{ label: '無變化', score: 0 }, { label: '有變化', score: 1 }] },
      ],
      bands: [{ min: 0, max: 0, severity: 'normal', label: '正常' }, { min: 1, max: 2, severity: 'monitor', label: '疑似' }],
      clinicallyReviewed: false,
    };
    const miniCog: ScaleDef = {
      id: 'mini-cog',
      domain: { top: 'psychological', sub: 'cognition' },
      tier: 'full',
      expandsTo: 'spmsq',
      applicableCfs: ['cfs5'],
      scoring: 'sum',
      inputType: 'option',
      requiresPatient: true,
      maxScore: 2,
      items: [
        { id: 'mc_recall', mode: 'patient', prompt: 'Mini-Cog 病人受測題', text: 'Mini-Cog 病人受測題', options: [{ label: '記得', score: 0 }, { label: '忘記', score: 1 }] },
      ],
      bands: [{ min: 0, max: 0, severity: 'normal', label: '正常' }, { min: 1, max: 2, severity: 'monitor', label: '疑似' }],
      clinicallyReviewed: false,
    };

    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment({ informantAvailable: false, patientAble: true });
    assessmentStore.informantAvailable = false;
    assessmentStore.patientAble = true;
    assessmentStore.cfsLevel = 'cfs5';
    render(QuestionnaireModule, { scales: [ad8, miniCog] });

    // No informant → AD8 is replaced by the patient-performed Mini-Cog (C-M2).
    await waitFor(() => expect(screen.getByText('Mini-Cog 病人受測題')).toBeInTheDocument());
    expect(screen.queryByText('AD8 知情者題')).toBeNull();
  });

  it('ask-informant 無法取得 marks the scale incomplete and advances (informant present)', async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment({ informantAvailable: true, patientAble: true });
    assessmentStore.cfsLevel = 'cfs5';
    assessmentStore.informantAvailable = true;
    assessmentStore.patientAble = true;
    // caregiverScreen is alwaysRun:true → appears directly in the triage phase.
    render(QuestionnaireModule, { scales: [caregiverScreen] });

    await waitFor(() => expect(screen.getByText('向熟悉受測者的家屬／照顧者詢問')).toBeInTheDocument());
    const unavailableBtn = screen.getByText(/無法取得/);
    await fireEvent.click(unavailableBtn);

    await waitFor(() => {
      const sr = assessmentStore.partialAnalysis.scaleResults;
      expect(sr?.['caregiver-screen']?.severity).toBe('incomplete');
    }, { timeout: 3000 });
  });

  it('renders the timed-task module when a flagged mobility screen expands to sit-to-stand', { timeout: 15000 }, async () => {
    // jsdom has no getUserMedia → MobilityTaskModule falls back to self-report.
    const mobilityTriage: ScaleDef = {
      id: 'mobility-triage', domain: { top: 'functional', sub: 'mobility' }, tier: 'triage',
      expandsTo: 'mobility-screen', applicableCfs: ['cfs5'], scoring: 'sum', inputType: 'option', maxScore: 1,
      items: [{ id: 'mobt', mode: 'ask-either', prompt: '行走困難嗎？', text: '行走困難嗎？',
        options: [{ label: '沒有', score: 0 }, { label: '有困難', score: 1 }] }],
      bands: [{ min: 0, max: 0, severity: 'normal', label: 'ok' }, { min: 1, max: 1, severity: 'monitor', label: 'c' }],
      clinicallyReviewed: false,
    };
    const mobilityScreen: ScaleDef = {
      id: 'mobility-screen',
      domain: { top: 'functional', sub: 'mobility' },
      tier: 'screen',
      expandsTo: 'sit-to-stand',
      applicableCfs: ['cfs5'],
      scoring: 'sum',
      inputType: 'option',
      maxScore: 2,
      items: [
        { id: 'mob_walk', mode: 'patient', prompt: '行走是否困難？', text: '行走困難', options: [{ label: '沒有困難', score: 0 }, { label: '明顯困難', score: 2 }] },
      ],
      bands: [
        { min: 0, max: 0, severity: 'normal', label: '良好' },
        { min: 1, max: 2, severity: 'monitor', label: '困難' },
      ],
      clinicallyReviewed: false,
    };
    const sitToStand: ScaleDef = {
      id: 'sit-to-stand',
      domain: { top: 'functional', sub: 'mobility' },
      tier: 'full',
      applicableCfs: ['cfs5'],
      scoring: 'measured-value',
      inputType: 'timed-task',
      maxScore: 30,
      items: [],
      bands: [
        { max: 12, severity: 'normal', label: '順暢完成' },
        { min: 13, max: 15, severity: 'monitor', label: '略慢' },
        { min: 16, severity: 'refer', label: '吃力' },
      ],
      clinicallyReviewed: false,
    };

    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.cfsLevel = 'cfs5';
    render(QuestionnaireModule, { scales: [mobilityTriage, mobilityScreen, sitToStand] });

    // First answer triage concern to reach mobility-screen, then flag screen → timed sit-to-stand.
    await waitFor(() => expect(screen.getByText('行走困難嗎？')).toBeInTheDocument());
    await clickOption('有困難');         // triage concern → expand mobility-screen
    await waitFor(() => expect(screen.getByText('行走是否困難？')).toBeInTheDocument());
    await clickOption('明顯困難');       // screen flag → expand timed sit-to-stand

    await waitFor(() => {
      expect(screen.getByText('行動能力自述')).toBeInTheDocument();
    }, { timeout: 6000 });
  });

  it('on resume, restores prior answers and continues from the first unanswered question', { timeout: 15000 }, async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.cfsLevel = 'cfs5';

    // First session: answer triage concern (→ expands mood-screen), then answer
    // only screen item 1, then "pause" (unmount).
    const first = render(QuestionnaireModule, { scales: [moodTriage, moodScreen, moodFull] });
    await waitFor(() => expect(screen.getByText('MOOD_TRIAGE_Q')).toBeInTheDocument());
    await clickOption('有');           // triage concern → expand mood-screen
    await waitFor(() => expect(screen.getByText('請唸給受測者：做事提不起勁的頻率？')).toBeInTheDocument());
    await clickOption('完全沒有');     // answer screen item 1
    await waitFor(async () => {
      const events = await db.assessmentEvents.where('moduleType').equals('questionnaire').toArray();
      expect(events.some(e => e.data.questionId === 'phq2_anhedonia')).toBe(true);
    }, { timeout: 2000 });
    first.unmount();

    // Second session (resume): same assessment/child still in the store.
    // initPhase rebuilds tier state: triage all resolved → expandTriageTier →
    // expandedScreens=[moodScreen], tier='screen'. Resume point = screen item 2.
    render(QuestionnaireModule, { scales: [moodTriage, moodScreen, moodFull] });
    await waitFor(() => {
      expect(screen.getByText('請唸給受測者：心情低落或絕望的頻率？')).toBeInTheDocument();
    }, { timeout: 4000 });
    // Triage and screen item 1 are not re-asked.
    expect(screen.queryByText('MOOD_TRIAGE_Q')).toBeNull();
    expect(screen.queryByText('請唸給受測者：做事提不起勁的頻率？')).toBeNull();
  });

  it('persists per-scale scores (keyed by scaleId) after answering all items', { timeout: 15000 }, async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.cfsLevel = 'cfs5';
    // Need triage fixture so moodScreen can be reached via concern.
    render(QuestionnaireModule, { scales: [moodTriage, moodScreen, moodFull] });

    // Answer triage with concern to expand mood-screen, then click remaining items.
    await waitFor(() => expect(screen.getByText('MOOD_TRIAGE_Q')).toBeInTheDocument());
    await clickOption('有'); // triage concern → expand mood-screen
    // Now answer remaining items (screen + possible full) with first option.
    const MAX = 20;
    for (let i = 0; i < MAX; i++) {
      if (assessmentStore.assessment?.status === 'completed') break;
      const btn = screen.queryAllByRole('button').find(b => b.classList.contains('option-btn'));
      if (!btn) break; // no more questions (finishing / advanced to result)
      await fireEvent.click(btn);
      await new Promise(r => setTimeout(r, 600));
    }
    await waitFor(() => expect(assessmentStore.assessment?.status).toBe('completed'), { timeout: 3000 });

    const scores = assessmentStore.partialAnalysis.questionnaireScores;
    const maxScores = assessmentStore.partialAnalysis.questionnaireMaxScores;
    expect(scores?.['mood-screen']).toBeDefined();
    expect(maxScores?.['mood-screen']).toBe(6);
  });

  // ---- Task 4 三階段展開測試 ----

  it('triage normal → does NOT expand into the domain screen', async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.informantAvailable = true;
    assessmentStore.patientAble = true;
    assessmentStore.cfsLevel = 'cfs5';
    render(QuestionnaireModule, { scales: [fallsTriage, fallsScreen, fallsFull] });
    await clickOption('否');                                  // triage normal
    await waitFor(() => expect(screen.queryByText('FALLS_SCREEN_Q')).toBeNull());
  });

  it('triage concern → expands screen; screen flag → expands full', async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.informantAvailable = true;
    assessmentStore.patientAble = true;
    assessmentStore.cfsLevel = 'cfs5';
    render(QuestionnaireModule, { scales: [fallsTriage, fallsScreen, fallsFull] });
    await clickOption('是');                                  // triage concern
    await waitFor(() => expect(screen.getByText('FALLS_SCREEN_Q')).toBeInTheDocument());
    await clickOption('是');                                  // screen flag
    await waitFor(() => expect(screen.getByText('FALLS_FULL_Q')).toBeInTheDocument());
  });

  it('alwaysRun screen is asked in the triage phase and NOT re-asked after expansion', async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.informantAvailable = true;
    assessmentStore.patientAble = true;
    assessmentStore.cfsLevel = 'cfs5';
    render(QuestionnaireModule, { scales: [fallsTriage, fallsScreen, fallsFull, alwaysRunScreen] });
    // always-run question present from the triage phase (appears before triage scales)
    await waitFor(() => expect(screen.getByText('ALWAYS_RUN_Q')).toBeInTheDocument());
    await clickOption('正常');                                // answer always-run (normal)
    await clickOption('是');                                  // falls triage concern → expand falls-screen
    await waitFor(() => expect(screen.getByText('FALLS_SCREEN_Q')).toBeInTheDocument());
    // always-run question must NOT reappear (already answered)
    expect(screen.queryByText('ALWAYS_RUN_Q')).toBeNull();
  });

  it('persists triage results so all-normal domains still get a score (blocker C)', async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.informantAvailable = true;
    assessmentStore.patientAble = true;
    assessmentStore.cfsLevel = 'cfs5';
    render(QuestionnaireModule, { scales: [fallsTriage, fallsScreen, fallsFull] });
    await clickOption('否');                                  // triage normal → no expansion → summary
    // triage result must be persisted (else the falls domain vanishes on the result page)
    await waitFor(() => {
      const stored = assessmentStore.partialAnalysis.scaleResults ?? {};
      expect(stored['falls-triage']).toBeTruthy();
      expect(stored['falls-triage'].severity).toBe('normal');
    });
  });
});
