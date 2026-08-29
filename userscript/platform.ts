import {translateMicrosoftTexts} from '@/src/providers/translation/microsoft';
import {runTranslationServiceConnectionTest} from '@/src/providers/translation/connectionTest';
import {
    applyConfigHistoryAction,
    config,
    configReady,
    CONFIG_HISTORY_MESSAGE,
    CONFIG_PERSIST_MESSAGE,
    saveConfig,
} from '@/src/services/config/store';
import {
    CONFIG_COUNT_INCREMENT_MESSAGE,
    parseConfigCountIncrement,
} from '@/src/services/config/count';
import {CONNECTION_TEST_MESSAGE} from '@/src/core/config/constants';
import {
    TRANSLATION_MODEL_CATALOG_MESSAGE,
} from '@/src/services/translation/modelCatalog';
import {
    formatTranslationModelCatalogError,
    listTranslationServiceModels,
} from '@/src/providers/translation/modelCatalog';
import {
    cleanupTranslationCache,
    clearTranslationCache,
    translateWithCache,
} from '@/src/app/translation/runtime';
import {lookupWord} from '@/src/features/selection-translation/services/wordDictionary';
import {UNHANDLED_RUNTIME_MESSAGE} from './browser';

const UNSUPPORTED_CAPABILITY_MESSAGE = '该功能依赖浏览器扩展权限，userscript 版本暂不支持';

export function createPlatformMessageHandler(openSettings: () => void) {
    return async (message: any): Promise<any> => {
        if (!message || typeof message !== 'object') return UNHANDLED_RUNTIME_MESSAGE;

        if (message.type === 'openOptionsPage') {
            openSettings();
            return {success: true};
        }

        if (message.type === 'fullPageTranslationState') return {success: true};

        if (message.type === CONFIG_PERSIST_MESSAGE) {
            await saveConfig(message.config, {recordHistory: true});
            return {success: true};
        }

        if (message.type === CONFIG_COUNT_INCREMENT_MESSAGE) {
            if (parseConfigCountIncrement(message.delta) === null) {
                return {success: false, error: '无效的翻译计数增量'};
            }
            await saveConfig(config);
            return {success: true, count: config.count};
        }

        if (message.type === CONFIG_HISTORY_MESSAGE) {
            const action = message.action === 'undo' || message.action === 'redo' || message.action === 'restore'
                ? message.action
                : null;
            if (!action) return {success: false, error: '无效的配置历史操作'};
            const history = await applyConfigHistoryAction(action, typeof message.version === 'number' ? message.version : undefined);
            return {success: true, history};
        }

        if (message.type === CONNECTION_TEST_MESSAGE) {
            await configReady;
            try {
                const result = await runTranslationServiceConnectionTest(String(message.service || ''));
                return {success: true, ...result};
            } catch (error) {
                return {success: false, error: error instanceof Error ? error.message : String(error)};
            }
        }

        if (message.type === TRANSLATION_MODEL_CATALOG_MESSAGE) {
            await configReady;
            try {
                const source = message.config && typeof message.config === 'object'
                    ? message.config
                    : config;
                const models = await listTranslationServiceModels(String(message.service || ''), source);
                return {success: true, models};
            } catch (error) {
                return {success: false, error: formatTranslationModelCatalogError(error)};
            }
        }

        if (message.type === 'inputBoxTranslation') {
            try {
                const translations = await translateMicrosoftTexts([String(message.text || '')], '', String(message.targetLang || 'zh-Hans'));
                return {success: true, translatedText: translations[0] || String(message.text || '')};
            } catch (error) {
                return {success: false, error: error instanceof Error ? error.message : String(error)};
            }
        }

        if (message.type === 'selectionWordLookup') {
            try {
                return {success: true, data: await lookupWord(String(message.word || ''))};
            } catch (error) {
                return {success: false, error: error instanceof Error ? error.message : String(error)};
            }
        }

        if (message.type === 'selectionTts' || message.type === 'selectionTtsGoogle' || message.type === 'selectionTtsStop') {
            // SelectionTranslator automatically falls back to speechSynthesis
            // and page audio when this transport reports unavailable.
            return {success: false, error: 'userscript 使用网页语音回退'};
        }

        if (message.type === 'clearTranslationCache') {
            await clearTranslationCache();
            return {success: true};
        }

        if (message.type === 'userscriptCacheMaintenance') {
            await cleanupTranslationCache();
            return {success: true};
        }

        if (typeof message.type === 'string' && (
            message.type === 'toggleSelectionAreaTranslator' ||
            message.type === 'toggleImageTranslator' ||
            message.type.startsWith('babelboxImage') ||
            message.type.startsWith('babelboxArea')
        )) {
            return {success: false, error: UNSUPPORTED_CAPABILITY_MESSAGE};
        }

        if (typeof message.origin === 'string' || Array.isArray(message.origin)) {
            return translateWithCache(message);
        }

        return UNHANDLED_RUNTIME_MESSAGE;
    };
}
