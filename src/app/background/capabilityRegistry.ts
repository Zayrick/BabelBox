import type {BackgroundMessageHandler} from '@/src/platform/browser/messageRouter';
import type {BrowserCapabilities} from '@/src/platform/browser/capabilities';

export interface CapabilityGatedBackgroundFactories<TContext> {
    readonly areaTranslation: () => Array<BackgroundMessageHandler<TContext>>;
    readonly imageTranslation: () => Array<BackgroundMessageHandler<TContext>>;
}

/** 不支持的 feature 连 factory 都不调用，避免在 Firefox 注册必失败消息 handler。 */
export function createCapabilityGatedBackgroundHandlers<TContext>(
    capabilities: BrowserCapabilities,
    factories: CapabilityGatedBackgroundFactories<TContext>,
): Array<BackgroundMessageHandler<TContext>> {
    const handlers: Array<BackgroundMessageHandler<TContext>> = [];
    if (capabilities.areaTranslation) handlers.push(...factories.areaTranslation());
    if (capabilities.imageTranslation) handlers.push(...factories.imageTranslation());
    return handlers;
}

export function createCapabilityGatedSelectionTtsTransport<TRequest, TRoute>(
    capabilities: BrowserCapabilities,
    transport: {
        readonly play: (request: TRequest) => Promise<void>;
        readonly stop: (route: TRoute) => Promise<void>;
    },
): {
    readonly play: (request: TRequest) => Promise<void>;
    readonly stop: (route: TRoute) => Promise<void>;
} {
    if (capabilities.selectionTtsOffscreen) return transport;
    return {
        // handler 在 page-only 模式下不会调用 play；保留签名避免分裂协议。
        play: transport.play,
        stop: async () => undefined,
    };
}
