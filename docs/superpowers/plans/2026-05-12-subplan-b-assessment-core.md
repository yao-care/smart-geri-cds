# Sub-plan B: Assessment Core

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the assessment state machine, IndexedDB schema extensions, child profile management, and flow controller — the foundation all assessment modules (C-G) plug into.

**Architecture:** Assessment state is managed in IndexedDB (Dexie.js). A Svelte 5 runes store coordinates the flow. Each assessment module receives the assessmentId and emits events to a shared event bus. Age-group detection drives module adaptation.

**Tech Stack:** Dexie.js 4.x, Svelte 5 runes, TypeScript, crypto.randomUUID()

---

## File Structure

### Create
- `src/lib/db/assessments.ts` — Assessment + Child DB tables + DAOs
- `src/lib/db/assessment-events.ts` — AssessmentEvent DB table + DAOs
- `src/lib/stores/assessment.svelte.ts` — Assessment flow state store
- `src/lib/utils/age-groups.ts` — CDSA age group logic (7 groups, 0-72 months)
- `src/components/assess/ChildProfile.svelte` — Child info entry form
- `src/components/assess/AssessmentShell.svelte` — Upgrade stub from A2 to full flow controller

### Modify
- `src/lib/db/schema.ts` — Add Assessment, Child, AssessmentEvent, NormThreshold tables

---

### Task B1: Extend IndexedDB Schema

**Files:**
- Modify: `src/lib/db/schema.ts`

Add new tables for CDSA assessments.

- [ ] **Step 1: Add interfaces and tables to schema.ts**

Add after existing interfaces:

```typescript
export type AssessmentStatus = 'started' | 'paused' | 'resumed' | 'completed' | 'incomplete';

export type AgeGroupCDSA = '2-6m' | '7-12m' | '13-24m' | '25-36m' | '37-48m' | '49-60m' | '61-72m';

export interface Child {
  id: string;
  birthDate: string;
  gender: 'male' | 'female' | 'other';
  nickName?: string;
  createdAt: Date;
}

export interface Assessment {
  id: string;
  childId: string;
  status: AssessmentStatus;
  language: string;
  currentStep: number;
  startedAt: Date;
  completedAt?: Date;
  pausedAt?: Date;
  triageResult?: {
    category: 'normal' | 'monitor' | 'refer';
    confidence: number;
    summary: string;
  };
  fhirSubmitted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssessmentEvent {
  id: string;
  assessmentId: string;
  childId: string;
  moduleType: 'questionnaire' | 'game' | 'voice' | 'video' | 'drawing';
  eventType: string;
  timestamp: Date;
  data: Record<string, unknown>;
  qualityFlags?: {
    isComplete: boolean;
    isAnomaly: boolean;
    anomalyType?: string;
  };
}

export interface MediaFile {
  id: string;
  assessmentId: string;
  childId: string;
  fileType: 'voice' | 'video' | 'drawing';
  blob: Blob;
  mimeType: string;
  fileSize: number;
  duration?: number;
  processed: boolean;
  createdAt: Date;
}

export interface NormThreshold {
  id: string;
  ageGroup: AgeGroupCDSA;
  metric: string;
  mean: number;
  std: number;
  source: string;
  updatedAt: Date;
}
```

Add tables to CdssDatabase class and version(2) migration:

```typescript
children!: Table<Child>;
assessments!: Table<Assessment>;
assessmentEvents!: Table<AssessmentEvent>;
mediaFiles!: Table<MediaFile>;
normThresholds!: Table<NormThreshold>;

// In constructor, add version(2):
this.version(2).stores({
  // Keep all v1 stores...
  patients: 'id, ageGroup, currentRiskLevel, lastSyncedAt',
  observations: 'id, patientId, indicator, effectiveDateTime, [patientId+indicator]',
  alerts: 'id, patientId, riskLevel, status, createdAt, [patientId+status]',
  baselines: '[patientId+indicator], patientId, updatedAt',
  syncQueue: 'id, createdAt',
  serverConfigs: 'id, lastUsedAt',
  educationInteractions: 'id, contentSlug, createdAt',
  ruleVersions: 'id, createdAt',
  webhookHistory: 'id, webhookId, alertId, createdAt',
  // New v2 stores:
  children: 'id, createdAt',
  assessments: 'id, childId, status, createdAt, [childId+status]',
  assessmentEvents: 'id, assessmentId, childId, moduleType, timestamp, [assessmentId+moduleType]',
  mediaFiles: 'id, assessmentId, childId, fileType, createdAt, [assessmentId+fileType]',
  normThresholds: 'id, ageGroup, metric, [ageGroup+metric]',
});
```

- [ ] **Step 2: Verify TypeScript**

Run: `npx tsc --noEmit --skipLibCheck`

- [ ] **Step 3: Commit**

```
feat(B1): extend IndexedDB schema with CDSA assessment tables
```

---

### Task B2: Assessment DAOs

**Files:**
- Create: `src/lib/db/assessments.ts`
- Create: `src/lib/db/assessment-events.ts`

- [ ] **Step 1: Create assessments.ts**

```typescript
import { db, type Assessment, type AssessmentStatus, type Child } from './schema';

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

export async function createAssessment(childId: string, language = 'zh-TW'): Promise<Assessment> {
  const now = new Date();
  const assessment: Assessment = {
    id: crypto.randomUUID(),
    childId,
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

export async function setTriageResult(
  id: string,
  result: Assessment['triageResult'],
): Promise<void> {
  await db.assessments.update(id, { triageResult: result, updatedAt: new Date() });
}

export async function markFhirSubmitted(id: string): Promise<void> {
  await db.assessments.update(id, { fhirSubmitted: true, updatedAt: new Date() });
}

export async function getIncompleteAssessments(): Promise<Assessment[]> {
  return db.assessments
    .where('status')
    .anyOf(['started', 'paused', 'resumed'])
    .reverse()
    .sortBy('createdAt');
}
```

- [ ] **Step 2: Create assessment-events.ts**

```typescript
import { db, type AssessmentEvent, type MediaFile } from './schema';

// ---- Event DAO ----

export async function recordEvent(event: Omit<AssessmentEvent, 'id'>): Promise<string> {
  const id = crypto.randomUUID();
  await db.assessmentEvents.put({ ...event, id });
  return id;
}

export async function recordEvents(events: Omit<AssessmentEvent, 'id'>[]): Promise<void> {
  const withIds = events.map(e => ({ ...e, id: crypto.randomUUID() }));
  await db.assessmentEvents.bulkPut(withIds);
}

export async function getEventsForAssessment(assessmentId: string): Promise<AssessmentEvent[]> {
  return db.assessmentEvents
    .where('assessmentId')
    .equals(assessmentId)
    .sortBy('timestamp');
}

export async function getEventsByModule(
  assessmentId: string,
  moduleType: AssessmentEvent['moduleType'],
): Promise<AssessmentEvent[]> {
  return db.assessmentEvents
    .where('[assessmentId+moduleType]')
    .equals([assessmentId, moduleType])
    .sortBy('timestamp');
}

export async function getEventCount(assessmentId: string): Promise<number> {
  return db.assessmentEvents.where('assessmentId').equals(assessmentId).count();
}

// ---- Media DAO ----

export async function saveMedia(media: Omit<MediaFile, 'id' | 'createdAt' | 'processed'>): Promise<string> {
  const id = crypto.randomUUID();
  await db.mediaFiles.put({ ...media, id, createdAt: new Date(), processed: false });
  return id;
}

export async function getMediaForAssessment(assessmentId: string): Promise<MediaFile[]> {
  return db.mediaFiles.where('assessmentId').equals(assessmentId).toArray();
}

export async function getMediaByType(
  assessmentId: string,
  fileType: MediaFile['fileType'],
): Promise<MediaFile[]> {
  return db.mediaFiles
    .where('[assessmentId+fileType]')
    .equals([assessmentId, fileType])
    .toArray();
}

export async function markMediaProcessed(id: string): Promise<void> {
  await db.mediaFiles.update(id, { processed: true });
}
```

- [ ] **Step 3: Verify TypeScript**
- [ ] **Step 4: Commit**

```
feat(B2): add assessment and event DAOs
```

---

### Task B3: CDSA Age Group Utility

**Files:**
- Create: `src/lib/utils/age-groups.ts`

- [ ] **Step 1: Create age-groups.ts**

```typescript
export type AgeGroupCDSA = '2-6m' | '7-12m' | '13-24m' | '25-36m' | '37-48m' | '49-60m' | '61-72m';

export const AGE_GROUPS_CDSA: readonly AgeGroupCDSA[] = [
  '2-6m', '7-12m', '13-24m', '25-36m', '37-48m', '49-60m', '61-72m',
] as const;

export const AGE_GROUP_LABELS: Record<AgeGroupCDSA, string> = {
  '2-6m': '2-6 個月',
  '7-12m': '7-12 個月',
  '13-24m': '13-24 個月',
  '25-36m': '25-36 個月',
  '37-48m': '37-48 個月',
  '49-60m': '49-60 個月',
  '61-72m': '61-72 個月',
};

/** Calculate age in months from birth date */
export function ageInMonths(birthDate: string | Date): number {
  const birth = typeof birthDate === 'string' ? new Date(birthDate) : birthDate;
  const now = new Date();
  const months = (now.getFullYear() - birth.getFullYear()) * 12 + (now.getMonth() - birth.getMonth());
  const dayAdjust = now.getDate() < birth.getDate() ? -1 : 0;
  return Math.max(0, months + dayAdjust);
}

/** Determine CDSA age group from birth date */
export function ageGroupCDSA(birthDate: string | Date): AgeGroupCDSA {
  const months = ageInMonths(birthDate);
  if (months <= 6) return '2-6m';
  if (months <= 12) return '7-12m';
  if (months <= 24) return '13-24m';
  if (months <= 36) return '25-36m';
  if (months <= 48) return '37-48m';
  if (months <= 60) return '49-60m';
  return '61-72m';
}

/** Check if child is within CDSA target range (0-72 months) */
export function isEligible(birthDate: string | Date): boolean {
  const months = ageInMonths(birthDate);
  return months >= 0 && months <= 72;
}

/** Get instruction complexity level for an age group */
export function instructionLevel(ageGroup: AgeGroupCDSA): 'none' | 'single_verb' | 'verb_object' | 'verb_adj_object' | 'compound' {
  switch (ageGroup) {
    case '2-6m':
    case '7-12m': return 'none';
    case '13-24m': return 'single_verb';
    case '25-36m': return 'verb_object';
    case '37-48m': return 'verb_adj_object';
    case '49-60m':
    case '61-72m': return 'compound';
  }
}
```

- [ ] **Step 2: Verify TypeScript**
- [ ] **Step 3: Commit**

```
feat(B3): add CDSA age group utility with instruction complexity levels
```

---

### Task B4: Assessment Store (Svelte 5 Runes)

**Files:**
- Create: `src/lib/stores/assessment.svelte.ts`

- [ ] **Step 1: Create assessment.svelte.ts**

```typescript
import type { Assessment, Child, AssessmentStatus } from '../db/schema';
import * as assessmentDao from '../db/assessments';
import { ageGroupCDSA, type AgeGroupCDSA } from '../utils/age-groups';

const STEPS = ['profile', 'questionnaire', 'game', 'voice', 'video', 'drawing', 'analyzing', 'result'] as const;
export type AssessmentStep = typeof STEPS[number];

class AssessmentStore {
  // Current state
  child = $state<Child | null>(null);
  assessment = $state<Assessment | null>(null);
  currentStepIndex = $state(0);
  isLoading = $state(false);
  error = $state<string | null>(null);

  // Derived
  currentStep = $derived(STEPS[this.currentStepIndex] ?? 'profile');
  ageGroup = $derived<AgeGroupCDSA | null>(
    this.child?.birthDate ? ageGroupCDSA(this.child.birthDate) : null
  );
  isFirstStep = $derived(this.currentStepIndex === 0);
  isLastStep = $derived(this.currentStepIndex === STEPS.length - 1);
  progress = $derived(this.currentStepIndex / (STEPS.length - 1));
  steps = STEPS;

  /** Start a new assessment with a new child profile */
  async startNew(childData: Omit<Child, 'id' | 'createdAt'>): Promise<void> {
    this.isLoading = true;
    this.error = null;
    try {
      const child: Child = {
        ...childData,
        id: crypto.randomUUID(),
        createdAt: new Date(),
      };
      await assessmentDao.createChild(child);
      this.child = child;

      const assessment = await assessmentDao.createAssessment(child.id);
      this.assessment = assessment;
      this.currentStepIndex = 1; // Move past profile step
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to start assessment';
    } finally {
      this.isLoading = false;
    }
  }

  /** Resume an existing assessment */
  async resume(assessmentId: string): Promise<void> {
    this.isLoading = true;
    this.error = null;
    try {
      const assessment = await assessmentDao.getAssessment(assessmentId);
      if (!assessment) throw new Error('Assessment not found');

      const child = await assessmentDao.getChild(assessment.childId);
      if (!child) throw new Error('Child not found');

      this.assessment = assessment;
      this.child = child;
      this.currentStepIndex = assessment.currentStep;

      await assessmentDao.updateAssessmentStatus(assessmentId, 'resumed');
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to resume assessment';
    } finally {
      this.isLoading = false;
    }
  }

  /** Advance to next step */
  async nextStep(): Promise<void> {
    if (this.currentStepIndex >= STEPS.length - 1) return;
    this.currentStepIndex++;
    if (this.assessment) {
      await assessmentDao.updateAssessmentStep(this.assessment.id, this.currentStepIndex);
    }
  }

  /** Go back to previous step */
  async prevStep(): Promise<void> {
    if (this.currentStepIndex <= 0) return;
    this.currentStepIndex--;
    if (this.assessment) {
      await assessmentDao.updateAssessmentStep(this.assessment.id, this.currentStepIndex);
    }
  }

  /** Pause the assessment */
  async pause(): Promise<void> {
    if (this.assessment) {
      await assessmentDao.updateAssessmentStatus(this.assessment.id, 'paused');
      this.assessment = { ...this.assessment, status: 'paused' };
    }
  }

  /** Complete the assessment */
  async complete(): Promise<void> {
    if (this.assessment) {
      await assessmentDao.updateAssessmentStatus(this.assessment.id, 'completed');
      this.assessment = { ...this.assessment, status: 'completed', completedAt: new Date() };
    }
  }

  /** Reset store (for starting fresh) */
  reset(): void {
    this.child = null;
    this.assessment = null;
    this.currentStepIndex = 0;
    this.error = null;
  }
}

export const assessmentStore = new AssessmentStore();
```

- [ ] **Step 2: Verify with svelte-check**
- [ ] **Step 3: Commit**

```
feat(B4): add assessment store with step navigation and state management
```

---

### Task B5: Child Profile Form

**Files:**
- Create: `src/components/assess/ChildProfile.svelte`

- [ ] **Step 1: Create ChildProfile.svelte**

```svelte
<script lang="ts">
  import { assessmentStore } from '../../lib/stores/assessment.svelte';
  import { isEligible, ageInMonths, ageGroupCDSA, AGE_GROUP_LABELS } from '../../lib/utils/age-groups';

  let birthDate = $state('');
  let gender = $state<'male' | 'female' | 'other'>('male');
  let nickName = $state('');
  let validationError = $state<string | null>(null);

  const ageMonths = $derived(birthDate ? ageInMonths(birthDate) : null);
  const eligible = $derived(birthDate ? isEligible(birthDate) : null);
  const ageGroup = $derived(birthDate && eligible ? ageGroupCDSA(birthDate) : null);

  async function handleSubmit() {
    validationError = null;

    if (!birthDate) {
      validationError = '請輸入出生日期';
      return;
    }
    if (!eligible) {
      validationError = '本系統適用於 72 個月（6 歲）以下長者';
      return;
    }

    await assessmentStore.startNew({
      birthDate,
      gender,
      nickName: nickName || undefined,
    });
  }
</script>

<form class="child-profile" onsubmit|preventDefault={handleSubmit}>
  <h2>長者基本資料</h2>
  <p class="form-description">請填寫以下資料，系統將依據年齡自動調整評估內容。</p>

  <div class="form-group">
    <label for="birthDate">出生日期 *</label>
    <input id="birthDate" type="date" bind:value={birthDate} required max={new Date().toISOString().split('T')[0]} />
    {#if ageMonths !== null && eligible}
      <span class="age-info">{ageMonths} 個月 — {ageGroup ? AGE_GROUP_LABELS[ageGroup] : ''}</span>
    {/if}
  </div>

  <div class="form-group">
    <label for="gender">性別 *</label>
    <div class="radio-group">
      <label class="radio-label">
        <input type="radio" name="gender" value="male" bind:group={gender} /> 男
      </label>
      <label class="radio-label">
        <input type="radio" name="gender" value="female" bind:group={gender} /> 女
      </label>
      <label class="radio-label">
        <input type="radio" name="gender" value="other" bind:group={gender} /> 其他
      </label>
    </div>
  </div>

  <div class="form-group">
    <label for="nickName">暱稱（選填）</label>
    <input id="nickName" type="text" bind:value={nickName} placeholder="寶寶的暱稱" />
  </div>

  {#if validationError}
    <p class="error">{validationError}</p>
  {/if}

  {#if assessmentStore.error}
    <p class="error">{assessmentStore.error}</p>
  {/if}

  <button type="submit" class="btn-start" disabled={assessmentStore.isLoading}>
    {assessmentStore.isLoading ? '準備中…' : '開始評估'}
  </button>
</form>
```

Style: form centered max-width 480px, large inputs (min-height 48px), large submit button (min-height 56px, --color-accent bg), radio buttons as pill toggles, age-info green badge, error red text. Child-friendly: rounded corners, generous spacing.

- [ ] **Step 2: Verify build**
- [ ] **Step 3: Commit**

```
feat(B5): add child profile entry form
```

---

### Task B6: Upgrade AssessmentShell to Full Flow Controller

**Files:**
- Modify: `src/components/assess/AssessmentShell.svelte`

Replace the stub from A2 with the full flow controller that routes between assessment modules.

- [ ] **Step 1: Rewrite AssessmentShell.svelte**

```svelte
<script lang="ts">
  import StepIndicator from './StepIndicator.svelte';
  import ChildProfile from './ChildProfile.svelte';
  import FhirSetup from './FhirSetup.svelte';
  import { assessmentStore } from '../../lib/stores/assessment.svelte';
  import { getIncompleteAssessments } from '../../lib/db/assessments';
  import type { Assessment } from '../../lib/db/schema';

  const STEP_LABELS = ['基本資料', '問卷', '互動遊戲', '語音互動', '影片錄製', '繪圖測試', '分析中', '評估結果'];

  let incompleteAssessments = $state<Assessment[]>([]);
  let showResume = $state(true);

  // Check for incomplete assessments on mount
  $effect(() => {
    getIncompleteAssessments().then(list => {
      incompleteAssessments = list;
    });
  });

  async function handleResume(id: string) {
    await assessmentStore.resume(id);
    showResume = false;
  }

  function handleStartNew() {
    assessmentStore.reset();
    showResume = false;
  }
</script>

<FhirSetup>
  <div class="assessment-shell">
    <StepIndicator steps={STEP_LABELS} currentStep={assessmentStore.currentStepIndex} />

    <div class="step-content">
      {#if showResume && incompleteAssessments.length > 0 && !assessmentStore.assessment}
        <!-- Resume incomplete assessment prompt -->
        <div class="resume-prompt">
          <h2>您有未完成的評估</h2>
          {#each incompleteAssessments as a}
            <button class="resume-card" onclick={() => handleResume(a.id)}>
              繼續評估（{new Date(a.startedAt).toLocaleDateString('zh-TW')}）
            </button>
          {/each}
          <button class="btn-secondary" onclick={handleStartNew}>開始新的評估</button>
        </div>

      {:else if assessmentStore.currentStep === 'profile'}
        <ChildProfile />

      {:else if assessmentStore.currentStep === 'questionnaire'}
        <!-- Sub-plan C will provide QuestionnaireModule -->
        <div class="module-placeholder">
          <h2>問卷評估</h2>
          <p>此模組即將實作。</p>
          <button class="btn-primary" onclick={() => assessmentStore.nextStep()}>跳過（開發中）</button>
        </div>

      {:else if assessmentStore.currentStep === 'game'}
        <!-- Sub-plan D will provide GameModule -->
        <div class="module-placeholder">
          <h2>互動遊戲</h2>
          <p>此模組即將實作。</p>
          <button class="btn-primary" onclick={() => assessmentStore.nextStep()}>跳過（開發中）</button>
        </div>

      {:else if assessmentStore.currentStep === 'voice'}
        <!-- Sub-plan E will provide VoiceModule -->
        <div class="module-placeholder">
          <h2>語音互動</h2>
          <p>此模組即將實作。</p>
          <button class="btn-primary" onclick={() => assessmentStore.nextStep()}>跳過（開發中）</button>
        </div>

      {:else if assessmentStore.currentStep === 'video'}
        <!-- Sub-plan F will provide VideoModule -->
        <div class="module-placeholder">
          <h2>影片錄製</h2>
          <p>此模組即將實作。</p>
          <button class="btn-primary" onclick={() => assessmentStore.nextStep()}>跳過（開發中）</button>
        </div>

      {:else if assessmentStore.currentStep === 'drawing'}
        <!-- Sub-plan G will provide DrawingModule -->
        <div class="module-placeholder">
          <h2>繪圖測試</h2>
          <p>此模組即將實作。</p>
          <button class="btn-primary" onclick={() => assessmentStore.nextStep()}>跳過（開發中）</button>
        </div>

      {:else if assessmentStore.currentStep === 'analyzing'}
        <!-- Sub-plan H will provide AI analysis -->
        <div class="module-placeholder analyzing">
          <h2>AI 分析中…</h2>
          <p>正在分析評估資料，請稍候。</p>
          <div class="spinner" aria-label="分析中"></div>
          <button class="btn-primary" onclick={() => assessmentStore.nextStep()}>跳過（開發中）</button>
        </div>

      {:else if assessmentStore.currentStep === 'result'}
        <!-- Sub-plan I will provide ResultView -->
        <div class="module-placeholder">
          <h2>評估結果</h2>
          <p>此模組即將實作。</p>
        </div>
      {/if}

      <!-- Navigation (except on profile and result steps) -->
      {#if assessmentStore.assessment && !assessmentStore.isFirstStep && assessmentStore.currentStep !== 'result'}
        <div class="step-nav">
          {#if assessmentStore.currentStep !== 'analyzing'}
            <button onclick={() => assessmentStore.prevStep()}>← 上一步</button>
          {/if}
          <button class="btn-pause" onclick={() => assessmentStore.pause()}>暫停評估</button>
        </div>
      {/if}
    </div>
  </div>
</FhirSetup>
```

Style: module-placeholder centered with dashed border, spinner CSS animation, step-nav fixed at bottom, btn-pause ghost style. All using design tokens.

- [ ] **Step 2: Build and verify full flow**
- [ ] **Step 3: Commit**

```
feat(B6): upgrade AssessmentShell to full flow controller with step routing
```
