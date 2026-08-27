import {describe, expect, it, vi} from 'vitest';

import {
    CONFIG_HISTORY_MESSAGE_TYPE,
    createConfigHistoryHandler,
} from '@/src/app/background/handlers/configHistory';
import {
    CLEAR_TRANSLATION_CACHE_MESSAGE,
    createTranslationCacheHandler,
} from '@/src/app/background/handlers/translationCache';
import {createBackgroundMessageRouter} from '@/src/platform/browser/messageRouter';

describe('background core message handlers', () => {
    it('清理 broker 缓存成功后返回明确响应', async () => {
        const clear = vi.fn(async () => undefined);
        const router = createBackgroundMessageRouter([
            createTranslationCacheHandler(clear),
        ]);

        await expect(router.dispatch({type: CLEAR_TRANSLATION_CACHE_MESSAGE}, undefined)).resolves.toEqual({
            handled: true,
            response: {success: true},
        });
        expect(clear).toHaveBeenCalledOnce();
    });

    it('缓存清理失败时把错误交给统一 router 边界', async () => {
        const failure = new Error('clear failed');
        const router = createBackgroundMessageRouter([
            createTranslationCacheHandler(async () => { throw failure; }),
        ]);

        await expect(router.dispatch({type: CLEAR_TRANSLATION_CACHE_MESSAGE}, undefined)).rejects.toBe(failure);
    });

    it.each([
        ['undo', 8],
        ['redo', undefined],
        ['restore', undefined],
    ] as const)('执行有效配置历史操作 %s', async (action, expectedVersion) => {
        const apply = vi.fn(async () => ({action, version: expectedVersion}));
        const router = createBackgroundMessageRouter([
            createConfigHistoryHandler(apply),
        ]);
        const version = action === 'undo' ? 8 : action === 'redo' ? Number.NaN : 'latest';

        await expect(router.dispatch({
            type: CONFIG_HISTORY_MESSAGE_TYPE,
            action,
            version,
        }, undefined)).resolves.toEqual({
            handled: true,
            response: {
                success: true,
                history: {action, version: expectedVersion},
            },
        });
        expect(apply).toHaveBeenCalledWith(action, expectedVersion);
    });

    it('拒绝未知配置历史操作且不调用 service', async () => {
        const apply = vi.fn();
        const router = createBackgroundMessageRouter([
            createConfigHistoryHandler(apply),
        ]);

        await expect(router.dispatch({
            type: CONFIG_HISTORY_MESSAGE_TYPE,
            action: 'drop-all',
        }, undefined)).resolves.toEqual({
            handled: true,
            response: {success: false, error: '无效的配置历史操作'},
        });
        expect(apply).not.toHaveBeenCalled();
    });

    it('配置历史 service 失败时保留原始错误', async () => {
        const failure = new Error('history failed');
        const router = createBackgroundMessageRouter([
            createConfigHistoryHandler(async () => { throw failure; }),
        ]);

        await expect(router.dispatch({
            type: CONFIG_HISTORY_MESSAGE_TYPE,
            action: 'undo',
        }, undefined)).rejects.toBe(failure);
    });
});
