import { reactive } from 'vue';

export type ActionFeedbackTone = 'success' | 'error';

export interface ActionFeedback {
  message: string;
  tone: ActionFeedbackTone;
}

/** 管理按钮内的短暂操作反馈，并在 popup 关闭时释放所有计时器。 */
export function useActionFeedback<Target extends string>(duration = 2200) {
  const feedbacks = reactive({}) as Partial<Record<Target, ActionFeedback>>;
  const timers = new Map<Target, ReturnType<typeof setTimeout>>();

  function clear(target: Target) {
    const timer = timers.get(target);
    if (timer) clearTimeout(timer);
    timers.delete(target);
    delete feedbacks[target];
  }

  function show(target: Target, message: string, tone: ActionFeedbackTone = 'success') {
    clear(target);
    feedbacks[target] = { message, tone };
    timers.set(target, setTimeout(() => clear(target), duration));
  }

  function dispose() {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  }

  return { feedbacks, show, clear, dispose };
}
