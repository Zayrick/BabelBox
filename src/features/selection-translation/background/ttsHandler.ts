import {
    parseSelectionTtsClientRequestId,
    parseSelectionTtsPlaybackState,
    parseSelectionTtsRoute,
    parseSelectionTtsTabId,
    sameSelectionTtsRoute,
    type SelectionTtsRoute,
} from '@/src/features/selection-translation/protocol';

export const SELECTION_TTS_PLAYBACK_STATE_MESSAGE_TYPE = 'selectionTtsPlaybackState' as const;
export const SELECTION_TTS_STOP_MESSAGE_TYPE = 'selectionTtsStop' as const;
export const SELECTION_TTS_MESSAGE_TYPE = 'selectionTts' as const;
export const SELECTION_TTS_GOOGLE_MESSAGE_TYPE = 'selectionTtsGoogle' as const;

export interface SelectionTtsContext {
    sender?: {
        tab?: {
            id?: number;
        };
    };
}

export interface SelectionTtsAudio {
    audio: ArrayBuffer;
    contentType: string;
    voice: string;
}

export interface SelectionTtsPlaybackStateMessage {
    type: typeof SELECTION_TTS_PLAYBACK_STATE_MESSAGE_TYPE;
    tabId?: unknown;
    clientRequestId?: unknown;
    state?: unknown;
    error?: unknown;
}

export interface SelectionTtsStopMessage {
    type: typeof SELECTION_TTS_STOP_MESSAGE_TYPE;
    clientRequestId?: unknown;
}

export interface SelectionTtsMessage {
    type: typeof SELECTION_TTS_MESSAGE_TYPE;
    text?: unknown;
    language?: unknown;
    clientRequestId?: unknown;
}

export interface SelectionTtsGoogleMessage {
    type: typeof SELECTION_TTS_GOOGLE_MESSAGE_TYPE;
    text?: unknown;
    language?: unknown;
    clientRequestId?: unknown;
}

export type SelectionTtsRuntimeMessage =
    | SelectionTtsPlaybackStateMessage
    | SelectionTtsStopMessage
    | SelectionTtsMessage
    | SelectionTtsGoogleMessage;

export interface SelectionTtsPlayAudioRequest {
    audioBase64: string;
    contentType: string;
    tabId: number;
    clientRequestId: string;
}

export interface SelectionTtsPlaySourceRequest {
    sourceUrl: string;
    tabId: number;
    clientRequestId: string;
}

export interface SelectionTtsBackgroundDependencies {
    readonly getPreferredVoices: () => unknown;
    readonly synthesize: (
        text: string,
        language: string,
        preferredVoices: unknown,
        signal?: AbortSignal,
    ) => Promise<SelectionTtsAudio>;
    readonly playWithOffscreen: (request: SelectionTtsPlayAudioRequest | SelectionTtsPlaySourceRequest) => Promise<void>;
    readonly stopWithOffscreen: (route: SelectionTtsRoute) => Promise<void>;
    readonly offscreenPlaybackEnabled?: boolean;
    readonly sendTabMessage: (tabId: number, message: unknown) => Promise<unknown>;
    readonly warn?: (message: string, error: unknown) => void;
}

export type SelectionTtsResponse =
    | {success: true; transport: 'offscreen'; voice?: string}
    | {success: true; transport: 'page'; audioBase64: string; contentType: string; voice: string}
    | {success: false; error: string};

export interface SelectionTtsBackgroundHandler<TMessage extends SelectionTtsRuntimeMessage = SelectionTtsRuntimeMessage> {
    readonly type: TMessage['type'];
    handle(message: TMessage, context: SelectionTtsContext): Promise<unknown>;
}

interface ActiveSelectionTts extends SelectionTtsRoute {
    controller: AbortController;
    playbackStarted: boolean;
}

function parseTabId(context: SelectionTtsContext): number | null {
    const tabId = context.sender?.tab?.id;
    try {
        return parseSelectionTtsTabId(tabId);
    } catch {
        return null;
    }
}

function parseText(value: unknown): string {
    if (typeof value !== 'string') throw new TypeError('TTS 文本为空');
    const text = value.trim();
    if (!text) throw new TypeError('TTS 文本为空');
    return text;
}

function parseLanguage(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value : 'en-US';
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

export function googleSelectionTtsUrl(text: string, language: string): string {
    return `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(language)}&client=tw-ob&q=${encodeURIComponent(text)}`;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * 创建划词朗读后台 handlers。状态封装在 factory 作用域内，避免 background
 * 继续持有跨请求状态机。
 */
export function createSelectionTtsBackgroundHandlers(
    dependencies: SelectionTtsBackgroundDependencies,
): SelectionTtsBackgroundHandler[] {
    let activeSelectionTts: ActiveSelectionTts | null = null;

    const beginSelectionTts = (tabId: number, clientRequestId: string): ActiveSelectionTts => {
        const request: ActiveSelectionTts = {
            tabId,
            clientRequestId,
            controller: new AbortController(),
            playbackStarted: false,
        };
        activeSelectionTts = request;
        return request;
    };

    const stopActiveSelectionTts = async (): Promise<void> => {
        const active = activeSelectionTts;
        activeSelectionTts = null;
        if (!active) return;
        active.controller.abort();
        if (active.playbackStarted) {
            await dependencies.stopWithOffscreen(active).catch(() => undefined);
        }
    };

    const stopLatePlayback = async (active: ActiveSelectionTts): Promise<SelectionTtsResponse> => {
        await dependencies.stopWithOffscreen(active).catch(() => undefined);
        return {success: false, error: '语音播放已取消'};
    };

    const playbackStateHandler: SelectionTtsBackgroundHandler<SelectionTtsPlaybackStateMessage> = {
        type: SELECTION_TTS_PLAYBACK_STATE_MESSAGE_TYPE,
        async handle(message) {
                let route: SelectionTtsRoute;
                let state: ReturnType<typeof parseSelectionTtsPlaybackState>;
                try {
                    route = parseSelectionTtsRoute(message);
                    state = parseSelectionTtsPlaybackState(message.state);
                } catch {
                    return {success: true};
                }

                // MV3 worker 重建后仍可仅凭 offscreen 自描述消息转发结果。
                if (activeSelectionTts && sameSelectionTtsRoute(activeSelectionTts, route)) {
                    activeSelectionTts = null;
                }
                await dependencies.sendTabMessage(route.tabId, {
                    type: 'selectionTtsState',
                    clientRequestId: route.clientRequestId,
                    state,
                    error: typeof message.error === 'string' ? message.error : undefined,
                }).catch(() => undefined);
                return {success: true};
        },
    };

    const stopHandler: SelectionTtsBackgroundHandler<SelectionTtsStopMessage> = {
        type: SELECTION_TTS_STOP_MESSAGE_TYPE,
        async handle(message, context) {
                const tabId = parseTabId(context);
                if (tabId === null || message.clientRequestId === undefined) return {success: true};
                const route = {
                    tabId,
                    clientRequestId: parseSelectionTtsClientRequestId(message.clientRequestId),
                };
                if (activeSelectionTts && sameSelectionTtsRoute(activeSelectionTts, route)) {
                    activeSelectionTts.controller.abort();
                    activeSelectionTts = null;
                }
                // 不依赖 active 内存：worker 重启后 STOP 仍能直达 offscreen。
                await dependencies.stopWithOffscreen(route).catch(() => undefined);
                return {success: true};
        },
    };

    const edgeTtsHandler: SelectionTtsBackgroundHandler<SelectionTtsMessage> = {
        type: SELECTION_TTS_MESSAGE_TYPE,
        async handle(message, context): Promise<SelectionTtsResponse> {
                const text = parseText(message.text);
                const language = parseLanguage(message.language);
                const clientRequestId = parseSelectionTtsClientRequestId(message.clientRequestId);
                const tabId = parseTabId(context);

                // 新请求先取消旧请求；没有 tab 时保留旧行为，合成后回退到 page audio。
                await stopActiveSelectionTts();
                const active = tabId === null ? null : beginSelectionTts(tabId, clientRequestId);
                let result: SelectionTtsAudio;
                try {
                    result = await dependencies.synthesize(
                        text,
                        language,
                        dependencies.getPreferredVoices(),
                        active?.controller.signal,
                    );
                } catch (synthesisError) {
                    if (active && activeSelectionTts === active) {
                        activeSelectionTts = null;
                    }
                    throw synthesisError;
                }

                if (active && activeSelectionTts !== active) {
                    return {success: false, error: '语音合成已取消'};
                }

                if (tabId !== null && active && dependencies.offscreenPlaybackEnabled !== false) {
                    active.playbackStarted = true;
                    try {
                        await dependencies.playWithOffscreen({
                            audioBase64: arrayBufferToBase64(result.audio),
                            contentType: result.contentType,
                            tabId,
                            clientRequestId: active.clientRequestId,
                        });
                        if (activeSelectionTts !== active) {
                            // STOP 可能早于 PLAY 生效；PLAY 成功返回后必须二次 STOP 清理 late playback。
                            return stopLatePlayback(active);
                        }
                        return {success: true, transport: 'offscreen', voice: result.voice};
                    } catch (offscreenError) {
                        const stillCurrent = activeSelectionTts === active;
                        if (stillCurrent) {
                            activeSelectionTts = null;
                        }
                        if (!stillCurrent) return stopLatePlayback(active);
                        dependencies.warn?.('Offscreen TTS playback unavailable, returning page audio:', offscreenError);
                    }
                }

                if (activeSelectionTts === active) activeSelectionTts = null;

                return {
                    success: true,
                    audioBase64: arrayBufferToBase64(result.audio),
                    contentType: result.contentType,
                    voice: result.voice,
                    transport: 'page',
                };
        },
    };

    const googleTtsHandler: SelectionTtsBackgroundHandler<SelectionTtsGoogleMessage> = {
        type: SELECTION_TTS_GOOGLE_MESSAGE_TYPE,
        async handle(message, context): Promise<SelectionTtsResponse> {
                const text = parseText(message.text);
                const language = parseLanguage(message.language);
                const clientRequestId = parseSelectionTtsClientRequestId(message.clientRequestId);
                const tabId = parseTabId(context);

                // Google fallback 与 Edge 共用单例播放状态，新请求同样先取消旧播放。
                await stopActiveSelectionTts();
                if (tabId === null) return {success: false, error: '无法确定当前标签页'};
                if (dependencies.offscreenPlaybackEnabled === false) {
                    return {success: false, error: '当前浏览器暂不支持 Google TTS 扩展播放'};
                }

                const active = beginSelectionTts(tabId, clientRequestId);
                active.playbackStarted = true;
                try {
                    await dependencies.playWithOffscreen({
                        sourceUrl: googleSelectionTtsUrl(text, language),
                        tabId,
                        clientRequestId: active.clientRequestId,
                    });
                    if (activeSelectionTts !== active) return stopLatePlayback(active);
                    return {success: true, transport: 'offscreen'};
                } catch (offscreenError) {
                    const stillCurrent = activeSelectionTts === active;
                    if (stillCurrent) {
                        activeSelectionTts = null;
                    } else {
                        await dependencies.stopWithOffscreen(active).catch(() => undefined);
                    }
                    return stillCurrent
                        ? {success: false, error: errorMessage(offscreenError)}
                        : {success: false, error: '语音播放已取消'};
                }
        },
    };

    return [playbackStateHandler, stopHandler, edgeTtsHandler, googleTtsHandler];
}
