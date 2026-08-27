import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockConfig } = vi.hoisted(() => ({
    mockConfig: {
        service: 'custom',
        custom: 'http://127.0.0.1:11434/v1/chat/completions',
        proxy: {} as Record<string, string>,
        token: {} as Record<string, string>,
        model: {} as Record<string, string>,
        customModel: {} as Record<string, string>,
        customBody: {} as Record<string, string>,
        system_role: {} as Record<string, string>,
        user_role: {} as Record<string, string>,
        to: 'zh-Hans',
    },
}));

vi.mock('@/src/services/config/store', () => ({ config: mockConfig }));

import {translateWithOpenAICompatibleAiSdk} from '@/src/providers/translation/ai-sdk/openai-compatible';
import {customModelString, services} from '@/src/core/config/catalog';

function successResponse() {
    return new Response(JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 1,
        model: 'local/translation-model',
        choices: [{index: 0, message: {role: 'assistant', content: '译文'}, finish_reason: 'stop'}],
        usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2},
    }), {
        status: 200,
        headers: {'content-type': 'application/json'},
    });
}

describe('自定义接口适配器', () => {
    beforeEach(() => {
        mockConfig.service = services.custom;
        mockConfig.custom = 'http://127.0.0.1:11434/v1/chat/completions';
        mockConfig.proxy = {};
        mockConfig.token = {[services.custom]: 'local-token'};
        mockConfig.model = {[services.custom]: customModelString};
        mockConfig.customModel = {[services.custom]: 'local/translation-model'};
        mockConfig.customBody = {};
        mockConfig.system_role = {[services.custom]: 'You are a translator.'};
        mockConfig.user_role = {[services.custom]: 'Translate {{origin}} into {{to}}.'};
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('使用按服务保存的代理、模型和令牌配置', async () => {
        mockConfig.proxy = {[services.custom]: 'http://127.0.0.1:8080'};
        const fetchMock = vi.fn().mockResolvedValue(successResponse());
        vi.stubGlobal('fetch', fetchMock);

        await expect(translateWithOpenAICompatibleAiSdk({origin: 'hello'})).resolves.toBe('译文');

        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('http://127.0.0.1:8080/');
        expect(new Headers(init.headers).get('Authorization')).toBe('Bearer local-token');
        expect(JSON.parse(String(init.body))).toMatchObject({model: 'local/translation-model'});
    });

    it('代理为空时回退到保存的自定义接口地址', async () => {
        const fetchMock = vi.fn().mockResolvedValue(successResponse());
        vi.stubGlobal('fetch', fetchMock);

        await translateWithOpenAICompatibleAiSdk({origin: 'hello'});

        expect(fetchMock.mock.calls[0]?.[0]).toBe(mockConfig.custom);
    });
});
