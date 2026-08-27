import type {
    SelectionTtsPlaybackRequest,
    SelectionTtsRoute,
} from '@/src/features/selection-translation/protocol';
import {
    chromeOffscreenClient,
    type OffscreenClient,
} from '@/src/platform/offscreen/client';

interface SelectionTtsOffscreenResponse {
    readonly success?: boolean;
    readonly error?: string;
}

/** TTS 消息始终携带 {tabId, clientRequestId}，不依赖可重启 worker 的内存。 */
export function createSelectionTtsOffscreenAdapter(client: OffscreenClient = chromeOffscreenClient) {
    return {
        async play(payload: SelectionTtsPlaybackRequest): Promise<void> {
            const response = await client.send<SelectionTtsOffscreenResponse>({
                type: 'PLAY_SELECTION_TTS',
                ...payload,
            });
            if (!response?.success) throw new Error(response?.error || 'Offscreen TTS 播放失败');
        },

        async stop(route: SelectionTtsRoute): Promise<void> {
            const response = await client.sendIfPresent<SelectionTtsOffscreenResponse>({
                type: 'STOP_SELECTION_TTS',
                ...route,
            });
            if (response && !response.success) throw new Error(response.error || 'Offscreen TTS 停止失败');
        },
    };
}

export const selectionTtsOffscreenAdapter = createSelectionTtsOffscreenAdapter();
