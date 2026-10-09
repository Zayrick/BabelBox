import {method, urls} from "@/src/core/config/constants";
import {cozeBody} from '@/src/services/translation/templates';
import type {TranslationProviderRequest} from '@/src/services/translation/types';
import {appendOptionalBearer} from './auth';
import {createHttpStatusError, createProviderCodeError, readJsonResponse} from '@/src/platform/http/errors';
import {runtimeFetch} from '@/src/platform/http/runtime';
import {requireSingleOrigin} from './request';

async function coze(request: TranslationProviderRequest) {
    const {service} = request;
    const headers = new Headers({'Content-Type': 'application/json'});
    appendOptionalBearer(headers, service.credential.apiKey);

    const resp = await runtimeFetch(service.endpoint || urls[service.provider], {
        method: method.POST,
        headers,
        body: cozeBody(request, requireSingleOrigin(request)),
    });
    if (!resp.ok) throw createHttpStatusError(resp);

    const result = await readJsonResponse<any>(resp, 'Coze 返回的不是有效 JSON');
    if (result.code === 0 && result.msg === "success") return result.messages[0].content;
    throw createProviderCodeError('请求失败', result.code);
}

export default coze;
