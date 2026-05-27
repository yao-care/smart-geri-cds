<script lang="ts">
  import { scoreScale, type ScaleDef, type ScaleResult } from '../../lib/scales/scale';
  import { saveMobilityRecording } from '../../lib/db/mobility-recordings';
  import { domainLabel } from '../../lib/domain/domain-tree';

  interface Props {
    /** The timed-task scale (e.g. sit-to-stand). */
    scale: ScaleDef;
    /** Self-report scale used when the camera path can't run. */
    fallbackScale: ScaleDef;
    /** Called once with the uniform ScaleResult (timed or fallback path). */
    onResult: (result: ScaleResult) => void;
    /** For persisting the recording locally; omitted in tests. */
    assessmentId?: string;
  }

  let { scale, fallbackScale, onResult, assessmentId }: Props = $props();

  // detecting → ready (camera ok) → recording → done
  //           → fallback (no camera / denied / user opts out)
  type Mode = 'detecting' | 'ready' | 'recording' | 'fallback' | 'done';
  let mode = $state<Mode>('detecting');
  let cameraError = $state<string | null>(null);

  // --- timing ---
  let startMs = $state(0);
  let nowMs = $state(0);
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  const elapsedSec = $derived(mode === 'recording' ? Math.round((nowMs - startMs) / 1000) : 0);

  // --- media ---
  let videoEl = $state<HTMLVideoElement | null>(null);
  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: Blob[] = [];

  const domain = $derived(domainLabel(scale.domain.top, scale.domain.sub));

  /** Browser/jsdom-safe feature detection. SSR & jsdom lack these APIs. */
  function cameraSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices &&
      typeof navigator.mediaDevices.getUserMedia === 'function' &&
      typeof window !== 'undefined' &&
      typeof window.MediaRecorder === 'function'
    );
  }

  // Decide the path once, on mount (client only).
  $effect(() => {
    if (mode !== 'detecting') return;
    if (!cameraSupported()) {
      mode = 'fallback';
      return;
    }
    void requestCamera();
  });

  async function requestCamera(): Promise<void> {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoEl) {
        videoEl.srcObject = stream;
        await videoEl.play().catch(() => {});
      }
      mode = 'ready';
    } catch {
      // Permission denied or no device → graceful fallback, never stuck.
      cameraError = '無法存取相機';
      mode = 'fallback';
    }
  }

  // When the <video> element binds after mode becomes ready, attach the stream.
  $effect(() => {
    if (videoEl && stream && !videoEl.srcObject) {
      videoEl.srcObject = stream;
      void videoEl.play().catch(() => {});
    }
  });

  function pickMimeType(): string {
    const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    for (const t of candidates) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(t)) return t;
    }
    return 'video/webm';
  }

  function handleStart(): void {
    if (mode !== 'ready' || !stream) return;
    chunks = [];
    const mimeType = pickMimeType();
    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch {
      recorder = new MediaRecorder(stream);
    }
    recorder.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };
    recorder.start();
    startMs = Date.now();
    nowMs = startMs;
    tickTimer = setInterval(() => { nowMs = Date.now(); }, 250);
    mode = 'recording';
  }

  function stopTracks(): void {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  }

  /** Finish: stop recorder, compute elapsed, score, persist blob, emit. */
  async function handleFinish(): Promise<void> {
    if (mode !== 'recording') return;
    const seconds = Math.max(1, Math.round((Date.now() - startMs) / 1000));
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    mode = 'done';

    const mimeType = recorder?.mimeType || pickMimeType();
    const blob = await stopRecorder(mimeType);
    stopTracks();

    if (blob && assessmentId) {
      try {
        await saveMobilityRecording({
          assessmentId,
          scaleId: scale.id,
          blob,
          mimeType,
          durationSec: seconds,
        });
      } catch {
        // Local-only persistence failure must not block the assessment result.
      }
    }

    onResult(scoreScale(scale, seconds));
  }

  /** Resolve the recorded Blob once MediaRecorder flushes its final chunk. */
  function stopRecorder(mimeType: string): Promise<Blob | null> {
    return new Promise(resolve => {
      if (!recorder || recorder.state === 'inactive') {
        resolve(chunks.length ? new Blob(chunks, { type: mimeType }) : null);
        return;
      }
      recorder.onstop = () => {
        resolve(chunks.length ? new Blob(chunks, { type: mimeType }) : null);
      };
      recorder.stop();
    });
  }

  /** Could not complete the standing task → refer (no recording kept). */
  function handleCannotComplete(): void {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    mode = 'done';
    stopRecorder(recorder?.mimeType || pickMimeType()).catch(() => {});
    stopTracks();
    onResult({
      scaleId: scale.id,
      domain: scale.domain,
      rawScore: null,
      maxScore: scale.maxScore,
      severity: 'refer',
      bandLabel: '無法完成站立，建議評估',
    });
  }

  /** User opts out of recording → switch to the self-report fallback. */
  function switchToFallback(): void {
    stopTracks();
    mode = 'fallback';
  }

  // ---- fallback self-report ----
  let fbIndex = $state(0);
  let fbAnswers = $state<Record<string, number>>({});
  const fbItem = $derived(fallbackScale.items[fbIndex] ?? null);

  function answerFallback(score: number): void {
    if (!fbItem) return;
    fbAnswers = { ...fbAnswers, [fbItem.id]: score };
    if (fbIndex < fallbackScale.items.length - 1) {
      fbIndex++;
    } else {
      const total = fallbackScale.items.reduce((sum, it) => sum + (fbAnswers[it.id] ?? 0), 0);
      mode = 'done';
      onResult(scoreScale(fallbackScale, total));
    }
  }
</script>

<div class="mobility-task">
  <div class="domain-badge">{domain}</div>

  {#if mode === 'detecting'}
    <p class="status">正在準備相機…</p>

  {:else if mode === 'ready' || mode === 'recording'}
    <h2 class="task-title">坐立測試</h2>
    <p class="instructions">
      請坐在椅子上、雙手抱胸。點「開始」後，盡量快地連續做 5 次「完全站起來再坐下」，
      做完第 5 次坐下後點「完成」。
    </p>

    <!-- svelte-ignore a11y_media_has_caption -->
    <video class="preview" bind:this={videoEl} muted playsinline></video>

    <p class="privacy" role="note">
      錄影僅儲存在本機瀏覽器，供臨床檢視，不會上傳。
    </p>

    {#if mode === 'recording'}
      <div class="timer" aria-live="polite">已進行 {elapsedSec} 秒</div>
      <div class="actions">
        <button class="btn-primary" onclick={handleFinish}>完成</button>
        <button class="btn-ghost" onclick={handleCannotComplete}>無法完成</button>
      </div>
    {:else}
      <div class="actions">
        <button class="btn-primary" onclick={handleStart}>開始</button>
        <button class="btn-ghost" onclick={switchToFallback}>無法錄影或不便</button>
      </div>
    {/if}

  {:else if mode === 'fallback'}
    <h2 class="task-title">行動能力自述</h2>
    {#if cameraError}
      <p class="fallback-note">{cameraError}，改以幾個問題了解您的行動能力。</p>
    {:else}
      <p class="fallback-note">改以幾個問題了解您的行動能力。</p>
    {/if}

    {#if fbItem}
      <p class="fb-progress">第 {fbIndex + 1} 題，共 {fallbackScale.items.length} 題</p>
      <h3 class="question-text">{fbItem.text}</h3>
      <div class="options-list">
        {#each fbItem.options as opt (opt.label)}
          <button class="option-btn" data-score={opt.score} onclick={() => answerFallback(opt.score)}>
            {opt.label}
          </button>
        {/each}
      </div>
    {/if}

  {:else}
    <p class="status">已記錄結果。</p>
  {/if}
</div>

<style>
  .mobility-task {
    max-width: 560px;
    margin: 0 auto;
    padding: var(--space-6);
  }

  .domain-badge {
    display: inline-block;
    padding: var(--space-1) var(--space-3);
    background: color-mix(in srgb, var(--warn) 12%, var(--bg));
    color: var(--warn);
    border-radius: var(--radius-full);
    font-size: var(--text-xs);
    font-weight: var(--font-medium);
    margin-bottom: var(--space-4);
  }

  .task-title {
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
    margin-bottom: var(--space-3);
    color: var(--text);
  }

  .instructions,
  .fallback-note {
    font-size: var(--text-base);
    line-height: var(--lh-base);
    color: var(--text);
    margin-bottom: var(--space-4);
  }

  .preview {
    width: 100%;
    max-height: 320px;
    background: color-mix(in srgb, var(--bg), var(--text) 8%);
    border-radius: var(--radius-lg);
    border: 1px solid var(--line);
    margin-bottom: var(--space-3);
    transform: scaleX(-1); /* mirror so the person sees a natural self-view */
  }

  .privacy {
    font-size: var(--text-xs);
    color: color-mix(in srgb, var(--text), var(--bg) 25%);
    margin-bottom: var(--space-4);
  }

  .timer {
    font-size: var(--text-2xl);
    font-weight: var(--font-bold);
    color: var(--accent);
    text-align: center;
    margin-bottom: var(--space-4);
  }

  .actions {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .btn-primary {
    width: 100%;
    min-height: 56px;
    padding: var(--space-4);
    background: var(--accent);
    color: white;
    border: none;
    border-radius: var(--radius-md);
    font-size: var(--text-lg);
    font-weight: var(--font-bold);
    cursor: pointer;
  }

  .btn-primary:hover {
    background: color-mix(in srgb, var(--accent) 85%, black);
  }

  .btn-ghost {
    width: 100%;
    min-height: 44px;
    padding: var(--space-3);
    background: var(--surface);
    color: color-mix(in srgb, var(--text), var(--bg) 20%);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .btn-ghost:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .status {
    font-size: var(--text-base);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    text-align: center;
    padding: var(--space-6);
  }

  .fb-progress {
    font-size: var(--text-xs);
    color: color-mix(in srgb, var(--text), var(--bg) 30%);
    margin-bottom: var(--space-2);
  }

  .question-text {
    font-size: var(--text-xl);
    font-weight: var(--font-bold);
    line-height: var(--lh-xl);
    margin-bottom: var(--space-5);
    color: var(--text);
  }

  .options-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .option-btn {
    width: 100%;
    min-height: 64px;
    padding: var(--space-4) var(--space-5);
    background: var(--surface);
    border: 2px solid var(--line);
    border-radius: var(--radius-lg);
    font-size: var(--text-base);
    font-weight: var(--font-medium);
    color: var(--text);
    cursor: pointer;
    text-align: left;
    line-height: var(--lh-base);
  }

  .option-btn:hover {
    border-color: var(--accent);
    background: var(--bg);
  }
</style>
