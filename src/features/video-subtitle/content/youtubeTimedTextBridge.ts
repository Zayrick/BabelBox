import {
    installYoutubeTimedTextBridgeLifecycleCore,
    type YoutubeBridgeEventTarget,
    type YoutubeFetchPort,
    type YoutubeXhrOpenPort,
    type YoutubeXhrSendPort,
} from './youtubeTimedTextBridgeCore';

/** 将真实 Fetch/XHR 注入可测试的 YouTube timedtext bridge。 */
export function installYoutubeTimedTextBridge(): () => void {
    const pageWindow = window as typeof window & Record<string, unknown>;
    return installYoutubeTimedTextBridgeLifecycleCore({
        stateHost: pageWindow,
        fetch: {
            get: () => window.fetch as unknown as YoutubeFetchPort,
            set: (value) => { window.fetch = value as typeof window.fetch; },
        },
        xhrOpen: {
            get: () => XMLHttpRequest.prototype.open as unknown as YoutubeXhrOpenPort,
            set: (value) => { XMLHttpRequest.prototype.open = value as typeof XMLHttpRequest.prototype.open; },
        },
        xhrSend: {
            get: () => XMLHttpRequest.prototype.send as unknown as YoutubeXhrSendPort,
            set: (value) => { XMLHttpRequest.prototype.send = value as typeof XMLHttpRequest.prototype.send; },
        },
        pageEvents: window as unknown as YoutubeBridgeEventTarget,
        documentEvents: document as unknown as YoutubeBridgeEventTarget,
        getHref: () => location.href,
        getOrigin: () => location.origin,
        postMessage: (payload, targetOrigin) => window.postMessage(payload, targetOrigin),
    });
}
