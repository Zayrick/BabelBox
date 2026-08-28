import type {
    TranslationConfigSource,
    TranslationProviderConfigSnapshot,
} from './types';
import type {TranslationServiceCredential} from '@/src/core/config/model';
import {
    getTranslationServiceInstance,
    type TranslationServiceInstance,
} from '@/src/core/config/translationServices';

/** 内部 symbol 无法由 content runtime 消息伪造，也不会进入网络 JSON。 */
export const TRANSLATION_PROVIDER_CONFIG = Symbol('fluentread.translation-provider-config');

export type TranslationProviderRequestContext = {
    readonly [TRANSLATION_PROVIDER_CONFIG]?: TranslationProviderConfigSnapshot;
};

function frozenStringMap(value: Record<string, string> | undefined): Readonly<Record<string, string>> {
    return Object.freeze({...value});
}

function frozenBooleanMap(value: Record<string, boolean> | undefined): Readonly<Record<string, boolean>> {
    return Object.freeze({...value});
}

function frozenServiceCredentials(
    value: Record<string, TranslationServiceCredential> | undefined,
): Readonly<Record<string, TranslationServiceCredential>> {
    return Object.freeze(Object.fromEntries(
        Object.entries(value || {}).map(([key, credential]) => [key, Object.freeze({...credential})]),
    ));
}

function frozenTranslationServices(
    value: readonly TranslationServiceInstance[] | undefined,
): readonly TranslationServiceInstance[] {
    return Object.freeze((value || []).map((instance) => Object.freeze({...instance})));
}

/**
 * 在任何 await 之前复制 provider 与缓存身份会读取的字段。嵌套映射和顶层对象
 * 均冻结，配置页后续原地修改不会改变已在途请求。
 */
export function createTranslationProviderConfigSnapshot(
    source: TranslationConfigSource,
): TranslationProviderConfigSnapshot {
    return Object.freeze({
        ...source,
        model: frozenStringMap(source.model),
        customModel: frozenStringMap(source.customModel),
        proxy: frozenStringMap(source.proxy),
        robot_id: frozenStringMap(source.robot_id),
        customBody: frozenStringMap(source.customBody),
        system_role: frozenStringMap(source.system_role),
        user_role: frozenStringMap(source.user_role),
        token: frozenStringMap(source.token),
        requireApiKey: frozenBooleanMap(source.requireApiKey),
        youdaoAppKey: source.youdaoAppKey ?? '',
        youdaoAppSecret: source.youdaoAppSecret ?? '',
        tencentSecretId: source.tencentSecretId ?? '',
        tencentSecretKey: source.tencentSecretKey ?? '',
        serviceCredentials: frozenServiceCredentials(source.serviceCredentials),
        translationServices: frozenTranslationServices(source.translationServices),
    }) as TranslationProviderConfigSnapshot;
}

export interface ResolvedTranslationServiceConfig {
    readonly instanceId: string;
    readonly provider: string;
    readonly instance?: TranslationServiceInstance;
    readonly config: TranslationProviderConfigSnapshot;
}

function instanceMapValue(
    map: Readonly<Record<string, string>>,
    instanceId: string,
    provider: string,
): string {
    if (Object.hasOwn(map, instanceId)) return map[instanceId] || '';
    return instanceId === provider ? map[provider] || '' : '';
}

/**
 * Projects one service instance onto the provider-keyed compatibility shape
 * consumed by existing adapters. The projection is immutable and request-local.
 */
export function resolveTranslationServiceConfig(
    source: TranslationProviderConfigSnapshot,
    instanceId: string,
    options: {allowDisabled?: boolean} = {},
): ResolvedTranslationServiceConfig {
    const hasInventory = Boolean(source.translationServices?.length);
    const instance = getTranslationServiceInstance(source, instanceId);
    if (hasInventory && !instance) throw new Error('翻译服务不存在或已被删除，请重新选择');
    if (instance && !instance.enabled && !options.allowDisabled) {
        throw new Error(`翻译服务「${instance.name}」已禁用，请先启用或选择其他服务`);
    }

    const provider = instance?.provider || instanceId;
    const credential = source.serviceCredentials?.[instanceId];
    const usesProviderId = instanceId === provider;
    const modelId = instance?.modelId
        || instanceMapValue(source.model, instanceId, provider)
        || (usesProviderId ? source.model[provider] || '' : '');
    const endpoint = instance?.proxy
        || instance?.endpoint
        || instanceMapValue(source.proxy, instanceId, provider)
        || (usesProviderId ? source.proxy[provider] || '' : '')
        || (usesProviderId && provider === 'custom' ? source.custom : '')
        || (usesProviderId && provider === 'newapi' ? source.newApiUrl : '')
        || (usesProviderId && provider === 'azureOpenai' ? source.azureOpenaiEndpoint : '');
    const token = credential
        ? credential.apiKey
        : instanceMapValue(source.token, instanceId, provider)
            || (usesProviderId ? source.token[provider] || '' : '');
    const customBody = instance?.customBody
        || instanceMapValue(source.customBody, instanceId, provider)
        || (usesProviderId ? source.customBody[provider] || '' : '');
    const systemRole = instance?.systemRole
        || instanceMapValue(source.system_role, instanceId, provider)
        || (usesProviderId ? source.system_role[provider] || '' : '');
    const userRole = instance?.userRole
        || instanceMapValue(source.user_role, instanceId, provider)
        || (usesProviderId ? source.user_role[provider] || '' : '');
    const robotId = instance?.robotId
        || instanceMapValue(source.robot_id, instanceId, provider)
        || (usesProviderId ? source.robot_id[provider] || '' : '');
    const requirementKey = `${provider}:${modelId}`;

    const scoped = createTranslationProviderConfigSnapshot({
        ...source,
        service: provider,
        model: {...source.model, [provider]: modelId},
        customModel: {...source.customModel, [provider]: modelId},
        proxy: {...source.proxy, [provider]: endpoint},
        token: {...source.token, [provider]: token},
        requireApiKey: {
            ...source.requireApiKey,
            ...(instance ? {[requirementKey]: instance.requireApiKey} : {}),
        },
        customBody: {...source.customBody, [provider]: customBody},
        system_role: {...source.system_role, [provider]: systemRole},
        user_role: {...source.user_role, [provider]: userRole},
        robot_id: {...source.robot_id, [provider]: robotId},
        custom: provider === 'custom' ? endpoint : source.custom,
        newApiUrl: provider === 'newapi' ? endpoint : source.newApiUrl,
        azureOpenaiEndpoint: provider === 'azureOpenai' ? endpoint : source.azureOpenaiEndpoint,
        deepseekApiType: instance?.deepseekApiType || source.deepseekApiType,
        deepseekThinkingMode: instance?.deepseekThinkingMode || source.deepseekThinkingMode,
        minimaxBillingPlan: instance?.minimaxBillingPlan || source.minimaxBillingPlan,
        minimaxRegion: instance?.minimaxRegion || source.minimaxRegion,
        mimoBillingPlan: instance?.mimoBillingPlan || source.mimoBillingPlan,
        mimoRegion: instance?.mimoRegion || source.mimoRegion,
        youdaoAppKey: credential?.appKey || (usesProviderId ? source.youdaoAppKey : ''),
        youdaoAppSecret: credential?.appSecret || (usesProviderId ? source.youdaoAppSecret : ''),
        tencentSecretId: credential?.secretId || (usesProviderId ? source.tencentSecretId : ''),
        tencentSecretKey: credential?.secretKey || (usesProviderId ? source.tencentSecretKey : ''),
    });

    return Object.freeze({instanceId, provider, instance, config: scoped});
}

export function attachTranslationProviderConfig<T extends object>(
    message: T,
    snapshot: TranslationProviderConfigSnapshot,
): T & TranslationProviderRequestContext {
    return Object.assign(message, {[TRANSLATION_PROVIDER_CONFIG]: snapshot});
}

export function getTranslationProviderConfig(
    message: unknown,
    currentConfig: TranslationProviderConfigSnapshot,
): TranslationProviderConfigSnapshot {
    if (message && typeof message === 'object') {
        const snapshot = (message as TranslationProviderRequestContext)[TRANSLATION_PROVIDER_CONFIG];
        if (snapshot) return snapshot;
    }
    // 连接测试直接调用 adapter，因此没有请求快照时使用已经加载的当前配置。
    return currentConfig;
}
