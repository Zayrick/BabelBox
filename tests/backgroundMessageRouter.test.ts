import {describe, expect, it, vi} from 'vitest';
import {
    createBackgroundMessageRouter,
    type BackgroundMessageHandler,
} from '@/src/platform/browser/messageRouter';

interface TestContext {
    prefix: string;
}

describe('background message router', () => {
    it('dispatches registered handlers and leaves unknown messages unhandled', async () => {
        const handler: BackgroundMessageHandler<TestContext> = {
            type: 'known',
            handle: (message, context) => `${context.prefix}:${message.type}`,
        };
        const router = createBackgroundMessageRouter([handler]);

        await expect(router.dispatch({type: 'known'}, {prefix: 'ctx'})).resolves.toEqual({
            handled: true,
            response: 'ctx:known',
        });
        await expect(router.dispatch({type: 'unknown'}, {prefix: 'ctx'})).resolves.toEqual({handled: false});
        await expect(router.dispatch({type: 42}, {prefix: 'ctx'})).resolves.toEqual({handled: false});
        await expect(router.dispatch(null, {prefix: 'ctx'})).resolves.toEqual({handled: false});
    });

    it('rejects duplicate registrations and preserves handler errors', async () => {
        expect(() => createBackgroundMessageRouter<TestContext>([
            {type: 'duplicate', handle: vi.fn()},
            {type: 'duplicate', handle: vi.fn()},
        ])).toThrow('后台消息处理器重复注册: duplicate');

        const error = new Error('handler failed');
        const router = createBackgroundMessageRouter<TestContext>([
            {type: 'broken', handle: () => { throw error; }},
        ]);
        await expect(router.dispatch({type: 'broken'}, {prefix: 'ctx'})).rejects.toBe(error);
    });
});
