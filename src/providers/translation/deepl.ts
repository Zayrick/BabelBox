import {method, urls} from "@/src/core/config/constants";
import {services} from "@/src/core/config/catalog";
import {config} from "@/src/services/config/store";
import {getTranslationLanguages} from '@/src/services/translation/languages';
import {createHttpStatusError, readJsonResponse} from '@/src/platform/http/errors';
import {runtimeFetch} from '@/src/platform/http/runtime';
import {getTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';

async function deepl(message: any) {
    const current = getTranslationProviderConfig(message, config);
    const service = message.serviceOverride || current.service;
    // deepl 不支持 zh-Hans，需要转换为 zh
    const {targetLanguage} = getTranslationLanguages(message);
    let targetLang = targetLanguage === 'zh-Hans' ? 'zh' : targetLanguage;

    // 判断是否使用代理
    let url: string = current.proxy[service] ? current.proxy[service] : urls[services.deepL]

    const resp = await runtimeFetch(url, {
        method: method.POST,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'DeepL-Auth-Key ' + current.token[service]
        },
        body: JSON.stringify({
            text: [message.origin],
            target_lang: targetLang,
            tag_handling: 'html',
            context: message.context,  // 添加上下文辅助信息
            preserve_formatting: true
        })
    });

    if (resp.ok) {
        const result = await readJsonResponse<any>(resp, 'DeepL 返回的不是有效 JSON');
        return result.translations[0].text
    } else {
        throw createHttpStatusError(resp, '翻译失败');
    }
}

export default deepl;
