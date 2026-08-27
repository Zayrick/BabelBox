import { createWorker, PSM, type Worker } from 'tesseract.js';
import { getOcrLanguages, normalizeOcrLines, type OcrLine } from '@/src/features/image-translation/core';
import type { ImageOcrLanguageCode } from '@/src/features/image-translation/ocrLanguages';
import { createOcrWorkerRuntime, type OcrWorkerPort } from './ocrWorkerRuntime';

function extensionAsset(path: string): string {
    const getRuntimeUrl = chrome.runtime.getURL as (assetPath: string) => string;
    return getRuntimeUrl(`/fluent-read-ocr/${path}`);
}

type TesseractRecognitionResult = Awaited<ReturnType<Worker['recognize']>>;

const ocrWorkerRuntime = createOcrWorkerRuntime<TesseractRecognitionResult>({
    sparseTextMode: PSM.SPARSE_TEXT,
    createWorker: async languages => createWorker(languages, 1, {
        workerPath: extensionAsset('worker/worker.min.js'),
        corePath: extensionAsset('core'),
        cachePath: 'fluent-read-image-ocr',
        // 不再把 traineddata 打进扩展；Tesseract.js 会从 jsDelivr 按需下载，
        // 并将解压后的语言包缓存到 Offscreen Document 的 IndexedDB。
        // Offscreen 页面拥有扩展源，直接加载本地 worker 可避免 Blob Worker 的 CSP/源限制。
        workerBlobURL: false,
    }) as unknown as Promise<OcrWorkerPort<TesseractRecognitionResult>>,
});

export async function recognizeImage(image: string, sourceLanguage: string): Promise<OcrLine[]> {
    const languages = getOcrLanguages(sourceLanguage).join('+');
    const result = await ocrWorkerRuntime.recognize(image, languages);
    return normalizeOcrLines(result.data.blocks);
}

export async function downloadImageOcrLanguages(languages: ImageOcrLanguageCode[]): Promise<void> {
    await ocrWorkerRuntime.ensureLanguages(languages);
}
