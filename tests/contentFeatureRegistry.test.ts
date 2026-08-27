import {describe, expect, it, vi} from 'vitest';

import {
    createContentFeatureRegistry,
    rejectUnsupportedContentFeature,
    type ContentFeatureRuntime,
} from '@/src/app/content/featureRegistry';
import {resolveBrowserCapabilities} from '@/src/platform/browser/capabilities';

function runtime(
    isCurrent = () => true,
    signal: AbortSignal = new AbortController().signal,
): ContentFeatureRuntime {
    return {
        ctx: {} as ContentFeatureRuntime['ctx'],
        signal,
        isCurrent,
    };
}

describe('content feature registry', () => {
    it('unsupported message helpers unmount and answer explicitly without touching supported features', () => {
        const unmount = vi.fn();
        const sendResponse = vi.fn();
        expect(rejectUnsupportedContentFeature(true, unmount, sendResponse, 'unsupported')).toBe(false);
        expect(unmount).not.toHaveBeenCalled();
        expect(sendResponse).not.toHaveBeenCalled();

        expect(rejectUnsupportedContentFeature(false, unmount, sendResponse, 'Firefox unsupported')).toBe(true);
        expect(unmount).toHaveBeenCalledOnce();
        expect(sendResponse).toHaveBeenCalledWith({status: 'unsupported', error: 'Firefox unsupported'});
    });

    it('checks required browser capabilities before reading feature configuration', async () => {
        const isEnabled = vi.fn(() => true);
        const mount = vi.fn();
        const feature = {id: 'area', requiredCapability: 'areaTranslation' as const, isEnabled, mount};
        const firefox = createContentFeatureRegistry([feature], {
            capabilities: resolveBrowserCapabilities({browser: 'firefox', manifestVersion: 2}),
        });
        await expect(firefox.mountEnabled(runtime())).resolves.toEqual([{id: 'area', status: 'skipped'}]);
        expect(isEnabled).not.toHaveBeenCalled();
        expect(mount).not.toHaveBeenCalled();

        const chrome = createContentFeatureRegistry([feature], {
            capabilities: resolveBrowserCapabilities({browser: 'chrome', manifestVersion: 3}),
        });
        await expect(chrome.mountEnabled(runtime())).resolves.toEqual([{id: 'area', status: 'mounted'}]);
        expect(isEnabled).toHaveBeenCalled();
        expect(mount).toHaveBeenCalled();
    });

    it('按注册顺序挂载已启用功能，并跳过关闭的功能', async () => {
        const calls: string[] = [];
        const registry = createContentFeatureRegistry([
            {
                id: 'selection',
                isEnabled: () => true,
                mount: () => calls.push('selection'),
            },
            {
                id: 'video-subtitle',
                isEnabled: () => false,
                mount: () => calls.push('video-subtitle'),
            },
        ]);

        const results = await registry.mountEnabled(runtime());

        expect(calls).toEqual(['selection']);
        expect(results).toEqual([
            {id: 'selection', status: 'mounted'},
            {id: 'video-subtitle', status: 'skipped'},
        ]);
    });

    it('异步 UI 首次未就绪时只重试一次，并按真实挂载状态报告成功', async () => {
        let mounted = false;
        let mountCount = 0;
        const mount = vi.fn(() => {
            mountCount += 1;
            mounted = mountCount === 2;
        });
        const registry = createContentFeatureRegistry([{
            id: 'floating-ball',
            isEnabled: () => true,
            mount,
            isMounted: () => mounted,
        }]);

        await expect(registry.mountEnabled(runtime())).resolves.toEqual([
            {id: 'floating-ball', status: 'mounted'},
        ]);
        expect(mount).toHaveBeenCalledTimes(2);
    });

    it('异步挂载期间激活失效时不清理可能已被新激活接管的 singleton，并跳过后续功能', async () => {
        let current = true;
        const firstUnmount = vi.fn();
        const secondMount = vi.fn();
        const registry = createContentFeatureRegistry([
            {
                id: 'first',
                isEnabled: () => true,
                mount: () => {
                    current = false;
                },
                unmount: firstUnmount,
            },
            {
                id: 'second',
                isEnabled: () => true,
                mount: secondMount,
            },
        ]);

        await expect(registry.mountEnabled(runtime(() => current))).resolves.toEqual([
            {id: 'first', status: 'skipped'},
            {id: 'second', status: 'skipped'},
        ]);
        expect(firstUnmount).not.toHaveBeenCalled();
        expect(secondMount).not.toHaveBeenCalled();
    });

    it('站点快速禁用再恢复时，旧 registry 的迟到收尾不会卸载新 activation 的重试结果', async () => {
        let resolveStaleMount!: () => void;
        const staleMount = new Promise<void>((resolve) => {
            resolveStaleMount = resolve;
        });
        let oldActivationCurrent = true;
        let mounted = false;
        let mountCalls = 0;
        const mount = vi.fn(() => {
            mountCalls += 1;
            // 恢复 activation 首次调用会复用禁用前尚未 settle 的 singleton Promise。
            if (mountCalls <= 2) return staleMount;
            // 旧 Promise settle 后，恢复 activation 的一次重试真正建立新宿主。
            mounted = true;
            return undefined;
        });
        const unmount = vi.fn(() => {
            mounted = false;
        });
        const feature = {
            id: 'selection-translator',
            isEnabled: () => true,
            mount,
            unmount,
            isMounted: () => mounted,
        };
        const oldRegistry = createContentFeatureRegistry([feature]);
        const restoredRegistry = createContentFeatureRegistry([feature]);

        const oldActivation = oldRegistry.mountEnabled(runtime(() => oldActivationCurrent));
        await Promise.resolve();
        oldActivationCurrent = false;
        oldRegistry.unmountAll();
        const restoredActivation = restoredRegistry.mountEnabled(runtime());
        await Promise.resolve();

        resolveStaleMount();
        await expect(oldActivation).resolves.toEqual([{id: 'selection-translator', status: 'skipped'}]);
        await expect(restoredActivation).resolves.toEqual([{id: 'selection-translator', status: 'mounted'}]);
        expect(mount).toHaveBeenCalledTimes(3);
        expect(unmount).toHaveBeenCalledOnce();
        expect(mounted).toBe(true);
    });

    it('当前 activation 挂载期间配置关闭时仍清理自己的功能', async () => {
        let enabled = true;
        const unmount = vi.fn();
        const registry = createContentFeatureRegistry([{
            id: 'floating-ball',
            isEnabled: () => enabled,
            mount: () => {
                enabled = false;
            },
            unmount,
        }]);

        await expect(registry.mountEnabled(runtime())).resolves.toEqual([
            {id: 'floating-ball', status: 'skipped'},
        ]);
        expect(unmount).toHaveBeenCalledOnce();
    });

    it('单个功能挂载失败时记录错误，并继续挂载其他功能', async () => {
        const failure = new Error('mount failed');
        const laterMount = vi.fn();
        const onError = vi.fn();
        const registry = createContentFeatureRegistry([
            {id: 'broken', isEnabled: () => true, mount: () => { throw failure; }},
            {id: 'healthy', isEnabled: () => true, mount: laterMount},
        ], {onError});

        await expect(registry.mountEnabled(runtime())).resolves.toEqual([
            {id: 'broken', status: 'failed', error: failure},
            {id: 'healthy', status: 'mounted'},
        ]);
        expect(onError).toHaveBeenCalledWith('broken', 'mount', failure);
        expect(laterMount).toHaveBeenCalledOnce();
    });

    it('两次挂载后仍未就绪时返回失败，而不是误报 mounted', async () => {
        const onError = vi.fn();
        const mount = vi.fn();
        const registry = createContentFeatureRegistry([{
            id: 'never-ready',
            isEnabled: () => true,
            mount,
            isMounted: () => false,
        }], {onError});

        const [result] = await registry.mountEnabled(runtime());

        expect(result.status).toBe('failed');
        expect(result).toEqual(expect.objectContaining({id: 'never-ready'}));
        expect(onError).toHaveBeenCalledWith(
            'never-ready',
            'mount',
            expect.objectContaining({message: '内容功能挂载后未就绪: never-ready'}),
        );
        expect(mount).toHaveBeenCalledTimes(2);
    });

    it('AbortSignal 已取消时不读取功能配置，也不启动挂载', async () => {
        const controller = new AbortController();
        controller.abort();
        const isEnabled = vi.fn(() => true);
        const mount = vi.fn();
        const registry = createContentFeatureRegistry([{id: 'image', isEnabled, mount}]);

        await expect(registry.mountEnabled(runtime(() => true, controller.signal))).resolves.toEqual([
            {id: 'image', status: 'skipped'},
        ]);
        expect(isEnabled).not.toHaveBeenCalled();
        expect(mount).not.toHaveBeenCalled();
    });

    it('按逆序卸载，且单个清理失败不会阻止其他功能释放资源', () => {
        const failure = new Error('unmount failed');
        const calls: string[] = [];
        const onError = vi.fn();
        const registry = createContentFeatureRegistry([
            {
                id: 'floating-ball',
                isEnabled: () => true,
                mount: vi.fn(),
                unmount: () => calls.push('floating-ball'),
            },
            {
                id: 'selection',
                isEnabled: () => true,
                mount: vi.fn(),
                unmount: () => {
                    calls.push('selection');
                    throw failure;
                },
            },
            {id: 'without-cleanup', isEnabled: () => true, mount: vi.fn()},
        ], {onError});

        registry.unmountAll();

        expect(calls).toEqual(['selection', 'floating-ball']);
        expect(onError).toHaveBeenCalledWith('selection', 'unmount', failure);
    });
});
