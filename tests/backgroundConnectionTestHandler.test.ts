import {describe, expect, it, vi} from 'vitest';

import {
    CONNECTION_TEST_MESSAGE_TYPE,
    createConnectionTestHandler,
} from '@/src/app/background/handlers/connectionTest';
import {createBackgroundMessageRouter} from '@/src/platform/browser/messageRouter';

describe('background connection test handler', () => {
    it('等待配置 ready 后执行 provider 连接测试', async () => {
        const runConnectionTest = vi.fn(async () => ({durationMs: 25}));
        const formatError = vi.fn((service: string, error: unknown) => `${service}:${String(error)}`);
        const router = createBackgroundMessageRouter([
            createConnectionTestHandler({
                ready: Promise.resolve(),
                runConnectionTest,
                formatError,
            }),
        ]);

        await expect(router.dispatch({
            type: CONNECTION_TEST_MESSAGE_TYPE,
            service: 'demo',
        }, undefined)).resolves.toEqual({
            handled: true,
            response: {success: true, durationMs: 25},
        });
        expect(runConnectionTest).toHaveBeenCalledWith('demo');
        expect(formatError).not.toHaveBeenCalled();
    });

    it('provider 失败时使用现有格式化器返回错误响应', async () => {
        const failure = new Error('provider down');
        const runConnectionTest = vi.fn(async () => { throw failure; });
        const formatError = vi.fn((service: string, error: unknown) => `${service}:${(error as Error).message}`);
        const handler = createConnectionTestHandler({
            ready: Promise.resolve(),
            runConnectionTest,
            formatError,
        });

        await expect(handler.handle({
            type: CONNECTION_TEST_MESSAGE_TYPE,
            service: 'demo',
        }, undefined)).resolves.toEqual({success: false, error: 'demo:provider down'});
        expect(formatError).toHaveBeenCalledWith('demo', failure);
    });

    it('配置初始化失败时仍按目标 service 格式化', async () => {
        const readyFailure = new Error('config unavailable');
        const formatError = vi.fn((service: string, error: unknown) => `${service}:${(error as Error).message}`);
        const handler = createConnectionTestHandler({
            ready: Promise.reject(readyFailure),
            runConnectionTest: vi.fn(),
            formatError,
        });

        await expect(handler.handle({
            type: CONNECTION_TEST_MESSAGE_TYPE,
            service: 'demo',
        }, undefined)).resolves.toEqual({success: false, error: 'demo:config unavailable'});
    });

    it.each([
        undefined,
        '',
        '   ',
        42,
    ])('拒绝非法 service payload %# 且不进入 provider', async (service) => {
        const runConnectionTest = vi.fn();
        const formatError = vi.fn((serviceName: string, error: unknown) => `${serviceName}:${(error as Error).message}`);
        const handler = createConnectionTestHandler({
            ready: Promise.resolve(),
            runConnectionTest,
            formatError,
        });

        await expect(handler.handle({
            type: CONNECTION_TEST_MESSAGE_TYPE,
            service,
        }, undefined)).resolves.toEqual({
            success: false,
            error: ':连接测试 service 必须是非空字符串',
        });
        expect(runConnectionTest).not.toHaveBeenCalled();
    });
});
