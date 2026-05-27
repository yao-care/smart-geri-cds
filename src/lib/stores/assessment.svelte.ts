import type { Assessment, Child, PartialAnalysis } from '../db/schema';
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

/** 各模組即時產出的分析結果（持久化於 Assessment，供 resume 還原）。
 *  ResultView 對 scaleResults 的 id 直接採用其結果，不再以 questionnaireScores 重算
 *  （因 fallback / 無法完成 等情境的 rawScore↔severity 對應無法用單一量表的 bands 重建）。 */
export type { PartialAnalysis };

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

    // 持久化作答進度快照，供 resume 還原（避免重答）。非阻塞、失敗不影響流程。
    // 此處讀回合併後的完整快照（含先前領域），而非僅 partial，確保 DB 與記憶體一致。
    // 用 $state.snapshot 去除 runes proxy，否則無法通過 structured clone 寫入 IndexedDB。
    if (this.assessment) {
      const snapshot = $state.snapshot(this.partialAnalysis) as PartialAnalysis;
      void assessmentDao
        .updateAssessmentPartialAnalysis(this.assessment.id, snapshot)
        .catch(() => {
          // 本機快照寫入失敗不可阻斷評估；resume 時退回從頭作答。
        });
    }
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
      // 還原問卷作答進度快照（per-scale 分數 + 計時任務 ScaleResult）。
      // 計時任務的 mobilityRecordings Blob 另存於 IndexedDB（keyed by assessmentId）；
      // 此處還原其 scaleResult，使其結果不因 resume 遺失。舊紀錄缺欄 → 退回空物件。
      this.partialAnalysis = assessment.partialAnalysis ?? {};
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
      // 暫停時再寫一次作答進度快照（防 addAnalysis 的非阻塞寫入尚未落地）。
      // $state.snapshot 去除 proxy，確保可通過 structured clone 寫入 IndexedDB。
      const snapshot = $state.snapshot(this.partialAnalysis) as PartialAnalysis;
      await assessmentDao.updateAssessmentPartialAnalysis(this.assessment.id, snapshot);
      await assessmentDao.updateAssessmentStatus(this.assessment.id, 'paused');
      this.assessment = { ...this.assessment, status: 'paused', partialAnalysis: snapshot };
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
