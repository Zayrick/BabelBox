import {method} from "@/src/core/config/constants";
import {geminiBody, requestModel} from '@/src/services/translation/templates';
import type {TranslationProviderRequest} from '@/src/services/translation/types';
import {appendOptionalHeader} from './auth';
import {createHttpStatusError, readJsonResponse} from '@/src/platform/http/errors';
import {runtimeFetch} from '@/src/platform/http/runtime';
import {requireSingleOrigin} from './request';

async function gemini(request: TranslationProviderRequest) {
    const {service} = request;
    const proxyUrl = service.endpoint.trim();
    const url = proxyUrl
        || `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(requestModel(request))}:generateContent`;

    const headers = new Headers({'Content-Type': 'application/json'});
    // Google documents x-goog-api-key for direct Gemini REST requests. Never
    // forward the Google credential to a user-configured proxy.
    if (!proxyUrl) appendOptionalHeader(headers, 'x-goog-api-key', service.credential.apiKey);

    const resp = await runtimeFetch(url, {
        method: method.POST,
        headers,
        body: geminiBody(request, requireSingleOrigin(request)),
    });
    if (!resp.ok) throw createHttpStatusError(resp, '翻译失败');

    const result = await readJsonResponse<any>(resp, 'Gemini 返回的不是有效 JSON');
    return result.candidates[0].content.parts[0].text;
}

export default gemini;
