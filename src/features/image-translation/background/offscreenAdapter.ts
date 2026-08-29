import type {OcrLine} from '@/src/features/image-translation/core';
import type {ImageOcrLanguageCode} from '@/src/features/image-translation/ocrLanguages';
import type {OffscreenImageTranslationResult} from '@/src/features/image-translation/services/offscreenRuntime';
import {
    chromeOffscreenClient,
    type OffscreenClient,
} from '@/src/platform/offscreen/client';

interface OffscreenResponse {
    readonly success?: boolean;
    readonly error?: string;
    readonly image?: unknown;
    readonly lines?: unknown;
}

function errorMessage(response: OffscreenResponse | undefined, fallback: string): string {
    return typeof response?.error === 'string' && response.error ? response.error : fallback;
}

function parseTranslationResult(
    response: OffscreenResponse | undefined,
    fallback: string,
): OffscreenImageTranslationResult {
    if (!response?.success || typeof response.image !== 'string' || !Array.isArray(response.lines)) {
        throw new Error(errorMessage(response, fallback));
    }
    return {image: response.image, lines: response.lines as OffscreenImageTranslationResult['lines']};
}

/** 图片 feature 对平台 Offscreen client 的唯一适配器。 */
export function createImageTranslationOffscreenAdapter(client: OffscreenClient = chromeOffscreenClient) {
    return {
        async recognizeImage(image: string, sourceLanguage: string): Promise<OcrLine[]> {
            const response = await client.send<OffscreenResponse>({
                type: 'BABELBOX_IMAGE_OCR_OFFSCREEN',
                image,
                sourceLanguage,
            });
            if (!response?.success || !Array.isArray(response.lines)) {
                throw new Error(errorMessage(response, '图片 OCR 失败'));
            }
            return response.lines as OcrLine[];
        },

        async translateImage(
            image: string,
            sourceLanguage: string,
            title: string,
        ): Promise<OffscreenImageTranslationResult> {
            const response = await client.send<OffscreenResponse>({
                type: 'BABELBOX_IMAGE_TRANSLATE_OFFSCREEN',
                image,
                sourceLanguage,
                title,
            });
            return parseTranslationResult(response, '图片翻译失败');
        },

        async downloadLanguages(languages: ImageOcrLanguageCode[]): Promise<void> {
            const response = await client.send<OffscreenResponse>({
                type: 'BABELBOX_IMAGE_OCR_DOWNLOAD_OFFSCREEN',
                languages,
            });
            if (!response?.success) throw new Error(errorMessage(response, '图片 OCR 语言包下载失败'));
        },
    };
}

export const imageTranslationOffscreenAdapter = createImageTranslationOffscreenAdapter();
