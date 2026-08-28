import type { Config, TranslationServiceCredential } from './model';
import {services} from './catalog';

export const SESSION_CREDENTIALS_STORAGE_KEY = 'session:credentials' as const;
export const LOCAL_CREDENTIALS_STORAGE_KEY = 'local:credentials' as const;
export const CREDENTIALS_SCHEMA_VERSION = 1 as const;

export const CONFIG_CREDENTIAL_FIELDS = [
    'token',
    'ak',
    'sk',
    'appid',
    'key',
    'youdaoAppKey',
    'youdaoAppSecret',
    'tencentSecretId',
    'tencentSecretKey',
    'extra',
    'serviceCredentials',
] as const;

export type ConfigCredentialField = typeof CONFIG_CREDENTIAL_FIELDS[number];
export type PublicConfig = Omit<Config, ConfigCredentialField>;

export interface ConfigCredentials {
    schemaVersion: typeof CREDENTIALS_SCHEMA_VERSION;
    token: Record<string, string>;
    ak: string;
    sk: string;
    appid: string;
    key: string;
    youdaoAppKey: string;
    youdaoAppSecret: string;
    tencentSecretId: string;
    tencentSecretKey: string;
    extra: Record<string, unknown>;
    serviceCredentials?: Record<string, TranslationServiceCredential>;
}

interface CredentialDestinationInstance {
    id: string;
    provider: string;
    endpoint?: string;
    proxy?: string;
}

interface CredentialDestinationConfig {
    translationServices?: readonly CredentialDestinationInstance[];
    proxy?: Record<string, string | undefined>;
    custom?: string;
    newApiUrl?: string;
    azureOpenaiEndpoint?: string;
    deeplx?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (!isRecord(value)) return value;

    const cloned: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) cloned[key] = cloneValue(item);
    return cloned;
}

function stringValue(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function stringMapping(value: unknown): Record<string, string> {
    if (!isRecord(value)) return {};
    return Object.fromEntries(
        Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
}

function extraMapping(value: unknown): Record<string, unknown> {
    return isRecord(value) ? cloneValue(value) as Record<string, unknown> : {};
}

function serviceCredentialMapping(value: unknown): Record<string, TranslationServiceCredential> {
    if (!isRecord(value)) return {};
    const result: Record<string, TranslationServiceCredential> = {};
    for (const [serviceId, credential] of Object.entries(value)) {
        if (!isRecord(credential)) continue;
        result[serviceId] = {
            apiKey: stringValue(credential.apiKey),
            appKey: stringValue(credential.appKey),
            appSecret: stringValue(credential.appSecret),
            secretId: stringValue(credential.secretId),
            secretKey: stringValue(credential.secretKey),
        };
    }
    return result;
}

export function extractConfigCredentials(value: unknown): ConfigCredentials {
    const source = isRecord(value) ? value : {};
    return {
        schemaVersion: CREDENTIALS_SCHEMA_VERSION,
        token: stringMapping(source.token),
        ak: stringValue(source.ak),
        sk: stringValue(source.sk),
        appid: stringValue(source.appid),
        key: stringValue(source.key),
        youdaoAppKey: stringValue(source.youdaoAppKey),
        youdaoAppSecret: stringValue(source.youdaoAppSecret),
        tencentSecretId: stringValue(source.tencentSecretId),
        tencentSecretKey: stringValue(source.tencentSecretKey),
        extra: extraMapping(source.extra),
        serviceCredentials: serviceCredentialMapping(source.serviceCredentials),
    };
}

export function parseStoredCredentials(value: unknown): ConfigCredentials | null {
    if (!isRecord(value)) return null;
    if (!CONFIG_CREDENTIAL_FIELDS.some((field) => field in value)) return null;
    return extractConfigCredentials(value);
}

export function hasCredentialFields(value: unknown): boolean {
    return isRecord(value) && CONFIG_CREDENTIAL_FIELDS.some((field) => field in value);
}

export function hasCredentialData(value: ConfigCredentials): boolean {
    return Object.keys(value.token).length > 0
        || Boolean(value.ak || value.sk || value.appid || value.key)
        || Boolean(value.youdaoAppKey || value.youdaoAppSecret)
        || Boolean(value.tencentSecretId || value.tencentSecretKey)
        || Object.keys(value.extra).length > 0
        || Object.values(value.serviceCredentials || {}).some((credential) =>
            Boolean(credential.apiKey || credential.appKey || credential.appSecret
                || credential.secretId || credential.secretKey));
}

export function credentialsEqual(left: ConfigCredentials, right: ConfigCredentials): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function credentialDestinationSignature(
    config: CredentialDestinationConfig,
    instance: CredentialDestinationInstance,
): string {
    const provider = instance.provider;
    const endpoint = instance.proxy
        || instance.endpoint
        || config.proxy?.[instance.id]
        || (instance.id === provider ? config.proxy?.[provider] : '')
        || (provider === services.custom ? config.custom : '')
        || (provider === services.newapi ? config.newApiUrl : '')
        || (provider === services.azureOpenai ? config.azureOpenaiEndpoint : '')
        || (provider === services.deeplx ? config.deeplx : '')
        || '';
    return `${provider}\u0000${endpoint}`;
}

function hasSameCredentialDestination(
    current: CredentialDestinationConfig,
    target: CredentialDestinationConfig,
    serviceId: string,
): boolean {
    const currentInstance = current.translationServices?.find((item) => item.id === serviceId);
    const targetInstance = target.translationServices?.find((item) => item.id === serviceId);
    return Boolean(currentInstance && targetInstance
        && credentialDestinationSignature(current, currentInstance)
            === credentialDestinationSignature(target, targetInstance));
}

function globalCredentialConsumersAreSafe(
    current: CredentialDestinationConfig,
    target: CredentialDestinationConfig,
    providers: readonly string[],
): boolean {
    const providerSet = new Set(providers);
    return (target.translationServices || [])
        .filter((item) => item.id === item.provider && providerSet.has(item.provider))
        .every((item) => hasSameCredentialDestination(current, target, item.id));
}

/**
 * Carries credentials across a public/history/imported config snapshot only
 * when the same instance ID still resolves to the same provider destination.
 */
export function filterConfigCredentialsForDestination(
    credentials: ConfigCredentials,
    current: CredentialDestinationConfig,
    target: CredentialDestinationConfig,
): ConfigCredentials {
    const filtered: ConfigCredentials = {
        ...credentials,
        token: Object.fromEntries(Object.entries(credentials.token)
            .filter(([serviceId]) => hasSameCredentialDestination(current, target, serviceId))),
        extra: extraMapping(credentials.extra),
        serviceCredentials: Object.fromEntries(Object.entries(credentials.serviceCredentials || {})
            .filter(([serviceId]) => hasSameCredentialDestination(current, target, serviceId))
            .map(([serviceId, credential]) => [serviceId, {...credential}])),
    };
    if (!globalCredentialConsumersAreSafe(current, target, [services.youdao])) {
        filtered.youdaoAppKey = '';
        filtered.youdaoAppSecret = '';
    }
    if (!globalCredentialConsumersAreSafe(current, target, [services.tencent, services.huanYuanTranslation])) {
        filtered.tencentSecretId = '';
        filtered.tencentSecretKey = '';
    }
    return filtered;
}

/** Remove both instance-scoped credentials and the provider-keyed legacy token. */
export function clearTranslationServiceCredentials(
    config: Pick<Config, 'serviceCredentials' | 'token'>,
    serviceId: string,
): void {
    delete config.serviceCredentials[serviceId];
    delete config.token[serviceId];
}

export function sanitizeConfigCredentials(value: unknown): Record<string, unknown> {
    const sanitized = isRecord(value) ? cloneValue(value) as Record<string, unknown> : {};
    for (const field of CONFIG_CREDENTIAL_FIELDS) delete sanitized[field];
    return sanitized;
}

export function mergeConfigCredentials(value: unknown, credentials: ConfigCredentials): Record<string, unknown> {
    const {schemaVersion: _schemaVersion, ...credentialFields} = credentials;
    return {
        ...sanitizeConfigCredentials(value),
        ...cloneValue(credentialFields) as Omit<ConfigCredentials, 'schemaVersion'>,
    };
}

export function sanitizeConfigHistoryCredentials(value: unknown): unknown {
    let parsed = value;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            // 损坏的旧历史无法可靠判断哪些片段属于凭据；继续保留原字符串会让
            // 已知敏感信息永久滞留在 local storage，因此按不可恢复历史丢弃。
            return null;
        }
    }
    const sanitized = cloneValue(parsed);
    if (!isRecord(sanitized) || !Array.isArray(sanitized.entries)) return sanitized;

    sanitized.entries = sanitized.entries.map((entry) => {
        if (!isRecord(entry)) return entry;
        return {
            ...entry,
            config: sanitizeConfigCredentials(entry.config),
        };
    });
    return sanitized;
}
