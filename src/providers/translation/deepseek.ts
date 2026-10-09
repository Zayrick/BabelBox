import { method, urls } from "@/src/core/config/constants";
import {deepseekChatBody, deepseekResponsesBody} from '@/src/services/translation/templates';
import {stripTranslationReasoning as contentPostHandler} from '@/src/core/translation/prompts';
import { appendOptionalBearer } from './auth';
import {createHttpStatusError, readJsonResponse} from '@/src/platform/http/errors';
import {runtimeFetch} from '@/src/platform/http/runtime';
import type {TranslationProviderRequest} from '@/src/services/translation/types';
import {requireSingleOrigin} from './request';

async function deepseek(request: TranslationProviderRequest) {
    const {service} = request;
    const origin = requireSingleOrigin(request);
    const headers = new Headers({'Content-Type': 'application/json'});
    appendOptionalBearer(headers, service.credential.apiKey);

    // 当前官方 V4 文档以 Chat Completion 为主；Responses API 仅在用户明确选择时启用，
    // 便于兼容已经支持该协议的代理或网关。
    const isResponses = service.deepseekApiType === 'responses';
    const url = buildDeepSeekEndpoint(service.endpoint || urls[service.provider], isResponses);

    const resp = await runtimeFetch(url, {
        method: method.POST,
        headers,
        body: isResponses ? deepseekResponsesBody(request, origin) : deepseekChatBody(request, origin),
    });
    if (!resp.ok) throw createHttpStatusError(resp, '翻译失败');

    const result = await readJsonResponse<any>(resp, 'DeepSeek 返回的不是有效 JSON');
    return isResponses ? extractResponsesContent(result) : extractChatContent(result);
}

function extractChatContent(result: any): string {
    const content = result?.choices?.[0]?.message?.content;

    if (typeof content !== 'string') {
        throw new Error('DeepSeek 返回数据格式异常：缺少 choices[0].message.content');
    }

    // Only final message.content is rendered. DeepSeek thinking fields such as
    // reasoning_content are intentionally ignored and must never reach the page.
    return contentPostHandler(content);
}

function extractResponsesContent(result: any): string {
    if (typeof result?.output_text === 'string' && result.output_text) {
        return contentPostHandler(result.output_text);
    }

    const text = Array.isArray(result?.output)
        ? result.output
            .filter((item: any) => item?.type === 'message' && Array.isArray(item.content))
            .flatMap((item: any) => item.content)
            .filter((part: any) => part?.type === 'output_text' && typeof part.text === 'string')
            .map((part: any) => part.text)
            .join('')
        : '';

    if (!text) {
        throw new Error('DeepSeek 返回数据格式异常：缺少 Responses API 输出文本');
    }

    return contentPostHandler(text);
}

export function buildDeepSeekEndpoint(endpoint: string, isResponses: boolean): string {
    const targetPath = isResponses ? 'responses' : 'chat/completions';

    try {
        const url = new URL(endpoint);
        const basePath = url.pathname
            .replace(/\/(?:chat\/completions|responses)\/?$/, '')
            .replace(/\/+$/, '');
        url.pathname = `${basePath}/${targetPath}`;
        return url.toString();
    } catch {
        // 兼容部分代理接受的非标准地址，同时确保查询参数和 hash 不会被拼到路径中。
        const match = endpoint.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/);
        const path = (match?.[1] || endpoint)
            .replace(/\/(?:chat\/completions|responses)\/?$/, '')
            .replace(/\/+$/, '');
        return `${path}/${targetPath}${match?.[2] || ''}${match?.[3] || ''}`;
    }
}

export default deepseek;
