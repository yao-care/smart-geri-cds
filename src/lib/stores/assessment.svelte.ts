import type { Assessment, Child } from '../db/schema';
import * as assessmentDao from '../db/assessments';
import type { CfsLevel } from '../utils/cfs-levels';
import type { TriageResult } from '../../engine/cdsa/triage';

// 純問卷版三步驟流程（感測模組移除，無可跳模組）。
const STEPS = ['profile', 'questionnaire', 'result'] as const;
export type AssessmentStep = typeof STEPS[number];

export const STEP_LABELS: Record<AssessmentStep, string> = {
  profile: '基本資料',
  questionnaire: '問卷',
  result: '評估結果',
};

/** 各模組即時產出的分析結果（純問卷版只有問卷分數）。 */
export interface PartialAnalysis {
  /** scaleId / top.sub → 累計原始分。 */
  questionnaireScores?: Record<string, number>;
  /** 同 key 的最大可能分，供正規化。 */
  questionnaireMaxScores?: Record<string, number>;
}

class AssessmentStore {
  child = $state<Child | null>(null);
  assessment = $state<Assessment | null>(null);
  currentStepIndex = $state(0);
  isLoading = $state(false);
  error = $state<string | null>(null);

  /** 分層軸：CFS 等級（入口 gate 判定，取代年齡帶 ageGroup）。 */
  cfsLevel = $state<CfsLevel | null>(null);

  /** 各模組即時累積的分析結果 */
  partialAnalysis = $state<PartialAnalysis>({});

  /** 最終分流結果（進入 result 步驟時由 ResultView 計算） */
  triageResult = $state<TriageResult | null>(null);

  currentStep = $derived(STEPS[this.currentStepIndex] ?? 'profile');
  isFirstStep = $derived(this.currentStepIndex === 0);
  isLastStep = $derived(this.currentStepIndex === STEPS.length - 1);
  progress = $derived(this.currentStepIndex / (STEPS.length - 1));
  steps = STEPS;

  /** 各模組完成時呼叫，累積分析結果 */
  addAnalysis(partial: Partial<PartialAnalysis>): void {
    // ⚠ 此 warn 依賴 addAnalysis 為 shallow spread（partial.questionnaireScores
    // 整個替換 this.partialAnalysis.questionnaireScores 而非深 merge）。若日後改深 merge，
    // 此守護需重寫（newKeys 將包含 prev 所有 key + new，永遠抓不到 drop）。
    if (import.meta.env.DEV && partial.questionnaireScores) {
      const prevKeys = Object.keys(this.partialAnalysis.questionnaireScores ?? {});
      const newKeys = Object.keys(partial.questionnaireScores);
      const missing = prevKeys.filter(k => !newKeys.includes(k));
      if (missing.length > 0) {
        console.warn(
          `[AssessmentStore] addAnalysis(questionnaireScores) drops previously-set domains: ${missing.join(', ')}`
        );
      }
    }
    this.partialAnalysis = { ...this.partialAnalysis, ...partial };
  }

  async startNew(childData: Omit<Child, 'id' | 'createdAt'>, cfsLevel: CfsLevel): Promise<void> {
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
      this.cfsLevel = cfsLevel;
      const assessment = await assessmentDao.createAssessment(child.id, cfsLevel);
      this.assessment = assessment;
      this.currentStepIndex = 1;
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to start assessment';
    } finally {
      this.isLoading = false;
    }
  }

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
      this.cfsLevel = assessment.cfsLevel;
      this.currentStepIndex = assessment.currentStep;
      await assessmentDao.updateAssessmentStatus(assessmentId, 'resumed');
    } catch (e) {
      this.error = e instanceof Error ? e.message : 'Failed to resume assessment';
    } finally {
      this.isLoading = false;
    }
  }

  async nextStep(): Promise<void> {
    if (this.currentStepIndex >= STEPS.length - 1) return;
    this.currentStepIndex++;
    if (this.assessment) {
      await assessmentDao.updateAssessmentStep(this.assessment.id, this.currentStepIndex);
    }
  }

  async prevStep(): Promise<void> {
    if (this.currentStepIndex <= 0) return;
    this.currentStepIndex--;
    if (this.assessment) {
      await assessmentDao.updateAssessmentStep(this.assessment.id, this.currentStepIndex);
    }
  }

  async pause(): Promise<void> {
    if (this.assessment) {
      await assessmentDao.updateAssessmentStatus(this.assessment.id, 'paused');
      this.assessment = { ...this.assessment, status: 'paused' };
    }
  }

  async complete(): Promise<void> {
    if (this.assessment) {
      await assessmentDao.updateAssessmentStatus(this.assessment.id, 'completed');
      this.assessment = { ...this.assessment, status: 'completed', completedAt: new Date() };
    }
  }

  reset(): void {
    this.child = null;
    this.assessment = null;
    this.cfsLevel = null;
    this.currentStepIndex = 0;
    this.error = null;
    this.partialAnalysis = {};
    this.triageResult = null;
  }
}

export const assessmentStore = new AssessmentStore();
