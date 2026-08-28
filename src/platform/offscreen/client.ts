import {browser} from 'wxt/browser';

export interface OffscreenMessage {
    readonly type: string;
}

export const OFFSCREEN_READY_MESSAGE_TYPE = 'FLUENT_READ_OFFSCREEN_READY' as const;

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
    closeDocument?(): Promise<void>;
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

function isMissingReceiverError(error: unknown): boolean {
    const message = errorMessage(error);
    return message.includes('Receiving end does not exist')
        || message.includes('Could not establish connection');
}

/** Chrome MV3 Offscreen 生命周期与 callback runtime messaging 的唯一平台适配器。 */
export function createOffscreenClient(dependencies: OffscreenClientDependencies): OffscreenClient {
    let creatingDocument: Promise<void> | null = null;
    let rebuildingDocument: Promise<void> | null = null;

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

    const createDocument = async (): Promise<void> => {
        const offscreen = dependencies.getOffscreen();
        if (!offscreen || typeof offscreen.createDocument !== 'function') {
            throw new Error('当前浏览器不支持扩展 Offscreen 文档');
        }
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
    };

    const waitForReceiver = async (attempts = 40): Promise<void> => {
        let lastError: unknown = new Error('Offscreen 文档尚未就绪');
        for (let attempt = 0; attempt < attempts; attempt += 1) {
            try {
                const response = await sendWithoutCreating<{
                    success?: boolean;
                    ready?: boolean;
                }, OffscreenMessage>({type: OFFSCREEN_READY_MESSAGE_TYPE});
                if (response?.success === true && response.ready === true) return;
                lastError = new Error('Offscreen 文档未确认接收端就绪');
            } catch (error) {
                if (!isMissingReceiverError(error)) throw error;
                lastError = error;
            }
            if (attempt + 1 < attempts) await new Promise<void>((resolve) => setTimeout(resolve, 25));
        }
        throw lastError;
    };

    const rebuildDocument = async (): Promise<void> => {
        if (!rebuildingDocument) {
            rebuildingDocument = (async () => {
                const offscreen = dependencies.getOffscreen();
                if (!offscreen || typeof offscreen.closeDocument !== 'function') {
                    throw new Error('当前浏览器无法重建失去接收端的 Offscreen 文档');
                }
                if ((await getExistingContexts()).length > 0) await offscreen.closeDocument();
                await createDocument();
                await waitForReceiver();
            })().finally(() => {
                rebuildingDocument = null;
            });
        }
        await rebuildingDocument;
    };

    const ensureDocument = async (): Promise<void> => {
        try {
            if (!dependencies.getOffscreen()) throw new Error('当前浏览器不支持扩展 Offscreen 文档');
            const hasExistingDocument = (await getExistingContexts()).length > 0;
            if (!hasExistingDocument) await createDocument();
            try {
                await waitForReceiver(hasExistingDocument ? 1 : 40);
            } catch (error) {
                if (!hasExistingDocument || !isMissingReceiverError(error)) throw error;
                await rebuildDocument();
            }
        } catch (error) {
            throw new Error(`无法创建 Offscreen 文档：${errorMessage(error)}`);
        }
    };

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
    getRuntime: () => browser.runtime as unknown as OffscreenRuntimeApi,
    getOffscreen: () => browser.offscreen as unknown as OffscreenDocumentApi | undefined,
});
