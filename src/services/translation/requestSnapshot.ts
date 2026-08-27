import type {
    TranslationConfigSource,
    TranslationProviderConfigSnapshot,
} from './types';

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
    }) as TranslationProviderConfigSnapshot;
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
