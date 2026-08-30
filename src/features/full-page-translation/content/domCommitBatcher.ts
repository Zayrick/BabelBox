interface PendingCommit {
    run: () => unknown;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
    settled: boolean;
}

type TimerHost = Pick<Window, 'setTimeout' | 'clearTimeout'>;
type BatchBoundary = (commit: () => void) => void;

/**
 * Coalesces provider completions so one observer pause can cover several DOM
 * writes. Each commit remains isolated: one renderer failure cannot drop the
 * other projections in the same batch.
 */
export class DomCommitBatcher {
    private readonly pending: PendingCommit[] = [];
    private timer: number | null = null;
    private disposed = false;

    constructor(
        private readonly timers: TimerHost,
        private readonly runBatch: BatchBoundary,
        private readonly intervalMs = 25,
    ) {}

    enqueue<T>(run: () => T): Promise<T> {
        if (this.disposed) return Promise.reject(new DOMException('翻译会话已结束', 'AbortError'));
        return new Promise<T>((resolve, reject) => {
            this.pending.push({
                run,
                resolve: (value) => resolve(value as T),
                reject,
                settled: false,
            });
            if (this.timer !== null) return;
            this.timer = this.timers.setTimeout(() => this.flush(), this.intervalMs);
        });
    }

    dispose(reason: unknown = new DOMException('翻译会话已结束', 'AbortError')): void {
        if (this.disposed) return;
        this.disposed = true;
        if (this.timer !== null) this.timers.clearTimeout(this.timer);
        this.timer = null;
        this.pending.splice(0).forEach((entry) => entry.reject(reason));
    }

    private flush(): void {
        this.timer = null;
        if (this.disposed || this.pending.length === 0) return;
        const entries = this.pending.splice(0);
        try {
            this.runBatch(() => {
                for (const entry of entries) {
                    try {
                        const value = entry.run();
                        entry.settled = true;
                        entry.resolve(value);
                    } catch (error) {
                        entry.settled = true;
                        entry.reject(error);
                    }
                }
            });
        } catch (error) {
            entries.forEach((entry) => {
                if (!entry.settled) entry.reject(error);
            });
        }
    }
}
