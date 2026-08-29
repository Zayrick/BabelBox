export const CREDENTIAL_STORAGE_STATE_SCHEMA_VERSION = 1 as const;
export const CREDENTIAL_STORAGE_MODE_MESSAGE = 'credentialStorageModeAction' as const;

export type CredentialStorageMode = 'device' | 'session';

export const DEFAULT_CREDENTIAL_STORAGE_MODE: CredentialStorageMode = 'device';

export interface EncryptedCredentialsEnvelope {
    iv: string;
    ciphertext: string;
}

export interface CredentialStorageState {
    schemaVersion: typeof CREDENTIAL_STORAGE_STATE_SCHEMA_VERSION;
    mode: CredentialStorageMode;
    encryptedCredentials?: EncryptedCredentialsEnvelope;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isCredentialStorageMode(value: unknown): value is CredentialStorageMode {
    return value === 'device' || value === 'session';
}

function isEncryptedCredentialsEnvelope(value: unknown): value is EncryptedCredentialsEnvelope {
    return isRecord(value)
        && typeof value.iv === 'string'
        && Boolean(value.iv)
        && typeof value.ciphertext === 'string'
        && Boolean(value.ciphertext);
}

export function parseCredentialStorageState(value: unknown): CredentialStorageState | null {
    if (!isRecord(value)
        || value.schemaVersion !== CREDENTIAL_STORAGE_STATE_SCHEMA_VERSION
        || !isCredentialStorageMode(value.mode)) return null;

    if (value.mode === 'session') {
        return {
            schemaVersion: CREDENTIAL_STORAGE_STATE_SCHEMA_VERSION,
            mode: 'session',
        };
    }

    const encryptedCredentials = value.encryptedCredentials === undefined
        ? undefined
        : isEncryptedCredentialsEnvelope(value.encryptedCredentials)
            ? value.encryptedCredentials
            : null;
    if (encryptedCredentials === null) return null;
    return {
        schemaVersion: CREDENTIAL_STORAGE_STATE_SCHEMA_VERSION,
        mode: 'device',
        ...(encryptedCredentials ? {encryptedCredentials} : {}),
    };
}

export function createCredentialStorageState(
    mode: CredentialStorageMode,
    encryptedCredentials?: EncryptedCredentialsEnvelope,
): CredentialStorageState {
    return {
        schemaVersion: CREDENTIAL_STORAGE_STATE_SCHEMA_VERSION,
        mode,
        ...(mode === 'device' && encryptedCredentials ? {encryptedCredentials} : {}),
    };
}
