import type {BackgroundMessageHandler} from '@/src/platform/browser/messageRouter';

export const CONNECTION_TEST_MESSAGE_TYPE = 'testTranslationService' as const;

export interface ConnectionTestMessage {
    type: typeof CONNECTION_TEST_MESSAGE_TYPE;
    service?: unknown;
}

export type ConnectionTestResponse =
    | {success: true; durationMs: number}
    | {success: false; error: string};

export interface ConnectionTestDependencies {
    readonly ready: Promise<void>;
    readonly runConnectionTest: (service: string) => Promise<{durationMs: number}>;
    readonly formatError: (service: string, error: unknown) => string;
}

function parseService(value: unknown): string {
    if (typeof value === 'string' && value.trim()) return value;
    throw new TypeError('连接测试 service 必须是非空字符串');
}

/** 创建 provider 连接测试 handler；错误在本 handler 内格式化，保持旧后台响应协议。 */
export function createConnectionTestHandler(
    dependencies: ConnectionTestDependencies,
): BackgroundMessageHandler<unknown, ConnectionTestMessage, ConnectionTestResponse> {
    return {
        type: CONNECTION_TEST_MESSAGE_TYPE,
        async handle(message) {
            let service = '';
            try {
                // 后台边界先收窄服务 ID，避免非法 payload 进入 provider registry。
                service = parseService(message.service);
                await dependencies.ready;

                // provider 测试失败时使用现有格式化器返回用户可读错误。
                const result = await dependencies.runConnectionTest(service);
                return {success: true, ...result};
            } catch (error) {
                return {success: false, error: dependencies.formatError(service, error)};
            }
        },
    };
}
