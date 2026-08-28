import {
    parseSelectionTtsRoute,
    sameSelectionTtsRoute,
    type SelectionTtsPlaybackRequest,
    type SelectionTtsPlaybackState,
} from '@/src/features/selection-translation/protocol';

export type {
    SelectionTtsPlaybackRequest,
    SelectionTtsPlaybackState,
    SelectionTtsRoute,
} from '@/src/features/selection-translation/protocol';

export interface SelectionAudioPort {
    preload: string;
    src: string;
    onended: ((event: Event) => void) | null;
    onerror: ((event: Event | string) => void) | null;
    pause(): void;
    load(): void;
    play(): Promise<void>;
    removeAttribute(name: string): void;
}

export interface SelectionTtsPlayerDependencies {
    readonly createAudio: () => SelectionAudioPort;
    readonly decodeBase64: (encoded: string) => Uint8Array;
    readonly createObjectUrl: (bytes: Uint8Array, contentType: string) => string;
    readonly revokeObjectUrl: (url: string) => void;
    readonly notify: (
        request: SelectionTtsPlaybackRequest,
        state: SelectionTtsPlaybackState,
        error?: unknown,
    ) => void;
}

interface PreparedPlayback {
    readonly request: SelectionTtsPlaybackRequest;
    readonly audio: SelectionAudioPort;
    readonly objectUrl: string;
}

function parseOptionalString(value: unknown, field: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !value.trim()) throw new TypeError(`TTS ${field} 必须是非空字符串`);
    return value;
}

export function parseSelectionTtsPlaybackRequest(value: unknown): SelectionTtsPlaybackRequest {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError('TTS 播放请求必须是对象');
    }
    const record = value as Record<string, unknown>;
    const route = parseSelectionTtsRoute(record);
    const sourceUrl = parseOptionalString(record.sourceUrl, 'sourceUrl');
    const audioBase64 = parseOptionalString(record.audioBase64, 'audioBase64');
    if (Boolean(sourceUrl) === Boolean(audioBase64)) {
        throw new TypeError('TTS 播放请求必须且只能提供一种音频来源');
    }
    return {
        sourceUrl,
        audioBase64,
        contentType: parseOptionalString(record.contentType, 'contentType'),
        ...route,
    };
}

/**
 * Offscreen 音频状态机。每一轮播放独占自己的 Audio 与 Blob URL，旧请求的
 * play() 延迟失败不会清理或通知新请求，从根源上避免竞态和 URL 泄漏。
 */
export class SelectionTtsPlayer {
    private active: PreparedPlayback | null = null;

    constructor(private readonly dependencies: SelectionTtsPlayerDependencies) {}

    private release(playback: PreparedPlayback): void {
        playback.audio.onended = null;
        playback.audio.onerror = null;
        playback.audio.pause();
        playback.audio.removeAttribute('src');
        playback.audio.load();
        if (playback.objectUrl) this.dependencies.revokeObjectUrl(playback.objectUrl);
    }

    private stopActive(notify: boolean): boolean {
        const active = this.active;
        if (!active) return false;
        this.active = null;
        this.release(active);
        if (notify) this.dependencies.notify(active.request, 'stopped');
        return true;
    }

    stop(value: unknown, notify = true): boolean {
        const route = parseSelectionTtsRoute(value);
        if (!this.active || !sameSelectionTtsRoute(this.active.request, route)) {
            return false;
        }
        return this.stopActive(notify);
    }

    dispose(): void {
        this.stopActive(false);
    }

    async play(value: unknown): Promise<void> {
        const request = parseSelectionTtsPlaybackRequest(value);
        const audio = this.dependencies.createAudio();
        audio.preload = 'auto';
        let objectUrl = '';
        try {
            if (request.sourceUrl) {
                audio.src = request.sourceUrl;
            } else {
                const bytes = this.dependencies.decodeBase64(request.audioBase64 as string);
                objectUrl = this.dependencies.createObjectUrl(bytes, request.contentType ?? 'audio/mpeg');
                audio.src = objectUrl;
            }
        } catch (error) {
            if (objectUrl) this.dependencies.revokeObjectUrl(objectUrl);
            throw error;
        }

        // 新资源完整准备成功后才停止旧播放，非法 payload 不打断用户当前语音。
        this.stopActive(true);
        const playback: PreparedPlayback = {request, audio, objectUrl};
        this.active = playback;

        // 回调只允许结束创建它的那一轮，过期事件不能污染当前状态。
        audio.onended = () => {
            if (this.active !== playback) return;
            this.active = null;
            this.release(playback);
            this.dependencies.notify(request, 'ended');
        };
        audio.onerror = () => {
            if (this.active !== playback) return;
            this.active = null;
            this.release(playback);
            this.dependencies.notify(request, 'error', new Error('扩展音频解码或播放失败'));
        };

        try {
            await audio.play();
        } catch (error) {
            // 只有仍然活跃的请求才上报错误；被后续请求替换的迟到失败已收到 stopped。
            if (this.active === playback) {
                this.active = null;
                this.release(playback);
                this.dependencies.notify(request, 'error', error);
            }
            throw error;
        }
    }
}

export function createSelectionTtsPlayer(dependencies: SelectionTtsPlayerDependencies): SelectionTtsPlayer {
    return new SelectionTtsPlayer(dependencies);
}
