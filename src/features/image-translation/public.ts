export {
    mountImageTranslator,
    unmountImageTranslator,
} from './content';
export {
    IMAGE_OCR_LANGUAGE_PACKS,
    IMAGE_OCR_LANGUAGE_STATE_KEY,
    IMAGE_OCR_RECOMMENDED_LANGUAGES,
    normalizeImageOcrLanguageCodes,
    type ImageOcrLanguageCode,
} from './ocrLanguages';
export type {
    OffscreenImageTranslationLine,
    OffscreenImageTranslationResult,
} from './services/offscreenRuntime';
export {default as ImageOcrSettings} from './ui/ImageOcrSettings.vue';
