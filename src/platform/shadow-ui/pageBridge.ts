import {
    installShadowRouteBridgeLifecycleCore,
    type AttachShadowPort,
    type BridgeEventTarget,
    type HistoryMutationPort,
} from './pageBridgeCore';

/** 把真实页面的 DOM/History API 注入可测试的 MAIN world bridge。 */
export function installShadowAndRouteBridge(): () => void {
    const pageWindow = window as typeof window & Record<string, unknown>;
    const navigation = (pageWindow as typeof window & {navigation?: EventTarget}).navigation;
    return installShadowRouteBridgeLifecycleCore({
        stateHost: pageWindow,
        attachShadow: {
            get: () => Element.prototype.attachShadow as unknown as AttachShadowPort,
            set: (value) => { Element.prototype.attachShadow = value as typeof Element.prototype.attachShadow; },
        },
        pushState: {
            get: () => history.pushState as unknown as HistoryMutationPort,
            set: (value) => { history.pushState = value as History['pushState']; },
        },
        replaceState: {
            get: () => history.replaceState as unknown as HistoryMutationPort,
            set: (value) => { history.replaceState = value as History['replaceState']; },
        },
        windowEvents: window as unknown as BridgeEventTarget,
        documentEvents: document as unknown as BridgeEventTarget,
        navigationEvents: navigation as unknown as BridgeEventTarget | undefined,
        getHref: () => location.href,
        createEvent: (type, init) => new CustomEvent(type, init),
    });
}
