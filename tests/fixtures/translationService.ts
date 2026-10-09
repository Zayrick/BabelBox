import {
    builtinTranslationProviders,
    createDefaultTranslationServices,
    createExternalTranslationService,
    EMPTY_TRANSLATION_SERVICE_CREDENTIAL,
    type TranslationServiceCredential,
    type TranslationServiceInstance,
} from '@/src/core/config/translationServices';
import type {
    ResolvedTranslationService,
    TranslationProviderRequest,
} from '@/src/services/translation/types';

/** A built-in or newly added service instance for the given provider. */
export function serviceInstance(
    provider: string,
    overrides: Partial<Omit<TranslationServiceInstance, 'provider' | 'kind'>> = {},
): TranslationServiceInstance {
    const base = builtinTranslationProviders.includes(provider)
        ? createDefaultTranslationServices().find((item) => item.provider === provider)!
        : createExternalTranslationService(provider);
    return {...base, ...overrides};
}

export function resolvedService(
    provider: string,
    overrides: Partial<Omit<TranslationServiceInstance, 'provider' | 'kind'>> = {},
    credential: Partial<TranslationServiceCredential> = {},
): ResolvedTranslationService {
    return {
        ...serviceInstance(provider, overrides),
        credential: {...EMPTY_TRANSLATION_SERVICE_CREDENTIAL, ...credential},
    };
}

export function providerRequest(
    service: ResolvedTranslationService,
    overrides: Partial<Omit<TranslationProviderRequest, 'service'>> = {},
): TranslationProviderRequest {
    return {
        service,
        origin: 'Hello',
        context: '',
        pageContext: '',
        sourceLanguage: 'auto',
        targetLanguage: 'zh-Hans',
        ...overrides,
    };
}
