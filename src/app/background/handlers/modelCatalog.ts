import type {BackgroundMessageHandler} from '@/src/platform/browser/messageRouter';
import {
    TRANSLATION_MODEL_CATALOG_MESSAGE,
    type TranslationModelCatalogMessage,
    type TranslationModelCatalogResponse,
} from '@/src/services/translation/modelCatalog';

export interface TranslationModelCatalogDependencies {
    readonly ready: Promise<void>;
    readonly listModels: (service: string) => Promise<string[]>;
    readonly formatError: (error: unknown) => string;
}

function parseService(value: unknown): string {
    if (typeof value === 'string' && value.trim()) return value.trim();
    throw new TypeError('模型列表 service 必须是非空字符串');
}

export function createTranslationModelCatalogHandler(
    dependencies: TranslationModelCatalogDependencies,
): BackgroundMessageHandler<unknown, TranslationModelCatalogMessage, TranslationModelCatalogResponse> {
    return {
        type: TRANSLATION_MODEL_CATALOG_MESSAGE,
        async handle(message) {
            try {
                const service = parseService(message.service);
                await dependencies.ready;
                return {success: true, models: await dependencies.listModels(service)};
            } catch (error) {
                return {success: false, error: dependencies.formatError(error)};
            }
        },
    };
}
