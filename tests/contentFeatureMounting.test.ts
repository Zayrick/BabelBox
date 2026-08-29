import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
    config: {
        disableSelectionTranslator: false,
        selectionTranslatorMode: 'bilingual',
        selectionAreaEnabled: true,
    },
    createVueShadowUi: vi.fn(),
}));

vi.mock('@/src/services/config/store', () => ({config: mocks.config}));
vi.mock('@/src/platform/shadow-ui', () => ({createVueShadowUi: mocks.createVueShadowUi}));
vi.mock('@/src/features/selection-translation/ui/SelectionTranslator.vue', () => ({default: {name: 'SelectionTranslator'}}));
vi.mock('@/src/features/area-translation/ui/AreaTranslator.vue', () => ({default: {name: 'AreaTranslator'}}));

interface MockUi {
    mounted?: {app?: unknown; instance?: unknown};
    remove: ReturnType<typeof vi.fn>;
}

function ui(instance: unknown = {feature: 'mounted'}): MockUi {
    return {
        mounted: {app: {unmount: vi.fn()}, instance},
        remove: vi.fn(),
    };
}

function pendingUi(): {
    promise: Promise<MockUi>;
    resolve: (value: MockUi) => void;
} {
    let resolve!: (value: MockUi) => void;
    return {
        promise: new Promise<MockUi>((done) => {
            resolve = done;
        }),
        resolve,
    };
}

beforeEach(() => {
    vi.resetModules();
    mocks.createVueShadowUi.mockReset();
    mocks.config.disableSelectionTranslator = false;
    mocks.config.selectionTranslatorMode = 'bilingual';
    mocks.config.selectionAreaEnabled = true;
    vi.stubGlobal('document', {getElementById: vi.fn(() => null)});
});

describe('划词翻译挂载生命周期', () => {
    it('没有内容脚本上下文或功能关闭时不挂载', async () => {
        const runtime = await import('@/src/features/selection-translation/content/runtime');

        expect(runtime.mountSelectionTranslator()).toBeUndefined();
        mocks.config.disableSelectionTranslator = true;
        expect(runtime.mountSelectionTranslator({} as never)).toBeNull();
        mocks.config.disableSelectionTranslator = false;
        mocks.config.selectionTranslatorMode = 'disabled';
        expect(runtime.mountSelectionTranslator({} as never)).toBeNull();
        expect(mocks.createVueShadowUi).not.toHaveBeenCalled();
    });

    it('只创建一个关闭 Shadow DOM，并在卸载时清理', async () => {
        const mountedUi = ui();
        mocks.createVueShadowUi.mockResolvedValue(mountedUi);
        const runtime = await import('@/src/features/selection-translation/content/runtime');
        const context = {name: 'content'} as never;

        await expect(runtime.mountSelectionTranslator(context)).resolves.toEqual({feature: 'mounted'});
        expect(mocks.createVueShadowUi).toHaveBeenCalledWith(context, expect.objectContaining({
            name: 'babelbox-selection-translator-ui',
            hostId: 'babelbox-selection-translator-container',
            zIndex: 2_147_483_646,
            mode: 'closed',
        }));
        expect(runtime.mountSelectionTranslator()).toBeNull();

        runtime.unmountSelectionTranslator();
        expect(mountedUi.remove).toHaveBeenCalledOnce();
        runtime.unmountSelectionTranslator();
        expect(mountedUi.remove).toHaveBeenCalledOnce();
    });

    it('复用正在挂载的请求，并丢弃卸载后的迟到结果', async () => {
        const pending = pendingUi();
        const mountedUi = ui();
        mocks.createVueShadowUi.mockReturnValue(pending.promise);
        const runtime = await import('@/src/features/selection-translation/content/runtime');

        const request = runtime.mountSelectionTranslator({} as never);
        expect(runtime.mountSelectionTranslator()).toBe(request);
        runtime.unmountSelectionTranslator();
        pending.resolve(mountedUi);

        await expect(request).resolves.toBeNull();
        expect(mountedUi.remove).toHaveBeenCalledOnce();
    });

    it.each([
        ['disableSelectionTranslator', true],
        ['selectionTranslatorMode', 'disabled'],
    ] as const)('挂载期间配置字段 %s 关闭时移除迟到界面', async (key, value) => {
        const pending = pendingUi();
        const mountedUi = ui();
        mocks.createVueShadowUi.mockReturnValue(pending.promise);
        const runtime = await import('@/src/features/selection-translation/content/runtime');

        const request = runtime.mountSelectionTranslator({} as never);
        mocks.config[key] = value as never;
        pending.resolve(mountedUi);

        await expect(request).resolves.toBeNull();
        expect(mountedUi.remove).toHaveBeenCalledOnce();
    });

    it('允许挂载器返回没有 Vue 实例的安全空结果', async () => {
        const mountedUi = {remove: vi.fn()};
        mocks.createVueShadowUi.mockResolvedValue(mountedUi);
        const runtime = await import('@/src/features/selection-translation/content/runtime');

        await expect(runtime.mountSelectionTranslator({} as never)).resolves.toBeNull();
        runtime.unmountSelectionTranslator();
        expect(mountedUi.remove).toHaveBeenCalledOnce();
    });
});

describe('圈选翻译挂载生命周期', () => {
    it('通过宿主元素报告挂载状态', async () => {
        const getElementById = vi.fn()
            .mockReturnValueOnce(null)
            .mockReturnValueOnce({id: 'babelbox-area-translator-container'});
        vi.stubGlobal('document', {getElementById});
        const runtime = await import('@/src/features/area-translation/content/runtime');

        expect(runtime.isAreaTranslatorMounted()).toBe(false);
        expect(runtime.isAreaTranslatorMounted()).toBe(true);
    });

    it('没有上下文或功能关闭时不挂载', async () => {
        const runtime = await import('@/src/features/area-translation/content/runtime');

        expect(runtime.mountAreaTranslator()).toBeUndefined();
        mocks.config.selectionAreaEnabled = false;
        expect(runtime.mountAreaTranslator({} as never)).toBeNull();
        expect(mocks.createVueShadowUi).not.toHaveBeenCalled();
    });

    it('只创建一个关闭 Shadow DOM，并在卸载后允许重新挂载', async () => {
        const firstUi = ui({feature: 'area'});
        const secondUi = ui({feature: 'area-again'});
        mocks.createVueShadowUi.mockResolvedValueOnce(firstUi).mockResolvedValueOnce(secondUi);
        const runtime = await import('@/src/features/area-translation/content/runtime');
        const context = {name: 'content'} as never;

        await expect(runtime.mountAreaTranslator(context)).resolves.toEqual({feature: 'area'});
        expect(mocks.createVueShadowUi).toHaveBeenNthCalledWith(1, context, expect.objectContaining({
            name: 'babelbox-area-translator-ui',
            hostId: 'babelbox-area-translator-container',
            zIndex: 2_147_483_647,
            mode: 'closed',
        }));
        expect(runtime.mountAreaTranslator()).toBeNull();

        runtime.unmountAreaTranslator();
        expect(firstUi.remove).toHaveBeenCalledOnce();
        await expect(runtime.mountAreaTranslator()).resolves.toEqual({feature: 'area-again'});
        runtime.unmountAreaTranslator();
        runtime.unmountAreaTranslator();
        expect(secondUi.remove).toHaveBeenCalledOnce();
    });

    it('复用正在挂载的请求，并丢弃卸载后的迟到结果', async () => {
        const pending = pendingUi();
        const mountedUi = ui();
        mocks.createVueShadowUi.mockReturnValue(pending.promise);
        const runtime = await import('@/src/features/area-translation/content/runtime');

        const request = runtime.mountAreaTranslator({} as never);
        expect(runtime.mountAreaTranslator()).toBe(request);
        runtime.unmountAreaTranslator();
        pending.resolve(mountedUi);

        await expect(request).resolves.toBeNull();
        expect(mountedUi.remove).toHaveBeenCalledOnce();
    });

    it('挂载期间被关闭时移除迟到界面', async () => {
        const pending = pendingUi();
        const mountedUi = ui();
        mocks.createVueShadowUi.mockReturnValue(pending.promise);
        const runtime = await import('@/src/features/area-translation/content/runtime');

        const request = runtime.mountAreaTranslator({} as never);
        mocks.config.selectionAreaEnabled = false;
        pending.resolve(mountedUi);

        await expect(request).resolves.toBeNull();
        expect(mountedUi.remove).toHaveBeenCalledOnce();
    });

    it('允许挂载器返回没有 Vue 实例的安全空结果', async () => {
        const mountedUi = {remove: vi.fn()};
        mocks.createVueShadowUi.mockResolvedValue(mountedUi);
        const runtime = await import('@/src/features/area-translation/content/runtime');

        await expect(runtime.mountAreaTranslator({} as never)).resolves.toBeNull();
        runtime.unmountAreaTranslator();
        expect(mountedUi.remove).toHaveBeenCalledOnce();
    });
});
