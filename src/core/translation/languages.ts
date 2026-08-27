export interface TranslationLanguageOverride {
    sourceLanguage?: string;
    targetLanguage?: string;
}

export interface TranslationLanguageDefaults {
    sourceLanguage: string;
    targetLanguage: string;
}

export interface TranslationLanguages {
    sourceLanguage: string;
    targetLanguage: string;
}

function readLanguage(value: unknown, fallback: string): string {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

/**
 * 解析一次请求实际使用的语言对，不读取也不修改全局配置。
 *
 * Step 1: 请求级覆盖先经过空白清理。
 * Step 2: 缺失或空白值回退到调用方提供的配置快照。
 */
export function resolveTranslationLanguages(
    message: TranslationLanguageOverride | null | undefined,
    defaults: TranslationLanguageDefaults,
): TranslationLanguages {
    return {
        sourceLanguage: readLanguage(message?.sourceLanguage, defaults.sourceLanguage),
        targetLanguage: readLanguage(message?.targetLanguage, defaults.targetLanguage),
    };
}
