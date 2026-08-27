import {method} from "@/src/core/config/constants";
import {geminiMsgTemplate} from '@/src/services/translation/templates';
import {customModelString} from "@/src/core/config/catalog";
import {config} from "@/src/services/config/store";
import {appendOptionalHeader} from './auth';
import {createHttpStatusError, readJsonResponse} from '@/src/platform/http/errors';
import {runtimeFetch} from '@/src/platform/http/runtime';
import {getTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';


async function gemini(message: any) {
    const current = getTranslationProviderConfig(message, config);
    const service = message.serviceOverride || current.service;

    const model = message.modelOverride
        || (current.model[service] === customModelString ? current.customModel[service] : current.model[service]);
    const proxyUrl = current.proxy[service]?.trim();
    const usesOfficialEndpoint = !proxyUrl;
    const url = proxyUrl
        || `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

    const headers = new Headers({'Content-Type': 'application/json'});
    // Google documents x-goog-api-key for direct Gemini REST requests. Never
    // forward the Google credential to a user-configured proxy.
    if (usesOfficialEndpoint) {
        appendOptionalHeader(headers, 'x-goog-api-key', current.token[service]);
    }

    const resp = await runtimeFetch(url, {
        method: method.POST,
        headers,
        body: geminiMsgTemplate(message.origin, message.pageContext, message.summaryPrompt, message.summarySystemPrompt, service, message.targetLanguage, current),
    });
    if (resp.ok) {
        const result = await readJsonResponse<any>(resp, 'Gemini 返回的不是有效 JSON');
        return result.candidates[0].content.parts[0].text;
    } else {
        throw createHttpStatusError(resp, '翻译失败');
    }
}

export default gemini;
