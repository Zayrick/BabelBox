import {setRuntimeFetch} from '@/src/platform/http/runtime';
import {installShadowAndRouteBridge} from '@/src/platform/shadow-ui/pageBridge';
import browser, {setPlatformMessageHandler} from './browser';
import {createUserscriptContentContext} from './context';
import {userscriptFetch} from './http';
import {ensureUserscriptConfig} from './initialize';

declare global {
    // Sandbox-local idempotency guard for managers that reinject on SPA state changes.
    var __babelboxUserscriptBootstrapped: boolean | undefined;
}

let disposeShadowAndRouteBridge: (() => void) | undefined;

async function waitForDocumentEnd(): Promise<void> {
    if (document.readyState !== 'loading') return;
    await new Promise<void>((resolve) => document.addEventListener('DOMContentLoaded', () => resolve(), {once: true}));
}

function registerMenu(label: string, listener: () => void): void {
    const register = globalThis.GM_registerMenuCommand;
    if (typeof register === 'function') register(label, listener);
}

async function bootstrap(): Promise<void> {
    if (globalThis.__babelboxUserscriptBootstrapped) return;
    globalThis.__babelboxUserscriptBootstrapped = true;

    disposeShadowAndRouteBridge = installShadowAndRouteBridge();
    setRuntimeFetch(userscriptFetch);
    await ensureUserscriptConfig();

    const [platformModule, settingsModule, contentModule, translationModule, configModule] = await Promise.all([
        import('./platform'),
        import('./settings'),
        import('@/src/app/content/runtime'),
        import('@/src/features/full-page-translation/public'),
        import('@/src/services/config/store'),
    ]);
    const ctx = createUserscriptContentContext();
    const openSettings = () => void settingsModule.openUserscriptSettings(ctx);
    const closeSettings = () => settingsModule.closeUserscriptSettings();
    setPlatformMessageHandler(platformModule.createPlatformMessageHandler(openSettings));
    window.addEventListener('babelbox-userscript-open-settings', openSettings);
    window.addEventListener('babelbox-userscript-close-settings', closeSettings);

    browser.runtime.onMessage.addListener((message: any, _sender: unknown, sendResponse: (response?: unknown) => void) => {
        if (message?.type !== 'userscriptTogglePageTranslation') return false;
        if (translationModule.isFullPageTranslationActive()) translationModule.restoreOriginalContent();
        else void translationModule.autoTranslateEnglishPage();
        sendResponse({success: true});
        return true;
    });

    registerMenu('翻译机：打开设置', openSettings);
    registerMenu('翻译机：翻译 / 恢复当前网页', () => {
        if (translationModule.isFullPageTranslationActive()) translationModule.restoreOriginalContent();
        else void translationModule.autoTranslateEnglishPage();
    });
    registerMenu('翻译机：启用 / 暂停', () => {
        const enabled = !configModule.config.on;
        configModule.config.on = enabled;
        void configModule.saveConfig().then(async () => {
            await browser.tabs.sendMessage(1, {
                type: 'toggleFloatingBall',
                isEnabled: enabled && !configModule.config.disableFloatingBall,
            });
            await browser.tabs.sendMessage(1, {
                type: 'updateSelectionTranslatorMode',
                mode: enabled ? configModule.config.selectionTranslatorMode : 'disabled',
            });
            if (!enabled) translationModule.restoreOriginalContent();
        });
    });
    registerMenu('翻译机：清空翻译缓存', () => {
        void browser.runtime.sendMessage({type: 'clearTranslationCache'});
    });

    await waitForDocumentEnd();
    await contentModule.startContentApp(ctx as never);
    void browser.runtime.sendMessage({type: 'userscriptCacheMaintenance'}).catch(() => undefined);

    window.addEventListener('beforeunload', () => {
        window.removeEventListener('babelbox-userscript-open-settings', openSettings);
        window.removeEventListener('babelbox-userscript-close-settings', closeSettings);
        closeSettings();
        ctx.invalidate();
        disposeShadowAndRouteBridge?.();
        disposeShadowAndRouteBridge = undefined;
    }, {once: true});
}

void bootstrap().catch((error) => {
    disposeShadowAndRouteBridge?.();
    disposeShadowAndRouteBridge = undefined;
    globalThis.__babelboxUserscriptBootstrapped = false;
    console.error('[BabelBox userscript] 初始化失败', error);
});
