import {translationProviderRegistry} from '@/src/providers/translation/registry';
import {AI_SDK_TRANSPORT_PROFILE, getAiSdkEndpointRoute, resolveOpenAICompatibleEndpoint} from '@/src/providers/translation/ai-sdk/endpoints';
import {config, configReady} from '@/src/services/config/store';
import {getMissingCredentialMessage} from '@/src/core/config/validation';
import {servicesType} from '@/src/core/config/catalog';
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
    describeEndpoint: (service) => getAiSdkEndpointRoute(service.provider)
        ? `${AI_SDK_TRANSPORT_PROFILE}:${resolveOpenAICompatibleEndpoint(service).endpoint}`
        : service.endpoint,
    isUseAIContext: servicesType.isUseAIContext,
    promptBuilder: {
        buildPageSummaryPrompt,
        buildPageSummarySystemPrompt,
    },
    getMissingCredentialMessage,
    getTranslationLanguages,
    buildTranslationCacheKey,
});

/** 扩展与 userscript 共用的翻译 broker singleton。 */
export const translateWithCache = broker.translateWithCache;
export const clearTranslationCache = broker.clearTranslationCache;
export const cleanupTranslationCache = broker.cleanupTranslationCache;
