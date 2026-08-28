import {translateText, translateTextBatch} from '@/src/services/translation/client';
import {services} from '@/src/core/config/catalog';
import {getTranslationServiceProvider} from '@/src/core/config/translationServices';
import {
    createDocumentDownload as createDocumentDownloadWithAdapters,
    type CreateDocumentDownloadOptions,
} from '@/src/features/document-translation/services/binary';
import {createDocumentSegmentTranslator} from '@/src/features/document-translation/services/translation';
import {rasterizePdfTranslationPage} from '@/src/features/document-translation/ui/pdfPreview';
import {config, configReady} from '@/src/services/config/store';
import type {
    DocumentRenderMode,
    ParsedDocument,
} from '@/src/features/document-translation/core/document';

const BATCH_DOCUMENT_SERVICES = new Set<string>([
    services.microsoft,
    services.freeTranslation,
]);

/** WXT 组合根：把运行时配置和翻译 API 注入纯文档业务服务。 */
export const translateDocumentSegments = createDocumentSegmentTranslator({
    waitUntilReady: () => configReady,
    getDefaultService: () => config.service,
    supportsBatch: (service) => BATCH_DOCUMENT_SERVICES.has(
        getTranslationServiceProvider(config, service),
    ),
    translateText,
    translateTextBatch,
});

/** 浏览器组合根为 PDF 下载注入 Canvas rasterizer；其他格式仍走同一纯二进制服务。 */
export function createDocumentDownload(
    document: ParsedDocument,
    translations: readonly string[],
    mode: DocumentRenderMode,
    options: CreateDocumentDownloadOptions = {},
) {
    return createDocumentDownloadWithAdapters(document, translations, mode, {
        ...options,
        pdfPageRasterizer: options.pdfPageRasterizer ?? rasterizePdfTranslationPage,
    });
}
