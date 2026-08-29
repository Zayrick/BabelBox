import {
    IMAGE_OCR_LANGUAGE_PACKS,
    normalizeImageOcrLanguageCodes,
    type ImageOcrLanguageCode,
} from '@/src/features/image-translation/ocrLanguages';

export const IMAGE_OCR_MESSAGE_TYPE = 'babelboxImageOcr' as const;
export const IMAGE_TRANSLATE_MESSAGE_TYPE = 'babelboxImageTranslate' as const;
export const IMAGE_TRANSLATE_TEXTS_MESSAGE_TYPE = 'babelboxImageTranslateTexts' as const;
export const IMAGE_OCR_DOWNLOAD_MESSAGE_TYPE = 'babelboxImageOcrDownload' as const;
export const IMAGE_FETCH_MESSAGE_TYPE = 'babelboxImageFetch' as const;

export interface ImageOcrMessage {
    type: typeof IMAGE_OCR_MESSAGE_TYPE;
    image?: unknown;
    sourceLanguage?: unknown;
}

export interface ImageTranslateMessage {
    type: typeof IMAGE_TRANSLATE_MESSAGE_TYPE;
    image?: unknown;
    sourceLanguage?: unknown;
    title?: unknown;
}

export interface ImageTranslateTextsMessage {
    type: typeof IMAGE_TRANSLATE_TEXTS_MESSAGE_TYPE;
    texts?: unknown;
    title?: unknown;
}

export interface ImageOcrDownloadMessage {
    type: typeof IMAGE_OCR_DOWNLOAD_MESSAGE_TYPE;
    languages?: unknown;
}

export interface ImageFetchMessage {
    type: typeof IMAGE_FETCH_MESSAGE_TYPE;
    url?: unknown;
}

export type ImageTranslationBackgroundMessage =
    | ImageOcrMessage
    | ImageTranslateMessage
    | ImageTranslateTextsMessage
    | ImageOcrDownloadMessage
    | ImageFetchMessage;

export interface ImageTranslationBackgroundDependencies {
    readonly assertLanguagesDownloaded: (sourceLanguage: string) => Promise<void>;
    readonly recognizeImage: (image: string, sourceLanguage: string) => Promise<unknown>;
    readonly translateImage: (image: string, sourceLanguage: string, title: string) => Promise<unknown>;
    readonly translateTexts: (request: {
        origin: string[];
        context: string;
        pageContext: '';
        useCache: true;
    }) => Promise<string | string[]>;
    readonly downloadLanguages: (languages: ImageOcrLanguageCode[]) => Promise<void>;
    readonly markLanguagesDownloaded: (languages: ImageOcrLanguageCode[]) => Promise<ImageOcrLanguageCode[]>;
    readonly fetchImage: (url: string) => Promise<string>;
}

export interface ImageTranslationBackgroundHandler<TMessage extends ImageTranslationBackgroundMessage> {
    readonly type: TMessage['type'];
    handle(message: TMessage): Promise<unknown>;
}

const SUPPORTED_OCR_LANGUAGES = new Set(IMAGE_OCR_LANGUAGE_PACKS.map((pack) => pack.code));

function parseDataImage(value: unknown): string {
    if (typeof value !== 'string' || !value.startsWith('data:image/')) {
        throw new TypeError('图片数据无效');
    }
    return value;
}

function parseRequiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new TypeError(`图片翻译 ${field} 必须是非空字符串`);
    }
    return value;
}

function parseOptionalTitle(value: unknown): string {
    if (value === undefined) return '';
    if (typeof value !== 'string') throw new TypeError('图片翻译 title 必须是字符串');
    return value;
}

function parseTexts(value: unknown): string[] {
    if (!Array.isArray(value) || value.length === 0) throw new TypeError('图片中没有可翻译文字');
    if (!value.every((text): text is string => typeof text === 'string' && text.trim().length > 0)) {
        throw new TypeError('图片翻译 texts 只能包含非空字符串');
    }
    return [...value];
}

function parseOcrLanguages(value: unknown): ImageOcrLanguageCode[] {
    if (!Array.isArray(value) || value.length === 0) throw new TypeError('OCR 语言包列表不能为空');
    if (!value.every((language): language is ImageOcrLanguageCode =>
        typeof language === 'string' && SUPPORTED_OCR_LANGUAGES.has(language as ImageOcrLanguageCode))) {
        throw new TypeError('OCR 语言包列表包含不支持的语言');
    }
    return normalizeImageOcrLanguageCodes(value);
}

function parseObjectResult(value: unknown, operation: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${operation}结果无效`);
    }
    return value as Record<string, unknown>;
}

/** 创建图片 OCR/翻译/下载/远程读取 handlers。 */
export function createImageTranslationBackgroundHandlers(
    dependencies: ImageTranslationBackgroundDependencies,
): ImageTranslationBackgroundHandler<ImageTranslationBackgroundMessage>[] {
    return [
        {
            type: IMAGE_OCR_MESSAGE_TYPE,
            async handle(message: ImageOcrMessage) {
                const image = parseDataImage(message.image);
                const sourceLanguage = parseRequiredString(message.sourceLanguage, 'sourceLanguage');
                await dependencies.assertLanguagesDownloaded(sourceLanguage);
                const lines = await dependencies.recognizeImage(image, sourceLanguage);
                if (!Array.isArray(lines)) throw new Error('图片 OCR 结果无效');
                return {success: true, lines};
            },
        },
        {
            type: IMAGE_TRANSLATE_MESSAGE_TYPE,
            async handle(message: ImageTranslateMessage) {
                const image = parseDataImage(message.image);
                const sourceLanguage = parseRequiredString(message.sourceLanguage, 'sourceLanguage');
                const title = parseOptionalTitle(message.title);
                await dependencies.assertLanguagesDownloaded(sourceLanguage);
                const result = parseObjectResult(
                    await dependencies.translateImage(image, sourceLanguage, title),
                    '图片翻译',
                );
                return {success: true, ...result};
            },
        },
        {
            type: IMAGE_TRANSLATE_TEXTS_MESSAGE_TYPE,
            async handle(message: ImageTranslateTextsMessage) {
                const texts = parseTexts(message.texts);
                const translations = await dependencies.translateTexts({
                    origin: texts,
                    context: parseOptionalTitle(message.title),
                    pageContext: '',
                    useCache: true,
                });
                if (!Array.isArray(translations)
                    || translations.length !== texts.length
                    || !translations.every((translation) => typeof translation === 'string')) {
                    throw new Error('图片文字翻译结果无效');
                }
                return {success: true, translations};
            },
        },
        {
            type: IMAGE_OCR_DOWNLOAD_MESSAGE_TYPE,
            async handle(message: ImageOcrDownloadMessage) {
                const languages = parseOcrLanguages(message.languages);
                await dependencies.downloadLanguages(languages);
                const downloaded = await dependencies.markLanguagesDownloaded(languages);
                return {success: true, languages: downloaded};
            },
        },
        {
            type: IMAGE_FETCH_MESSAGE_TYPE,
            async handle(message: ImageFetchMessage) {
                const url = parseRequiredString(message.url, 'url');
                const image = await dependencies.fetchImage(url);
                if (typeof image !== 'string' || !image.startsWith('data:image/')) {
                    throw new Error('远程图片结果无效');
                }
                return {success: true, image};
            },
        },
    ];
}
