import type {Config} from './model';
import type {TranslationServiceCredential, TranslationServiceInstance} from './translationServices';

export const SESSION_CREDENTIALS_STORAGE_KEY = 'session:credentials' as const;
export const LOCAL_CREDENTIALS_STORAGE_KEY = 'local:credentials' as const;
export const CREDENTIALS_SCHEMA_VERSION = 2 as const;

export const CONFIG_CREDENTIAL_FIELDS = ['serviceCredentials'] as const;

/**
 * Plaintext secret fields written by earlier versions. They are never read, but
 * every public snapshot (storage, history, export) strips them.
 */
const RETIRED_CREDENTIAL_FIELDS = [
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
] as const;

export type ConfigCredentialField = typeof CONFIG_CREDENTIAL_FIELDS[number];
export type PublicConfig = Omit<Config, ConfigCredentialField>;

export interface ConfigCredentials {
    schemaVersion: typeof CREDENTIALS_SCHEMA_VERSION;
    serviceCredentials: Record<string, TranslationServiceCredential>;
}

interface CredentialDestinationConfig {
    translationServices?: readonly Pick<TranslationServiceInstance, 'id' | 'provider' | 'endpoint'>[];
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
        serviceCredentials: serviceCredentialMapping(source.serviceCredentials),
    };
}

export function parseStoredCredentials(value: unknown): ConfigCredentials | null {
    if (!isRecord(value) || value.schemaVersion !== CREDENTIALS_SCHEMA_VERSION) return null;
    return extractConfigCredentials(value);
}

export function hasCredentialData(value: ConfigCredentials): boolean {
    return Object.values(value.serviceCredentials).some((credential) =>
        Object.values(credential).some(Boolean));
}

export function credentialsEqual(left: ConfigCredentials, right: ConfigCredentials): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function credentialDestination(config: CredentialDestinationConfig, serviceId: string): string | null {
    const instance = config.translationServices?.find((item) => item.id === serviceId);
    return instance ? `${instance.provider}\u0000${instance.endpoint}` : null;
}

/**
 * Carries credentials across a public/history/imported config snapshot only
 * when the same instance ID still sends requests to the same destination.
 */
export function filterConfigCredentialsForDestination(
    credentials: ConfigCredentials,
    current: CredentialDestinationConfig,
    target: CredentialDestinationConfig,
): ConfigCredentials {
    return {
        schemaVersion: CREDENTIALS_SCHEMA_VERSION,
        serviceCredentials: Object.fromEntries(Object.entries(credentials.serviceCredentials)
            .filter(([serviceId]) => {
                const destination = credentialDestination(current, serviceId);
                return destination !== null && destination === credentialDestination(target, serviceId);
            })
            .map(([serviceId, credential]) => [serviceId, {...credential}])),
    };
}

export function clearTranslationServiceCredentials(
    config: Pick<Config, 'serviceCredentials'>,
    serviceId: string,
): void {
    delete config.serviceCredentials[serviceId];
}

export function sanitizeConfigCredentials(value: unknown): Record<string, unknown> {
    const sanitized = isRecord(value) ? cloneValue(value) as Record<string, unknown> : {};
    for (const field of [...CONFIG_CREDENTIAL_FIELDS, ...RETIRED_CREDENTIAL_FIELDS]) delete sanitized[field];
    return sanitized;
}

export function mergeConfigCredentials(value: unknown, credentials: ConfigCredentials): Record<string, unknown> {
    return {
        ...sanitizeConfigCredentials(value),
        serviceCredentials: cloneValue(credentials.serviceCredentials),
    };
}

export function sanitizeConfigHistoryCredentials(value: unknown): unknown {
    let parsed = value;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            // 损坏的历史无法可靠判断哪些片段属于凭据；继续保留原字符串会让
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
