import {translationProviderRegistry} from '@/src/providers/translation/registry';
import {AI_SDK_TRANSPORT_PROFILE, resolveOpenAICompatibleEndpoint} from '@/src/providers/translation/ai-sdk/endpoints';
import {config, configReady} from '@/src/services/config/store';
import {getMimoEndpoint, MINIMAX_ENDPOINTS} from '@/src/core/config/constants';
import {getMissingCredentialMessage} from '@/src/core/config/validation';
import {resolveConfiguredModel, services, servicesType} from '@/src/core/config/catalog';
import {buildPageSummaryPrompt, buildPageSummarySystemPrompt} from '@/src/core/translation/prompts';
import {getTranslationLanguages} from '@/src/services/translation/languages';
import {createTranslationBroker} from '@/src/services/translation/broker';
import {buildTranslationCacheKey, translationCache} from '@/src/services/translation/cache';

export type {
    TranslationBatchRequestMessage,
    TranslationBroker,
    TranslationBrokerDependencies,
    TranslationProvider,
    TranslationProviderRegistry,
    TranslationRequestMessage,
    TranslationRequestMessageBase,
    TranslationSingleRequestMessage,
} from '@/src/services/translation/broker';

const broker = createTranslationBroker({
    ready: configReady,
    getConfig: () => config,
    providers: translationProviderRegistry,
    cache: translationCache,
    serviceIds: {
        minimax: services.minimax,
        mimo: services.mimo,
    },
    serviceTypes: servicesType,
    endpointResolver: {
        resolveOpenAICompatibleEndpoint,
        getMimoEndpoint,
        minimaxEndpoints: MINIMAX_ENDPOINTS,
        aiSdkTransportProfile: AI_SDK_TRANSPORT_PROFILE,
    },
    promptBuilder: {
        buildPageSummaryPrompt,
        buildPageSummarySystemPrompt,
    },
    getMissingCredentialMessage,
    getTranslationLanguages,
    resolveConfiguredModel,
    buildTranslationCacheKey,
});

/** 扩展与 userscript 共用的翻译 broker singleton。 */
export const translateWithCache = broker.translateWithCache;
export const clearTranslationCache = broker.clearTranslationCache;
export const cleanupTranslationCache = broker.cleanupTranslationCache;
