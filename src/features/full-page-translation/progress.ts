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
  listener(cloneProgress());
}

function notifyProgressListeners(): void {
  listeners.forEach(deliverProgress);
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

  const {running, queued, offscreen} = value;
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
