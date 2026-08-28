import { describe, expect, it, vi } from 'vitest';
import { useActionFeedback } from '@/src/app/popup/actionFeedback';

describe('popup button action feedback', () => {
  it('shows feedback beside its action and restores the original state after reading time', () => {
    vi.useFakeTimers();
    const feedback = useActionFeedback<'translate' | 'cache'>(2200);

    feedback.show('translate', '已恢复原文');
    feedback.show('cache', '清除成功');
    expect(feedback.feedbacks.translate).toEqual({ message: '已恢复原文', tone: 'success' });
    expect(feedback.feedbacks.cache).toEqual({ message: '清除成功', tone: 'success' });

    vi.advanceTimersByTime(2199);
    expect(feedback.feedbacks.translate?.message).toBe('已恢复原文');
    vi.advanceTimersByTime(1);
    expect(feedback.feedbacks.translate).toBeUndefined();
    expect(feedback.feedbacks.cache).toBeUndefined();
    vi.useRealTimers();
  });

  it('restarts the reading time when the same action reports again', () => {
    vi.useFakeTimers();
    const feedback = useActionFeedback<'cache'>(2200);

    feedback.show('cache', '清除失败，请重试', 'error');
    vi.advanceTimersByTime(1200);
    feedback.show('cache', '清除成功');
    vi.advanceTimersByTime(1200);
    expect(feedback.feedbacks.cache).toEqual({ message: '清除成功', tone: 'success' });

    feedback.dispose();
    vi.runAllTimers();
    expect(feedback.feedbacks.cache?.message).toBe('清除成功');
    vi.useRealTimers();
  });
});
