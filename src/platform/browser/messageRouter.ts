export interface BackgroundMessage {
    type: string;
}
export interface BackgroundMessageHandler<
    TContext,
    TMessage extends BackgroundMessage = BackgroundMessage,
    TResponse = unknown,
> {
    readonly type: TMessage['type'];
    handle(message: TMessage, context: TContext): TResponse | Promise<TResponse>;
}

export type BackgroundDispatchResult =
    | {handled: false}
    | {handled: true; response: unknown};

function readMessageType(message: unknown): string | null {
    if (!message || typeof message !== 'object') return null;
    const type = (message as {type?: unknown}).type;
    return typeof type === 'string' ? type : null;
}

export class BackgroundMessageRouter<TContext> {
    private readonly handlers = new Map<string, BackgroundMessageHandler<TContext>>();
    constructor(handlers: readonly BackgroundMessageHandler<TContext>[]) {
        for (const handler of handlers) {
            if (this.handlers.has(handler.type)) {
                throw new Error(`后台消息处理器重复注册: ${handler.type}`);
            }
            this.handlers.set(handler.type, handler);
        }
    }

    async dispatch(message: unknown, context: TContext): Promise<BackgroundDispatchResult> {
        const type = readMessageType(message);
        const handler = type === null ? undefined : this.handlers.get(type);
        if (handler) {
            const response = await handler.handle(message as BackgroundMessage, context);
            return {handled: true, response};
        }

        return {handled: false};
    }
}

export function createBackgroundMessageRouter<TContext>(
    handlers: readonly BackgroundMessageHandler<TContext>[],
): BackgroundMessageRouter<TContext> {
    return new BackgroundMessageRouter(handlers);
}
