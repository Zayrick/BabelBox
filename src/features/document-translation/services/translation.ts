import type {DocumentSegment} from '@/src/features/document-translation/core/document';

export interface DocumentTranslationProgress {
    completed: number;
    total: number;
}

export interface DocumentTranslationOptions {
    fileName: string;
    pageContext?: string;
    serviceOverride?: string;
    modelOverride?: string;
    sourceLanguage?: string;
    targetLanguage?: string;
    signal?: AbortSignal;
    onProgress?: (progress: DocumentTranslationProgress) => void;
}

export interface DocumentTranslationRequestOptions {
    signal?: AbortSignal;
    pageContext: string;
    serviceOverride?: string;
    modelOverride?: string;
    sourceLanguage?: string;
    targetLanguage?: string;
}

/**
 * 文档翻译只依赖这一组端口，不读取 WXT storage 或具体 provider。
 * 入口层负责把当前配置、批量能力和翻译客户端注入进来。
 */
export interface DocumentTranslationGateway {
    waitUntilReady(): PromiseLike<unknown> | unknown;
    getDefaultService(): string;
    supportsBatch(service: string): boolean;
    translateText(
        source: string,
        context: string,
        options: DocumentTranslationRequestOptions,
    ): Promise<string>;
    translateTextBatch(
        sources: string[],
        context: string,
        options: DocumentTranslationRequestOptions,
    ): Promise<string[]>;
}

export type TranslateDocumentSegments = (
    segments: readonly DocumentSegment[],
    options: DocumentTranslationOptions,
) => Promise<string[]>;

const BATCH_ITEM_LIMIT = 16;
const BATCH_CHARACTER_LIMIT = 3_500;

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        const error = new Error('文档翻译已取消');
        error.name = 'AbortError';
        throw error;
    }
}

function splitBatches(segments: readonly DocumentSegment[]): DocumentSegment[][] {
    const batches: DocumentSegment[][] = [];
    let current: DocumentSegment[] = [];
    let currentCharacters = 0;

    segments.forEach((segment) => {
        const nextCharacters = currentCharacters + segment.source.length;
        if (current.length > 0 && (current.length >= BATCH_ITEM_LIMIT || nextCharacters > BATCH_CHARACTER_LIMIT)) {
            batches.push(current);
            current = [];
            currentCharacters = 0;
        }
        current.push(segment);
        currentCharacters += segment.source.length;
    });

    if (current.length > 0) batches.push(current);
    return batches;
}

function buildDocumentContext(segments: readonly DocumentSegment[], fileName: string, supplied?: string): string {
    if (supplied?.trim()) return supplied.trim().slice(0, 4_000);
    const preview = segments
        .slice(0, 24)
        .map((segment) => segment.source)
        .join('\n')
        .trim();
    return `Document: ${fileName}\n${preview}`.slice(0, 4_000);
}

export function createDocumentSegmentTranslator(
    gateway: DocumentTranslationGateway,
): TranslateDocumentSegments {
    return async (segments, options) => {
        await gateway.waitUntilReady();
        throwIfAborted(options.signal);

        if (segments.length === 0) return [];
        const translations = new Array<string>(segments.length);
        const context = options.fileName || 'FluentRead 文档';
        const pageContext = buildDocumentContext(segments, context, options.pageContext);
        // 一次文档任务固定语言对，不能被设置页同步更新或用户中途改选污染后续批次。
        const sourceLanguage = options.sourceLanguage;
        const targetLanguage = options.targetLanguage;
        let completed = 0;
        const reportProgress = () => options.onProgress?.({completed, total: segments.length});
        reportProgress();

        const service = options.serviceOverride || gateway.getDefaultService();
        if (gateway.supportsBatch(service)) {
            for (const batch of splitBatches(segments)) {
                throwIfAborted(options.signal);
                try {
                    const result = await gateway.translateTextBatch(
                        batch.map((segment) => segment.source),
                        context,
                        {
                            signal: options.signal,
                            pageContext,
                            serviceOverride: options.serviceOverride,
                            modelOverride: options.modelOverride,
                            sourceLanguage,
                            targetLanguage,
                        },
                    );
                    result.forEach((translation, index) => {
                        translations[batch[index].id] = translation;
                    });
                    completed += batch.length;
                    reportProgress();
                } catch (error) {
                    throw new Error(`第 ${completed + 1} 段文档翻译失败：${getErrorMessage(error)}`);
                }
            }
            return translations;
        }

        let stopped = false;
        // 文档层一次提交全部逐段任务，实际网络并发统一由翻译队列控制。
        await Promise.all(segments.map(async (segment, index) => {
            throwIfAborted(options.signal);
            try {
                const translation = await gateway.translateText(segment.source, context, {
                    signal: options.signal,
                    pageContext,
                    serviceOverride: options.serviceOverride,
                    modelOverride: options.modelOverride,
                    sourceLanguage,
                    targetLanguage,
                });
                // Promise.all 会在首个任务失败时立即 reject；其余在途请求仍会稍后结束。
                // 失败后不再上报过期进度。
                if (stopped) return;
                translations[segment.id] = translation;
                completed += 1;
                reportProgress();
            } catch (error) {
                if (stopped) return;
                stopped = true;
                if (options.signal?.aborted) throwIfAborted(options.signal);
                throw new Error(`第 ${index + 1} 段文档翻译失败：${getErrorMessage(error)}`);
            }
        }));
        return translations;
    };
}
