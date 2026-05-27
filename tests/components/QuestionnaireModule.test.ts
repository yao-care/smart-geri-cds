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
 *  and informant-mode framing). Not delirium/cognition → 無法取得 allowed. */
const caregiverScreen: ScaleDef = {
  id: 'caregiver-screen',
  domain: { top: 'social', sub: 'caregiver' },
  tier: 'screen',
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

/** Click the first option button on the current question and wait the feedback delay.
 *  Waits for an option button to appear first (the module starts in a 'loading'
 *  phase while it restores prior progress). */
async function clickFirstOption(): Promise<void> {
  let btn: HTMLElement | undefined;
  await waitFor(() => {
    btn = screen.queryAllByRole('button').find(b => b.classList.contains('option-btn'));
    expect(btn).toBeTruthy();
  });
  await fireEvent.click(btn!);
  await new Promise(r => setTimeout(r, 600));
}

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
    assessmentStore.cfsLevel = 'cfs1'; // screen applies only to cfs5
    render(QuestionnaireModule, { scales: [moodScreen, moodFull] });
    await waitFor(() => expect(screen.getByText(/沒有可施測的量表/)).toBeInTheDocument());
  });

  it('renders the patient-source mode frame for the first screen item (SOP wording)', async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.informantAvailable = true;
    assessmentStore.patientAble = true;
    assessmentStore.cfsLevel = 'cfs5';
    render(QuestionnaireModule, { scales: [moodScreen, moodFull] });
    await waitFor(() => expect(screen.getByText('請受測者本人作答（操作者唸題並記錄）')).toBeInTheDocument());
    expect(screen.getByText('請唸給受測者：做事提不起勁的頻率？')).toBeInTheDocument();
  });

  it('renders the ask-informant mode frame as「向熟悉受測者的家屬／照顧者詢問」(informant present)', async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment({ informantAvailable: true, patientAble: true });
    assessmentStore.informantAvailable = true;
    assessmentStore.patientAble = true;
    assessmentStore.cfsLevel = 'cfs5';
    render(QuestionnaireModule, { scales: [caregiverScreen] });
    // caregiver item is ask-informant → informant-source header.
    await waitFor(() => expect(screen.getByText('向熟悉受測者的家屬／照顧者詢問')).toBeInTheDocument());
    // 無法取得 path is offered for non-delirium/cognition informant scales.
    expect(screen.getByText(/無法取得/)).toBeInTheDocument();
  });

  it('ask-either item header is patient-OR-family (NOT the operator-blind「請詢問家屬」)', async () => {
    // Regression for the original contradiction: an ADL-style ask-either item
    // must read「向受測者本人或家屬…」, not「請詢問家屬／照顧者」.
    const adlEither: ScaleDef = {
      id: 'adl-screen',
      domain: { top: 'functional', sub: 'adl' },
      tier: 'screen',
      applicableCfs: ['cfs5'],
      scoring: 'sum',
      inputType: 'option',
      maxScore: 2,
      items: [
        {
          id: 'adl_help', mode: 'ask-either',
          prompt: '請向受測者或家屬詢問：日常自我照顧是否需要協助？', text: 'ADL 協助',
          options: [{ label: '不需要', score: 0 }, { label: '需要', score: 2 }],
        },
      ],
      bands: [
        { min: 0, max: 0, severity: 'normal', label: '獨立' },
        { min: 1, max: 2, severity: 'monitor', label: '需協助' },
      ],
      clinicallyReviewed: false,
    };
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.informantAvailable = true;
    assessmentStore.patientAble = true;
    assessmentStore.cfsLevel = 'cfs5';
    render(QuestionnaireModule, { scales: [adlEither] });
    await waitFor(() => expect(screen.getByText('向受測者本人或家屬／照顧者詢問（可參考觀察與病歷）')).toBeInTheDocument());
    expect(screen.queryByText('請詢問家屬／照顧者')).toBeNull();
  });

  it('does NOT expand the full scale when the screen result is normal', async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.cfsLevel = 'cfs5';
    render(QuestionnaireModule, { scales: [moodScreen, moodFull] });

    // Answer both screen items 「完全沒有」(0) → screen normal → no expand.
    await clickOption('完全沒有');
    await clickOption('完全沒有');

    await waitFor(() => expect(screen.getByText('問卷完成！')).toBeInTheDocument(), { timeout: 3000 });
    // No GDS full question was ever rendered.
    expect(screen.queryByText('GDS 深評題一')).toBeNull();
  });

  it('expands the full scale when the screen result is flagged (monitor)', async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.cfsLevel = 'cfs5';
    render(QuestionnaireModule, { scales: [moodScreen, moodFull] });

    // Screen item 1: 0, item 2: 3 (also triggers red flag) → screen score 3 → monitor → expand.
    await clickOption('完全沒有');
    await clickOption('幾乎每天');

    // The expanded full scale's questions now appear.
    await waitFor(() => expect(screen.getByText('GDS 深評題一')).toBeInTheDocument(), { timeout: 3000 });
    await clickOption('否');
    await clickOption('否');
    await waitFor(() => expect(screen.getByText('問卷完成！')).toBeInTheDocument(), { timeout: 3000 });
  });

  it('shows the self-harm safety notice when a redFlag item gets a concerning answer (non-blocking)', async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.cfsLevel = 'cfs5';
    render(QuestionnaireModule, { scales: [moodScreen, moodFull] });

    await clickOption('完全沒有'); // item 1
    await clickOption('幾乎每天'); // item 2 = redFlag affirmative

    // Safety notice appears (non-blocking: flow continued into the expanded scale).
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument(), { timeout: 3000 });
    expect(screen.getByText(/自傷風險/)).toBeInTheDocument();
    expect(screen.getByText(/1925/)).toBeInTheDocument();
  });

  it('records a questionnaire_answer event after clicking an answer', async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.cfsLevel = 'cfs5';
    render(QuestionnaireModule, { scales: [moodScreen, moodFull] });

    await clickOption('完全沒有');

    await waitFor(async () => {
      const events = await db.assessmentEvents.where('moduleType').equals('questionnaire').toArray();
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].eventType).toBe('questionnaire_answer');
      expect(events[0].data.scaleId).toBe('mood-screen');
    }, { timeout: 2000 });
  });

  it('patientAble=false + requiresPatient screen → result severity becomes incomplete (availability gate)', async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment({ informantAvailable: true, patientAble: false });
    assessmentStore.cfsLevel = 'cfs5';
    assessmentStore.informantAvailable = true;
    assessmentStore.patientAble = false;
    render(QuestionnaireModule, { scales: [moodScreen, moodFull] });

    // Answer both screen items; patient cannot validly perform a patient-required test.
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
    render(QuestionnaireModule, { scales: [caregiverScreen] });

    // The ask-informant header degrades to「無知情者，標為無法取得」.
    await waitFor(() => expect(screen.getByText('無知情者，標為無法取得')).toBeInTheDocument());
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

    // No informant → AD8 is replaced by the patient-performed Mini-Cog.
    await waitFor(() => expect(screen.getByText('Mini-Cog 病人受測題')).toBeInTheDocument());
    expect(screen.queryByText('AD8 知情者題')).toBeNull();
  });

  it('ask-informant 無法取得 marks the scale incomplete and advances (informant present)', async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment({ informantAvailable: true, patientAble: true });
    assessmentStore.cfsLevel = 'cfs5';
    assessmentStore.informantAvailable = true;
    assessmentStore.patientAble = true;
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
    render(QuestionnaireModule, { scales: [mobilityScreen, sitToStand] });

    // Wait for the screen question to mount (avoid the mount-vs-click race) then
    // flag the screen → expand to the timed sit-to-stand.
    await waitFor(() => expect(screen.getByText('行走是否困難？')).toBeInTheDocument());
    await clickOption('明顯困難');

    await waitFor(() => {
      expect(screen.getByText('行動能力自述')).toBeInTheDocument();
    }, { timeout: 6000 });
  });

  it('on resume, restores prior answers and continues from the first unanswered question', { timeout: 15000 }, async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.cfsLevel = 'cfs5';

    // First session: answer only screen item 1, then "pause" (unmount).
    const first = render(QuestionnaireModule, { scales: [moodScreen, moodFull] });
    await waitFor(() => expect(screen.getByText('請唸給受測者：做事提不起勁的頻率？')).toBeInTheDocument());
    await clickOption('完全沒有');
    await waitFor(async () => {
      const events = await db.assessmentEvents.where('moduleType').equals('questionnaire').toArray();
      expect(events.some(e => e.data.questionId === 'phq2_anhedonia')).toBe(true);
    }, { timeout: 2000 });
    first.unmount();

    // Second session (resume): same assessment/child still in the store.
    render(QuestionnaireModule, { scales: [moodScreen, moodFull] });
    await waitFor(() => {
      expect(screen.getByText('請唸給受測者：心情低落或絕望的頻率？')).toBeInTheDocument();
    }, { timeout: 2000 });
    // Item 1 is not re-asked.
    expect(screen.queryByText('請唸給受測者：做事提不起勁的頻率？')).toBeNull();
  });

  it('persists per-scale scores (keyed by scaleId) after answering all items', { timeout: 15000 }, async () => {
    assessmentStore.child = makeChild();
    assessmentStore.assessment = makeAssessment();
    assessmentStore.cfsLevel = 'cfs5';
    render(QuestionnaireModule, { scales: [moodScreen, moodFull] });

    const MAX = 12;
    for (let i = 0; i < MAX; i++) {
      if (screen.queryByText('問卷完成！')) break;
      await clickFirstOption();
    }
    await waitFor(() => expect(screen.getByText('問卷完成！')).toBeInTheDocument(), { timeout: 3000 });

    const scores = assessmentStore.partialAnalysis.questionnaireScores;
    const maxScores = assessmentStore.partialAnalysis.questionnaireMaxScores;
    expect(scores?.['mood-screen']).toBeDefined();
    expect(maxScores?.['mood-screen']).toBe(6);
  });
});
