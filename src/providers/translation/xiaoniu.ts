import {method, urls} from "@/src/core/config/constants";
import {services} from "@/src/core/config/catalog";
import {config} from "@/src/services/config/store";
import {getTranslationLanguages} from '@/src/services/translation/languages';
import {createHttpStatusError, readJsonResponse} from '@/src/platform/http/errors';
import {runtimeFetch} from '@/src/platform/http/runtime';
import {getTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';

async function xiaoniu(message: any) {
    const current = getTranslationProviderConfig(message, config);
    const service = message.serviceOverride || current.service;
    // 根据需要调整目标语言
    const {targetLanguage} = getTranslationLanguages(message);
    let targetLang = targetLanguage === 'zh-Hans' ? 'zh' : targetLanguage;

    // 判断是否使用代理
    let url: string = current.proxy[service] ? current.proxy[service] : urls[services.xiaoniu]

    const resp = await runtimeFetch(url, {
        method: method.POST,
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: `from=auto&to=${targetLang}&apikey=${current.token[service]}&src_text=${encodeURIComponent(message.origin)}`
    });

    if (resp.ok) {
        const result = await readJsonResponse<any>(resp, '小牛翻译返回的不是有效 JSON');
        return result.tgt_text
    } else {
        throw createHttpStatusError(resp, '翻译失败');
    }
}

export default xiaoniu;
