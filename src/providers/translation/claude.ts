import {services} from "@/src/core/config/catalog";
import {method, urls} from "@/src/core/config/constants";
import {claudeMsgTemplate} from '@/src/services/translation/templates';
import {config} from "@/src/services/config/store";
import {appendOptionalHeader} from './auth';
import {createHttpStatusError, readJsonResponse} from '@/src/platform/http/errors';
import {runtimeFetch} from '@/src/platform/http/runtime';
import {getTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';

async function claude(message: any) {
    const current = getTranslationProviderConfig(message, config);
    const service = message.serviceOverride || services.claude;
    // 构建请求头
    let headers = new Headers();
    headers.append('Content-Type', 'application/json');
    appendOptionalHeader(headers, 'x-api-key', current.token[service]);
    headers.append('anthropic-version', '2023-06-01');
    headers.append('anthropic-dangerous-direct-browser-access', 'true');

    const url = current.proxy[service] || urls[services.claude];

    try {
        const resp = await runtimeFetch(url, {
            method: method.POST,
            headers,
            body: claudeMsgTemplate(message.origin, message.pageContext, message.summaryPrompt, message.summarySystemPrompt, service, message.targetLanguage, message.modelOverride, current)
        });

        if (!resp.ok) {
            throw createHttpStatusError(resp);
        }

        const result = await readJsonResponse<any>(resp, 'Claude 返回的不是有效 JSON');
        return result.content[0].text;
    } catch (error) {
        throw error;
    }
}

export default claude;
