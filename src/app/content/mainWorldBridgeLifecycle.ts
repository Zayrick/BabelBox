import {
    SHADOW_BRIDGE_DISPOSE_EVENT,
    SHADOW_BRIDGE_ENABLE_EVENT,
} from '@/src/platform/shadow-ui/pageBridgeCore';
import {
    YOUTUBE_BRIDGE_DISPOSE_EVENT,
    YOUTUBE_BRIDGE_ENABLE_EVENT,
} from '@/src/features/video-subtitle/content/youtubeTimedTextBridgeCore';

export interface MainWorldBridgeEventTarget {
    dispatchEvent(event: Event): unknown;
}

/** 以 DOM 事件跨越 isolated/MAIN world，统一切换两个宿主 API bridge。 */
export function setMainWorldBridgesEnabled(target: MainWorldBridgeEventTarget, enabled: boolean): void {
    const eventNames = enabled
        ? [SHADOW_BRIDGE_ENABLE_EVENT, YOUTUBE_BRIDGE_ENABLE_EVENT]
        : [SHADOW_BRIDGE_DISPOSE_EVENT, YOUTUBE_BRIDGE_DISPOSE_EVENT];
    for (const eventName of eventNames) target.dispatchEvent(new CustomEvent(eventName));
}
