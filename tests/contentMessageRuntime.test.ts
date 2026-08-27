import {beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
    config: {
        on: true,
        disableFloatingBall: false,
        selectionTranslatorMode: 'bilingual',
        disableSelectionTranslator: false,
        selectionTranslatorTrigger: 'direct',
        selectionTranslatorHotkey: 'none',
        customSelectionTranslatorHotkey: '',
        selectionTranslatorDelay: 0,
        selectionAreaEnabled: false,
        disableImageTranslator: false,
        translationProgressPanelEnabled: false,
    },
    normalizeDelay: vi.fn((value: number | string) => Number(value)),
    autoTranslateEnglishPage: vi.fn(),
    isFullPageTranslationActive: vi.fn(),
    mountAreaTranslator: vi.fn(),
    mountFloatingBall: vi.fn(),
    mountImageTranslator: vi.fn(),
    mountSelectionTranslator: vi.fn(),
    mountTranslationProgressPanel: vi.fn(),
    restoreOriginalContent: vi.fn(),
    unmountAreaTranslator: vi.fn(),
    unmountFloatingBall: vi.fn(),
    unmountImageTranslator: vi.fn(),
    unmountSelectionTranslator: vi.fn(),
    unmountTranslationProgressPanel: vi.fn(),
}));

vi.mock('@/src/core/config/model', () => ({
    normalizeSelectionTranslatorDelay: mocks.normalizeDelay,
}));
vi.mock('@/src/services/config/store', () => ({config: mocks.config}));
vi.mock('@/src/app/content/features', () => ({
    autoTranslateEnglishPage: mocks.autoTranslateEnglishPage,
    isFullPageTranslationActive: mocks.isFullPageTranslationActive,
    mountAreaTranslator: mocks.mountAreaTranslator,
    mountFloatingBall: mocks.mountFloatingBall,
    mountImageTranslator: mocks.mountImageTranslator,
    mountSelectionTranslator: mocks.mountSelectionTranslator,
    mountTranslationProgressPanel: mocks.mountTranslationProgressPanel,
    restoreOriginalContent: mocks.restoreOriginalContent,
    unmountAreaTranslator: mocks.unmountAreaTranslator,
    unmountFloatingBall: mocks.unmountFloatingBall,
    unmountImageTranslator: mocks.unmountImageTranslator,
    unmountSelectionTranslator: mocks.unmountSelectionTranslator,
    unmountTranslationProgressPanel: mocks.unmountTranslationProgressPanel,
}));

beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    Object.assign(mocks.config, {
        on: true,
        disableFloatingBall: false,
        selectionTranslatorMode: 'bilingual',
        disableSelectionTranslator: false,
        selectionTranslatorTrigger: 'direct',
        selectionTranslatorHotkey: 'none',
        customSelectionTranslatorHotkey: '',
        selectionTranslatorDelay: 0,
        selectionAreaEnabled: false,
        disableImageTranslator: false,
        translationProgressPanelEnabled: false,
    });
    for (const value of Object.values(mocks)) {
        if (typeof value === 'function' && 'mockReset' in value) value.mockReset();
    }
    mocks.normalizeDelay.mockImplementation((value) => Number(value));
    mocks.isFullPageTranslationActive.mockReturnValue(false);
    vi.stubGlobal('document', {getElementById: vi.fn(() => null)});
});

describe('内容脚本 runtime 消息协议', () => {
    it('严格校验站点开关并把异步成功与失败显式回传', async () => {
        const {createContentRuntimeMessageHandler} = await import('@/src/app/content/messageRuntime');
        const updateSiteDisabled = vi.fn(async () => undefined);
        const respond = vi.fn();
        const handler = createContentRuntimeMessageHandler({} as never, {
            isSiteDisabled: () => false,
            updateSiteDisabled,
        });

        expect(handler(null, {}, respond)).toBe(false);
        expect(handler({type: 'updateSiteExtensionDisabled', isDisabled: 'yes'}, {}, respond)).toBe(false);
        expect(handler({type: 'updateSiteExtensionDisabled', isDisabled: true}, {}, respond)).toBe(true);
        await Promise.resolve();
        expect(updateSiteDisabled).toHaveBeenCalledWith(true);
        expect(respond).toHaveBeenCalledWith({status: 'success'});

        updateSiteDisabled.mockRejectedValueOnce(new Error('activation failed'));
        expect(handler({type: 'updateSiteExtensionDisabled', isDisabled: false}, {}, respond)).toBe(true);
        await Promise.resolve();
        await Promise.resolve();
        expect(respond).toHaveBeenLastCalledWith({status: 'failed'});
    });

    it('站点禁用时只开放状态读取，并保留 tabId 菜单所需的真实字段', async () => {
        const {createContentRuntimeMessageHandler} = await import('@/src/app/content/messageRuntime');
        const respond = vi.fn();
        const handler = createContentRuntimeMessageHandler({} as never, {
            isSiteDisabled: () => true,
            updateSiteDisabled: vi.fn(async () => undefined),
        });

        expect(handler({type: 'toggleFloatingBall', isEnabled: true}, {}, respond)).toBe(true);
        expect(respond).toHaveBeenLastCalledWith({status: 'disabled'});
        expect(mocks.mountFloatingBall).not.toHaveBeenCalled();

        expect(handler({type: 'getFullPageTranslationState'}, {}, respond)).toBe(true);
        expect(respond).toHaveBeenLastCalledWith({
            status: 'success',
            isTranslated: false,
            isSiteDisabled: true,
        });
    });

    it('更新 UI 配置并让菜单翻译与恢复根据真实全文状态回复', async () => {
        const {createContentRuntimeMessageHandler} = await import('@/src/app/content/messageRuntime');
        const respond = vi.fn();
        const handler = createContentRuntimeMessageHandler({} as never, {
            isSiteDisabled: () => false,
            updateSiteDisabled: vi.fn(async () => undefined),
        });

        expect(handler({type: 'toggleFloatingBall', isEnabled: true}, {}, respond)).toBe(true);
        expect(mocks.mountFloatingBall).toHaveBeenCalledOnce();
        expect(handler({type: 'toggleFloatingBall', isEnabled: false}, {}, respond)).toBe(true);
        expect(mocks.unmountFloatingBall).toHaveBeenCalledOnce();
        expect(handler({type: 'updateSelectionTranslatorMode', mode: 'invalid'}, {}, respond)).toBe(false);
        expect(handler({type: 'updateSelectionTranslatorMode', mode: 'disabled'}, {}, respond)).toBe(true);
        expect(mocks.unmountSelectionTranslator).toHaveBeenCalledOnce();
        expect(handler({
            type: 'updateSelectionTranslatorSettings',
            trigger: 'custom',
            customHotkey: 'Alt+K',
            delay: '25',
        }, {}, respond)).toBe(true);
        expect(mocks.config).toMatchObject({
            selectionTranslatorTrigger: 'custom',
            selectionTranslatorHotkey: 'custom',
            customSelectionTranslatorHotkey: 'Alt+K',
            selectionTranslatorDelay: 25,
        });

        mocks.isFullPageTranslationActive.mockReturnValueOnce(true);
        expect(handler({type: 'contextMenuTranslate', action: 'fullPage'}, {}, respond)).toBe(true);
        expect(mocks.autoTranslateEnglishPage).toHaveBeenCalledOnce();
        expect(respond).toHaveBeenLastCalledWith({
            status: 'success',
            action: 'translated',
            isTranslated: true,
        });

        mocks.isFullPageTranslationActive.mockReturnValueOnce(false);
        expect(handler({type: 'contextMenuTranslate', action: 'restore'}, {}, respond)).toBe(true);
        expect(mocks.restoreOriginalContent).toHaveBeenCalledOnce();
        expect(respond).toHaveBeenLastCalledWith({
            status: 'success',
            action: 'restored',
            isTranslated: false,
        });
        expect(handler({type: 'contextMenuTranslate', action: 'unknown'}, {}, respond)).toBe(false);
    });
});
