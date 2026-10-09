import {method, urls} from "@/src/core/config/constants";
import {services} from "@/src/core/config/catalog";
import type {TranslationProviderRequest} from '@/src/services/translation/types';
import {createHttpStatusError, readJsonResponse} from '@/src/platform/http/errors';
import {runtimeFetch} from '@/src/platform/http/runtime';
import {appendOptionalHeader} from './auth';
import {requireSingleOrigin} from './request';

async function deepl(request: TranslationProviderRequest) {
    const {service} = request;
    // deepl 不支持 zh-Hans，需要转换为 zh
    const targetLang = request.targetLanguage === 'zh-Hans' ? 'zh' : request.targetLanguage;
    const apiKey = service.credential.apiKey.trim();

    const headers = new Headers({'Content-Type': 'application/json'});
    appendOptionalHeader(headers, 'Authorization', apiKey ? `DeepL-Auth-Key ${apiKey}` : undefined);

    const resp = await runtimeFetch(service.endpoint || urls[services.deepL], {
        method: method.POST,
        headers,
        body: JSON.stringify({
            text: [requireSingleOrigin(request)],
            target_lang: targetLang,
            tag_handling: 'html',
            context: request.context,
            preserve_formatting: true,
        }),
    });
    if (!resp.ok) throw createHttpStatusError(resp, '翻译失败');

    const result = await readJsonResponse<any>(resp, 'DeepL 返回的不是有效 JSON');
    return result.translations[0].text;
}

export default deepl;
