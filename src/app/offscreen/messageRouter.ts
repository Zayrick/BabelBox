import type {AreaTranslationSelection} from '@/src/features/area-translation/protocol';
import {OFFSCREEN_READY_MESSAGE_TYPE} from '@/src/platform/offscreen/client';
import {
    IMAGE_OCR_LANGUAGE_PACKS,
    normalizeImageOcrLanguageCodes,
    type ImageOcrLanguageCode,
} from '@/src/features/image-translation/ocrLanguages';
import type {SelectionTtsPlayer} from './ttsPlayback';
import {parseLanguageCode} from './translation';

export type OffscreenSendResponse = (response: unknown) => void;

export interface OffscreenMessageDependencies {
    readonly translate: (data: unknown) => Promise<string>;
    readonly ttsPlayer: Pick<SelectionTtsPlayer, 'play' | 'stop'>;
    readonly recognizeImage: (image: string, sourceLanguage: string) => Promise<unknown>;
    readonly translateImage: (image: string, sourceLanguage: string, title: string) => Promise<unknown>;
    readonly translateArea: (
        image: string,
        sourceLanguage: string,
        title: string,
        selection: AreaTranslationSelection,
    ) => Promise<unknown>;
    readonly downloadOcrLanguages: (languages: ImageOcrLanguageCode[]) => Promise<void>;
}

type OffscreenMessageListener = (
    message: unknown,
    sender: unknown,
    sendResponse: OffscreenSendResponse,
) => boolean;

const SUPPORTED_OCR_LANGUAGES = new Set(IMAGE_OCR_LANGUAGE_PACKS.map((pack) => pack.code));

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredString(value: unknown, field: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(`Offscreen ${field} 必须是非空字符串`);
    return value;
}

function requiredImage(value: unknown): string {
    const image = requiredString(value, 'image');
    if (!image.startsWith('data:image/')) throw new TypeError('Offscreen image 必须是 data:image URL');
    return image;
}

function requiredSourceLanguage(value: unknown): string {
    return parseLanguageCode(value, 'sourceLanguage', true);
}

function optionalTitle(value: unknown): string {
    if (value === undefined) return '';
    if (typeof value !== 'string') throw new TypeError('Offscreen title 必须是字符串');
    return value;
}

function parseSelection(value: unknown): AreaTranslationSelection {
    if (!isRecord(value)) throw new TypeError('Offscreen selection 必须是对象');
    const fields = ['left', 'top', 'width', 'height', 'viewportWidth', 'viewportHeight'] as const;
    const numbers = Object.fromEntries(fields.map((field) => {
        const fieldValue = value[field];
        if (typeof fieldValue !== 'number' || !Number.isFinite(fieldValue)) {
            throw new TypeError(`Offscreen selection.${field} 必须是有限数字`);
        }
        return [field, fieldValue];
    })) as unknown as AreaTranslationSelection;
    if (numbers.left < 0 || numbers.top < 0 || numbers.width <= 0 || numbers.height <= 0
        || numbers.viewportWidth <= 0 || numbers.viewportHeight <= 0) {
        throw new TypeError('Offscreen selection 尺寸无效');
    }
    return numbers;
}

function parseOcrLanguages(value: unknown): ImageOcrLanguageCode[] {
    if (!Array.isArray(value) || value.length === 0) throw new TypeError('Offscreen OCR languages 必须是非空数组');
    if (!value.every((language): language is ImageOcrLanguageCode =>
        typeof language === 'string' && SUPPORTED_OCR_LANGUAGES.has(language as ImageOcrLanguageCode))) {
        throw new TypeError('Offscreen OCR languages 包含不支持的语言');
    }
    return normalizeImageOcrLanguageCodes(value);
}

function resultRecord(value: unknown, operation: string): Record<string, unknown> {
    if (!isRecord(value)) throw new Error(`${operation}结果无效`);
    return value;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function respondWith(
    operation: () => Promise<unknown>,
    sendResponse: OffscreenSendResponse,
    shape: (result: unknown) => unknown = (result) => ({success: true, result}),
): void {
    void Promise.resolve()
        .then(operation)
        .then((result) => sendResponse(shape(result)))
        .catch((error) => sendResponse({success: false, error: errorMessage(error)}));
}

/** 静态路由 Offscreen 消息；未知或非对象消息不会占用其他 runtime listener。 */
export function createOffscreenMessageListener(dependencies: OffscreenMessageDependencies): OffscreenMessageListener {
    return (message, _sender, sendResponse) => {
        if (!isRecord(message) || typeof message.type !== 'string') return false;
        if (message.target !== 'offscreen') return false;

        switch (message.type) {
            case OFFSCREEN_READY_MESSAGE_TYPE:
                sendResponse({success: true, ready: true});
                return true;
            case 'PLAY_SELECTION_TTS':
                respondWith(() => dependencies.ttsPlayer.play(message), sendResponse, () => ({success: true}));
                return true;
            case 'STOP_SELECTION_TTS':
                respondWith(async () => dependencies.ttsPlayer.stop(message), sendResponse, () => ({success: true}));
                return true;
            case 'CHROME_TRANSLATE_OFFSCREEN':
                respondWith(() => dependencies.translate(message.data), sendResponse);
                return true;
            case 'FLUENT_READ_IMAGE_OCR_OFFSCREEN':
                respondWith(
                    () => dependencies.recognizeImage(
                        requiredImage(message.image),
                        requiredSourceLanguage(message.sourceLanguage),
                    ),
                    sendResponse,
                    (lines) => {
                        if (!Array.isArray(lines)) throw new Error('图片 OCR 结果无效');
                        return {success: true, lines};
                    },
                );
                return true;
            case 'FLUENT_READ_IMAGE_TRANSLATE_OFFSCREEN':
                respondWith(
                    () => dependencies.translateImage(
                        requiredImage(message.image),
                        requiredSourceLanguage(message.sourceLanguage),
                        optionalTitle(message.title),
                    ),
                    sendResponse,
                    (result) => ({...resultRecord(result, '图片翻译'), success: true}),
                );
                return true;
            case 'FLUENT_READ_AREA_TRANSLATE_OFFSCREEN':
                respondWith(
                    () => dependencies.translateArea(
                        requiredImage(message.image),
                        requiredSourceLanguage(message.sourceLanguage),
                        optionalTitle(message.title),
                        parseSelection(message.selection),
                    ),
                    sendResponse,
                    (result) => ({...resultRecord(result, '区域翻译'), success: true}),
                );
                return true;
            case 'FLUENT_READ_IMAGE_OCR_DOWNLOAD_OFFSCREEN':
                respondWith(
                    () => dependencies.downloadOcrLanguages(parseOcrLanguages(message.languages)),
                    sendResponse,
                    () => ({success: true}),
                );
                return true;
            default:
                return false;
        }
    };
}
