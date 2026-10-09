import {services} from "@/src/core/config/catalog";
import {method, urls} from "@/src/core/config/constants";
import {claudeBody} from '@/src/services/translation/templates';
import type {TranslationProviderRequest} from '@/src/services/translation/types';
import {appendOptionalHeader} from './auth';
import {createHttpStatusError, readJsonResponse} from '@/src/platform/http/errors';
import {runtimeFetch} from '@/src/platform/http/runtime';
import {requireSingleOrigin} from './request';

async function claude(request: TranslationProviderRequest) {
    const {service} = request;
    const headers = new Headers({'Content-Type': 'application/json'});
    appendOptionalHeader(headers, 'x-api-key', service.credential.apiKey);
    headers.append('anthropic-version', '2023-06-01');
    headers.append('anthropic-dangerous-direct-browser-access', 'true');

    const resp = await runtimeFetch(service.endpoint || urls[services.claude], {
        method: method.POST,
        headers,
        body: claudeBody(request, requireSingleOrigin(request)),
    });
    if (!resp.ok) throw createHttpStatusError(resp);

    const result = await readJsonResponse<any>(resp, 'Claude 返回的不是有效 JSON');
    return result.content[0].text;
}

export default claude;
