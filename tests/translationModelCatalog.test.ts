import {afterEach, describe, expect, it, vi} from 'vitest';

vi.mock('@/src/services/config/store', () => ({config: {}}));

import {Config, type TranslationServiceCredential} from '@/src/core/config/model';
import {services} from '@/src/core/config/catalog';
import {
    createAITranslationService,
    createTranslationServiceId,
} from '@/src/core/config/translationServices';
import {setRuntimeFetch} from '@/src/platform/http/runtime';
import {
    extractTranslationModelIds,
    listTranslationServiceModels,
} from '@/src/providers/translation/modelCatalog';
import {hasDynamicTranslationModelCatalog} from '@/src/services/translation/modelCatalog';

function credential(apiKey = ''): TranslationServiceCredential {
    return {apiKey, appKey: '', appSecret: '', secretId: '', secretKey: ''};
}

function configWithAIService(
    provider: string,
    options: {apiKey?: string; endpoint?: string} = {},
): {config: Config; instanceId: string} {
    const source = new Config();
    const instance = createAITranslationService(provider, {
        id: createTranslationServiceId(provider, source.translationServices),
        modelId: '',
        endpoint: options.endpoint || '',
    });
    source.translationServices.push(instance);
    if (options.apiKey !== undefined) {
        source.serviceCredentials[instance.id] = credential(options.apiKey);
    }
    return {config: source, instanceId: instance.id};
}

afterEach(() => {
    setRuntimeFetch();
    vi.restoreAllMocks();
});

describe('translation model catalog', () => {
    it('只为已确认存在模型列表 API 的供应商启用下拉菜单', () => {
        expect(hasDynamicTranslationModelCatalog(services.openai)).toBe(true);
        expect(hasDynamicTranslationModelCatalog(services.openrouter)).toBe(true);
        expect(hasDynamicTranslationModelCatalog(services.custom)).toBe(true);
        expect(hasDynamicTranslationModelCatalog(services.azureOpenai)).toBe(false);
        expect(hasDynamicTranslationModelCatalog(services.cozecom)).toBe(false);
        expect(hasDynamicTranslationModelCatalog(services.tongyi)).toBe(false);
    });

    it('OpenRouter 没有 API Key 时仍请求公开模型列表且不发送鉴权头', async () => {
        const {config, instanceId} = configWithAIService(services.openrouter);
        const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            expect(String(input)).toBe('https://openrouter.ai/api/v1/models');
            expect(new Headers(init?.headers).has('Authorization')).toBe(false);
            return new Response(JSON.stringify({data: [{id: 'openrouter/first'}, {id: 'openrouter/second'}]}), {
                status: 200,
                headers: {'Content-Type': 'application/json'},
            });
        });
        setRuntimeFetch(transport);

        await expect(listTranslationServiceModels(instanceId, config)).resolves.toEqual([
            'openrouter/first',
            'openrouter/second',
        ]);
        expect(transport).toHaveBeenCalledOnce();
    });

    it('用户已填写 API Key 时以 Bearer 方式请求 OpenAI 模型列表', async () => {
        const {config, instanceId} = configWithAIService(services.openai, {apiKey: 'key-for-test'});
        setRuntimeFetch(async (input, init) => {
            expect(String(input)).toBe('https://api.openai.com/v1/models');
            expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer key-for-test');
            return new Response(JSON.stringify({data: [{id: 'gpt-test'}]}), {status: 200});
        });

        await expect(listTranslationServiceModels(instanceId, config)).resolves.toEqual(['gpt-test']);
    });

    it('自定义 OpenAI 兼容接口从 Chat Completions 地址派生 /models', async () => {
        const {config, instanceId} = configWithAIService(services.custom, {
            endpoint: 'https://gateway.example.test/openai/v1/chat/completions',
        });
        setRuntimeFetch(async (input) => {
            expect(String(input)).toBe('https://gateway.example.test/openai/v1/models');
            return new Response(JSON.stringify({data: [{id: 'custom-chat-model'}]}), {status: 200});
        });

        await expect(listTranslationServiceModels(instanceId, config)).resolves.toEqual(['custom-chat-model']);
    });

    it('解析 Gemini 模型名并排除不支持 generateContent 的模型', () => {
        expect(extractTranslationModelIds({
            models: [
                {name: 'models/gemini-chat', supportedGenerationMethods: ['generateContent']},
                {baseModelId: 'gemini-embed', supportedGenerationMethods: ['embedContent']},
            ],
        })).toEqual(['gemini-chat']);
    });

    it('把供应商失败原因返回给 UI，但不会回显当前 API Key', async () => {
        const apiKey = 'sk-secret-value-for-test';
        const {config, instanceId} = configWithAIService(services.openai, {apiKey});
        setRuntimeFetch(async () => new Response(JSON.stringify({
            error: {message: `Invalid credential ${apiKey}`},
        }), {
            status: 401,
            statusText: 'Unauthorized',
            headers: {'Content-Type': 'application/json'},
        }));

        let error: Error | undefined;
        try {
            await listTranslationServiceModels(instanceId, config);
        } catch (reason) {
            error = reason as Error;
        }
        expect(error).toBeInstanceOf(Error);
        if (!error) throw new Error('预期模型列表请求失败');
        expect(error.message).toContain('HTTP 401 Unauthorized');
        expect(error.message).toContain('Invalid credential ***');
        expect(error.message).not.toContain(apiKey);
    });
});
