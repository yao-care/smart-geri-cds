import Dexie, { type Table } from 'dexie';
import type { RiskLevel } from '../utils/risk-levels';
import type { CfsLevel } from '../utils/cfs-levels';
import type { ScaleResult } from '../scales/scale';

export type { RiskLevel };
export type AlertStatus = 'open' | 'acknowledged' | 'false_positive' | 'resolved';

export interface Patient {
  id: string;              // FHIR Patient ID
  name?: string;
  birthDate: string;
  gender: 'male' | 'female';
  ageGroup: 'infant' | 'toddler' | 'preschool';
  currentRiskLevel: RiskLevel;
  lastSyncedAt: Date;
}

export interface Observation {
  id: string;              // FHIR Observation ID
  patientId: string;
  indicator: string;       // LOINC code
  value: number;
  unit: string;
  effectiveDateTime: Date;
  syncedAt: Date;
}

export interface Alert {
  id: string;              // local UUID
  patientId: string;
  riskLevel: RiskLevel;
  status: AlertStatus;
  indicators: string[];    // triggered indicators
  rationale: string;
  ruleVersion: string;
  modelVersion?: string;
  inputSnapshot: object;   // complete decision trace
  fhirRiskAssessmentId?: string;
  educationRecommended?: string[];
  educationTriggeredAt?: Date;
  acknowledgedBy?: string;
  notes?: string;
  parentAlertId?: string;
  createdAt: Date;
  closedAt?: Date;
}

export interface Baseline {
  patientId: string;
  indicator: string;
  mean: number;
  std: number;
  sampleCount: number;
  updatedAt: Date;
}

export interface SyncQueueItem {
  id: string;
  action: 'create' | 'update';
  resourceType: string;
  payload: object;
  createdAt: Date;
  retryCount: number;
}

export interface ServerConfig {
  id: string;
  name: string;
  fhirBaseUrl: string;
  clientId: string;
  scopes: string;
  lastUsedAt: Date;
}

export interface EducationInteraction {
  id: string;
  contentSlug: string;
  action: 'view' | 'complete' | 'questionnaire_submit';
  durationSeconds?: number;
  questionnaireAnswers?: object;
  createdAt: Date;
}

export interface RuleVersion {
  id: string;
  yamlContent: string;
  changedBy: string;
  changeReason: string;
  createdAt: Date;
}

export interface WebhookHistoryEntry {
  id: string;
  webhookId: string;
  alertId: string;
  url: string;
  status: 'success' | 'failed';
  statusCode?: number;
  createdAt: Date;
}

export type AssessmentStatus = 'started' | 'paused' | 'resumed' | 'completed' | 'incomplete';

export interface Child {
  id: string;
  birthDate: string;
  gender: 'male' | 'female' | 'other';
  nickName?: string;
  createdAt: Date;
}

/**
 * 各模組即時產出的分析結果（純問卷版只有問卷分數）。
 * 持久化於 Assessment 上，供 resume 還原作答進度（避免重答）。
 */
export interface PartialAnalysis {
  /** scaleId → 累計原始分。 */
  questionnaireScores?: Record<string, number>;
  /** 同 key 的最大可能分，供正規化。 */
  questionnaireMaxScores?: Record<string, number>;
  /** 已完整計分的 ScaleResult（計時任務 / 其 fallback），keyed by 量表 id。 */
  scaleResults?: Record<string, ScaleResult>;
}

export interface Assessment {
  id: string;
  childId: string;
  /** 分層軸：入口 gate 判定的 CFS 等級（取代兒科 ageGroup）。 */
  cfsLevel: CfsLevel;
  /** 是否有熟悉受測者日常的家屬／照顧者可提供資訊。SOP 真相：gate ask-informant 量表
   *  （無→incomplete），並決定認知用 AD8（有）或 Mini-Cog（無）。
   *  舊紀錄（pre-v5）缺欄 → resume 時退回預設（true，保守地保留 AD8/知情者題）。 */
  informantAvailable?: boolean;
  /** 受測者本人能否參與作答/受測。否則 requiresPatient（認知/情緒）量表標 incomplete
   *  「需受測者本人，建議由專業評估」。舊紀錄缺欄 → 退回預設（true）。 */
  patientAble?: boolean;
  status: AssessmentStatus;
  language: string;
  currentStep: number;
  startedAt: Date;
  completedAt?: Date;
  pausedAt?: Date;
  /** 進行中的問卷作答進度快照（per-scale 分數 + 計時任務 ScaleResult）。
   *  resume 時還原，使暫停後續評不需重答。完成後仍保留以利除錯，不影響結果計算。 */
  partialAnalysis?: PartialAnalysis;
  triageResult?: {
    /** 整體分流＝取最嚴重領域（含 incomplete）。 */
    category: 'normal' | 'monitor' | 'refer' | 'incomplete';
    summary: string;
    /** Per-scale breakdown. Populated by the parent flow so the standalone
     *  /result/?id= page can render the radar without recomputing triage.
     *  Older records won't have it; UI falls back to a summary-only view. */
    details?: ScaleResult[];
  };
  fhirSubmitted: boolean;
  fhirDiagnosticReportId?: string;
  /** GCM（或其他 redirect 型收案機構）回傳的病例唯一碼（收案編號）。 */
  gcmCaseId?: string;
  physicianNote?: string | null;
  physicianNoteUpdatedAt?: Date | null;
  /** Origin of the record. Undefined / 'idb' = produced on this device.
   *  'fhir-cache' = pulled from FHIR server by the cross-device resolver and cached locally. */
  _source?: 'idb' | 'fhir-cache';
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

/**
 * Locally-stored recording of a self-administered timed mobility task
 * (e.g. Five-Times Sit-to-Stand). The Blob lives ONLY in this browser's
 * IndexedDB for clinician review — it is never uploaded, never placed in the
 * PDF, and never logged. One row per completed timed-task run.
 */
export interface MobilityRecording {
  id: string;               // local UUID
  assessmentId: string;
  scaleId: string;          // e.g. 'sit-to-stand'
  blob: Blob;               // recorded video (MediaRecorder output)
  mimeType: string;         // e.g. 'video/webm'
  durationSec: number;      // elapsed seconds (start→finish click)
  createdAt: Date;
}

export interface CustomEducation {
  id: string;
  tenantId: string;         // derived from FHIR base URL
  title: string;
  summary: string;
  category: string;
  ageGroup: string[];       // ['infant', 'toddler', 'preschool']
  format: 'article' | 'video';
  content: string;          // Markdown content for articles
  videoUrl?: string;        // YouTube URL for videos
  triggerIndicators: string[];
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface TenantSettings {
  id: string;               // tenantId
  tenantId: string;
  displayName: string;
  pollingInterval: number;
  advisoryBatchInterval: number;
  browserNotifications: boolean;
  soundEnabled: boolean;
  alertAfterHours: number;
  customRulesYaml?: string;  // tenant-specific YAML rules override
  updatedAt: Date;
}

/** Triage category × domain recommendation overlay (one row per cell). */
export type RecommendationCategory = 'normal' | 'monitor' | 'refer';
export type RecommendationSource = 'internal' | 'custom' | 'external';

export interface RecommendationItem {
  source: RecommendationSource;
  /** For source: 'internal' — slug under /education/{slug}/ */
  slug?: string;
  /** For source: 'custom' — id of a CustomEducation row */
  customId?: string;
  /** For source: 'external' — full URL (e.g. YouTube, hospital page) */
  url?: string;
  /** Display title; required for external, optional for internal/custom (falls back to source content) */
  title?: string;
  /** Display summary (one-liner) */
  summary?: string;
}

export interface RecommendationOverlay {
  /** Composite id: `${tenantId}::${category}::${domain}` */
  id: string;
  tenantId: string;
  category: RecommendationCategory;
  domain: string;
  items: RecommendationItem[];
  /** When true, items are appended to the default list; when false, items replace the default. */
  mergeWithDefault: boolean;
  updatedAt: Date;
}

export class CdssDatabase extends Dexie {
  patients!: Table<Patient>;
  observations!: Table<Observation>;
  alerts!: Table<Alert>;
  baselines!: Table<Baseline>;
  syncQueue!: Table<SyncQueueItem>;
  serverConfigs!: Table<ServerConfig>;
  educationInteractions!: Table<EducationInteraction>;
  ruleVersions!: Table<RuleVersion>;
  webhookHistory!: Table<WebhookHistoryEntry>;
  children!: Table<Child>;
  assessments!: Table<Assessment>;
  assessmentEvents!: Table<AssessmentEvent>;
  mediaFiles!: Table<MediaFile>;
  customEducation!: Table<CustomEducation>;
  tenantSettings!: Table<TenantSettings>;
  recommendationOverlays!: Table<RecommendationOverlay>;
  mobilityRecordings!: Table<MobilityRecording>;

  constructor() {
    // smart-geri-cds 為全新 DB 名（刻意不遷兒科資料），版本鏈重置為乾淨 v1。
    // 移除 normThresholds 表/index；assessments 沿用既有 index（cfsLevel 非索引欄）。
    super('smart-geri-cds');
    this.version(1).stores({
      patients: 'id, ageGroup, currentRiskLevel, lastSyncedAt',
      observations: 'id, patientId, indicator, effectiveDateTime, [patientId+indicator]',
      alerts: 'id, patientId, riskLevel, status, createdAt, [patientId+status]',
      baselines: '[patientId+indicator], patientId, updatedAt',
      syncQueue: 'id, createdAt',
      serverConfigs: 'id, lastUsedAt',
      educationInteractions: 'id, contentSlug, createdAt',
      ruleVersions: 'id, createdAt',
      webhookHistory: 'id, webhookId, alertId, createdAt',
      children: 'id, createdAt',
      assessments: 'id, childId, status, createdAt, [childId+status]',
      assessmentEvents: 'id, assessmentId, childId, moduleType, timestamp, [assessmentId+moduleType]',
      mediaFiles: 'id, assessmentId, childId, fileType, createdAt, [assessmentId+fileType]',
      customEducation: 'id, tenantId, category, isActive, [tenantId+isActive]',
      tenantSettings: 'id, tenantId',
      recommendationOverlays: 'id, tenantId, category, domain, [tenantId+category+domain]',
    });
    // v2：新增 mobilityRecordings（本機端坐立測試錄影 Blob）。乾淨 DB；index 僅查詢用，
    //   blob/mimeType/durationSec 為非索引欄。BroadcastChannel/sync 不涉及此表（永不上傳）。
    this.version(2).stores({
      mobilityRecordings: 'id, assessmentId, scaleId, createdAt, [assessmentId+scaleId]',
    });
    // v3：assessments 新增非索引欄 partialAnalysis（問卷作答進度快照，供 resume 還原）。
    //   非索引欄不需改 stores()；以空 .stores({}) 標記版本，向後相容（舊紀錄缺欄→undefined）。
    this.version(3).stores({});
    // v4：assessments 新增非索引欄 operator（操作者身分，供操作者效度閘門 C-M6 與報告標示）。
    //   非索引欄不需改 stores()；以空 .stores({}) 標記版本，向後相容（舊紀錄缺欄→undefined）。
    this.version(4).stores({});
    // v5：SOP 模型重構——以 informantAvailable + patientAble（在場/可參與）取代 operator。
    //   皆為非索引欄，不需改 stores()；以空 .stores({}) 標記版本。乾淨 DB OK；
    //   舊紀錄（pre-v5）缺新欄 → resume 退回保守預設（informantAvailable=true、patientAble=true）。
    this.version(5).stores({});
  }
}

export const db = new CdssDatabase();
