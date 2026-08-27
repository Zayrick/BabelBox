import type {BackgroundMessageHandler} from '@/src/platform/browser/messageRouter';

export const CONFIG_PERSIST_MESSAGE_TYPE = 'persistConfig' as const;

export interface ConfigPersistenceMessage {
    type: typeof CONFIG_PERSIST_MESSAGE_TYPE;
    config?: unknown;
    clientId?: unknown;
    sequence?: unknown;
}

export interface ConfigPersistenceContext {
    sender?: {
        id?: string;
        url?: string;
        frameId?: number;
        tab?: {
            id?: number;
        };
    };
}

export interface ConfigPersistenceResponse {
    success: true;
}

export interface ConfigPersistenceDependencies<TConfig> {
    readonly ready: Promise<void>;
    readonly getCurrentConfig: () => TConfig;
    readonly prepareConfigSaveRequest: (
        incomingConfig: Record<string, unknown>,
        currentConfig: TConfig,
        allowCredentialUpdates: boolean,
    ) => TConfig;
    readonly saveConfig: (config: TConfig, options: {recordHistory: true}) => Promise<void>;
    readonly isExtensionUrl: (url: string) => boolean;
}

interface ParsedConfigPersistenceRequest {
    config: Record<string, unknown>;
    clientId: string;
    sequence: number;
    allowCredentialUpdates: boolean;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseClientId(value: unknown): string {
    if (typeof value === 'string' && value.trim()) return value;
    throw new TypeError('配置保存 clientId 必须是非空字符串');
}

function parseSequence(value: unknown): number {
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
    throw new TypeError('配置保存 sequence 必须是正安全整数');
}

function parseConfigPersistenceMessage(
    message: ConfigPersistenceMessage,
    context: ConfigPersistenceContext,
    isExtensionUrl: (url: string) => boolean,
): ParsedConfigPersistenceRequest {
    if (!isPlainRecord(message.config)) throw new TypeError('配置保存 payload 缺少有效 config');

    const clientId = parseClientId(message.clientId);
    const sequence = parseSequence(message.sequence);

    // 只有扩展自身页面可以更新凭据；content/page 消息只能保存公开字段。
    const senderUrl = typeof context.sender?.url === 'string' ? context.sender.url : '';
    return {
        config: message.config,
        clientId,
        sequence,
        allowCredentialUpdates: isExtensionUrl(senderUrl),
    };
}

export function createConfigPersistenceHandler<TConfig>(
    dependencies: ConfigPersistenceDependencies<TConfig>,
): BackgroundMessageHandler<ConfigPersistenceContext, ConfigPersistenceMessage, ConfigPersistenceResponse> {
    let persistQueue: Promise<void> = Promise.resolve();
    const latestSequenceByClient = new Map<string, number>();

    return {
        type: CONFIG_PERSIST_MESSAGE_TYPE,
        async handle(message, context) {
            const request = parseConfigPersistenceMessage(message, context, dependencies.isExtensionUrl);
            const lastSequence = latestSequenceByClient.get(request.clientId) ?? 0;
            if (request.sequence <= lastSequence) return {success: true};
            latestSequenceByClient.set(request.clientId, request.sequence);

            const persist = persistQueue
                .catch(() => undefined)
                .then(async () => {
                    if (latestSequenceByClient.get(request.clientId) !== request.sequence) return;
                    await dependencies.ready;

                    const prepared = dependencies.prepareConfigSaveRequest(
                        request.config,
                        dependencies.getCurrentConfig(),
                        request.allowCredentialUpdates,
                    );
                    await dependencies.saveConfig(prepared, {recordHistory: true});
                });
            persistQueue = persist.catch(() => undefined);
            await persist;
            return {success: true};
        },
    };
}
