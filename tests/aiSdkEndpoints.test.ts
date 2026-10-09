import {describe, expect, it} from 'vitest';

import {
    AI_SDK_COMMON_SERVICE_IDS,
    AI_SDK_SERVICE_IDS,
    AI_SDK_TRANSPORT_PROFILE,
    getAiSdkEndpointRoute,
    normalizeNewApiEndpoint,
    parseChatCompletionsEndpoint,
    resolveOpenAICompatibleEndpoint,
    type AiSdkEndpointConfig,
} from '@/src/providers/translation/ai-sdk/endpoints';
import {services} from '@/src/core/config/catalog';
import {urls} from '@/src/core/config/constants';

const REQUIRED_ENDPOINTS: Record<string, string> = {
    [services.custom]: 'http://localhost:11434/v1/chat/completions',
    [services.newapi]: 'http://localhost:3000',
    [services.azureOpenai]: 'https://reader.openai.azure.com/openai/deployments/translation/chat/completions?api-version=2024-02-15-preview',
};

function endpointConfig(provider: string, overrides: Partial<AiSdkEndpointConfig> = {}): AiSdkEndpointConfig {
    return {
        provider,
        endpoint: REQUIRED_ENDPOINTS[provider] || '',
        minimaxBillingPlan: 'payg',
        minimaxRegion: 'cn',
        mimoBillingPlan: 'payg',
        mimoRegion: 'cn',
        ...overrides,
    };
}

describe('AI SDK 首批服务路由', () => {
    it('暴露稳定的 transport profile 供缓存隔离', () => {
        expect(AI_SDK_TRANSPORT_PROFILE).toBe('vercel-ai-sdk-openai-compatible-v1');
    });

    it('精确覆盖 15 个 common 服务和 3 个专用入口', () => {
        expect(AI_SDK_COMMON_SERVICE_IDS).toEqual([
            services.yiyan,
            services.infini,
            services.minimax,
            services.mimo,
            services.openai,
            services.moonshot,
            services.baichuan,
            services.lingyi,
            services.jieyue,
            services.groq,
            services.huanYuan,
            services.doubao,
            services.siliconCloud,
            services.openrouter,
            services.grok,
        ]);
        expect(new Set(AI_SDK_SERVICE_IDS).size).toBe(18);
        expect(getAiSdkEndpointRoute(services.custom)).toBe('custom');
        expect(getAiSdkEndpointRoute(services.newapi)).toBe('newapi');
        expect(getAiSdkEndpointRoute(services.azureOpenai)).toBe('azure');
        expect(getAiSdkEndpointRoute(services.deepseek)).toBeNull();
    });

    it.each([
        [services.yiyan, 'https://qianfan.bj.baidubce.com/v2/chat/completions', 'https://qianfan.bj.baidubce.com/v2'],
        [services.infini, 'https://cloud.infini-ai.com/maas/v1/chat/completions', 'https://cloud.infini-ai.com/maas/v1'],
        [services.minimax, 'https://api.minimaxi.com/v1/chat/completions', 'https://api.minimaxi.com/v1'],
        [services.mimo, 'https://api.xiaomimimo.com/v1/chat/completions', 'https://api.xiaomimimo.com/v1'],
        [services.openai, 'https://api.openai.com/v1/chat/completions', 'https://api.openai.com/v1'],
        [services.moonshot, 'https://api.moonshot.cn/v1/chat/completions', 'https://api.moonshot.cn/v1'],
        [services.baichuan, 'https://api.baichuan-ai.com/v1/chat/completions', 'https://api.baichuan-ai.com/v1'],
        [services.lingyi, 'https://api.lingyiwanwu.com/v1/chat/completions', 'https://api.lingyiwanwu.com/v1'],
        [services.jieyue, 'https://api.stepfun.com/v1/chat/completions', 'https://api.stepfun.com/v1'],
        [services.groq, 'https://api.groq.com/openai/v1/chat/completions', 'https://api.groq.com/openai/v1'],
        [services.huanYuan, 'https://api.tokenhub.tencent.com/v1/chat/completions', 'https://api.tokenhub.tencent.com/v1'],
        [services.doubao, 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', 'https://ark.cn-beijing.volces.com/api/v3'],
        [services.siliconCloud, 'https://api.siliconflow.cn/v1/chat/completions', 'https://api.siliconflow.cn/v1'],
        [services.openrouter, 'https://openrouter.ai/api/v1/chat/completions', 'https://openrouter.ai/api/v1'],
        [services.grok, 'https://api.x.ai/v1/chat/completions', 'https://api.x.ai/v1'],
        [services.custom, 'http://localhost:11434/v1/chat/completions', 'http://localhost:11434/v1'],
        [services.newapi, 'http://localhost:3000/v1/chat/completions', 'http://localhost:3000/v1'],
        [services.azureOpenai, 'https://reader.openai.azure.com/openai/deployments/translation/chat/completions?api-version=2024-02-15-preview', 'https://reader.openai.azure.com/openai/deployments/translation'],
    ])('%s 解析为当前请求 URL 和 SDK baseURL', (service, endpoint, baseURL) => {
        const result = resolveOpenAICompatibleEndpoint(endpointConfig(service));

        expect(result.endpoint).toBe(endpoint);
        expect(result.baseURL).toBe(baseURL);
        expect(result.queryParams).toEqual(service === services.azureOpenai
            ? {'api-version': '2024-02-15-preview'}
            : undefined);
        expect(result.exactEndpoint).toBeUndefined();
    });
});

describe('AI SDK endpoint 选择规则', () => {
    it('common 服务的实例请求地址覆盖默认端点', () => {
        const endpoint = 'https://gateway.example.com/openai/v1/chat/completions';
        const result = resolveOpenAICompatibleEndpoint(endpointConfig(services.openai, {endpoint}));

        expect(result.endpoint).toBe(endpoint);
        expect(result.baseURL).toBe('https://gateway.example.com/openai/v1');
    });

    it('MiniMax 保留计费方案和区域选择', () => {
        const result = resolveOpenAICompatibleEndpoint(endpointConfig(services.minimax, {
            minimaxBillingPlan: 'token-plan',
            minimaxRegion: 'global',
        }));

        expect(result.endpoint).toBe('https://api.minimax.io/v1/chat/completions');
    });

    it('MiMo 保留 Token Plan 集群选择', () => {
        const result = resolveOpenAICompatibleEndpoint(endpointConfig(services.mimo, {
            mimoBillingPlan: 'token-plan',
            mimoRegion: 'ams',
        }));

        expect(result.endpoint).toBe('https://token-plan-ams.xiaomimimo.com/v1/chat/completions');
    });

    it('空白请求地址不覆盖默认端点，缺失的 common URL 会显式失败', () => {
        expect(resolveOpenAICompatibleEndpoint(endpointConfig(services.openai, {endpoint: '   '})).endpoint)
            .toBe(urls[services.openai]);

        const original = urls[services.openai];
        try {
            delete urls[services.openai];
            expect(() => resolveOpenAICompatibleEndpoint(endpointConfig(services.openai)))
                .toThrow(`未找到翻译服务接口: ${services.openai}`);
        } finally {
            urls[services.openai] = original;
        }
    });

    it('Azure 从完整部署 URL 拆出 api-version', () => {
        const result = resolveOpenAICompatibleEndpoint(endpointConfig(services.azureOpenai));

        expect(result.queryParams).toEqual({'api-version': '2024-02-15-preview'});
        expect(result.baseURL).toBe('https://reader.openai.azure.com/openai/deployments/translation');
    });

    it.each([
        [services.deepseek, '尚未纳入 AI SDK 端点解析'],
        [services.custom, '接口地址未配置'],
        [services.newapi, 'New API 地址未配置'],
        [services.azureOpenai, '接口地址未配置'],
    ])('%s 缺少路由或必要地址时给出明确错误', (service, message) => {
        expect(() => resolveOpenAICompatibleEndpoint(endpointConfig(service, {endpoint: ''}))).toThrow(message);
    });
});

describe('Chat Completions URL 拆分', () => {
    it('拒绝语法无效的绝对 URL，并保留调用方标签', () => {
        expect(() => parseChatCompletionsEndpoint('not a url', '自定义地址')).toThrow('自定义地址格式不正确');
    });

    it('支持位于站点根路径且带尾斜杠的 Chat Completions URL', () => {
        const result = parseChatCompletionsEndpoint('https://gateway.example.com/chat/completions/');

        expect(result.endpoint).toBe('https://gateway.example.com/chat/completions');
        expect(result.baseURL).toBe('https://gateway.example.com');
    });
    it('拆分完整路径并保留查询参数', () => {
        const result = parseChatCompletionsEndpoint(
            'https://gateway.example.com/api/v1/chat/completions?api-version=2026-01-01&region=cn#ignored',
        );

        expect(result.endpoint).toBe('https://gateway.example.com/api/v1/chat/completions?api-version=2026-01-01&region=cn');
        expect(result.baseURL).toBe('https://gateway.example.com/api/v1');
        expect(result.queryParams).toEqual({'api-version': '2026-01-01', region: 'cn'});
        expect(result.exactEndpoint).toBeUndefined();
    });

    it('重复查询参数改用 exactEndpoint，避免 Record 归一化丢值', () => {
        const endpoint = 'https://gateway.example.com/v1/chat/completions?feature=a&feature=b';
        const result = parseChatCompletionsEndpoint(endpoint);

        expect(result.endpoint).toBe(endpoint);
        expect(result.queryParams).toBeUndefined();
        expect(result.exactEndpoint).toBe(endpoint);
    });

    it('非标准 Custom 路径返回 exactEndpoint，供后续 fetch rewrite 使用', () => {
        const result = resolveOpenAICompatibleEndpoint(endpointConfig(services.custom, {
            endpoint: 'https://local.example.com/api/generate?mode=translate',
        }));

        expect(result.baseURL).toBe('https://local.example.com/api/generate');
        expect(result.queryParams).toEqual({mode: 'translate'});
        expect(result.exactEndpoint).toBe('https://local.example.com/api/generate?mode=translate');
    });
});

describe('New API URL 规范化', () => {
    it.each([
        ['http://localhost:3000', 'http://localhost:3000/v1/chat/completions'],
        ['http://localhost:3000/', 'http://localhost:3000/v1/chat/completions'],
        ['http://localhost:3000/v1', 'http://localhost:3000/v1/chat/completions'],
        ['http://localhost:3000/v1/', 'http://localhost:3000/v1/chat/completions'],
        ['http://localhost:3000/v1/chat/completions', 'http://localhost:3000/v1/chat/completions'],
        ['https://gateway.example.com/api?tenant=reader', 'https://gateway.example.com/api/v1/chat/completions?tenant=reader'],
    ])('%s -> %s', (input, expected) => {
        expect(normalizeNewApiEndpoint(input)).toBe(expected);
    });

    it('拒绝空地址和非 HTTP(S) 协议', () => {
        expect(() => normalizeNewApiEndpoint('')).toThrow('New API 地址未配置');
        expect(() => normalizeNewApiEndpoint('file:///tmp/api')).toThrow('仅支持 HTTP 或 HTTPS');
    });
});
