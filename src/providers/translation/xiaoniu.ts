import {method, urls} from "@/src/core/config/constants";
import {services} from "@/src/core/config/catalog";
import type {TranslationProviderRequest} from '@/src/services/translation/types';
import {createHttpStatusError, readJsonResponse} from '@/src/platform/http/errors';
import {runtimeFetch} from '@/src/platform/http/runtime';
import {requireSingleOrigin} from './request';

async function xiaoniu(request: TranslationProviderRequest) {
    const {service} = request;
    const targetLang = request.targetLanguage === 'zh-Hans' ? 'zh' : request.targetLanguage;
    const body = new URLSearchParams({
        from: 'auto',
        to: targetLang,
        apikey: service.credential.apiKey,
        src_text: requireSingleOrigin(request),
    });

    const resp = await runtimeFetch(service.endpoint || urls[services.xiaoniu], {
        method: method.POST,
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: body.toString(),
    });
    if (!resp.ok) throw createHttpStatusError(resp, '翻译失败');

    const result = await readJsonResponse<any>(resp, '小牛翻译返回的不是有效 JSON');
    return result.tgt_text;
}

export default xiaoniu;
