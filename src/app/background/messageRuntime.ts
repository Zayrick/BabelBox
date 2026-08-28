import {browser} from 'wxt/browser';
import {
    formatConnectionTestError,
    formatTranslationModelCatalogError,
    listTranslationServiceModels,
    runTranslationServiceConnectionTest,
    translateMicrosoftTexts,
} from './providerRuntime';
import {
    applyConfigHistoryAction,
    config,
    configReady,
    prepareConfigSaveRequest,
    saveConfig,
} from '@/src/services/config/store';
import {synthesizeEdgeTts} from '@/src/features/selection-translation/services/edgeTts';
import {lookupWord} from '@/src/features/selection-translation/services/wordDictionary';
import {vocabularyBook} from '@/src/features/vocabulary/repository';
import {clearTranslationCache, translateWithCache} from '@/src/app/translation/runtime';
import {serializeTranslationError} from '@/src/services/translation/errors';
import {createBackgroundMessageRouter, type BackgroundMessageHandler} from '@/src/platform/browser/messageRouter';
import {
    createAreaTranslationBackgroundHandlers,
    type AreaTranslationBackgroundContext,
} from './handlers/areaTranslation';
import {createConfigHistoryHandler} from './handlers/configHistory';
import {createTranslationCacheHandler} from './handlers/translationCache';
import {createConfigPersistenceHandler, type ConfigPersistenceContext} from './handlers/configPersistence';
import {createConnectionTestHandler} from './handlers/connectionTest';
import {createTranslationModelCatalogHandler} from './handlers/modelCatalog';
import {
    createFullPageTranslationStateHandlers,
    type FullPageBackgroundContext,
} from './handlers/fullPageTranslationState';
import {
    createImageOcrLanguageRepository,
    createImageTranslationBackgroundHandlers,
    fetchRemoteImageForOcr,
} from './handlers/imageTranslation';
import {createInputBoxTranslationHandler} from './handlers/inputTranslation';
import {createOpenOptionsPageHandler} from './handlers/openOptions';
import {createTranslationRequestHandler} from './handlers/translation';
import {createSelectionTtsBackgroundHandlers, type SelectionTtsContext} from './handlers/selectionTts';
import {createSelectionWordLookupHandler} from './handlers/selectionWordLookup';
import {isBrowserTabId, type TabTranslationStateStore} from './tabTranslationState';
import {
    createBrowserVocabularyBookChangedBroadcaster,
    createVocabularyBackgroundHandlers,
    type VocabularyBackgroundContext,
} from './handlers/vocabulary';
import {browserCapabilities, type BrowserCapabilities} from '@/src/platform/browser/capabilities';
import {areaTranslationOffscreenAdapter} from '@/src/features/area-translation/background/offscreenAdapter';
import {imageTranslationOffscreenAdapter} from '@/src/features/image-translation/background/offscreenAdapter';
import {selectionTtsOffscreenAdapter} from '@/src/features/selection-translation/background/offscreenAdapter';
import {createCapabilityGatedBackgroundHandlers, createCapabilityGatedSelectionTtsTransport} from './capabilityRegistry';

type BackgroundRuntimeContext = ConfigPersistenceContext
    & VocabularyBackgroundContext
    & SelectionTtsContext
    & FullPageBackgroundContext
    & AreaTranslationBackgroundContext;
export interface BackgroundMessageRuntimeOptions {
    tabTranslationStates: TabTranslationStateStore;
    onFullPageStateChanged(tabId: number): void;
    capabilities?: BrowserCapabilities;
}

/** 用静态 handler registry 组装唯一的 runtime.onMessage 入口。 */
export function installBackgroundMessageRuntime(options: BackgroundMessageRuntimeOptions): void {
    const capabilities = options.capabilities ?? browserCapabilities;
    const imageOcrLanguageRepository = createImageOcrLanguageRepository({
        get: (key) => browser.storage.local.get(key),
        set: (values) => browser.storage.local.set(values),
    });
    const selectionTtsTransport = createCapabilityGatedSelectionTtsTransport(capabilities, selectionTtsOffscreenAdapter);
    const handlers: Array<BackgroundMessageHandler<BackgroundRuntimeContext>> = [
        createTranslationRequestHandler({
            translate: translateWithCache,
            serializeError: serializeTranslationError,
        }),
        createTranslationCacheHandler(clearTranslationCache),
        createConfigHistoryHandler(applyConfigHistoryAction),
        createConfigPersistenceHandler({
            ready: configReady,
            getCurrentConfig: () => config,
            prepareConfigSaveRequest,
            saveConfig,
            isExtensionUrl: (url) => url.startsWith(browser.runtime.getURL('/')),
        }),
        createConnectionTestHandler({
            ready: configReady,
            runConnectionTest: runTranslationServiceConnectionTest,
            formatError: formatConnectionTestError,
        }),
        createTranslationModelCatalogHandler({
            ready: configReady,
            listModels: listTranslationServiceModels,
            formatError: formatTranslationModelCatalogError,
        }),
        createInputBoxTranslationHandler({
            translateText: async (text, targetLanguage) => {
                const translations = await translateMicrosoftTexts([text], '', targetLanguage);
                return translations[0] || '';
            },
        }),
        createOpenOptionsPageHandler({
            openDefaultPage: () => browser.runtime.openOptionsPage(),
            openSection: async (section) => {
                await browser.tabs.create({url: `${browser.runtime.getURL('/options.html')}#${section}`});
            },
        }),
        ...createFullPageTranslationStateHandlers({
            stateStore: options.tabTranslationStates,
            isTabId: isBrowserTabId,
            onStateChanged: options.onFullPageStateChanged,
        }),
        createSelectionWordLookupHandler({
            lookupWord,
            getDefaultTargetLanguage: () => config.to,
            translate: translateWithCache,
            warn: (message, error) => console.warn(message, error),
        }),
        ...createCapabilityGatedBackgroundHandlers(capabilities, {
            areaTranslation: () => createAreaTranslationBackgroundHandlers({
                captureVisibleTab: (windowId) => browser.tabs.captureVisibleTab(windowId, {format: 'png'}),
                getDefaultSourceLanguage: () => config.from,
                assertLanguagesDownloaded: imageOcrLanguageRepository.assertDownloaded,
                translateArea: areaTranslationOffscreenAdapter.translateArea,
            }),
            imageTranslation: () => createImageTranslationBackgroundHandlers({
                assertLanguagesDownloaded: imageOcrLanguageRepository.assertDownloaded,
                recognizeImage: imageTranslationOffscreenAdapter.recognizeImage,
                translateImage: imageTranslationOffscreenAdapter.translateImage,
                translateTexts: translateWithCache,
                downloadLanguages: imageTranslationOffscreenAdapter.downloadLanguages,
                markLanguagesDownloaded: imageOcrLanguageRepository.markDownloaded,
                fetchImage: (url) => fetchRemoteImageForOcr(
                    url,
                    (requestUrl, init) => fetch(requestUrl, init),
                ),
            }),
        }),
        ...createSelectionTtsBackgroundHandlers({
            getPreferredVoices: () => config.selectionTtsVoices,
            synthesize: synthesizeEdgeTts,
            playWithOffscreen: selectionTtsTransport.play,
            stopWithOffscreen: selectionTtsTransport.stop,
            offscreenPlaybackEnabled: capabilities.selectionTtsOffscreen,
            sendTabMessage: (tabId, message) => browser.tabs.sendMessage(tabId, message),
            warn: (message, error) => console.warn(message, error),
        }),
        ...createVocabularyBackgroundHandlers({
            configReady,
            isVocabularyBookEnabled: () => config.vocabularyBookEnabled === true,
            vocabularyBook,
            broadcastChanged: createBrowserVocabularyBookChangedBroadcaster({
                sendRuntimeMessage: (message) => browser.runtime.sendMessage(message),
                queryTabs: () => browser.tabs.query({}) as Promise<Array<{id?: number}>>,
                sendTabMessage: (tabId, message) => browser.tabs.sendMessage(tabId, message),
            }),
            logOperationFailure: (error) => console.error('[FluentRead] vocabulary book operation failed:', error),
        }),
    ];
    const router = createBackgroundMessageRouter(handlers);

    browser.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
        void router.dispatch(message, {sender}).then((dispatch) => {
            sendResponse(dispatch.handled
                ? dispatch.response
                : {success: false, error: '不支持的后台消息'});
        }, (error) => {
            sendResponse({success: false, error: error instanceof Error ? error.message : String(error)});
        });
        // Chromium 只有在同步返回 true 时才会为异步 sendResponse 保持消息通道。
        return true;
    });
}
