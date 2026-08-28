import {
    restoreRestorableConfig,
    toRestorableConfig,
    type RestorableConfig,
} from './history';
import {isConfigRecord, parseStoredConfig} from './schema';

export const CONFIG_AUTO_BACKUP_LIMIT = 10 as const;
export const CONFIG_AUTO_BACKUP_SCHEMA_VERSION = 1 as const;

export interface ConfigAutoBackupEntry {
    version: number;
    savedAt: string;
    config: RestorableConfig;
}

export interface ConfigAutoBackupState {
    schemaVersion: typeof CONFIG_AUTO_BACKUP_SCHEMA_VERSION;
    entries: ConfigAutoBackupEntry[];
    nextVersion: number;
}

export function serializeConfigAutoBackups(value: ConfigAutoBackupState): string {
    return JSON.stringify(value);
}

export function cloneConfigAutoBackups(value: ConfigAutoBackupState): ConfigAutoBackupState {
    return {
        schemaVersion: CONFIG_AUTO_BACKUP_SCHEMA_VERSION,
        entries: value.entries.map((entry) => ({
            version: entry.version,
            savedAt: entry.savedAt,
            config: toRestorableConfig(entry.config),
        })),
        nextVersion: value.nextVersion,
    };
}

export function createBaselineConfigAutoBackups(
    value: unknown,
    savedAt = new Date().toISOString(),
): ConfigAutoBackupState {
    return {
        schemaVersion: CONFIG_AUTO_BACKUP_SCHEMA_VERSION,
        entries: [{version: 1, savedAt, config: toRestorableConfig(value)}],
        nextVersion: 2,
    };
}

export function parseConfigAutoBackups(value: unknown): ConfigAutoBackupState | null {
    if (!isConfigRecord(value) || !Array.isArray(value.entries)) return null;
    if (value.schemaVersion !== undefined && value.schemaVersion !== CONFIG_AUTO_BACKUP_SCHEMA_VERSION) return null;

    const entries = value.entries
        .map((entry) => {
            if (!isConfigRecord(entry)
                || typeof entry.version !== 'number'
                || !Number.isSafeInteger(entry.version)
                || entry.version < 1
                || typeof entry.savedAt !== 'string') return null;
            const parsedConfig = parseStoredConfig(entry.config);
            if (!parsedConfig) return null;
            return {
                version: entry.version,
                savedAt: entry.savedAt,
                config: toRestorableConfig(parsedConfig),
            } satisfies ConfigAutoBackupEntry;
        })
        .filter((entry): entry is ConfigAutoBackupEntry => entry !== null)
        .slice(-CONFIG_AUTO_BACKUP_LIMIT);

    if (entries.length === 0) return null;
    const maxVersion = entries.reduce((max, entry) => Math.max(max, entry.version), 0);
    const rawNextVersion = typeof value.nextVersion === 'number'
        && Number.isSafeInteger(value.nextVersion)
        && value.nextVersion >= 1
        ? value.nextVersion
        : maxVersion + 1;
    return {
        schemaVersion: CONFIG_AUTO_BACKUP_SCHEMA_VERSION,
        entries,
        nextVersion: Math.max(rawNextVersion, maxVersion + 1),
    };
}

/** 自动备份是时间检查点，即使配置未变化也会追加一份。 */
export function appendConfigAutoBackup(
    state: ConfigAutoBackupState,
    value: unknown,
    savedAt = new Date().toISOString(),
): ConfigAutoBackupState {
    const entries = [...state.entries, {
        version: state.nextVersion,
        savedAt,
        config: toRestorableConfig(value),
    }].slice(-CONFIG_AUTO_BACKUP_LIMIT);
    return {
        schemaVersion: CONFIG_AUTO_BACKUP_SCHEMA_VERSION,
        entries,
        nextVersion: state.nextVersion + 1,
    };
}

export function findConfigAutoBackup(
    state: ConfigAutoBackupState,
    version: number,
): ConfigAutoBackupEntry | null {
    return state.entries.find((entry) => entry.version === version) || null;
}

export {restoreRestorableConfig};
