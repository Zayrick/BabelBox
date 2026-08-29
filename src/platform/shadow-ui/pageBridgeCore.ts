export const SHADOW_ROOT_EVENT = 'babelbox-open-shadow-root';
export const ROUTE_CHANGE_EVENT = 'babelbox-route-change';
export const SHADOW_BRIDGE_DISPOSE_EVENT = 'babelbox-shadow-bridge-dispose';
export const SHADOW_BRIDGE_ENABLE_EVENT = 'babelbox-shadow-bridge-enable';
export const SHADOW_BRIDGE_STATE_KEY = '__babelboxShadowBridgeState__';
export const SHADOW_BRIDGE_LIFECYCLE_STATE_KEY = '__babelboxShadowBridgeLifecycleState__';

export interface BridgeEventTarget {
    addEventListener(type: string, listener: () => void): void;
    removeEventListener(type: string, listener: () => void): void;
    dispatchEvent(event: unknown): unknown;
}

export interface BridgeMethodSlot<T extends (...args: never[]) => unknown> {
    get(): T;
    set(value: T): void;
}

export interface ShadowHostPort {
    dispatchEvent(event: unknown): unknown;
}

export type AttachShadowPort = (this: ShadowHostPort, init: {mode?: string}) => unknown;
export type HistoryMutationPort = (
    this: unknown,
    data: unknown,
    unused: string,
    url?: string | URL | null,
) => unknown;

export interface ShadowRouteBridgeEnvironment {
    readonly stateHost: Record<string, unknown>;
    readonly attachShadow: BridgeMethodSlot<AttachShadowPort>;
    readonly pushState: BridgeMethodSlot<HistoryMutationPort>;
    readonly replaceState: BridgeMethodSlot<HistoryMutationPort>;
    readonly windowEvents: BridgeEventTarget;
    readonly documentEvents: BridgeEventTarget;
    readonly navigationEvents?: BridgeEventTarget;
    readonly getHref: () => string;
    readonly createEvent: (type: string, init?: Record<string, unknown>) => unknown;
}

interface ShadowRouteBridgeState {
    readonly owner: symbol;
    readonly dispose: () => void;
}

interface ShadowRouteBridgeLifecycleState {
    readonly owner: symbol;
    readonly dispose: () => void;
}

function installMethod<T extends (...args: never[]) => unknown>(slot: BridgeMethodSlot<T>, value: T): boolean {
    try {
        slot.set(value);
        return slot.get() === value;
    } catch {
        return false;
    }
}

function restoreMethod<T extends (...args: never[]) => unknown>(
    slot: BridgeMethodSlot<T>,
    wrapper: T,
    original: T,
): void {
    try {
        if (slot.get() === wrapper) slot.set(original);
    } catch {
        // 强化页面可能把宿主 API 改为不可写；卸载失败不能破坏页面生命周期。
    }
}

/** 与 DOM 全局无关的 MAIN world bridge 状态机。 */
export function installShadowRouteBridgeCore(environment: ShadowRouteBridgeEnvironment): () => void {
    const previous = environment.stateHost[SHADOW_BRIDGE_STATE_KEY] as ShadowRouteBridgeState | undefined;
    previous?.dispose?.();

    const owner = Symbol('babelbox-shadow-bridge');
    const originalAttachShadow = environment.attachShadow.get();
    const originalPushState = environment.pushState.get();
    const originalReplaceState = environment.replaceState.get();
    const dispatchRouteChange = () => environment.documentEvents.dispatchEvent(
        environment.createEvent(ROUTE_CHANGE_EVENT),
    );
    const attachShadowWrapper: AttachShadowPort = function attachShadow(init) {
        const root = Reflect.apply(originalAttachShadow, this, [init]);
        if (init.mode === 'open') {
            this.dispatchEvent(environment.createEvent(SHADOW_ROOT_EVENT, {
                bubbles: true,
                composed: true,
            }));
        }
        return root;
    };
    const pushStateWrapper: HistoryMutationPort = function pushState(data, unused, url) {
        const previousUrl = environment.getHref();
        const result = Reflect.apply(originalPushState, this, [data, unused, url]);
        if (environment.getHref() !== previousUrl) dispatchRouteChange();
        return result;
    };
    const replaceStateWrapper: HistoryMutationPort = function replaceState(data, unused, url) {
        const previousUrl = environment.getHref();
        const result = Reflect.apply(originalReplaceState, this, [data, unused, url]);
        if (environment.getHref() !== previousUrl) dispatchRouteChange();
        return result;
    };
    const dispose = () => {
        const current = environment.stateHost[SHADOW_BRIDGE_STATE_KEY] as ShadowRouteBridgeState | undefined;
        if (current?.owner !== owner) return;
        restoreMethod(environment.attachShadow, attachShadowWrapper, originalAttachShadow);
        restoreMethod(environment.pushState, pushStateWrapper, originalPushState);
        restoreMethod(environment.replaceState, replaceStateWrapper, originalReplaceState);
        environment.windowEvents.removeEventListener('popstate', dispatchRouteChange);
        environment.windowEvents.removeEventListener('hashchange', dispatchRouteChange);
        environment.navigationEvents?.removeEventListener('navigate', dispatchRouteChange);
        environment.documentEvents.removeEventListener(SHADOW_BRIDGE_DISPOSE_EVENT, dispose);
        delete environment.stateHost[SHADOW_BRIDGE_STATE_KEY];
    };

    // 三个宿主方法独立安装；单个只读 API 不妨碍其余路由/ShadowRoot 观测。
    installMethod(environment.attachShadow, attachShadowWrapper);
    installMethod(environment.pushState, pushStateWrapper);
    installMethod(environment.replaceState, replaceStateWrapper);
    environment.windowEvents.addEventListener('popstate', dispatchRouteChange);
    environment.windowEvents.addEventListener('hashchange', dispatchRouteChange);
    environment.navigationEvents?.addEventListener('navigate', dispatchRouteChange);
    environment.stateHost[SHADOW_BRIDGE_STATE_KEY] = {owner, dispose};
    environment.documentEvents.addEventListener(SHADOW_BRIDGE_DISPOSE_EVENT, dispose);
    return dispose;
}

/** 允许 isolated content runtime 在站点禁用/恢复时完整还原并重装 MAIN world 宿主 API。 */
export function installShadowRouteBridgeLifecycleCore(environment: ShadowRouteBridgeEnvironment): () => void {
    const previous = environment.stateHost[SHADOW_BRIDGE_LIFECYCLE_STATE_KEY] as ShadowRouteBridgeLifecycleState | undefined;
    previous?.dispose?.();

    const owner = Symbol('babelbox-shadow-bridge-lifecycle');
    let disposeBridge = installShadowRouteBridgeCore(environment);
    const disable = () => disposeBridge();
    const enable = () => {
        if (environment.stateHost[SHADOW_BRIDGE_STATE_KEY]) return;
        disposeBridge = installShadowRouteBridgeCore(environment);
    };
    const dispose = () => {
        const current = environment.stateHost[SHADOW_BRIDGE_LIFECYCLE_STATE_KEY] as ShadowRouteBridgeLifecycleState | undefined;
        if (current?.owner !== owner) return;
        environment.documentEvents.removeEventListener(SHADOW_BRIDGE_DISPOSE_EVENT, disable);
        environment.documentEvents.removeEventListener(SHADOW_BRIDGE_ENABLE_EVENT, enable);
        disposeBridge();
        delete environment.stateHost[SHADOW_BRIDGE_LIFECYCLE_STATE_KEY];
    };

    environment.documentEvents.addEventListener(SHADOW_BRIDGE_DISPOSE_EVENT, disable);
    environment.documentEvents.addEventListener(SHADOW_BRIDGE_ENABLE_EVENT, enable);
    environment.stateHost[SHADOW_BRIDGE_LIFECYCLE_STATE_KEY] = {owner, dispose};
    return dispose;
}
