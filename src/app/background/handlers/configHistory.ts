import type {BackgroundMessageHandler} from '@/src/platform/browser/messageRouter';

export const CONFIG_HISTORY_MESSAGE_TYPE = 'configHistoryAction' as const;

export type ConfigHistoryAction = 'undo' | 'redo' | 'restore';

export interface ConfigHistoryMessage {
    type: typeof CONFIG_HISTORY_MESSAGE_TYPE;
    action?: unknown;
    version?: unknown;
}
export type ConfigHistoryResponse<T> =
    | {success: true; history: T}
    | {success: false; error: string};

export type ApplyConfigHistoryAction<T> = (
    action: ConfigHistoryAction,
    version?: number,
) => Promise<T>;

/** 创建配置历史 handler；配置存储与历史栈由 service 依赖实现。 */
export function createConfigHistoryHandler<T>(
    applyConfigHistoryAction: ApplyConfigHistoryAction<T>,
): BackgroundMessageHandler<unknown, ConfigHistoryMessage, ConfigHistoryResponse<T>> {
    return {
        type: CONFIG_HISTORY_MESSAGE_TYPE,
        async handle(message) {
            // 在后台信任边界把未知 action 收窄为明确的历史操作。
            const action = message.action === 'undo'
                || message.action === 'redo'
                || message.action === 'restore'
                ? message.action
                : null;
            if (!action) return {success: false, error: '无效的配置历史操作'};

            // 只有有限数字版本才向 service 传递，其余值按“当前版本”处理。
            const version = typeof message.version === 'number' && Number.isFinite(message.version)
                ? message.version
                : undefined;
            const history = await applyConfigHistoryAction(action, version);
            return {success: true, history};
        },
    };
}
