/** 创建保留调用方 `this` 与参数类型的前缘节流函数。 */
export function throttle<TThis, TArgs extends unknown[]>(
    fn: (this: TThis, ...args: TArgs) => void,
    intervalMs: number,
): (this: TThis, ...args: TArgs) => void {
    let lastRunAt = 0;

    return function throttled(this: TThis, ...args: TArgs): void {
        const now = Date.now();
        if (now - lastRunAt < intervalMs) return;

        // 先更新窗口，再调用目标函数，避免目标函数同步重入绕过节流。
        lastRunAt = now;
        fn.apply(this, args);
    };
}
