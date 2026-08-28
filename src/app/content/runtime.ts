import type {ContentScriptContext} from 'wxt/utils/content-script-context';
import {createShadowRootUi} from 'wxt/utils/content-script-ui/shadow-root';
import {browser} from 'wxt/browser';
import {constants} from '@/src/core/config/constants';
import {isExtensionDisabledOnSite, shouldAutoTranslatePage} from '@/src/core/site-rules/domain';
import {config, configReady, subscribeConfig} from '@/src/services/config/store';
import {cancelAllTranslations} from '@/src/services/translation/client';
import {resetPageTranslationContextCache} from '@/src/services/translation/context';
import {getCenterPoint} from '@/src/shared/geometry/touch';
import {createContentFeatureRegistry, type ContentFeatureRegistry} from './featureRegistry';
import {createContentHotkeyRuntime} from './hotkeyRuntime';
import {
    createContentRuntimeMessageHandler,
    type ContentRuntimeMessageHandler,
} from './messageRuntime';
import {
    autoTranslateEnglishPage,
    cancelPendingHoverTranslation,
    createInputTranslationContentFeature,
    handleTranslation,
    inputBoxTranslationConfigKey,
    isAreaTranslatorMounted,
    isFullPageTranslationActive,
    mountAreaTranslator,
    mountFloatingBall,
    mountHoverTranslationContentFeature,
    mountImageTranslator,
    mountSelectionTranslator,
    mountTranslationProgressPanel,
    mountVideoSubtitleTranslation,
    restoreOriginalContent,
    unmountAreaTranslator,
    unmountFloatingBall,
    unmountImageTranslator,
    unmountSelectionTranslator,
    unmountTranslationProgressPanel,
} from './features';
import pageStyles from './page.css?inline';
import {browserCapabilities, type BrowserCapabilities} from '@/src/platform/browser/capabilities';
import {setMainWorldBridgesEnabled} from './mainWorldBridgeLifecycle';
import {configureCurrentTranslationFilters} from '@/src/core/translation/public';
function shouldAutomaticallyTranslateCurrentPage(nextConfig: typeof config): boolean {
    return shouldAutoTranslatePage(window.location.href, {
        on: nextConfig.on,
        autoTranslate: nextConfig.autoTranslate,
        alwaysTranslateDomains: nextConfig.alwaysTranslateDomains,
        disabledExtensionDomains: nextConfig.disabledExtensionDomains,
    });
}
function installPageStyles(ctx: ContentScriptContext): () => void {
    const existing = document.getElementById('fluent-read-page-styles');
    if (existing) return () => undefined;
    const style = document.createElement('style');
    style.id = 'fluent-read-page-styles';
    style.textContent = pageStyles;
    (document.head ?? document.documentElement).appendChild(style);
    const remove = () => style.remove();
    ctx.onInvalidated(remove);
    return remove;
}
/**
 * 启动当前 document 对应的内容应用。
 * WXT 只负责创建 context；所有功能组装和清理都在这一 composition root 内完成。
 */
export async function startContentApp(ctx: ContentScriptContext,
    capabilities: BrowserCapabilities = browserCapabilities): Promise<void> {
    await configReady;
    configureCurrentTranslationFilters(config.translationFilter);
    let currentPageSiteDisabled = isExtensionDisabledOnSite(
        window.location.href,
        config.disabledExtensionDomains,
    );
    let unmountVideoSubtitleTranslation: (() => void) | null = null;
    let unsubscribeContentConfig: (() => void) | null = null;
    let runtimeMessageListener: ContentRuntimeMessageHandler | null = null;
    let cleanedUp = false;
    let featureController: AbortController | null = null;
    let activePageFeatureRegistry: ContentFeatureRegistry | null = null;
    let removePageStyles: (() => void) | null = null;
    let shouldAutomaticallyTranslate = false;
    let inputBoxConfigGeneration = 0;
    let previousInputBoxConfigKey = inputBoxTranslationConfigKey(config);
    const pageEventController = new AbortController();
    document.addEventListener('fluentread-route-change', resetPageTranslationContextCache, {signal: pageEventController.signal});
    const hotkeys = createContentHotkeyRuntime(() => currentPageSiteDisabled);
    const inputTranslationFeature = createInputTranslationContentFeature({
        context: ctx,
        config,
        document,
        isSiteDisabled: () => currentPageSiteDisabled,
        readConfigGeneration: () => inputBoxConfigGeneration,
        sendMessage: (message) => browser.runtime.sendMessage(message),
        createUi: createShadowRootUi,
        logger: console,
    });
    const reportSiteDisabledState = (): void => {
        void browser.runtime.sendMessage({
            type: 'siteExtensionDisabledState',
            isDisabled: currentPageSiteDisabled,
        }).catch(() => undefined);
    };

    const disposePageFeatures = (): void => {
        featureController?.abort();
        featureController = null;
        restoreOriginalContent();
        cancelAllTranslations();
        activePageFeatureRegistry?.unmountAll();
        activePageFeatureRegistry = null;
        unmountTranslationProgressPanel();
        unmountVideoSubtitleTranslation?.();
        unmountVideoSubtitleTranslation = null;
        inputTranslationFeature.invalidate();
        removePageStyles?.();
        removePageStyles = null;
    };

    const activatePageFeatures = async (): Promise<void> => {
        if (cleanedUp || currentPageSiteDisabled || featureController) return;

        removePageStyles = installPageStyles(ctx);
        const activationController = new AbortController();
        featureController = activationController;
        const isActivationCurrent = () => !cleanedUp
            && !currentPageSiteDisabled
            && featureController === activationController
            && !activationController.signal.aborted;

        inputTranslationFeature.mount(activationController.signal);
        // 视频字幕 Beta 只在 YouTube 播放页监听原生字幕，不采集音频或视频内容。
        unmountVideoSubtitleTranslation = mountVideoSubtitleTranslation();
        mountHoverTranslationContentFeature({
            config,
            constants,
            document,
            window,
            navigator,
            isSiteDisabled: () => currentPageSiteDisabled,
            getCenterPoint,
            handleTranslation,
            cancelPendingHoverTranslation,
            hasActiveSelectionTranslationCandidate: hotkeys.hasActiveSelectionTranslationCandidate,
            getConfiguredSelectionHotkey: hotkeys.getConfiguredSelectionHotkey,
            getCustomSelectionHotkey: () => config.customSelectionTranslatorHotkey,
            matchesSelectionTranslatorShortcut: hotkeys.matchesSelectionTranslatorShortcut,
            shouldReserveSelectionShortcut: hotkeys.shouldReserveSelectionShortcut,
        }, activationController.signal);
        hotkeys.installFloatingBallHotkey(activationController.signal);

        const pageFeatureRegistry = createContentFeatureRegistry([
            {
                id: 'floating-ball',
                isEnabled: () => config.on && config.disableFloatingBall !== true,
                mount: () => mountFloatingBall(ctx),
                unmount: unmountFloatingBall,
                isMounted: () => Boolean(document.getElementById('fluent-read-floating-ball-container')),
            },
            {
                id: 'selection-translator',
                isEnabled: () => config.on && config.disableSelectionTranslator !== true,
                mount: () => mountSelectionTranslator(ctx),
                unmount: unmountSelectionTranslator,
                isMounted: () => Boolean(document.getElementById('fluent-read-selection-translator-container')),
            },
            {
                id: 'selection-area-translator',
                requiredCapability: 'areaTranslation',
                isEnabled: () => config.on && config.selectionAreaEnabled === true,
                mount: () => mountAreaTranslator(ctx),
                unmount: unmountAreaTranslator,
                isMounted: isAreaTranslatorMounted,
            },
            {
                id: 'image-translator',
                requiredCapability: 'imageTranslation',
                isEnabled: () => config.on && config.disableImageTranslator !== true,
                mount: () => mountImageTranslator(),
                unmount: unmountImageTranslator,
            },
        ], {
            capabilities,
            onError: (featureId, phase, error) => {
                console.error(`[FluentRead] 内容功能 ${featureId} ${phase} 失败:`, error);
            },
        });
        activePageFeatureRegistry = pageFeatureRegistry;
        await pageFeatureRegistry.mountEnabled({
            ctx,
            signal: activationController.signal,
            isCurrent: isActivationCurrent,
        });
    };

    const applySiteDisabledState = async (disabled: boolean): Promise<void> => {
        if (cleanedUp) return;
        currentPageSiteDisabled = disabled;
        reportSiteDisabledState();
        if (disabled) {
            shouldAutomaticallyTranslate = false;
            setMainWorldBridgesEnabled(document, false);
            disposePageFeatures();
            return;
        }

        setMainWorldBridgesEnabled(document, true);
        await activatePageFeatures();
        if (cleanedUp || currentPageSiteDisabled) return;
        const nextShouldAutomaticallyTranslate = shouldAutomaticallyTranslateCurrentPage(config);
        const shouldStartNow = !shouldAutomaticallyTranslate && nextShouldAutomaticallyTranslate;
        shouldAutomaticallyTranslate = nextShouldAutomaticallyTranslate;
        if (shouldStartNow && !isFullPageTranslationActive()) autoTranslateEnglishPage();
    };

    const cleanup = (): void => {
        if (cleanedUp) return;
        cleanedUp = true;
        pageEventController.abort();
        setMainWorldBridgesEnabled(document, false);
        if (runtimeMessageListener) browser.runtime.onMessage.removeListener(runtimeMessageListener);
        disposePageFeatures();
        unsubscribeContentConfig?.();
        unsubscribeContentConfig = null;
    };
    ctx.onInvalidated(cleanup);
    window.addEventListener('beforeunload', cleanup, {once: true});

    runtimeMessageListener = createContentRuntimeMessageHandler(ctx, {
        isSiteDisabled: () => currentPageSiteDisabled, updateSiteDisabled: applySiteDisabledState,
    }, capabilities);
    browser.runtime.onMessage.addListener(runtimeMessageListener);
    reportSiteDisabledState();

    if (!currentPageSiteDisabled) {
        await activatePageFeatures();
        shouldAutomaticallyTranslate = shouldAutomaticallyTranslateCurrentPage(config);
        if (shouldAutomaticallyTranslate) autoTranslateEnglishPage();
    } else {
        setMainWorldBridgesEnabled(document, false);
    }

    unsubscribeContentConfig = subscribeConfig((nextConfig) => {
        const filterConfigChanged = configureCurrentTranslationFilters(nextConfig.translationFilter);
        const wasFullPageTranslationActive = filterConfigChanged && isFullPageTranslationActive();
        if (filterConfigChanged) {
            cancelPendingHoverTranslation();
            restoreOriginalContent();
            cancelAllTranslations();
        }
        const nextInputBoxConfigKey = inputBoxTranslationConfigKey(nextConfig);
        if (nextInputBoxConfigKey !== previousInputBoxConfigKey) {
            previousInputBoxConfigKey = nextInputBoxConfigKey;
            inputBoxConfigGeneration += 1;
            inputTranslationFeature.invalidate();
        }
        const nextSiteDisabled = isExtensionDisabledOnSite(
            window.location.href,
            nextConfig.disabledExtensionDomains,
        );
        if (nextSiteDisabled !== currentPageSiteDisabled) {
            void applySiteDisabledState(nextSiteDisabled);
            return;
        }

        if (nextSiteDisabled) {
            unmountTranslationProgressPanel();
            return;
        }
        if (nextConfig.translationProgressPanelEnabled === true) void mountTranslationProgressPanel(ctx);
        else unmountTranslationProgressPanel();

        if (wasFullPageTranslationActive) autoTranslateEnglishPage();

        const nextShouldAutomaticallyTranslate = shouldAutomaticallyTranslateCurrentPage(nextConfig);
        const shouldStartNow = !shouldAutomaticallyTranslate && nextShouldAutomaticallyTranslate;
        shouldAutomaticallyTranslate = nextShouldAutomaticallyTranslate;
        // 关闭“始终翻译”不撤销当前会话；只处理 false -> true，避免 storage.watch 同值回声。
        if (shouldStartNow && !isFullPageTranslationActive()) autoTranslateEnglishPage();
    });
}
