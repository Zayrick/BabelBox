export interface OffscreenMessage {
    readonly type: string;
}

export type OffscreenMessageEnvelope<TMessage extends OffscreenMessage> = TMessage & {
    readonly target: 'offscreen';
};

export interface OffscreenRuntimeApi {
    readonly lastError?: {readonly message?: string};
    getContexts?(filter: {contextTypes: ['OFFSCREEN_DOCUMENT']}): Promise<unknown[]>;
    sendMessage(
        message: unknown,
        callback: (response: unknown) => void,
    ): void;
}

export interface OffscreenDocumentApi {
    createDocument(options: {
        url: string;
        reasons: string[];
        justification: string;
    }): Promise<void>;
}

export interface OffscreenClientDependencies {
    readonly getRuntime: () => OffscreenRuntimeApi;
    readonly getOffscreen: () => OffscreenDocumentApi | undefined;
    readonly documentUrl?: string;
}

export interface OffscreenClient {
    hasDocument(): Promise<boolean>;
    ensureDocument(): Promise<void>;
    send<
        TResponse,
        TMessage extends OffscreenMessage = OffscreenMessage & Readonly<Record<string, unknown>>,
    >(message: TMessage): Promise<TResponse>;
    sendIfPresent<
        TResponse,
        TMessage extends OffscreenMessage = OffscreenMessage & Readonly<Record<string, unknown>>,
    >(
        message: TMessage,
    ): Promise<TResponse | undefined>;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Chrome MV3 Offscreen 生命周期与 callback runtime messaging 的唯一平台适配器。 */
export function createOffscreenClient(dependencies: OffscreenClientDependencies): OffscreenClient {
    let creatingDocument: Promise<void> | null = null;

    const getExistingContexts = async (): Promise<unknown[]> => {
        const getContexts = dependencies.getRuntime().getContexts;
        if (typeof getContexts !== 'function') {
            throw new Error('当前浏览器不支持查询 Offscreen 文档');
        }
        return getContexts.call(dependencies.getRuntime(), {contextTypes: ['OFFSCREEN_DOCUMENT']});
    };

    const hasDocument = async (): Promise<boolean> => {
        const runtime = dependencies.getRuntime();
        if (!dependencies.getOffscreen() || typeof runtime.getContexts !== 'function') return false;
        const contexts = await runtime.getContexts({contextTypes: ['OFFSCREEN_DOCUMENT']});
        return contexts.length > 0;
    };

    const ensureDocument = async (): Promise<void> => {
        const offscreen = dependencies.getOffscreen();
        if (!offscreen || typeof offscreen.createDocument !== 'function') {
            throw new Error('当前浏览器不支持扩展 Offscreen 文档');
        }

        try {
            if ((await getExistingContexts()).length > 0) return;
            if (!creatingDocument) {
                creatingDocument = offscreen.createDocument({
                    url: dependencies.documentUrl || 'offscreen.html',
                    reasons: ['DOM_SCRAPING', 'AUDIO_PLAYBACK'],
                    justification: 'FluentRead needs an extension-owned DOM for Translation API, OCR, and CSP-independent TTS playback',
                }).finally(() => {
                    creatingDocument = null;
                });
            }
            await creatingDocument;
        } catch (error) {
            throw new Error(`无法创建 Offscreen 文档：${errorMessage(error)}`);
        }
    };

    const sendWithoutCreating = <TResponse, TMessage extends OffscreenMessage>(
        message: TMessage,
    ): Promise<TResponse> => new Promise((resolve, reject) => {
        const runtime = dependencies.getRuntime();
        try {
            runtime.sendMessage({...message, target: 'offscreen'}, (response) => {
                const runtimeError = dependencies.getRuntime().lastError;
                if (runtimeError) {
                    reject(new Error(runtimeError.message || 'Offscreen 消息发送失败'));
                } else {
                    resolve(response as TResponse);
                }
            });
        } catch (error) {
            reject(error);
        }
    });

    return {
        hasDocument,
        ensureDocument,
        async send<TResponse, TMessage extends OffscreenMessage>(message: TMessage): Promise<TResponse> {
            await ensureDocument();
            return sendWithoutCreating<TResponse, TMessage>(message);
        },
        async sendIfPresent<TResponse, TMessage extends OffscreenMessage>(
            message: TMessage,
        ): Promise<TResponse | undefined> {
            if (!await hasDocument()) return undefined;
            return sendWithoutCreating<TResponse, TMessage>(message);
        },
    };
}

export const chromeOffscreenClient = createOffscreenClient({
    getRuntime: () => chrome.runtime as OffscreenRuntimeApi,
    getOffscreen: () => chrome.offscreen as unknown as OffscreenDocumentApi | undefined,
});
