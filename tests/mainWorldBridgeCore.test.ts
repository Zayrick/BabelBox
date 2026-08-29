import {describe, expect, it, vi} from 'vitest';
import {
    ROUTE_CHANGE_EVENT,
    SHADOW_BRIDGE_DISPOSE_EVENT,
    SHADOW_BRIDGE_ENABLE_EVENT,
    SHADOW_BRIDGE_LIFECYCLE_STATE_KEY,
    SHADOW_BRIDGE_STATE_KEY,
    SHADOW_ROOT_EVENT,
    installShadowRouteBridgeCore,
    installShadowRouteBridgeLifecycleCore,
    type AttachShadowPort,
    type BridgeEventTarget,
    type BridgeMethodSlot,
    type HistoryMutationPort,
} from '@/src/platform/shadow-ui/pageBridgeCore';
import {
    YOUTUBE_BRIDGE_DISPOSE_EVENT,
    YOUTUBE_BRIDGE_ENABLE_EVENT,
    YOUTUBE_BRIDGE_LIFECYCLE_STATE_KEY,
    YOUTUBE_BRIDGE_STATE_KEY,
    createYoutubeTimedTextPayload,
    getYoutubeRequestUrl,
    installYoutubeTimedTextBridgeCore,
    installYoutubeTimedTextBridgeLifecycleCore,
    isYoutubeTimedTextUrl,
    type YoutubeBridgeEventTarget,
    type YoutubeBridgeMethodSlot,
    type YoutubeFetchPort,
    type YoutubeFetchResponsePort,
    type YoutubeTimedTextBridgeEnvironment,
    type YoutubeXhrOpenPort,
    type YoutubeXhrPort,
    type YoutubeXhrSendPort,
} from '@/src/features/video-subtitle/content/youtubeTimedTextBridgeCore';

class FakeEvents implements BridgeEventTarget, YoutubeBridgeEventTarget {
    readonly listeners = new Map<string, Set<(event?: {persisted?: boolean}) => void>>();
    readonly dispatched: unknown[] = [];

    addEventListener(type: string, listener: (event?: {persisted?: boolean}) => void): void {
        const listeners = this.listeners.get(type) ?? new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type: string, listener: (event?: {persisted?: boolean}) => void): void {
        this.listeners.get(type)?.delete(listener);
    }

    dispatchEvent(event: unknown): boolean {
        this.dispatched.push(event);
        const type = (event as {type?: string})?.type;
        if (type) for (const listener of this.listeners.get(type) ?? []) listener();
        return true;
    }

    emit(type: string, event?: {persisted?: boolean}): void {
        for (const listener of [...this.listeners.get(type) ?? []]) listener(event);
    }
}

function slot<T extends (...args: never[]) => unknown>(initial: T) {
    let value = initial;
    let locked = false;
    const port: BridgeMethodSlot<T> & YoutubeBridgeMethodSlot<T> = {
        get: () => value,
        set: (next) => {
            if (locked) throw new Error('locked');
            value = next;
        },
    };
    return {
        port,
        get value() { return value; },
        set value(next: T) { value = next; },
        lock: () => { locked = true; },
    };
}

function shadowFixture(withNavigation = true) {
    let href = 'https://example.test/start';
    const stateHost: Record<string, unknown> = {};
    const windowEvents = new FakeEvents();
    const documentEvents = new FakeEvents();
    const navigationEvents = new FakeEvents();
    const originalAttach = vi.fn(function originalAttach(this: unknown, init: unknown) {
        return {host: this, init};
    }) as unknown as AttachShadowPort;
    const originalPush = vi.fn(function originalPush(this: unknown, _data: unknown, _unused: string, url?: string | URL | null) {
        if (url) href = new URL(String(url), href).href;
        return this;
    }) as unknown as HistoryMutationPort;
    const originalReplace = vi.fn(function originalReplace(this: unknown, _data: unknown, _unused: string, url?: string | URL | null) {
        if (url) href = new URL(String(url), href).href;
        return this;
    }) as unknown as HistoryMutationPort;
    const attach = slot(originalAttach);
    const push = slot(originalPush);
    const replace = slot(originalReplace);
    const environment = {
        stateHost,
        attachShadow: attach.port,
        pushState: push.port,
        replaceState: replace.port,
        windowEvents,
        documentEvents,
        navigationEvents: withNavigation ? navigationEvents : undefined,
        getHref: () => href,
        createEvent: (type: string, init?: Record<string, unknown>) => ({type, ...init}),
    };
    return {attach, documentEvents, environment, navigationEvents, originalAttach, originalPush, originalReplace, push, replace, stateHost, windowEvents};
}

class FakeXhr implements YoutubeXhrPort {
    responseText: unknown = '';
    readonly listeners = new Map<string, Array<() => void>>();

    addEventListener(type: string, listener: () => void): void {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    emit(type: string): void {
        for (const listener of this.listeners.get(type) ?? []) listener();
    }
}

function youtubeFixture() {
    const stateHost: Record<string, unknown> = {};
    const pageEvents = new FakeEvents();
    const documentEvents = new FakeEvents();
    const posts: unknown[] = [];
    let failPost = false;
    const response: YoutubeFetchResponsePort = {
        clone: () => ({text: async () => '<timedtext />'}),
    };
    const originalFetch = vi.fn(async () => response) as unknown as YoutubeFetchPort;
    const originalOpen = vi.fn(function originalOpen(this: YoutubeXhrPort) { return this; }) as unknown as YoutubeXhrOpenPort;
    const originalSend = vi.fn(function originalSend(this: YoutubeXhrPort) { return this; }) as unknown as YoutubeXhrSendPort;
    const fetch = slot(originalFetch);
    const xhrOpen = slot(originalOpen);
    const xhrSend = slot(originalSend);
    const environment: YoutubeTimedTextBridgeEnvironment = {
        stateHost,
        fetch: fetch.port,
        xhrOpen: xhrOpen.port,
        xhrSend: xhrSend.port,
        pageEvents,
        documentEvents,
        getHref: () => 'https://www.youtube.com/watch?v=fixture',
        getOrigin: () => 'https://www.youtube.com',
        postMessage: (payload, targetOrigin) => {
            if (failPost) throw new Error('post failed');
            posts.push({payload, targetOrigin});
        },
    };
    return {
        documentEvents,
        environment,
        fetch,
        originalFetch,
        originalOpen,
        originalSend,
        pageEvents,
        posts,
        response,
        setPostFailure: (value: boolean) => { failPost = value; },
        stateHost,
        xhrOpen,
        xhrSend,
    };
}

async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe('ShadowRoot 与路由 MAIN world bridge core', () => {
    it('发布 open ShadowRoot 与真实路由变化，并在卸载时恢复宿主 API', () => {
        const fixture = shadowFixture();
        const dispose = installShadowRouteBridgeCore(fixture.environment);
        expect(fixture.stateHost[SHADOW_BRIDGE_STATE_KEY]).toBeTruthy();

        const hostEvents: unknown[] = [];
        const host = {dispatchEvent: (event: unknown) => hostEvents.push(event)};
        const openRoot = fixture.attach.value.call(host, {mode: 'open'});
        fixture.attach.value.call(host, {mode: 'closed'});
        expect(openRoot).toMatchObject({host});
        expect(hostEvents).toEqual([{type: SHADOW_ROOT_EVENT, bubbles: true, composed: true}]);

        const historyHost = {};
        fixture.push.value.call(historyHost, {}, '', null);
        expect(fixture.documentEvents.dispatched).toHaveLength(0);
        expect(fixture.push.value.call(historyHost, {}, '', '/next')).toBe(historyHost);
        fixture.replace.value.call(historyHost, {}, '', '/final');
        fixture.windowEvents.emit('popstate');
        fixture.windowEvents.emit('hashchange');
        fixture.navigationEvents.emit('navigate');
        expect(fixture.documentEvents.dispatched.filter((event) => (event as {type: string}).type === ROUTE_CHANGE_EVENT))
            .toHaveLength(5);

        dispose();
        expect(fixture.attach.value).toBe(fixture.originalAttach);
        expect(fixture.push.value).toBe(fixture.originalPush);
        expect(fixture.replace.value).toBe(fixture.originalReplace);
        expect(fixture.stateHost[SHADOW_BRIDGE_STATE_KEY]).toBeUndefined();
        expect(fixture.windowEvents.listeners.get('popstate')?.size).toBe(0);
    });

    it('重复安装先卸载旧 owner，旧 disposer 不会破坏新桥', () => {
        const fixture = shadowFixture(false);
        const firstDispose = installShadowRouteBridgeCore(fixture.environment);
        const firstWrapper = fixture.attach.value;
        const secondDispose = installShadowRouteBridgeCore(fixture.environment);
        expect(fixture.attach.value).not.toBe(firstWrapper);
        firstDispose();
        expect(fixture.attach.value).not.toBe(fixture.originalAttach);
        fixture.documentEvents.emit(SHADOW_BRIDGE_DISPOSE_EVENT);
        expect(fixture.attach.value).toBe(fixture.originalAttach);
        secondDispose();
    });

    it('只读或后来锁定/替换的方法不阻断安装与安全卸载', () => {
        const fixture = shadowFixture();
        fixture.attach.lock();
        const dispose = installShadowRouteBridgeCore(fixture.environment);
        expect(fixture.attach.value).toBe(fixture.originalAttach);
        fixture.push.lock();
        fixture.replace.value = fixture.originalReplace;
        expect(() => dispose()).not.toThrow();
        expect(fixture.windowEvents.listeners.get('hashchange')?.size).toBe(0);
    });

    it('站点禁用恢复宿主 API，重新启用只安装一层 wrapper', () => {
        const fixture = shadowFixture();
        const firstLifecycleDispose = installShadowRouteBridgeLifecycleCore(fixture.environment);
        const firstWrapper = fixture.attach.value;
        const disposeLifecycle = installShadowRouteBridgeLifecycleCore(fixture.environment);
        firstLifecycleDispose();
        expect(fixture.attach.value).not.toBe(fixture.originalAttach);
        expect(fixture.stateHost[SHADOW_BRIDGE_LIFECYCLE_STATE_KEY]).toBeTruthy();

        fixture.documentEvents.emit(SHADOW_BRIDGE_DISPOSE_EVENT);
        expect(fixture.attach.value).toBe(fixture.originalAttach);
        fixture.documentEvents.emit(SHADOW_BRIDGE_ENABLE_EVENT);
        const restoredWrapper = fixture.attach.value;
        expect(restoredWrapper).not.toBe(firstWrapper);
        fixture.documentEvents.emit(SHADOW_BRIDGE_ENABLE_EVENT);
        expect(fixture.attach.value).toBe(restoredWrapper);

        disposeLifecycle();
        expect(fixture.attach.value).toBe(fixture.originalAttach);
        expect(fixture.stateHost[SHADOW_BRIDGE_LIFECYCLE_STATE_KEY]).toBeUndefined();
        fixture.documentEvents.emit(SHADOW_BRIDGE_ENABLE_EVENT);
        expect(fixture.attach.value).toBe(fixture.originalAttach);
    });
});

describe('YouTube timedtext MAIN world bridge core', () => {
    it('规范化 string、URL-like、Request-like 输入并严格限定 YouTube host/path', () => {
        expect(getYoutubeRequestUrl('https://x')).toBe('https://x');
        expect(getYoutubeRequestUrl({href: 'https://href'})).toBe('https://href');
        expect(getYoutubeRequestUrl({url: 'https://request'})).toBe('https://request');
        expect(getYoutubeRequestUrl({href: 1, url: 'https://fallback'})).toBe('https://fallback');
        expect(getYoutubeRequestUrl(null)).toBe('');
        expect(getYoutubeRequestUrl(1)).toBe('');
        expect(getYoutubeRequestUrl({})).toBe('');

        const base = 'https://www.youtube.com/watch?v=1';
        expect(isYoutubeTimedTextUrl('/api/timedtext?x=1', base)).toBe(true);
        expect(isYoutubeTimedTextUrl('https://youtube.com/api/timedtext', base)).toBe(true);
        expect(isYoutubeTimedTextUrl('https://notyoutube.com/api/timedtext', base)).toBe(false);
        expect(isYoutubeTimedTextUrl('https://www.youtube.com/watch', base)).toBe(false);
        expect(isYoutubeTimedTextUrl('http://[bad', base)).toBe(false);
    });

    it('只为非空 timedtext 文本创建跨 world payload', () => {
        const base = 'https://www.youtube.com/watch?v=1';
        expect(createYoutubeTimedTextPayload('/api/timedtext', '<xml/>', base)).toEqual({
            source: 'babelbox',
            type: 'babelbox-youtube-timedtext',
            url: '/api/timedtext',
            responseText: '<xml/>',
        });
        expect(createYoutubeTimedTextPayload('/api/timedtext', '', base)).toBeNull();
        expect(createYoutubeTimedTextPayload('/api/timedtext', 1, base)).toBeNull();
        expect(createYoutubeTimedTextPayload('/watch', 'text', base)).toBeNull();
    });

    it('采集 fetch clone 文本且不消费原响应，普通请求不发布', async () => {
        const fixture = youtubeFixture();
        const dispose = installYoutubeTimedTextBridgeCore(fixture.environment);
        const timedResponse = await fixture.fetch.value.call({}, '/api/timedtext?lang=en');
        const normalResponse = await fixture.fetch.value.call({}, '/watch');
        await flush();
        expect(timedResponse).toBe(fixture.response);
        expect(normalResponse).toBe(fixture.response);
        expect(fixture.originalFetch).toHaveBeenCalledTimes(2);
        expect(fixture.posts).toEqual([{
            payload: expect.objectContaining({url: '/api/timedtext?lang=en', responseText: '<timedtext />'}),
            targetOrigin: 'https://www.youtube.com',
        }]);
        dispose();
        expect(fixture.fetch.value).toBe(fixture.originalFetch);
    });

    it('clone、text 与 postMessage 失败均不改变 fetch 结果', async () => {
        const fixture = youtubeFixture();
        const cloneFailure = {clone: () => { throw new Error('clone failed'); }};
        (fixture.originalFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(cloneFailure);
        installYoutubeTimedTextBridgeCore(fixture.environment);
        await expect(fixture.fetch.value.call({}, '/api/timedtext')).resolves.toBe(cloneFailure);

        const textFailure = {clone: () => ({text: async () => { throw new Error('text failed'); }})};
        (fixture.originalFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(textFailure);
        await expect(fixture.fetch.value.call({}, '/api/timedtext')).resolves.toBe(textFailure);
        const emptyText = {clone: () => ({text: async () => ''})};
        (fixture.originalFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(emptyText);
        await expect(fixture.fetch.value.call({}, '/api/timedtext')).resolves.toBe(emptyText);
        fixture.setPostFailure(true);
        await fixture.fetch.value.call({}, '/api/timedtext');
        await flush();
    });

    it('采集 XHR load，复用对象时清除旧 URL，并忽略不可读 responseText', () => {
        const fixture = youtubeFixture();
        installYoutubeTimedTextBridgeCore(fixture.environment);
        const xhr = new FakeXhr();
        xhr.responseText = '<xml xhr />';
        fixture.xhrOpen.value.call(xhr, 'GET', '/api/timedtext', true);
        fixture.xhrSend.value.call(xhr, null);
        xhr.emit('load');
        expect(fixture.posts).toHaveLength(1);
        expect(fixture.originalOpen).toHaveBeenCalledWith('GET', '/api/timedtext', true);
        expect(fixture.originalSend).toHaveBeenCalledWith(null);

        const reused = new FakeXhr();
        fixture.xhrOpen.value.call(reused, 'GET', '/api/timedtext');
        fixture.xhrOpen.value.call(reused, 'GET', '/watch');
        fixture.xhrSend.value.call(reused);
        expect(reused.listeners.get('load')).toBeUndefined();

        const throwing = new FakeXhr();
        Object.defineProperty(throwing, 'responseText', {get() { throw new Error('invalid state'); }});
        fixture.xhrOpen.value.call(throwing, 'GET', '/api/timedtext');
        fixture.xhrSend.value.call(throwing);
        expect(() => throwing.emit('load')).not.toThrow();
    });

    it('XHR send 后 abort/同步失败再复用时不会发布旧 timedtext URL', () => {
        const fixture = youtubeFixture();
        installYoutubeTimedTextBridgeCore(fixture.environment);
        expect(fixture.xhrSend.value.call(new FakeXhr())).toBeInstanceOf(FakeXhr);
        const reused = new FakeXhr();
        reused.responseText = '<current />';
        fixture.xhrOpen.value.call(reused, 'GET', '/api/timedtext?old=1');
        fixture.xhrSend.value.call(reused);
        fixture.xhrOpen.value.call(reused, 'GET', '/api/timedtext?new=1');
        fixture.xhrSend.value.call(reused);
        reused.emit('load');
        expect(fixture.posts).toEqual([{
            payload: expect.objectContaining({url: '/api/timedtext?new=1'}),
            targetOrigin: 'https://www.youtube.com',
        }]);

        const failed = new FakeXhr();
        (fixture.originalSend as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
            throw new Error('send failed');
        });
        fixture.xhrOpen.value.call(failed, 'GET', '/api/timedtext?failed=1');
        expect(() => fixture.xhrSend.value.call(failed)).toThrow('send failed');
        failed.emit('load');
        expect(fixture.posts).toHaveLength(1);
    });

    it('BFCache pagehide 保留 bridge，普通 pagehide/显式事件恢复 API', () => {
        const fixture = youtubeFixture();
        const firstDispose = installYoutubeTimedTextBridgeCore(fixture.environment);
        const firstFetch = fixture.fetch.value;
        const secondDispose = installYoutubeTimedTextBridgeCore(fixture.environment);
        expect(fixture.fetch.value).not.toBe(firstFetch);
        firstDispose();
        expect(fixture.fetch.value).not.toBe(fixture.originalFetch);
        fixture.documentEvents.emit(YOUTUBE_BRIDGE_DISPOSE_EVENT);
        expect(fixture.fetch.value).toBe(fixture.originalFetch);
        expect(fixture.stateHost[YOUTUBE_BRIDGE_STATE_KEY]).toBeUndefined();
        secondDispose();

        installYoutubeTimedTextBridgeCore(fixture.environment);
        const bfcacheWrapper = fixture.fetch.value;
        fixture.pageEvents.emit('pagehide', {persisted: true});
        expect(fixture.fetch.value).toBe(bfcacheWrapper);
        fixture.pageEvents.emit('pagehide', {persisted: false});
        expect(fixture.fetch.value).toBe(fixture.originalFetch);
    });

    it('站点禁用停止延迟发布并恢复 API，重新启用不嵌套包装', async () => {
        const fixture = youtubeFixture();
        let resolveText: (value: string) => void = () => undefined;
        const delayed = {clone: () => ({text: () => new Promise<string>((resolve) => { resolveText = resolve; })})};
        (fixture.originalFetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(delayed);
        const firstLifecycleDispose = installYoutubeTimedTextBridgeLifecycleCore(fixture.environment);
        const firstWrapper = fixture.fetch.value;
        const disposeLifecycle = installYoutubeTimedTextBridgeLifecycleCore(fixture.environment);
        firstLifecycleDispose();
        expect(fixture.fetch.value).not.toBe(fixture.originalFetch);
        expect(fixture.stateHost[YOUTUBE_BRIDGE_LIFECYCLE_STATE_KEY]).toBeTruthy();
        await fixture.fetch.value.call({}, '/api/timedtext?pending=1');

        fixture.documentEvents.emit(YOUTUBE_BRIDGE_DISPOSE_EVENT);
        expect(fixture.fetch.value).toBe(fixture.originalFetch);
        resolveText('<late />');
        await flush();
        expect(fixture.posts).toHaveLength(0);

        fixture.documentEvents.emit(YOUTUBE_BRIDGE_ENABLE_EVENT);
        const restoredWrapper = fixture.fetch.value;
        expect(restoredWrapper).not.toBe(firstWrapper);
        fixture.documentEvents.emit(YOUTUBE_BRIDGE_ENABLE_EVENT);
        expect(fixture.fetch.value).toBe(restoredWrapper);

        disposeLifecycle();
        expect(fixture.fetch.value).toBe(fixture.originalFetch);
        expect(fixture.stateHost[YOUTUBE_BRIDGE_LIFECYCLE_STATE_KEY]).toBeUndefined();
    });

    it('只读、后来锁定或被宿主替换的方法安全降级', () => {
        const fixture = youtubeFixture();
        fixture.fetch.lock();
        const dispose = installYoutubeTimedTextBridgeCore(fixture.environment);
        expect(fixture.fetch.value).toBe(fixture.originalFetch);
        fixture.xhrOpen.lock();
        fixture.xhrSend.value = fixture.originalSend;
        expect(() => dispose()).not.toThrow();
        expect(fixture.pageEvents.listeners.get('pagehide')?.size).toBe(0);
    });
});
