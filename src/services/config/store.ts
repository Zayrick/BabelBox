import { storage } from '@wxt-dev/storage';
import { Config, normalizeConfig } from '@/src/core/config/model';
import {
    DEFAULT_CREDENTIAL_STORAGE_MODE,
    CREDENTIAL_STORAGE_MODE_MESSAGE,
    createCredentialStorageState,
    isCredentialStorageMode,
    parseCredentialStorageState,
    type CredentialStorageMode,
    type CredentialStorageState,
} from '@/src/core/config/credentialStorage';
import {
    LOCAL_CREDENTIALS_STORAGE_KEY,
    SESSION_CREDENTIALS_STORAGE_KEY,
    credentialsEqual,
    extractConfigCredentials,
    filterConfigCredentialsForDestination,
    hasCredentialData,
    hasCredentialFields,
    mergeConfigCredentials,
    parseStoredCredentials,
    sanitizeConfigCredentials,
    sanitizeConfigHistoryCredentials,
    type ConfigCredentials,
} from '@/src/core/config/credentials';
import {
    ENCRYPTED_CREDENTIAL_VAULT_ENABLED,
    isTrustedCredentialStorageContext,
} from '@/src/platform/storage/credentialContext';
import {
    decryptCredentials,
    encryptCredentials,
} from '@/src/platform/storage/credentialVault';
import {
    CONFIG_HISTORY_LIMIT,
    appendConfigHistorySnapshot,
    cloneConfigHistory,
    createBaselineConfigHistory,
    parseConfigHistory,
    resolveConfigHistoryTargetIndex,
    serializeConfigHistory,
    toPublicConfig,
    toRestorableConfig,
    restoreRestorableConfig,
    type ConfigHistoryAction,
    type ConfigHistoryState,
    type RestorableConfig,
} from './history';
import {
    CONFIG_REVISION_FIELD,
    getStoredConfigRevision,
    isConfigRecord,
    parseStoredConfig,
    serializeConfig,
} from './schema';
import {
    CONFIG_COUNT_INCREMENT_MESSAGE,
    parseConfigCountIncrement,
} from './count';

export {CONFIG_HISTORY_LIMIT, parseStoredConfig, serializeConfig};
export type {ConfigHistoryAction, ConfigHistoryEntry, ConfigHistoryState} from './history';

export const CONFIG_STORAGE_KEY = 'local:config' as const;
export const CONFIG_HISTORY_STORAGE_KEY = 'local:configHistory' as const;
export const CREDENTIAL_STORAGE_STATE_KEY = 'local:credentialStorageState' as const;
export const CONFIG_PERSIST_MESSAGE = 'persistConfig' as const;
export const CONFIG_HISTORY_MESSAGE = 'configHistoryAction' as const;
const CONFIG_HISTORY_DEBOUNCE_MS = 350;

type ConfigListener = (nextConfig: Config) => void;

type ConfigHistoryListener = (nextHistory: ConfigHistoryState) => void;
type CredentialStorageModeListener = (mode: CredentialStorageMode) => void;

const listeners = new Set<ConfigListener>();
const historyListeners = new Set<ConfigHistoryListener>();
const credentialStorageModeListeners = new Set<CredentialStorageModeListener>();
let storageRevision = 0;
let initialized = false;
let lastPersistedSerialized = '';
let writeRevision = 0;
let writeQueue: Promise<void> = Promise.resolve();
let latestRequestedSerialized = '';
let persistedConfigRevision = 0;
let requestSequence = 0;
const requestClientId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let historyState: ConfigHistoryState;
let historyInitialized = false;
let historyLastSerialized = '';
let historyPendingSerialized = '';
let historyWriteRevision = 0;
let historyWriteQueue: Promise<void> = Promise.resolve();
let pendingHistorySnapshot: RestorableConfig | null = null;
let pendingHistoryTimer: ReturnType<typeof setTimeout> | undefined;
let historyFlushPromise: Promise<void> | null = null;

// 所有运行时模块共享同一个可变配置对象；存储层负责把跨上下文变更同步进来。
export const config = new Config();

function notifyHistoryListeners(): void {
    if (!historyState) return;
    const snapshot = cloneConfigHistory(historyState);
    historyListeners.forEach((listener) => listener(snapshot));
}

function setHistoryState(nextHistory: ConfigHistoryState, notify = true): void {
    historyState = cloneConfigHistory(nextHistory);
    historyLastSerialized = serializeConfigHistory(historyState);
    if (notify) notifyHistoryListeners();
}

function handleStoredHistoryChange(value: unknown): void {
    const parsed = parseConfigHistory(value);
    if (!parsed) return;
    const serialized = serializeConfigHistory(parsed);
    if (serialized === historyLastSerialized) return;
    // 写队列处理中只接收最新请求的回声，避免较慢的旧写入覆盖新快照。
    if (historyPendingSerialized && serialized !== historyPendingSerialized) return;

    // 外部上下文没有与本地写入竞争时，立即同步历史游标和订阅者。
    setHistoryState(parsed);
}

async function queueHistoryWrite(nextHistory: ConfigHistoryState): Promise<void> {
    const sanitizedHistory = cloneConfigHistory(nextHistory);
    const serialized = serializeConfigHistory(sanitizedHistory);
    if (!historyPendingSerialized && serialized === historyLastSerialized) return;
    if (serialized === historyPendingSerialized) return;

    historyPendingSerialized = serialized;
    const revision = ++historyWriteRevision;
    historyWriteQueue = historyWriteQueue
        .catch(() => undefined)
        .then(async () => {
            // 队列轮到当前写入时再次执行 latest-write-wins 检查。
            if (revision !== historyWriteRevision || historyPendingSerialized !== serialized) return;
            await storage.setItem<ConfigHistoryState>(CONFIG_HISTORY_STORAGE_KEY, sanitizedHistory);

            // storage.setItem 期间可能产生更新请求；旧写入完成后不能回滚内存状态。
            if (revision !== historyWriteRevision || historyPendingSerialized !== serialized) return;
            setHistoryState(sanitizedHistory);
            historyPendingSerialized = '';
        });
    try {
        await historyWriteQueue;
    } catch (error) {
        if (revision === historyWriteRevision && historyPendingSerialized === serialized) {
            historyPendingSerialized = '';
        }
        throw error;
    }
}

async function initializeConfigHistory(): Promise<void> {
    try {
        await configReady;
        const storedHistory = await storage.getItem<unknown>(CONFIG_HISTORY_STORAGE_KEY);
        const parsed = parseConfigHistory(storedHistory);
        historyInitialized = true;
        if (parsed) {
            setHistoryState(parsed);
        } else {
            setHistoryState(createBaselineConfigHistory(config, persistedConfigRevision), false);
        }
    } catch (error) {
        historyInitialized = true;
        setHistoryState(createBaselineConfigHistory(config, persistedConfigRevision), false);
        console.error('[BabelBox] 配置历史读取失败，使用当前配置快照', error);
    }
}

async function appendHistorySnapshotNow(value: unknown): Promise<void> {
    await configHistoryReady;
    const nextHistory = appendConfigHistorySnapshot(historyState, value);
    if (!nextHistory) return;
    await queueHistoryWrite(nextHistory);
}

function takePendingHistorySnapshot(): RestorableConfig | null {
    if (pendingHistoryTimer) clearTimeout(pendingHistoryTimer);
    pendingHistoryTimer = undefined;
    const snapshot = pendingHistorySnapshot;
    pendingHistorySnapshot = null;
    return snapshot;
}

function flushHistorySnapshot(snapshot: RestorableConfig): Promise<void> {
    // 每次追加都等待前一个追加完成，确保它读取到已提交的游标与 nextVersion。
    const previous = historyFlushPromise;
    const current = (previous ? previous.catch(() => undefined) : Promise.resolve())
        .then(() => appendHistorySnapshotNow(snapshot));
    historyFlushPromise = current;

    // 只有队尾任务可以清空引用；较早任务结束不能让调用方漏等后续快照。
    const clearIfCurrent = () => {
        if (historyFlushPromise === current) historyFlushPromise = null;
    };
    void current.then(clearIfCurrent, clearIfCurrent);
    void current.catch((error) => console.error('[BabelBox] 配置历史保存失败', error));
    return current;
}

function scheduleHistorySnapshot(value: unknown): void {
    pendingHistorySnapshot = toRestorableConfig(value);
    if (pendingHistoryTimer) clearTimeout(pendingHistoryTimer);
    pendingHistoryTimer = setTimeout(() => {
        const snapshot = takePendingHistorySnapshot();
        if (snapshot) flushHistorySnapshot(snapshot);
    }, CONFIG_HISTORY_DEBOUNCE_MS);
}

export async function flushConfigHistory(): Promise<void> {
    const snapshot = takePendingHistorySnapshot();
    let current = snapshot ? flushHistorySnapshot(snapshot) : historyFlushPromise;
    while (current) {
        await current;
        current = historyFlushPromise === current ? null : historyFlushPromise;
    }
}

function notifyListeners(nextConfig: Config): void {
    const snapshot = normalizeConfig(nextConfig);
    listeners.forEach((listener) => listener(snapshot));
}

function applyConfig(nextConfig: Config): void {
    Object.assign(config, nextConfig);
    notifyListeners(config);
}

const trustedCredentialStorageContext = isTrustedCredentialStorageContext();
let credentialStorageMode: CredentialStorageMode = DEFAULT_CREDENTIAL_STORAGE_MODE;
let legacyCredentialCleanupRequired = false;
let lastCredentialCheckpointSerialized = '';
let sessionCredentialWatchRegistered = false;

function setCredentialStorageModeState(mode: CredentialStorageMode, notify = true): void {
    if (credentialStorageMode === mode) return;
    credentialStorageMode = mode;
    if (notify) credentialStorageModeListeners.forEach((listener) => listener(mode));
}

async function writeSessionCredentials(credentials: ConfigCredentials): Promise<void> {
    await storage.setItem<ConfigCredentials>(SESSION_CREDENTIALS_STORAGE_KEY, credentials);
}

async function writeCredentialStorageState(
    mode: CredentialStorageMode,
    credentials: ConfigCredentials,
): Promise<void> {
    if (!ENCRYPTED_CREDENTIAL_VAULT_ENABLED) {
        if (mode !== 'device') throw new Error('Userscript 不支持仅会话凭据模式');
        lastCredentialCheckpointSerialized = serializeConfig(credentials);
        setCredentialStorageModeState('device');
        return;
    }

    const encryptedCredentials = mode === 'device' && hasCredentialData(credentials)
        ? await encryptCredentials(credentials)
        : undefined;
    const state = createCredentialStorageState(mode, encryptedCredentials);
    await storage.setItem<CredentialStorageState>(CREDENTIAL_STORAGE_STATE_KEY, state);
    lastCredentialCheckpointSerialized = serializeConfig(credentials);
    setCredentialStorageModeState(mode);
}

async function sanitizeStoredHistory(rawHistory?: unknown): Promise<void> {
    const storedHistory = arguments.length > 0
        ? rawHistory
        : await storage.getItem<unknown>(CONFIG_HISTORY_STORAGE_KEY);
    if (storedHistory === null || storedHistory === undefined) return;
    const sanitized = sanitizeConfigHistoryCredentials(storedHistory);
    if (serializeConfig(storedHistory) === serializeConfig(sanitized)) return;
    if (sanitized === null) {
        await storage.removeItem(CONFIG_HISTORY_STORAGE_KEY);
        return;
    }
    await storage.setItem(CONFIG_HISTORY_STORAGE_KEY, sanitized);
}

function queueStorageWrite(nextConfig: Config, serialized: string, revision: number, storedRevision: number): Promise<void> {
    writeQueue = writeQueue
        .catch(() => undefined)
        .then(async () => {
            // 只写最后一次快照，避免连续输入或多个页面初始化时排队回写旧配置。
            if (revision !== writeRevision || lastPersistedSerialized !== serialized) return;
            try {
                if (!trustedCredentialStorageContext) {
                    // Userscripts and extension content scripts can persist the
                    // public configuration, but they cannot access the
                    // extension-only session credential store. Credentials are
                    // stripped by toPublicConfig before this fallback write.
                    await storage.setItem(CONFIG_STORAGE_KEY, {
                        ...toPublicConfig(nextConfig),
                        [CONFIG_REVISION_FIELD]: storedRevision,
                    });
                    return;
                }

                const credentials = extractConfigCredentials(nextConfig);
                const credentialsSerialized = serializeConfig(credentials);
                const credentialSnapshotChanged = credentialsSerialized !== lastCredentialCheckpointSerialized;
                const mustCheckpointCredentials = credentialSnapshotChanged
                    || legacyCredentialCleanupRequired;
                if (mustCheckpointCredentials) {
                    await writeSessionCredentials(credentials);
                }
                if (credentialStorageMode === 'device' && credentialSnapshotChanged) {
                    await writeCredentialStorageState('device', credentials);
                } else if (credentialSnapshotChanged) {
                    lastCredentialCheckpointSerialized = credentialsSerialized;
                }

                await storage.setItem(CONFIG_STORAGE_KEY, {
                    ...toPublicConfig(nextConfig),
                    [CONFIG_REVISION_FIELD]: storedRevision,
                });

                if (legacyCredentialCleanupRequired) {
                    await sanitizeStoredHistory();
                    await storage.removeItem(LOCAL_CREDENTIALS_STORAGE_KEY);
                    legacyCredentialCleanupRequired = false;
                }
            } catch (error) {
                if (lastPersistedSerialized === serialized) lastPersistedSerialized = '';
                throw error;
            }
        });
    return writeQueue;
}

async function persistNormalizedConfig(nextConfig: Config, serialized = serializeConfig(nextConfig)): Promise<void> {
    if (serialized === lastPersistedSerialized) return;

    lastPersistedSerialized = serialized;
    const revision = ++writeRevision;
    const storedRevision = ++persistedConfigRevision;
    await queueStorageWrite(nextConfig, serialized, revision, storedRevision);
}

function handleStoredConfigChange(value: unknown): void {
    storageRevision += 1;
    const parsed = parseStoredConfig(value);
    if (!parsed) return;

    const targetConfig = normalizeConfig(sanitizeConfigCredentials(parsed));
    const credentials = filterConfigCredentialsForDestination(
        extractConfigCredentials(config),
        config,
        targetConfig,
    );
    const normalized = normalizeConfig(mergeConfigCredentials(targetConfig, credentials));
    const serialized = serializeConfig(normalized);
    const storedRevision = getStoredConfigRevision(parsed);
    if (storedRevision && storedRevision < persistedConfigRevision) return;
    if (storedRevision) persistedConfigRevision = storedRevision;
    // 同一个短生命周期页面可能在极短时间内产生多个快照。storage.watch
    // 可能先回传前一个快照，不能让它覆盖页面尚未完成发送的最新快照。
    if (latestRequestedSerialized && serialized !== latestRequestedSerialized) return;
    if (serialized === lastPersistedSerialized) return;

    // 外部上下文已经产生了新快照，使尚未写入的旧快照失效。
    writeRevision += 1;
    lastPersistedSerialized = serialized;
    applyConfig(normalized);
}

// 在首次读取前注册监听，避免设置页打开期间丢失其他上下文的更新。
storage.watch(CONFIG_STORAGE_KEY, handleStoredConfigChange);
storage.watch(CONFIG_HISTORY_STORAGE_KEY, handleStoredHistoryChange);
if (trustedCredentialStorageContext && ENCRYPTED_CREDENTIAL_VAULT_ENABLED) {
    storage.watch(CREDENTIAL_STORAGE_STATE_KEY, (value) => {
        const state = parseCredentialStorageState(value);
        setCredentialStorageModeState(state?.mode || DEFAULT_CREDENTIAL_STORAGE_MODE);
    });
}

function registerSessionCredentialWatch(): void {
    if (!trustedCredentialStorageContext || sessionCredentialWatchRegistered) return;
    try {
        storage.watch(SESSION_CREDENTIALS_STORAGE_KEY, (value) => {
            const nextCredentials = parseStoredCredentials(value) || extractConfigCredentials({});
            lastCredentialCheckpointSerialized = serializeConfig(nextCredentials);
            const normalized = normalizeConfig(mergeConfigCredentials(config, nextCredentials));
            const serialized = serializeConfig(normalized);
            if (serialized === serializeConfig(config)) return;
            lastPersistedSerialized = serialized;
            applyConfig(normalized);
        });
        sessionCredentialWatchRegistered = true;
    } catch (error) {
        console.warn('[BabelBox] 当前浏览器不支持 session 凭据监听', error);
    }
}

async function initializeConfig(): Promise<void> {
    try {
        let storedValue: unknown = null;

        // 读取过程中若收到 storage.onChanged，重新读取一次，避免旧读结果覆盖新配置。
        for (let attempt = 0; attempt < 2; attempt += 1) {
            const revisionAtRead = storageRevision;
            storedValue = await storage.getItem<unknown>(CONFIG_STORAGE_KEY);
            if (revisionAtRead === storageRevision) break;
        }

        const parsed = parseStoredConfig(storedValue);
        persistedConfigRevision = getStoredConfigRevision(storedValue);

        if (!trustedCredentialStorageContext) {
            // content script 的 location 属于网页 origin，且默认无权访问 storage.session。
            // 只加载公开配置，不在此上下文迁移、回写或监听凭据。
            const normalized = parsed
                ? normalizeConfig(sanitizeConfigCredentials(parsed))
                : new Config();
            initialized = true;
            lastPersistedSerialized = serializeConfig(normalized);
            applyConfig(normalized);
            return;
        }

        const legacyCredentials = parsed && hasCredentialFields(parsed)
            ? extractConfigCredentials(parsed)
            : null;
        const localCredentialsValue = await storage.getItem<unknown>(LOCAL_CREDENTIALS_STORAGE_KEY);
        const localCredentials = parseStoredCredentials(localCredentialsValue);

        let storedCredentialState: CredentialStorageState | null = null;
        let deviceCredentials: ConfigCredentials | null = null;
        if (ENCRYPTED_CREDENTIAL_VAULT_ENABLED) {
            storedCredentialState = parseCredentialStorageState(
                await storage.getItem<unknown>(CREDENTIAL_STORAGE_STATE_KEY),
            );
            // 升级时保留用户已选择的仅会话模式；新安装仍使用新默认值。
            setCredentialStorageModeState(
                storedCredentialState?.mode
                    || (parsed?.persistCredentials === false
                        ? 'session'
                        : DEFAULT_CREDENTIAL_STORAGE_MODE),
                false,
            );
            if (storedCredentialState?.mode === 'device' && storedCredentialState.encryptedCredentials) {
                try {
                    deviceCredentials = await decryptCredentials(storedCredentialState.encryptedCredentials);
                } catch (error) {
                    console.warn('[BabelBox] 设备凭据保险库读取失败', error);
                }
            }
        } else {
            setCredentialStorageModeState('device', false);
            deviceCredentials = localCredentials;
        }
        const rawHistory = await storage.getItem<unknown>(CONFIG_HISTORY_STORAGE_KEY);
        const sanitizedRawHistory = sanitizeConfigHistoryCredentials(rawHistory);
        const historyNeedsSanitizing = rawHistory !== null
            && rawHistory !== undefined
            && serializeConfig(rawHistory) !== serializeConfig(sanitizedRawHistory);

        let sessionCredentials: ConfigCredentials | null = null;
        let sessionReadError: unknown;
        try {
            sessionCredentials = parseStoredCredentials(
                await storage.getItem<unknown>(SESSION_CREDENTIALS_STORAGE_KEY),
            );
        } catch (error) {
            sessionReadError = error;
        }

        const activeCredentials = sessionCredentials
            || deviceCredentials
            || localCredentials
            || legacyCredentials
            || extractConfigCredentials({});
        const normalized = parsed
            ? normalizeConfig(mergeConfigCredentials(parsed, activeCredentials))
            : normalizeConfig(mergeConfigCredentials(new Config(), activeCredentials));
        // normalizeConfig may materialize instance-scoped credentials while
        // splitting legacy webpage/document models into separate instances.
        // Every checkpoint must persist that migrated result, not its input.
        const checkpointCredentials = extractConfigCredentials(normalized);
        const serialized = serializeConfig(normalized);

        initialized = true;
        applyConfig(normalized);
        credentialStorageModeListeners.forEach((listener) => listener(credentialStorageMode));

        const hasLegacyCredentialStorage = Boolean(
            legacyCredentials
            || localCredentials
            || historyNeedsSanitizing,
        );
        legacyCredentialCleanupRequired = hasLegacyCredentialStorage;
        const mustCheckpointCredentials = hasCredentialData(checkpointCredentials)
            || hasLegacyCredentialStorage
            || deviceCredentials !== null;

        if (mustCheckpointCredentials) {
            try {
                if (sessionReadError) throw sessionReadError;
                await writeSessionCredentials(checkpointCredentials);
            } catch (error) {
                lastPersistedSerialized = serialized;
                console.warn('[BabelBox] session 凭据不可用，保留旧凭据存储以避免数据丢失', error);
                registerSessionCredentialWatch();
                return;
            }
        }

        if (ENCRYPTED_CREDENTIAL_VAULT_ENABLED) {
            const needsCredentialStateWrite = (!storedCredentialState && credentialStorageMode === 'session')
                || (credentialStorageMode === 'device' && (
                    hasLegacyCredentialStorage
                    || (!storedCredentialState && hasCredentialData(checkpointCredentials))
                    || (deviceCredentials !== null
                        && !credentialsEqual(deviceCredentials, checkpointCredentials))
                    || (storedCredentialState?.mode === 'device'
                        && !storedCredentialState.encryptedCredentials
                        && hasCredentialData(checkpointCredentials))
                ));
            if (needsCredentialStateWrite) {
                await writeCredentialStorageState(credentialStorageMode, checkpointCredentials);
            } else {
                lastCredentialCheckpointSerialized = serializeConfig(checkpointCredentials);
            }
        } else {
            lastCredentialCheckpointSerialized = serializeConfig(checkpointCredentials);
        }

        const nextStoredConfig = {
            ...toPublicConfig(normalized),
            [CONFIG_REVISION_FIELD]: persistedConfigRevision,
        };
        const storedNeedsMigration = !isConfigRecord(storedValue)
            || typeof storedValue === 'string'
            || serializeConfig(storedValue) !== serializeConfig(nextStoredConfig);
        if (storedNeedsMigration) {
            persistedConfigRevision += 1;
            await storage.setItem(CONFIG_STORAGE_KEY, {
                ...toPublicConfig(normalized),
                [CONFIG_REVISION_FIELD]: persistedConfigRevision,
            });
        }
        if (historyNeedsSanitizing) await sanitizeStoredHistory(rawHistory);
        if (hasLegacyCredentialStorage) {
            await storage.removeItem(LOCAL_CREDENTIALS_STORAGE_KEY);
        }
        legacyCredentialCleanupRequired = false;
        lastPersistedSerialized = serialized;
        registerSessionCredentialWatch();
    } catch (error) {
        if (initialized) {
            lastPersistedSerialized = serializeConfig(config);
            console.error('[BabelBox] 配置安全迁移未完成，保留当前运行时与旧存储以便重试', error);
            return;
        }
        // 存储 API 暂时不可用时仍提供默认配置，避免 Firefox 设置页因初始化 rejection 反复重载。
        console.error('[BabelBox] 配置读取失败，使用默认配置', error);
        const fallback = new Config();
        initialized = true;
        lastPersistedSerialized = '';
        applyConfig(fallback);
        // 读取失败时不做清理或迁移，避免把暂时不可用误判为“没有凭据”。
    }
}

export const configReady = initializeConfig();
export const configHistoryReady = initializeConfigHistory();

export function subscribeConfig(listener: ConfigListener): () => void {
    listeners.add(listener);
    if (initialized) listener(normalizeConfig(config));
    return () => listeners.delete(listener);
}

export function getCredentialStorageMode(): CredentialStorageMode {
    return credentialStorageMode;
}

export function subscribeCredentialStorageMode(listener: CredentialStorageModeListener): () => void {
    credentialStorageModeListeners.add(listener);
    if (initialized) listener(credentialStorageMode);
    return () => credentialStorageModeListeners.delete(listener);
}

/** 切到仅会话前先写入 session，再删除设备密文。 */
export async function setCredentialStorageMode(mode: CredentialStorageMode): Promise<CredentialStorageMode> {
    if (!trustedCredentialStorageContext) throw new Error('当前上下文无权修改 API 凭据存储方式');
    await configReady;
    if (mode === credentialStorageMode) return credentialStorageMode;

    const credentials = extractConfigCredentials(config);
    writeQueue = writeQueue
        .catch(() => undefined)
        .then(async () => {
            await writeSessionCredentials(credentials);
            await writeCredentialStorageState(mode, credentials);
            if (legacyCredentialCleanupRequired) {
                await sanitizeStoredHistory();
                await storage.removeItem(LOCAL_CREDENTIALS_STORAGE_KEY);
                legacyCredentialCleanupRequired = false;
            }
        });
    await writeQueue;
    return credentialStorageMode;
}

type CredentialStorageModeMessageResponse = {
    success?: boolean;
    error?: string;
    mode?: CredentialStorageMode;
} | undefined;

type CredentialStorageModeMessageSender = (message: {
    type: typeof CREDENTIAL_STORAGE_MODE_MESSAGE;
    mode: CredentialStorageMode;
}) => Promise<CredentialStorageModeMessageResponse>;

export async function requestCredentialStorageModeChange(
    mode: CredentialStorageMode,
    sendMessage: CredentialStorageModeMessageSender,
): Promise<CredentialStorageMode> {
    const response = await sendMessage({type: CREDENTIAL_STORAGE_MODE_MESSAGE, mode});
    if (response?.success === false) throw new Error(response.error || 'API 凭据存储设置失败');
    if (!isCredentialStorageMode(response?.mode)) throw new Error('后台没有返回有效的 API 凭据存储方式');
    setCredentialStorageModeState(response.mode);
    return response.mode;
}

/** 翻译计数只做后台原子增量，不提交可能过期的整份页面配置。 */
export async function incrementConfigCount(delta: number): Promise<number> {
    const normalizedDelta = parseConfigCountIncrement(delta);
    if (normalizedDelta === null) throw new TypeError('无效的翻译计数增量');
    await configReady;

    const nextConfig = normalizeConfig({...config, count: config.count + normalizedDelta});
    await storage.setItem(CONFIG_STORAGE_KEY, {
        ...toPublicConfig(nextConfig),
        [CONFIG_REVISION_FIELD]: persistedConfigRevision,
    });
    writeRevision += 1;
    lastPersistedSerialized = serializeConfig(nextConfig);
    applyConfig(nextConfig);
    return nextConfig.count;
}

type ConfigCountMessageResponse = {success?: boolean; error?: string; count?: number} | undefined;
type ConfigCountMessageSender = (message: {
    type: typeof CONFIG_COUNT_INCREMENT_MESSAGE;
    delta: number;
}) => Promise<ConfigCountMessageResponse>;

export async function requestConfigCountIncrement(
    delta: number,
    sendMessage?: ConfigCountMessageSender,
): Promise<number> {
    const normalizedDelta = parseConfigCountIncrement(delta);
    if (normalizedDelta === null) throw new TypeError('无效的翻译计数增量');
    if (!sendMessage) return incrementConfigCount(normalizedDelta);

    const response = await sendMessage({type: CONFIG_COUNT_INCREMENT_MESSAGE, delta: normalizedDelta});
    if (response?.success === false) throw new Error(response.error || '翻译计数保存失败');
    if (typeof response?.count !== 'number') throw new Error('翻译计数保存没有返回结果');
    return response.count;
}

/**
 * 网页/content 发来的保存请求只能修改公开配置；凭据必须由
 * popup/options 等扩展 origin 明确更新，避免无凭据的 content 快照清空后台 session。
 */
export function prepareConfigSaveRequest(
    value: unknown,
    currentValue: unknown = config,
    allowCredentialUpdates = false,
): Config {
    const currentConfig = normalizeConfig(currentValue);
    const incomingConfig = normalizeConfig(value);
    if (allowCredentialUpdates) {
        return normalizeConfig({
            ...incomingConfig,
            count: currentConfig.count,
            videoServiceDefaultMigrated: currentConfig.videoServiceDefaultMigrated,
        });
    }

    const targetConfig = normalizeConfig({
        ...sanitizeConfigCredentials(incomingConfig),
        count: currentConfig.count,
        videoServiceDefaultMigrated: currentConfig.videoServiceDefaultMigrated,
    });
    const credentials = filterConfigCredentialsForDestination(
        extractConfigCredentials(currentConfig),
        currentConfig,
        targetConfig,
    );
    return normalizeConfig(mergeConfigCredentials(targetConfig, credentials));
}

export function getConfigHistorySnapshot(): ConfigHistoryState {
    return cloneConfigHistory(
        historyState || createBaselineConfigHistory(config, persistedConfigRevision),
    );
}

export function subscribeConfigHistory(listener: ConfigHistoryListener): () => void {
    historyListeners.add(listener);
    if (historyInitialized && historyState) listener(cloneConfigHistory(historyState));
    return () => historyListeners.delete(listener);
}

/**
 * 配置唯一写入口。调用方可以传入编辑中的快照，也可以省略参数保存运行时配置。
 * 写入前会归一化、去重，并串行淘汰旧快照，避免设置页和 popup 互相回灌。
 */
export interface SaveConfigOptions {
    recordHistory?: boolean;
    immediateHistory?: boolean;
}

export async function saveConfig(value: unknown = config, options: SaveConfigOptions = {}): Promise<void> {
    await configReady;

    const normalized = normalizeConfig(value);
    const serialized = serializeConfig(normalized);
    if (serializeConfig(config) !== serialized) applyConfig(normalized);
    await persistNormalizedConfig(normalized, serialized);
    if (options.recordHistory) {
        if (options.immediateHistory) {
            await flushConfigHistory();
            await flushHistorySnapshot(toRestorableConfig(normalized));
        } else {
            scheduleHistorySnapshot(normalized);
        }
    }
}

/**
 * 从 popup/options 等短生命周期页面请求后台保存配置。
 * Firefox 可能在 popup 关闭时销毁页面上下文，不能依赖页面内的异步 storage.set 完成。
 */
type ConfigMessageResponse = { success?: boolean; error?: string } | undefined;
type ConfigMessageSender = (message: {
    type: typeof CONFIG_PERSIST_MESSAGE;
    config: Config;
    clientId: string;
    sequence: number;
}) => Promise<ConfigMessageResponse>;

export async function requestConfigSave(value: unknown = config, sendMessage?: ConfigMessageSender): Promise<void> {
    const normalized = normalizeConfig(value);
    const serialized = serializeConfig(normalized);
    latestRequestedSerialized = serialized;
    const sequence = ++requestSequence;
    try {
        if (!sendMessage) {
            await saveConfig(normalized, {recordHistory: true, immediateHistory: true});
            return;
        }

        const response = await sendMessage({
            type: CONFIG_PERSIST_MESSAGE,
            config: normalized,
            clientId: requestClientId,
            sequence,
        });

        if (response?.success === false) {
            throw new Error(response.error || '后台保存配置失败');
        }
    } finally {
        if (latestRequestedSerialized === serialized) latestRequestedSerialized = '';
    }
}

export async function applyConfigHistoryAction(action: ConfigHistoryAction, version?: number): Promise<ConfigHistoryState> {
    await configHistoryReady;
    await flushConfigHistory();

    const targetIndex = resolveConfigHistoryTargetIndex(historyState, action, version);

    if (targetIndex === historyState.cursor) return getConfigHistorySnapshot();
    const target = historyState.entries[targetIndex];
    const normalized = restoreRestorableConfig(target.config, config);
    await persistNormalizedConfig(normalized);
    if (serializeConfig(config) !== serializeConfig(normalized)) applyConfig(normalized);

    if (action === 'restore') {
        const historyWithLatestCursor = {
            ...historyState,
            cursor: historyState.entries.length - 1,
        };
        const restoredHistory = appendConfigHistorySnapshot(historyWithLatestCursor, normalized);
        await queueHistoryWrite(restoredHistory || historyWithLatestCursor);
        return getConfigHistorySnapshot();
    }

    await queueHistoryWrite({
        ...historyState,
        cursor: targetIndex,
    });
    return getConfigHistorySnapshot();
}

type ConfigHistoryMessageResponse = {success?: boolean; error?: string; history?: ConfigHistoryState} | undefined;
type ConfigHistoryMessageSender = (message: {
    type: typeof CONFIG_HISTORY_MESSAGE;
    action: ConfigHistoryAction;
    version?: number;
}) => Promise<ConfigHistoryMessageResponse>;

export async function requestConfigHistoryAction(
    action: ConfigHistoryAction,
    version?: number,
    sendMessage?: ConfigHistoryMessageSender,
): Promise<ConfigHistoryState> {
    if (!sendMessage) return applyConfigHistoryAction(action, version);

    try {
        const response = await sendMessage({type: CONFIG_HISTORY_MESSAGE, action, version});
        if (response?.success === false) throw new Error(response.error || '配置历史操作失败');
        return response?.history || getConfigHistorySnapshot();
    } catch (error) {
        const history = await applyConfigHistoryAction(action, version);
        if (error instanceof Error && !error.message.includes('Receiving end')) {
            console.warn('[BabelBox] 后台配置历史操作失败，已回退到当前上下文', error);
        }
        return history;
    }
}
