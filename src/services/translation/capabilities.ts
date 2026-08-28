import {services} from '@/src/core/config/catalog';
import {
    getTranslationServiceOptions,
    type TranslationServiceConfigLike,
    type TranslationServiceOption,
} from '@/src/core/config/translationServices';
import {
    browserCapabilities,
    type BrowserCapabilities,
} from '@/src/platform/browser/capabilities';

export const CHROME_TRANSLATOR_UNAVAILABLE_MESSAGE =
    '当前浏览器暂不支持 Chrome 内置翻译；原配置会保留，请切换到其他翻译服务。';

export function isTranslationServiceAvailable(
    service: string,
    capabilities: BrowserCapabilities = browserCapabilities,
    provider = service,
): boolean {
    return provider !== services.chromeTranslator || capabilities.chromeTranslation;
}

export function getTranslationServiceUnavailableMessage(
    service: string,
    capabilities: BrowserCapabilities = browserCapabilities,
    provider = service,
): string | null {
    return isTranslationServiceAvailable(service, capabilities, provider)
        ? null
        : CHROME_TRANSLATOR_UNAVAILABLE_MESSAGE;
}

export function filterAvailableTranslationServices<TOption extends {readonly value: string; readonly provider?: string}>(
    options: readonly TOption[],
    capabilities: BrowserCapabilities = browserCapabilities,
): TOption[] {
    return options.filter((option) => isTranslationServiceAvailable(
        option.value,
        capabilities,
        option.provider || option.value,
    ));
}

/** Single selector used by every service picker outside the management list. */
export function getSelectableTranslationServices(
    config: TranslationServiceConfigLike,
    capabilities: BrowserCapabilities = browserCapabilities,
): TranslationServiceOption[] {
    return filterAvailableTranslationServices(getTranslationServiceOptions(config, true), capabilities);
}
