import {method, urls} from "@/src/core/config/constants";
import {commonMsgTemplate} from '@/src/services/translation/templates';
import {config} from "@/src/services/config/store";
import {stripTranslationReasoning as contentPostHandler} from '@/src/core/translation/prompts';
import { appendOptionalBearer } from './auth';
import {createHttpStatusError, readJsonResponse} from '@/src/platform/http/errors';
import {runtimeFetch} from '@/src/platform/http/runtime';
import {getTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';

/**
 * Grok 服务实现
 * 使用 X.AI API，兼容 OpenAI 接口
 * 当前预设模型：grok-4.5、grok-4.3；也支持用户输入自定义模型编号。
 */
async function grok(message: any) {
    try {
        const current = getTranslationProviderConfig(message, config);
        const service = message.serviceOverride || current.service;
        const headers = new Headers({'Content-Type': 'application/json'});
        appendOptionalBearer(headers, current.token[service]);

        const url = current.proxy[service] || urls[service];

        const resp = await runtimeFetch(url, {
            method: method.POST,
            headers,
            body: commonMsgTemplate(message.origin, message.pageContext, message.summaryPrompt, message.summarySystemPrompt, service, message.targetLanguage, message.modelOverride, current)
        });

        if (!resp.ok) {
            throw createHttpStatusError(resp, '翻译失败');
        }

        const result = await readJsonResponse<any>(resp, 'Grok 返回的不是有效 JSON');
        return contentPostHandler(result.choices[0].message.content);
    } catch (error) {
        throw error;
    }
}

export default grok;
