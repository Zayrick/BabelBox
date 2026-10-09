import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {adapter, mockConfig} = vi.hoisted(() => ({
    adapter: vi.fn(),
    mockConfig: {} as Record<string, unknown>,
}));

vi.mock('@/src/providers/translation/registry', () => ({
    translationProviderRegistry: {
        demo: adapter,
    },
}));

vi.mock('@/src/services/config/store', () => ({config: mockConfig}));

import {
    CONNECTION_TEST_ORIGIN,
    formatConnectionTestError,
    runTranslationServiceConnectionTest,
} from '@/src/providers/translation/connectionTest';
import {formatServiceError, getServiceErrorMessage} from '@/src/services/translation/serviceErrors';
import {services} from '@/src/core/config/catalog';

function demoInstance(overrides: Record<string, unknown> = {}) {
    return {
        id: 'demo',
        provider: 'demo',
        name: 'Demo',
        enabled: true,
        kind: 'ai',
        modelId: 'demo-model',
        endpoint: '',
        customBody: '',
        systemRole: '',
        userRole: '',
        robotId: '',
        deepseekApiType: 'auto',
        deepseekThinkingMode: 'disabled',
        minimaxBillingPlan: 'payg',
        minimaxRegion: 'cn',
        mimoBillingPlan: 'payg',
        mimoRegion: 'cn',
        ...overrides,
    };
}

describe('翻译服务连接测试', () => {
    beforeEach(() => {
        for (const key of Object.keys(mockConfig)) delete mockConfig[key];
        Object.assign(mockConfig, {
            service: 'demo',
            from: 'auto',
            to: 'zh-CN',
            translationServices: [demoInstance()],
            serviceCredentials: {},
        });
        adapter.mockReset();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('调用真实适配器并携带实例配置与凭据，禁用的服务也可以测试', async () => {
        Object.assign(mockConfig, {
            translationServices: [demoInstance({
                id: 'service:demo:first',
                enabled: false,
                modelId: 'demo-v2',
                endpoint: 'https://example.test/v2',
                customBody: '{"temperature":0}',
            })],
            serviceCredentials: {
                'service:demo:first': {apiKey: 'instance-key', appKey: '', appSecret: '', secretId: '', secretKey: ''},
            },
        });
        adapter.mockResolvedValue('测试译文');

        await expect(runTranslationServiceConnectionTest('service:demo:first')).resolves.toEqual(
            expect.objectContaining({durationMs: expect.any(Number)}),
        );
        expect(adapter).toHaveBeenCalledWith(expect.objectContaining({
            origin: CONNECTION_TEST_ORIGIN,
            targetLanguage: 'zh-CN',
            service: expect.objectContaining({
                id: 'service:demo:first',
                modelId: 'demo-v2',
                endpoint: 'https://example.test/v2',
                customBody: '{"temperature":0}',
                credential: expect.objectContaining({apiKey: 'instance-key'}),
            }),
        }));
    });

    it('拒绝空响应，避免把仅 HTTP 成功误报为连接正常', async () => {
        adapter.mockResolvedValue('   ');

        await expect(runTranslationServiceConnectionTest('demo')).rejects.toThrow('没有返回有效译文');
    });

    it('拒绝非字符串响应、已删除服务与未知适配器', async () => {
        adapter.mockResolvedValue(['unexpected batch']);

        await expect(runTranslationServiceConnectionTest('demo')).rejects.toThrow('没有返回有效译文');
        await expect(runTranslationServiceConnectionTest('deleted')).rejects.toThrow('翻译服务不存在');
        (mockConfig.translationServices as unknown[]).push(demoInstance({id: 'missing', provider: 'missing'}));
        await expect(runTranslationServiceConnectionTest('missing')).rejects.toThrow('未找到翻译服务适配器: missing');
    });

    it('系统时钟回拨时将耗时钳制为零', async () => {
        adapter.mockResolvedValue('测试译文');
        vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(90);

        await expect(runTranslationServiceConnectionTest('demo')).resolves.toEqual({durationMs: 0});
    });

    it('复用统一服务错误格式化器', () => {
        expect(formatConnectionTestError('demo', new Error('plain failure'))).toBe('plain failure');
    });

    it('实例连接失败时按供应商而不是实例 ID 生成专用提示', () => {
        mockConfig.translationServices = [{
            id: 'service:minimax:first',
            provider: services.minimax,
            name: 'MiniMax first',
            enabled: true,
            modelId: 'MiniMax-Text-01',
        }];

        const message = formatConnectionTestError(
            'service:minimax:first',
            new Error('翻译失败: 401 Unauthorized'),
        );

        expect(message).toContain('Token Plan Key');
        expect(message).toContain('不能互换');
    });

    it('将 MiniMax 2049 错误转换为 Key、区域和计费类型提示', () => {
        const message = formatServiceError(
            services.minimax,
            new Error('翻译失败: 401 Unauthorized'),
        );

        expect(message).toContain('Token Plan Key');
        expect(message).toContain('api.minimaxi.com');
        expect(message).toContain('api.minimax.io');
        expect(message).toContain('不能互换');
    });

    it('将 MiMo 鉴权错误转换为 Key 前缀和集群提示', () => {
        const message = formatServiceError(
            services.mimo,
            new Error('翻译失败: 401 Unauthorized'),
        );

        expect(message).toContain('sk-');
        expect(message).toContain('tp-');
        expect(message).toContain('中国、新加坡或欧洲集群');
    });

    it('统一读取 Error 与非 Error 的消息', () => {
        expect(getServiceErrorMessage(new Error('from-error'))).toBe('from-error');
        expect(getServiceErrorMessage(503)).toBe('503');
    });

    it('网络错误增加可识别前缀，其他错误保持供应商原文', () => {
        expect(formatServiceError('demo', new Error('Failed to fetch endpoint')))
            .toBe('网络连接失败：Failed to fetch endpoint');
        expect(formatServiceError('demo', new Error('provider rejected request')))
            .toBe('provider rejected request');
    });

    it('空错误使用稳定兜底，并且鉴权提示只对匹配服务生效', () => {
        expect(formatServiceError('demo', '   ')).toBe('未知错误');
        expect(formatServiceError('demo', '401 Unauthorized')).toBe('401 Unauthorized');
    });
});
