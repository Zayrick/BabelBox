import {services} from "@/src/core/config/catalog";
import {method, tongyiTokenPlanUrl, urls} from "@/src/core/config/constants";
import {requestModel, tongyiBody} from '@/src/services/translation/templates';
import type {TranslationProviderRequest} from '@/src/services/translation/types';
import {appendOptionalBearer} from './auth';
import {createHttpStatusError, readJsonResponse} from '@/src/platform/http/errors';
import {runtimeFetch} from '@/src/platform/http/runtime';
import {requireSingleOrigin} from './request';

/** Token Plan 模型只在专用网关上提供。 */
const TONGYI_TOKEN_PLAN_MODEL = 'qwen3.8-max-preview';

// 文档：https://help.aliyun.com/zh/dashscope/developer-reference/tongyi-thousand-questions-metering-and-billing
async function tongyi(request: TranslationProviderRequest) {
    const {service} = request;
    const headers = new Headers({'Content-Type': 'application/json'});
    appendOptionalBearer(headers, service.credential.apiKey);

    const officialUrl = requestModel(request) === TONGYI_TOKEN_PLAN_MODEL
        ? tongyiTokenPlanUrl
        : urls[services.tongyi];
    const resp = await runtimeFetch(service.endpoint || officialUrl, {
        method: method.POST,
        headers,
        body: tongyiBody(request, requireSingleOrigin(request)),
    });
    if (!resp.ok) throw createHttpStatusError(resp, '翻译失败');

    const result = await readJsonResponse<any>(resp, '通义千问返回的不是有效 JSON');
    return result.choices[0].message.content;
}

export default tongyi;
