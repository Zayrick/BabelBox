import {services} from '@/src/core/config/catalog';
import {
    browserCapabilities,
    type BrowserCapabilities,
} from '@/src/platform/browser/capabilities';

export const CHROME_TRANSLATOR_UNAVAILABLE_MESSAGE =
    '当前浏览器暂不支持 Chrome 内置翻译；原配置会保留，请切换到其他翻译服务。';

export function isTranslationServiceAvailable(
    service: string,
    capabilities: BrowserCapabilities = browserCapabilities,
): boolean {
    return service !== services.chromeTranslator || capabilities.chromeTranslation;
}

export function getTranslationServiceUnavailableMessage(
    service: string,
    capabilities: BrowserCapabilities = browserCapabilities,
): string | null {
    return isTranslationServiceAvailable(service, capabilities)
        ? null
        : CHROME_TRANSLATOR_UNAVAILABLE_MESSAGE;
}

export function filterAvailableTranslationServices<TOption extends {readonly value: string}>(
    options: readonly TOption[],
    capabilities: BrowserCapabilities = browserCapabilities,
): TOption[] {
    return options.filter((option) => isTranslationServiceAvailable(option.value, capabilities));
}
