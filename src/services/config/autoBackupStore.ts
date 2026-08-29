import {storage} from '@wxt-dev/storage';
import {
    appendConfigAutoBackup,
    cloneConfigAutoBackups,
    createBaselineConfigAutoBackups,
    findConfigAutoBackup,
    parseConfigAutoBackups,
    restoreRestorableConfig,
    serializeConfigAutoBackups,
    type ConfigAutoBackupState,
} from './autoBackup';
import {
    config,
    configHistoryReady,
    configReady,
    getConfigHistorySnapshot,
    saveConfig,
    type ConfigHistoryState,
} from './store';

export const CONFIG_AUTO_BACKUP_STORAGE_KEY = 'local:configAutoBackups' as const;
export const CONFIG_AUTO_BACKUP_RESTORE_MESSAGE = 'configAutoBackupRestore' as const;

export interface CaptureConfigAutoBackupOptions {
    config?: unknown;
    savedAt?: string;
}

export interface ConfigAutoBackupRestoreResult {
    backups: ConfigAutoBackupState;
    history: ConfigHistoryState;
}

type ConfigAutoBackupListener = (nextBackups: ConfigAutoBackupState) => void;
type ConfigAutoBackupMessageResponse = {
    success?: boolean;
    error?: string;
    result?: ConfigAutoBackupRestoreResult;
} | undefined;
type ConfigAutoBackupMessageSender = (message: {
    type: typeof CONFIG_AUTO_BACKUP_RESTORE_MESSAGE;
    version: number;
}) => Promise<ConfigAutoBackupMessageResponse>;

const listeners = new Set<ConfigAutoBackupListener>();
let backupState: ConfigAutoBackupState;
let initialized = false;
let lastSerialized = '';

function notifyListeners(): void {
    if (!backupState) return;
    const snapshot = cloneConfigAutoBackups(backupState);
    listeners.forEach((listener) => listener(snapshot));
}

function setBackupState(nextState: ConfigAutoBackupState, notify = true): void {
    const next = cloneConfigAutoBackups(nextState);
    const serialized = serializeConfigAutoBackups(next);
    const changed = serialized !== lastSerialized;
    backupState = next;
    lastSerialized = serialized;
    if (notify && changed) notifyListeners();
}

function handleStoredBackupsChange(value: unknown): void {
    const parsed = parseConfigAutoBackups(value);
    if (!parsed || serializeConfigAutoBackups(parsed) === lastSerialized) return;
    setBackupState(parsed);
}

storage.watch(CONFIG_AUTO_BACKUP_STORAGE_KEY, handleStoredBackupsChange);

async function persistBackupState(nextState: ConfigAutoBackupState): Promise<void> {
    const next = cloneConfigAutoBackups(nextState);
    await storage.setItem<ConfigAutoBackupState>(CONFIG_AUTO_BACKUP_STORAGE_KEY, next);
    setBackupState(next);
}

async function initializeConfigAutoBackups(): Promise<void> {
    try {
        await configReady;
        const stored = await storage.getItem<unknown>(CONFIG_AUTO_BACKUP_STORAGE_KEY);
        const parsed = parseConfigAutoBackups(stored);
        if (parsed) {
            initialized = true;
            setBackupState(parsed, false);
            return;
        }

        const baseline = createBaselineConfigAutoBackups(config);
        await storage.setItem<ConfigAutoBackupState>(CONFIG_AUTO_BACKUP_STORAGE_KEY, baseline);
        initialized = true;
        setBackupState(baseline, false);
    } catch (error) {
        initialized = true;
        setBackupState(createBaselineConfigAutoBackups(config), false);
        console.error('[BabelBox] 自动配置备份读取失败，使用当前配置基线', error);
    }
}

export const configAutoBackupsReady = initializeConfigAutoBackups();

export function getConfigAutoBackupsSnapshot(): ConfigAutoBackupState {
    return cloneConfigAutoBackups(backupState || createBaselineConfigAutoBackups(config));
}

export function subscribeConfigAutoBackups(listener: ConfigAutoBackupListener): () => void {
    listeners.add(listener);
    if (initialized && backupState) listener(getConfigAutoBackupsSnapshot());
    return () => listeners.delete(listener);
}

export async function captureConfigAutoBackup(
    options: CaptureConfigAutoBackupOptions = {},
): Promise<ConfigAutoBackupState> {
    await configAutoBackupsReady;
    const next = appendConfigAutoBackup(
        backupState,
        options.config === undefined ? config : options.config,
        options.savedAt,
    );
    await persistBackupState(next);
    return getConfigAutoBackupsSnapshot();
}

export async function restoreConfigAutoBackup(version: number): Promise<ConfigAutoBackupRestoreResult> {
    await Promise.all([configAutoBackupsReady, configHistoryReady]);
    const entry = findConfigAutoBackup(backupState, version);
    if (!entry) throw new Error(`自动备份 v${version} 不存在`);

    const restored = restoreRestorableConfig(entry.config, config);
    await saveConfig(restored, {recordHistory: true, immediateHistory: true});
    return {
        backups: getConfigAutoBackupsSnapshot(),
        history: getConfigHistorySnapshot(),
    };
}

export async function requestConfigAutoBackupRestore(
    version: number,
    sendMessage?: ConfigAutoBackupMessageSender,
): Promise<ConfigAutoBackupRestoreResult> {
    if (!sendMessage) return restoreConfigAutoBackup(version);

    const response = await sendMessage({
        type: CONFIG_AUTO_BACKUP_RESTORE_MESSAGE,
        version,
    });
    if (response?.success === false) throw new Error(response.error || '自动配置备份恢复失败');
    if (!response?.result) throw new Error('自动配置备份恢复没有返回结果');
    return response.result;
}
