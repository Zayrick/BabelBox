import {method, urls} from "@/src/core/config/constants";
import {cozeTemplate} from '@/src/services/translation/templates';
import {config} from "@/src/services/config/store";
import {appendOptionalBearer} from './auth';
import {createHttpStatusError, createProviderCodeError, readJsonResponse} from '@/src/platform/http/errors';
import {runtimeFetch} from '@/src/platform/http/runtime';
import {getTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';

async function coze( message: any) {
    const current = getTranslationProviderConfig(message, config);
    const service = message.serviceOverride || current.service;
    // 构建请求头
    let headers = new Headers();
    headers.append('Content-Type', 'application/json');
    appendOptionalBearer(headers, current.token[service]);

    // 判断是否使用代理
    let url: string = current.proxy[service] ? current.proxy[service] : urls[service];

    // 发起 fetch 请求
    const resp = await runtimeFetch(url, {
        method: method.POST,
        headers: headers,
        body: cozeTemplate(message.origin, message.pageContext, message.summaryPrompt, message.summarySystemPrompt, service, message.targetLanguage, current)
    });

    if (resp.ok) {
        const result = await readJsonResponse<any>(resp, 'Coze 返回的不是有效 JSON');
        if (result.code === 0 && result.msg === "success") {
            return result.messages[0].content;
        } else {
            throw createProviderCodeError('请求失败', result.code);
        }
    } else {
        throw createHttpStatusError(resp);
    }
}

export default coze;
