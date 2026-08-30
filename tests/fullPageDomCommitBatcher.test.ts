import {afterEach, describe, expect, it, vi} from 'vitest';
import {DomCommitBatcher} from '@/src/features/full-page-translation/content/domCommitBatcher';

describe('全文翻译 DOM commit batcher', () => {
    afterEach(() => vi.useRealTimers());

    const timers = {
        setTimeout: (callback: () => void, delay?: number) =>
            globalThis.setTimeout(callback, delay) as unknown as number,
        clearTimeout: (timer: number) => globalThis.clearTimeout(timer),
    } as Pick<Window, 'setTimeout' | 'clearTimeout'>;

    it('commits several results inside one observer boundary', async () => {
        vi.useFakeTimers();
        const boundaries: string[] = [];
        const batcher = new DomCommitBatcher(timers, (commit) => {
            boundaries.push('pause');
            commit();
            boundaries.push('resume');
        });

        const first = batcher.enqueue(() => {
            boundaries.push('first');
            return 1;
        });
        const second = batcher.enqueue(() => {
            boundaries.push('second');
            return 2;
        });
        await vi.advanceTimersByTimeAsync(25);

        await expect(first).resolves.toBe(1);
        await expect(second).resolves.toBe(2);
        expect(boundaries).toEqual(['pause', 'first', 'second', 'resume']);
    });

    it('rejects queued writes when the session is disposed', async () => {
        vi.useFakeTimers();
        const batcher = new DomCommitBatcher(timers, (commit) => commit());
        const pending = batcher.enqueue(() => 'late');
        batcher.dispose();

        await expect(pending).rejects.toMatchObject({name: 'AbortError'});
    });
});
