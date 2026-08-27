export interface FullPageTranslationProgress {
  sessionId: number;
  active: boolean;
  running: number;
  remaining: number;
  queued: number;
  offscreen: number;
}

type FullPageTranslationProgressListener = (progress: FullPageTranslationProgress) => void;

const listeners = new Set<FullPageTranslationProgressListener>();
let nextSessionId = 0;
let progress: FullPageTranslationProgress = {
  sessionId: 0,
  active: false,
  running: 0,
  remaining: 0,
  queued: 0,
  offscreen: 0,
};

function cloneProgress(): FullPageTranslationProgress {
  return {...progress};
}

function deliverProgress(listener: FullPageTranslationProgressListener): void {
  try {
    // 每个订阅者都获得独立快照，一个 UI 的误修改或异常不会污染其他 UI。
    listener(cloneProgress());
  } catch (error) {
    console.error('[FluentRead] 全文翻译进度订阅者执行失败', error);
  }
}

function notifyProgressListeners(): void {
  listeners.forEach(deliverProgress);
}

function normalizeCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

export function startFullPageTranslationProgress(): number {
  const sessionId = ++nextSessionId;
  progress = {
    sessionId,
    active: true,
    running: 0,
    remaining: 0,
    queued: 0,
    offscreen: 0,
  };
  notifyProgressListeners();
  return sessionId;
}

export function updateFullPageTranslationProgress(
  sessionId: number,
  value: Pick<FullPageTranslationProgress, 'running' | 'queued' | 'offscreen'>,
): void {
  if (!progress.active || progress.sessionId !== sessionId) return;

  const running = normalizeCount(value.running);
  const queued = normalizeCount(value.queued);
  const offscreen = normalizeCount(value.offscreen);
  const remaining = queued + offscreen;
  if (
    progress.running === running &&
    progress.remaining === remaining &&
    progress.queued === queued &&
    progress.offscreen === offscreen
  ) return;

  progress = {...progress, running, remaining, queued, offscreen};
  notifyProgressListeners();
}

export function finishFullPageTranslationProgress(sessionId: number): void {
  if (!progress.active || progress.sessionId !== sessionId) return;
  progress = {
    sessionId,
    active: false,
    running: 0,
    remaining: 0,
    queued: 0,
    offscreen: 0,
  };
  notifyProgressListeners();
}

export function getFullPageTranslationProgress(): FullPageTranslationProgress {
  return cloneProgress();
}

export function subscribeFullPageTranslationProgress(
  listener: FullPageTranslationProgressListener,
): () => void {
  listeners.add(listener);
  deliverProgress(listener);
  return () => {
    listeners.delete(listener);
  };
}
