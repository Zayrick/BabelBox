import type {AreaTranslationSelection} from '@/src/features/area-translation/core';
import type {OffscreenImageTranslationResult} from '@/src/features/image-translation/public';
import {
    chromeOffscreenClient,
    type OffscreenClient,
} from '@/src/platform/offscreen/client';

interface AreaOffscreenResponse {
    readonly success?: boolean;
    readonly error?: string;
    readonly image?: unknown;
    readonly lines?: unknown;
}

/** 圈选 feature 只声明自身消息，文档创建和 runtime callback 由平台 client 负责。 */
export function createAreaTranslationOffscreenAdapter(client: OffscreenClient = chromeOffscreenClient) {
    return {
        async translateArea(
            image: string,
            sourceLanguage: string,
            title: string,
            selection: AreaTranslationSelection,
        ): Promise<OffscreenImageTranslationResult> {
            const response = await client.send<AreaOffscreenResponse>({
                type: 'BABELBOX_AREA_TRANSLATE_OFFSCREEN',
                image,
                sourceLanguage,
                title,
                selection,
            });
            if (!response?.success || typeof response.image !== 'string' || !Array.isArray(response.lines)) {
                throw new Error(response?.error || '圈选翻译失败');
            }
            return {image: response.image, lines: response.lines as OffscreenImageTranslationResult['lines']};
        },
    };
}

export const areaTranslationOffscreenAdapter = createAreaTranslationOffscreenAdapter();
