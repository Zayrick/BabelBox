import {services} from '@/src/core/config/catalog';

export const TRANSLATION_MODEL_CATALOG_MESSAGE = 'listTranslationServiceModels' as const;

export interface TranslationModelCatalogMessage {
    type: typeof TRANSLATION_MODEL_CATALOG_MESSAGE;
    service?: unknown;
}

export type TranslationModelCatalogResponse =
    | {success: true; models: string[]}
    | {success: false; error: string};

const dynamicModelCatalogProviders = new Set<string>([
    services.openai,
    services.gemini,
    services.yiyan,
    services.moonshot,
    services.claude,
    services.custom,
    services.infini,
    services.deepseek,
    services.minimax,
    services.mimo,
    services.jieyue,
    services.groq,
    services.huanYuan,
    services.doubao,
    services.siliconCloud,
    services.openrouter,
    services.grok,
    services.newapi,
]);

/** 只有已确认提供模型列表 API 的供应商才在设置页使用可输入下拉框。 */
export function hasDynamicTranslationModelCatalog(provider: string): boolean {
    return dynamicModelCatalogProviders.has(provider);
}
