import {afterEach, describe, expect, it, vi} from 'vitest';

import {
  finishFullPageTranslationProgress,
  getFullPageTranslationProgress,
  startFullPageTranslationProgress,
  subscribeFullPageTranslationProgress,
  updateFullPageTranslationProgress,
} from '@/src/features/full-page-translation/progress';

afterEach(() => {
  const current = getFullPageTranslationProgress();
  if (current.active) finishFullPageTranslationProgress(current.sessionId);
});

describe('全文翻译进度', () => {
  it('立即提供快照，并发布进行中、队列与离屏任务数量', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFullPageTranslationProgress(listener);
    const sessionId = startFullPageTranslationProgress();

    updateFullPageTranslationProgress(sessionId, {
      running: 3,
      queued: 4,
      offscreen: 7,
    });

    expect(listener).toHaveBeenLastCalledWith({
      sessionId,
      active: true,
      running: 3,
      remaining: 11,
      queued: 4,
      offscreen: 7,
    });
    expect(getFullPageTranslationProgress()).toEqual(listener.mock.lastCall?.[0]);
    unsubscribe();
  });

  it('忽略旧会话的迟到更新和结束通知', () => {
    const staleSessionId = startFullPageTranslationProgress();
    const currentSessionId = startFullPageTranslationProgress();

    updateFullPageTranslationProgress(staleSessionId, {running: 99, queued: 99, offscreen: 99});
    finishFullPageTranslationProgress(staleSessionId);

    expect(getFullPageTranslationProgress()).toEqual({
      sessionId: currentSessionId,
      active: true,
      running: 0,
      remaining: 0,
      queued: 0,
      offscreen: 0,
    });
  });

  it('结束当前会话时清零计数并通知订阅者', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFullPageTranslationProgress(listener);
    const sessionId = startFullPageTranslationProgress();
    updateFullPageTranslationProgress(sessionId, {running: 2, queued: 1, offscreen: 5});

    finishFullPageTranslationProgress(sessionId);

    expect(listener).toHaveBeenLastCalledWith({
      sessionId,
      active: false,
      running: 0,
      remaining: 0,
      queued: 0,
      offscreen: 0,
    });
    unsubscribe();
  });

});
