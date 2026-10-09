import type {BackgroundMessageHandler} from '@/src/platform/browser/messageRouter';

export const CONFIG_PERSIST_MESSAGE_TYPE = 'persistConfig' as const;

export interface ConfigPersistenceMessage {
    type: typeof CONFIG_PERSIST_MESSAGE_TYPE;
    patch?: unknown;
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

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function createConfigPersistenceHandler(
    persistPatch: (patch: Record<string, unknown>) => Promise<unknown>,
): BackgroundMessageHandler<ConfigPersistenceContext, ConfigPersistenceMessage, ConfigPersistenceResponse> {
    return {
        type: CONFIG_PERSIST_MESSAGE_TYPE,
        async handle(message) {
            if (!isPlainRecord(message.patch)) throw new TypeError('配置保存 payload 缺少有效 patch');
            // 翻译计数只能通过增量消息修改，页面快照中的计数可能已经过期。
            const {count: _count, ...patch} = message.patch;
            await persistPatch(patch);
            return {success: true};
        },
    };
}
