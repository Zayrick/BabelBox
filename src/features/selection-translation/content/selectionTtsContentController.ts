import {
    matchesSelectionTtsClientRequest,
    type SelectionTtsPlaybackState,
} from '@/src/features/selection-translation/protocol';

export interface SelectionTtsContentRemoteRequest {
    readonly generation: number;
    readonly clientRequestId: string;
}

export interface SelectionTtsContentRemoteResponse {
    readonly success?: unknown;
    readonly transport?: unknown;
}

export type SelectionTtsContentRemoteResult = 'failed' | 'offscreen' | 'page' | 'stale';

export interface SelectionTtsContentControllerState {
    readonly generation: number;
    readonly pendingClientRequestId: string | null;
    readonly activeClientRequestId: string | null;
}

export interface SelectionTtsContentControllerDependencies {
    readonly createClientRequestId: () => string;
    readonly stopRemote: (clientRequestId: string) => Promise<unknown>;
}

const PLAYBACK_STATES = new Set<SelectionTtsPlaybackState>(['ended', 'stopped', 'error']);

/**
 * 内容脚本侧的远程 TTS 所有权状态机。
 *
 * Audio/SpeechSynthesis 仍由 Vue 组件持有；这里仅管理可跨 MV3 worker 重启的
 * UUID、当前 UI generation 与迟到响应清理，避免旧 Promise 清掉新请求状态。
 */
export class SelectionTtsContentController {
    private generation = 0;
    private pendingClientRequestId: string | null = null;
    private activeClientRequestId: string | null = null;

    constructor(private readonly dependencies: SelectionTtsContentControllerDependencies) {}

    getState(): SelectionTtsContentControllerState {
        return {
            generation: this.generation,
            pendingClientRequestId: this.pendingClientRequestId,
            activeClientRequestId: this.activeClientRequestId,
        };
    }

    currentGeneration(): number {
        return this.generation;
    }

    isCurrentGeneration(generation: number): boolean {
        return generation === this.generation;
    }

    beginRemoteRequest(): SelectionTtsContentRemoteRequest {
        const request = {
            generation: this.generation,
            clientRequestId: this.dependencies.createClientRequestId(),
        };
        this.pendingClientRequestId = request.clientRequestId;
        return request;
    }

    completeRemoteRequest(
        request: SelectionTtsContentRemoteRequest,
        response: SelectionTtsContentRemoteResponse | null | undefined,
    ): SelectionTtsContentRemoteResult {
        if (this.pendingClientRequestId === request.clientRequestId) {
            this.pendingClientRequestId = null;
        }

        if (!this.isCurrentGeneration(request.generation)) {
            // STOP 可能先于 PLAY 生效。迟到的 offscreen 成功必须按旧 UUID 精确清理，
            // 且不能触碰当前 generation 的 pending/active 请求。
            if (response?.success === true && response.transport === 'offscreen') {
                this.stopRemote(request.clientRequestId);
            }
            return 'stale';
        }

        if (response?.success !== true) return 'failed';
        if (response.transport === 'offscreen') {
            this.activeClientRequestId = request.clientRequestId;
            return 'offscreen';
        }
        return 'page';
    }

    rejectRemoteRequest(request: SelectionTtsContentRemoteRequest): boolean {
        if (this.pendingClientRequestId === request.clientRequestId) {
            this.pendingClientRequestId = null;
        }
        return this.isCurrentGeneration(request.generation);
    }

    matchRemoteState(message: unknown): SelectionTtsPlaybackState | null {
        if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
        const payload = message as {type?: unknown; clientRequestId?: unknown; state?: unknown};
        if (payload.type !== 'selectionTtsState'
            || !matchesSelectionTtsClientRequest(
                payload.clientRequestId,
                this.activeClientRequestId,
                this.pendingClientRequestId,
            )
            || typeof payload.state !== 'string'
            || !PLAYBACK_STATES.has(payload.state as SelectionTtsPlaybackState)) {
            return null;
        }
        return payload.state as SelectionTtsPlaybackState;
    }

    stop(notifyRemote = true): void {
        const stoppedClientRequestId = this.activeClientRequestId ?? this.pendingClientRequestId;
        this.activeClientRequestId = null;
        this.pendingClientRequestId = null;
        this.generation += 1;
        if (notifyRemote && stoppedClientRequestId !== null) this.stopRemote(stoppedClientRequestId);
    }

    private stopRemote(clientRequestId: string): void {
        // runtime.sendMessage 既可能同步抛错，也可能返回 rejected Promise；停止是幂等旁路，
        // 两种失败都不能污染当前播放或制造 unhandled rejection。
        void Promise.resolve()
            .then(() => this.dependencies.stopRemote(clientRequestId))
            .catch(() => undefined);
    }
}

export function createSelectionTtsContentController(
    dependencies: SelectionTtsContentControllerDependencies,
): SelectionTtsContentController {
    return new SelectionTtsContentController(dependencies);
}
