import { customModelString, options, services, servicesType } from './catalog';
import type {TranslationServiceCredential} from './model';
import {
    getTranslationServiceInstance,
    getTranslationServiceLabel,
    getTranslationServiceModel,
    getTranslationServiceProvider,
    type TranslationServiceInstance,
} from './translationServices';

export interface CredentialConfig {
    token?: Record<string, string | undefined>;
    model?: Record<string, string | undefined>;
    customModel?: Record<string, string | undefined>;
    requireApiKey?: Record<string, boolean | undefined>;
    youdaoAppKey?: string;
    youdaoAppSecret?: string;
    tencentSecretId?: string;
    tencentSecretKey?: string;
    translationServices?: readonly TranslationServiceInstance[];
    serviceCredentials?: Record<string, TranslationServiceCredential | undefined>;
}

function getServiceLabel(service: string, config: CredentialConfig): string {
    return getTranslationServiceLabel(config, service)
        || options.services.find((item) => item.value === service)?.label
        || service;
}

/** 使用服务和实际模型共同定位开关，避免切换模型时误用另一模型的设置。 */
export function getApiKeyRequirementKey(service: string, config: CredentialConfig): string {
    const selectedModel = getTranslationServiceModel(config, service) || config.model?.[service] || '';
    const actualModel = selectedModel === customModelString
        ? config.customModel?.[service] || selectedModel
        : selectedModel;
    return `${service}:${actualModel}`;
}

export function isApiKeyRequired(service: string, config: CredentialConfig): boolean {
    const instance = getTranslationServiceInstance(config, service);
    if (instance?.kind === 'ai') return instance.requireApiKey;
    const provider = getTranslationServiceProvider(config, service);
    if (!servicesType.isAI(provider)) return true;
    return config.requireApiKey?.[getApiKeyRequirementKey(service, config)] !== false;
}

/** 返回设置页和翻译前校验共用的凭据提示；返回 null 表示当前服务不缺凭据。 */
export function getMissingCredentialMessage(
    service: string,
    config: CredentialConfig,
): string | null {
    const provider = getTranslationServiceProvider(config, service);
    const serviceLabel = getServiceLabel(service, config);
    const credential = config.serviceCredentials?.[service];
    const legacyProviderConfig = provider === service;
    const apiKey = credential?.apiKey
        ?? config.token?.[service]
        ?? (legacyProviderConfig ? config.token?.[provider] : undefined);

    if (servicesType.isUseToken(provider) && provider !== services.deeplx && isApiKeyRequired(service, config)) {
        if (!apiKey?.trim()) {
            return `${serviceLabel} 需要 API Key（访问令牌），当前尚未配置；请先在设置中填写，再开始翻译。`;
        }
    }

    const appKey = credential?.appKey || (legacyProviderConfig ? config.youdaoAppKey : '');
    const appSecret = credential?.appSecret || (legacyProviderConfig ? config.youdaoAppSecret : '');
    if (provider === services.youdao && (!appKey?.trim() || !appSecret?.trim())) {
        return `${serviceLabel} 需要 App Key 和 App Secret，当前尚未完整配置；请先在设置中填写，再开始翻译。`;
    }

    const secretId = credential?.secretId || (legacyProviderConfig ? config.tencentSecretId : '');
    const secretKey = credential?.secretKey || (legacyProviderConfig ? config.tencentSecretKey : '');
    if (servicesType.isTencent(provider) && (!secretId?.trim() || !secretKey?.trim())) {
        return `${serviceLabel} 需要 SecretId 和 SecretKey，当前尚未完整配置；请先在设置中填写，再开始翻译。`;
    }

    return null;
}
