export const YOUTUBE_TIMED_TEXT_MESSAGE = 'fluent-read-youtube-timedtext';
export const YOUTUBE_BRIDGE_DISPOSE_EVENT = 'fluentread-youtube-bridge-dispose';
export const YOUTUBE_BRIDGE_ENABLE_EVENT = 'fluentread-youtube-bridge-enable';
export const YOUTUBE_BRIDGE_STATE_KEY = '__fluentReadYoutubeTimedTextBridgeState__';
export const YOUTUBE_BRIDGE_LIFECYCLE_STATE_KEY = '__fluentReadYoutubeTimedTextBridgeLifecycleState__';

export interface TimedTextPayload {
    readonly source: 'fluent-read';
    readonly type: typeof YOUTUBE_TIMED_TEXT_MESSAGE;
    readonly url: string;
    readonly responseText: string;
}

export interface YoutubeBridgeMethodSlot<T extends (...args: never[]) => unknown> {
    get(): T;
    set(value: T): void;
}

export interface YoutubeFetchResponsePort {
    clone(): {text(): Promise<string>};
}

export type YoutubeFetchPort = (
    this: unknown,
    input: unknown,
    init?: unknown,
) => Promise<YoutubeFetchResponsePort>;

export interface YoutubeXhrPort {
    readonly responseText: unknown;
    addEventListener(type: string, listener: () => void, options?: {once?: boolean}): void;
}

export type YoutubeXhrOpenPort = (
    this: YoutubeXhrPort,
    method: string,
    url: unknown,
    ...rest: unknown[]
) => unknown;
export type YoutubeXhrSendPort = (this: YoutubeXhrPort, body?: unknown) => unknown;

export interface YoutubeBridgeEventTarget {
    addEventListener(type: string, listener: (event?: {persisted?: boolean}) => void): void;
    removeEventListener(type: string, listener: (event?: {persisted?: boolean}) => void): void;
}

export interface YoutubeTimedTextBridgeEnvironment {
    readonly stateHost: Record<string, unknown>;
    readonly fetch: YoutubeBridgeMethodSlot<YoutubeFetchPort>;
    readonly xhrOpen: YoutubeBridgeMethodSlot<YoutubeXhrOpenPort>;
    readonly xhrSend: YoutubeBridgeMethodSlot<YoutubeXhrSendPort>;
    readonly pageEvents: YoutubeBridgeEventTarget;
    readonly documentEvents: YoutubeBridgeEventTarget;
    readonly getHref: () => string;
    readonly getOrigin: () => string;
    readonly postMessage: (payload: TimedTextPayload, targetOrigin: string) => void;
}

interface YoutubeBridgeState {
    readonly owner: symbol;
    readonly dispose: () => void;
}

interface YoutubeBridgeLifecycleState {
    readonly owner: symbol;
    readonly dispose: () => void;
}

export function getYoutubeRequestUrl(input: unknown): string {
    if (typeof input === 'string') return input;
    if (!input || typeof input !== 'object') return '';
    const record = input as {href?: unknown; url?: unknown};
    if (typeof record.href === 'string') return record.href;
    return typeof record.url === 'string' ? record.url : '';
}

export function isYoutubeTimedTextUrl(value: string, baseHref: string): boolean {
    try {
        const url = new URL(value, baseHref);
        return (url.hostname === 'youtube.com' || url.hostname.endsWith('.youtube.com'))
            && url.pathname.includes('/api/timedtext');
    } catch {
        return false;
    }
}

export function createYoutubeTimedTextPayload(
    url: string,
    responseText: unknown,
    baseHref: string,
): TimedTextPayload | null {
    if (typeof responseText !== 'string' || !responseText || !isYoutubeTimedTextUrl(url, baseHref)) return null;
    return {
        source: 'fluent-read',
        type: YOUTUBE_TIMED_TEXT_MESSAGE,
        url,
        responseText,
    };
}

function installMethod<T extends (...args: never[]) => unknown>(
    slot: YoutubeBridgeMethodSlot<T>,
    wrapper: T,
): boolean {
    try {
        slot.set(wrapper);
        return slot.get() === wrapper;
    } catch {
        return false;
    }
}

function restoreMethod<T extends (...args: never[]) => unknown>(
    slot: YoutubeBridgeMethodSlot<T>,
    wrapper: T,
    original: T,
): void {
    try {
        if (slot.get() === wrapper) slot.set(original);
    } catch {
        // 页面在运行期间锁定宿主 API 时，不能让卸载异常逃逸到站点代码。
    }
}

/** 安装可卸载、不会嵌套包装的 MAIN world timedtext bridge。 */
export function installYoutubeTimedTextBridgeCore(
    environment: YoutubeTimedTextBridgeEnvironment,
): () => void {
    const previous = environment.stateHost[YOUTUBE_BRIDGE_STATE_KEY] as YoutubeBridgeState | undefined;
    previous?.dispose?.();

    const owner = Symbol('fluentread-youtube-timedtext-bridge');
    const originalFetch = environment.fetch.get();
    const originalOpen = environment.xhrOpen.get();
    const originalSend = environment.xhrSend.get();
    const requestUrls = new WeakMap<YoutubeXhrPort, string>();
    const requestGenerations = new WeakMap<YoutubeXhrPort, number>();
    let active = true;
    const publish = (url: string, responseText: unknown) => {
        if (!active) return;
        const payload = createYoutubeTimedTextPayload(url, responseText, environment.getHref());
        if (!payload) return;
        try {
            environment.postMessage(payload, environment.getOrigin());
        } catch {
            // 页面导航或 CSP 边界变化时丢弃诊断消息，不影响原始网络请求。
        }
    };

    const fetchWrapper: YoutubeFetchPort = async function fetch(input, init) {
        const requestUrl = getYoutubeRequestUrl(input);
        const response = await Reflect.apply(originalFetch, this, [input, init]);
        if (isYoutubeTimedTextUrl(requestUrl, environment.getHref())) {
            try {
                void response.clone().text()
                    .then((responseText) => publish(requestUrl, responseText))
                    .catch(() => undefined);
            } catch {
                // 不可 clone 的响应只跳过旁路采集，原 response 仍原样返回。
            }
        }
        return response;
    };
    const openWrapper: YoutubeXhrOpenPort = function open(method, url, ...rest) {
        // XHR 对象允许复用；每次 open 必须先清掉旧 timedtext URL。
        requestUrls.delete(this);
        requestGenerations.set(this, (requestGenerations.get(this) ?? 0) + 1);
        const requestUrl = getYoutubeRequestUrl(url);
        if (isYoutubeTimedTextUrl(requestUrl, environment.getHref())) requestUrls.set(this, requestUrl);
        return Reflect.apply(originalOpen, this, [method, url, ...rest]);
    };
    const sendWrapper: YoutubeXhrSendPort = function send(body) {
        const requestUrl = requestUrls.get(this);
        const requestGeneration = requestGenerations.get(this) ?? 0;
        requestUrls.delete(this);
        if (requestUrl) {
            this.addEventListener('load', () => {
                if (requestGenerations.get(this) !== requestGeneration) return;
                try {
                    publish(requestUrl, this.responseText);
                } catch {
                    // 非文本 responseType 的 responseText getter 会抛异常。
                }
            }, {once: true});
        }
        try {
            return Reflect.apply(originalSend, this, [body]);
        } catch (error) {
            // 同步 send 失败后作废已挂 listener；同一个 XHR 再 open 时不会发布旧 URL。
            requestGenerations.set(this, requestGeneration + 1);
            throw error;
        }
    };
    const dispose = () => {
        const current = environment.stateHost[YOUTUBE_BRIDGE_STATE_KEY] as YoutubeBridgeState | undefined;
        if (current?.owner !== owner) return;
        active = false;
        restoreMethod(environment.fetch, fetchWrapper, originalFetch);
        restoreMethod(environment.xhrOpen, openWrapper, originalOpen);
        restoreMethod(environment.xhrSend, sendWrapper, originalSend);
        environment.pageEvents.removeEventListener('pagehide', handlePageHide);
        environment.documentEvents.removeEventListener(YOUTUBE_BRIDGE_DISPOSE_EVENT, dispose);
        delete environment.stateHost[YOUTUBE_BRIDGE_STATE_KEY];
    };
    const handlePageHide = (event?: {persisted?: boolean}) => {
        // BFCache pagehide 会保留 document；返回时 MAIN world 入口不会重跑，因此必须保留包装。
        if (event?.persisted !== true) dispose();
    };

    // 某个宿主 API 不可写时保留其他采集通道，避免桥整体失效。
    installMethod(environment.fetch, fetchWrapper);
    installMethod(environment.xhrOpen, openWrapper);
    installMethod(environment.xhrSend, sendWrapper);
    environment.pageEvents.addEventListener('pagehide', handlePageHide);
    environment.documentEvents.addEventListener(YOUTUBE_BRIDGE_DISPOSE_EVENT, dispose);
    environment.stateHost[YOUTUBE_BRIDGE_STATE_KEY] = {owner, dispose};
    return dispose;
}

/** 站点禁用时恢复宿主 API，恢复启用时在同一 document 内无嵌套地重装 bridge。 */
export function installYoutubeTimedTextBridgeLifecycleCore(
    environment: YoutubeTimedTextBridgeEnvironment,
): () => void {
    const previous = environment.stateHost[YOUTUBE_BRIDGE_LIFECYCLE_STATE_KEY] as YoutubeBridgeLifecycleState | undefined;
    previous?.dispose?.();

    const owner = Symbol('fluentread-youtube-timedtext-bridge-lifecycle');
    let disposeBridge = installYoutubeTimedTextBridgeCore(environment);
    const disable = () => disposeBridge();
    const enable = () => {
        if (environment.stateHost[YOUTUBE_BRIDGE_STATE_KEY]) return;
        disposeBridge = installYoutubeTimedTextBridgeCore(environment);
    };
    const dispose = () => {
        const current = environment.stateHost[YOUTUBE_BRIDGE_LIFECYCLE_STATE_KEY] as YoutubeBridgeLifecycleState | undefined;
        if (current?.owner !== owner) return;
        environment.documentEvents.removeEventListener(YOUTUBE_BRIDGE_DISPOSE_EVENT, disable);
        environment.documentEvents.removeEventListener(YOUTUBE_BRIDGE_ENABLE_EVENT, enable);
        disposeBridge();
        delete environment.stateHost[YOUTUBE_BRIDGE_LIFECYCLE_STATE_KEY];
    };

    environment.documentEvents.addEventListener(YOUTUBE_BRIDGE_DISPOSE_EVENT, disable);
    environment.documentEvents.addEventListener(YOUTUBE_BRIDGE_ENABLE_EVENT, enable);
    environment.stateHost[YOUTUBE_BRIDGE_LIFECYCLE_STATE_KEY] = {owner, dispose};
    return dispose;
}
