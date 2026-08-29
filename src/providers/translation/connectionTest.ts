import {translationProviderRegistry} from './registry';
import {formatServiceError} from '@/src/services/translation/serviceErrors';
import {config} from '@/src/services/config/store';
import {
    attachTranslationProviderConfig,
    createTranslationProviderConfigSnapshot,
    resolveTranslationServiceConfig,
} from '@/src/services/translation/requestSnapshot';

export const CONNECTION_TEST_ORIGIN = 'Hello from BabelBox.';

function isNonEmptyText(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}

/** 通过实例对应的供应商适配器发出真实最小请求，覆盖鉴权、端点、模型和响应解析。 */
export async function runTranslationServiceConnectionTest(instanceId: string): Promise<{durationMs: number}> {
    const snapshot = createTranslationProviderConfigSnapshot(config);
    const resolved = resolveTranslationServiceConfig(snapshot, instanceId, {allowDisabled: true});
    const adapter = translationProviderRegistry[resolved.provider];
    if (!adapter) {
        throw new Error(`未找到翻译服务适配器: ${resolved.provider}`);
    }

    const startedAt = Date.now();
    const result = await adapter(attachTranslationProviderConfig({
        origin: CONNECTION_TEST_ORIGIN,
        context: '',
        pageContext: '',
        summaryPrompt: '',
        summarySystemPrompt: '',
        serviceOverride: resolved.provider,
        modelOverride: resolved.instance?.modelId || resolved.config.model[resolved.provider] || undefined,
        useCache: false,
        requestTimeoutMs: 30_000,
    }, resolved.config));

    if (!isNonEmptyText(result)) {
        throw new Error('服务已响应，但没有返回有效译文');
    }

    return {durationMs: Math.max(0, Date.now() - startedAt)};
}

export function formatConnectionTestError(instanceId: string, error: unknown): string {
    try {
        const snapshot = createTranslationProviderConfigSnapshot(config);
        const resolved = resolveTranslationServiceConfig(snapshot, instanceId, {allowDisabled: true});
        return formatServiceError(resolved.provider, error);
    } catch {
        return formatServiceError(instanceId, error);
    }
}
