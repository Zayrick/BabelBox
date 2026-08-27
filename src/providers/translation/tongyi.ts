import {currentModelIds, services} from "@/src/core/config/catalog";
import {method, tongyiTokenPlanUrl, urls} from "@/src/core/config/constants";
import {tongyiMsgTemplate} from '@/src/services/translation/templates';
import {config} from "@/src/services/config/store";
import {appendOptionalBearer} from './auth';
import {createHttpStatusError, readJsonResponse} from '@/src/platform/http/errors';
import {runtimeFetch} from '@/src/platform/http/runtime';
import {getTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';

// 文档：https://help.aliyun.com/zh/dashscope/developer-reference/tongyi-thousand-questions-metering-and-billing
async function tongyi(message: any) {
    const current = getTranslationProviderConfig(message, config);
    const service = message.serviceOverride || services.tongyi;
    // 构建请求头
    let headers = new Headers();
    headers.append('Content-Type', 'application/json');
    appendOptionalBearer(headers, current.token[service]);

    // 判断是否使用代理
    const selectedModel = message.modelOverride || current.model[service];
    const officialUrl = selectedModel === currentModelIds.tongyiTokenPlan
        ? tongyiTokenPlanUrl
        : urls[services.tongyi];
    const url: string = current.proxy[service] || officialUrl;

    const resp = await runtimeFetch(url, {
        method: method.POST,
        headers: headers,
        body: tongyiMsgTemplate(message.origin, message.pageContext, message.summaryPrompt, message.summarySystemPrompt, service, message.targetLanguage, message.modelOverride, current)
    });

    if (resp.ok) {
        const result = await readJsonResponse<any>(resp, '通义千问返回的不是有效 JSON');
        return result.choices[0].message.content;
    } else {
        throw createHttpStatusError(resp, '翻译失败');
    }
}

export default tongyi;


//
