/**
 * OCR Worker 的最小能力边界。
 *
 * 这里不依赖 Tesseract.js 或 Chrome API，便于单测完整覆盖 Worker 的并发与切换语义。
 */
export interface OcrWorkerPort<TResult> {
    setParameters(parameters: Record<string, string | number>): Promise<unknown>;
    recognize(image: string, options: Record<string, never>, output: {blocks: true}): Promise<TResult>;
    terminate(): Promise<unknown>;
}

export type OcrWorkerRuntimeDependencies<TResult> = {
    createWorker: (languages: string) => Promise<OcrWorkerPort<TResult>>;
    sparseTextMode: string | number;
};

export type OcrWorkerRuntime<TResult> = {
    recognize: (image: string, languages: string) => Promise<TResult>;
    ensureLanguages: (languages: string[]) => Promise<void>;
};

/**
 * 串行化所有 Worker 操作，避免语言切换终止仍在识别的 Worker，也避免同一
 * Worker 的 setParameters/recognize 被另一次请求交叉覆盖。
 */
export function createOcrWorkerRuntime<TResult>(
    dependencies: OcrWorkerRuntimeDependencies<TResult>,
): OcrWorkerRuntime<TResult> {
    let workerPromise: Promise<OcrWorkerPort<TResult>> | null = null;
    let workerLanguages = '';
    let operationTail: Promise<void> = Promise.resolve();

    function runExclusive<T>(operation: () => Promise<T>): Promise<T> {
        // 无论上一项成功还是失败，后续 OCR 操作都必须继续执行。
        const result = operationTail.then(operation, operation);
        // 尾链只保存完成信号，调用方仍收到原始结果或异常。
        operationTail = result.then(() => undefined, () => undefined);
        return result;
    }

    async function getWorker(languages: string): Promise<OcrWorkerPort<TResult>> {
        if (workerPromise && workerLanguages === languages) return workerPromise;

        if (workerPromise) {
            const previousWorker = await workerPromise.catch(() => null);
            await previousWorker?.terminate().catch(() => undefined);
            workerPromise = null;
            workerLanguages = '';
        }

        const nextWorkerPromise = dependencies.createWorker(languages);
        workerPromise = nextWorkerPromise;
        workerLanguages = languages;

        try {
            return await nextWorkerPromise;
        } catch (error) {
            if (workerPromise === nextWorkerPromise) {
                workerPromise = null;
                workerLanguages = '';
            }
            throw error;
        }
    }

    return {
        recognize(image, languages) {
            return runExclusive(async () => {
                const worker = await getWorker(languages);
                await worker.setParameters({
                    tessedit_pageseg_mode: dependencies.sparseTextMode,
                    preserve_interword_spaces: '1',
                });
                return worker.recognize(image, {}, {blocks: true});
            });
        },
        ensureLanguages(languages) {
            if (languages.length === 0) return Promise.resolve();
            return runExclusive(async () => {
                await getWorker(languages.join('+'));
            });
        },
    };
}
