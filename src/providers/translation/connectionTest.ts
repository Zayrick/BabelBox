import {translationProviderRegistry} from './registry';
import {formatServiceError} from '@/src/services/translation/serviceErrors';
import {config} from '@/src/services/config/store';
import {resolveTranslationService} from '@/src/services/translation/requestSnapshot';
import {getTranslationServiceProvider} from '@/src/core/config/translationServices';

export const CONNECTION_TEST_ORIGIN = 'Hello from BabelBox.';

function isNonEmptyText(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

/** 通过实例对应的供应商适配器发出真实最小请求，覆盖鉴权、端点、模型和响应解析。 */
export async function runTranslationServiceConnectionTest(serviceId: string): Promise<{durationMs: number}> {
    const service = resolveTranslationService(config, serviceId, {allowDisabled: true});
    const adapter = translationProviderRegistry[service.provider];
    if (!adapter) throw new Error(`未找到翻译服务适配器: ${service.provider}`);

    const startedAt = Date.now();
    const result = await adapter({
        service,
        origin: CONNECTION_TEST_ORIGIN,
        context: '',
        pageContext: '',
        sourceLanguage: config.from,
        targetLanguage: config.to,
        requestTimeoutMs: 30_000,
    });
    if (!isNonEmptyText(result)) throw new Error('服务已响应，但没有返回有效译文');

    return {durationMs: Math.max(0, Date.now() - startedAt)};
}

export function formatConnectionTestError(serviceId: string, error: unknown): string {
    return formatServiceError(getTranslationServiceProvider(config, serviceId) || serviceId, error);
}
