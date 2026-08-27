import {resolveTranslationLanguages} from '@/src/core/translation/languages';
import type {TranslationLanguageOverride} from '@/src/core/translation/languages';
import {config} from '@/src/services/config/store';

export type {TranslationLanguageOverride} from '@/src/core/translation/languages';

/**
 * Resolve the language pair attached to a translation request without mutating
 * the shared extension configuration. This keeps comparison requests isolated
 * when several services are translated at the same time.
 */
export function getTranslationLanguages(message?: TranslationLanguageOverride | null): {
    sourceLanguage: string;
    targetLanguage: string;
} {
    return resolveTranslationLanguages(message, {
        sourceLanguage: config.from,
        targetLanguage: config.to,
    });
}
