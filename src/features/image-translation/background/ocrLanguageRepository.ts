import {
    getRequiredImageOcrLanguages,
    IMAGE_OCR_LANGUAGE_PACKS,
    IMAGE_OCR_LANGUAGE_STATE_KEY,
    normalizeImageOcrLanguageCodes,
    type ImageOcrLanguageCode,
} from '@/src/features/image-translation/ocrLanguages';

export interface ImageOcrLanguageStorage {
    get(key: string): Promise<Record<string, unknown>>;
    set(values: Record<string, unknown>): Promise<void>;
}

export interface ImageOcrLanguageRepository {
    getDownloaded(): Promise<ImageOcrLanguageCode[]>;
    markDownloaded(languages: ImageOcrLanguageCode[]): Promise<ImageOcrLanguageCode[]>;
    assertDownloaded(sourceLanguage: string): Promise<void>;
}

/** 创建 OCR 语言包仓库；browser.storage.local 仅通过 adapter 注入。 */
export function createImageOcrLanguageRepository(
    storage: ImageOcrLanguageStorage,
): ImageOcrLanguageRepository {
    const getDownloaded = async (): Promise<ImageOcrLanguageCode[]> => {
        const stored = await storage.get(IMAGE_OCR_LANGUAGE_STATE_KEY);
        return normalizeImageOcrLanguageCodes(stored[IMAGE_OCR_LANGUAGE_STATE_KEY]);
    };

    return {
        getDownloaded,
        async markDownloaded(languages) {
            const downloaded = new Set(await getDownloaded());
            for (const language of languages) downloaded.add(language);
            const next = normalizeImageOcrLanguageCodes([...downloaded]);
            await storage.set({[IMAGE_OCR_LANGUAGE_STATE_KEY]: next});
            return next;
        },
        async assertDownloaded(sourceLanguage) {
            const downloaded = new Set(await getDownloaded());
            const missing = getRequiredImageOcrLanguages(sourceLanguage)
                .filter((language) => !downloaded.has(language));
            if (missing.length === 0) return;

            const labels = new Map(IMAGE_OCR_LANGUAGE_PACKS.map((pack) => [pack.code, pack.label]));
            const missingLabels = missing.map((language) => labels.get(language)!).join('、');
            throw new Error(`图片文字识别需要先下载${missingLabels}语言包，请前往设置 > 图片翻译下载`);
        },
    };
}
