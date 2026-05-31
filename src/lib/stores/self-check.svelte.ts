import type { SelfCheckScale, SelfCheckItem, SelfCheckAnswers } from '$lib/self-check/self-check';
import { summariseSelfCheck, type SelfCheckSummary } from '$lib/self-check/summarise';

export type SelfCheckStep = 'intro' | 'screening' | 'summary';

interface QueueEntry { item: SelfCheckItem; scaleId: string; }

/**
 * 民眾自評步驟機（Svelte 5 runes）。純記憶體：不寫 IndexedDB
 * （一次性 2–3 分鐘快測，重整即重來，承 spec 非目標）。
 *
 * scales/queue 宣告為 $state（初值空陣列），constructor 立即填值，
 * 確保 $derived 的 class-field 初始化器在 TS 視角不違反 TS2729
 * （"used before initialization"）。功能與 readonly 等效，因 reset()
 * 不會清除它們。
 */
export class SelfCheckStore {
  // $state fields initialised to [] so $derived initialisers below can safely
  // reference them — TS sees them as initialised at field declaration.
  scales = $state<SelfCheckScale[]>([]);
  private queue = $state<QueueEntry[]>([]);

  step = $state<SelfCheckStep>('intro');
  index = $state(0);
  answers = $state<SelfCheckAnswers>({});

  currentItem = $derived(this.queue[this.index]?.item ?? null);
  progress = $derived(this.totalQuestions > 0 ? this.index / this.totalQuestions : 0);

  /** 已答之 redFlag 題是否有正分（自傷念頭）。驅動作答頁安全提示。 */
  redFlagActive = $derived(
    this.queue.some(q => q.item.redFlag === 'self-harm' && (this.answers[q.item.id] ?? 0) > 0),
  );

  summary = $derived<SelfCheckSummary>(summariseSelfCheck(this.scales, this.answers));

  constructor(scales: SelfCheckScale[]) {
    this.scales = scales;
    this.queue = scales.flatMap(sc => sc.items.map(item => ({ item, scaleId: sc.id })));
  }

  get totalQuestions(): number { return this.queue.length; }

  start(): void {
    this.step = 'screening';
    this.index = 0;
  }

  /** 記錄當前題分數並前進；最後一題後 → summary。 */
  answer(score: number): void {
    const entry = this.queue[this.index];
    if (!entry) return;
    this.answers = { ...this.answers, [entry.item.id]: score };
    if (this.index < this.queue.length - 1) {
      this.index++;
    } else {
      this.step = 'summary';
    }
  }

  back(): void {
    if (this.index > 0) this.index--;
  }

  reset(): void {
    this.step = 'intro';
    this.index = 0;
    this.answers = {};
  }
}
