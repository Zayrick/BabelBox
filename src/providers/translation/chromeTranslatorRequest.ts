import {resolveTranslationLanguages, type TranslationLanguageDefaults} from '@/src/core/translation/languages';

export interface ChromeTranslatorMessage {
    readonly origin?: unknown;
    readonly sourceLanguage?: unknown;
    readonly targetLanguage?: unknown;
}

export interface ChromeOffscreenTranslationData {
    readonly text: string;
    readonly from: string;
    readonly to: string;
}

/**
 * Provider payload 与 broker 缓存身份必须使用同一组请求级语言覆盖。
 * 该纯函数刻意不读取全局 config，调用方只传入当次配置快照。
 */
export function buildChromeOffscreenTranslationData(
    message: ChromeTranslatorMessage,
    defaults: TranslationLanguageDefaults,
): ChromeOffscreenTranslationData {
    if (typeof message.origin !== 'string' || !message.origin.trim()) {
        throw new TypeError('翻译文本不能为空');
    }
    const override = {
        sourceLanguage: typeof message.sourceLanguage === 'string' ? message.sourceLanguage : undefined,
        targetLanguage: typeof message.targetLanguage === 'string' ? message.targetLanguage : undefined,
    };
    const {sourceLanguage, targetLanguage} = resolveTranslationLanguages(override, defaults);
    return {
        text: message.origin,
        from: sourceLanguage,
        to: targetLanguage,
    };
}
