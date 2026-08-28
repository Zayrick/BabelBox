import { storage } from '@wxt-dev/storage';
import { Config, normalizeConfig } from '@/src/core/config/model';
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
    type PublicConfig,
} from '@/src/core/config/credentials';
import {isTrustedCredentialStorageContext} from '@/src/platform/storage/credentialContext';
import {
    CONFIG_HISTORY_LIMIT,
    appendConfigHistorySnapshot,
    cloneConfigHistory,
    createBaselineConfigHistory,
    parseConfigHistory,
    resolveConfigHistoryTargetIndex,
    serializeConfigHistory,
    toPublicConfig,
    type ConfigHistoryAction,
    type ConfigHistoryState,
} from './history';
import {
    CONFIG_REVISION_FIELD,
    getStoredConfigRevision,
    isConfigRecord,
    parseStoredConfig,
    serializeConfig,
} from './schema';

export {CONFIG_HISTORY_LIMIT, parseStoredConfig, serializeConfig};
export type {ConfigHistoryAction, ConfigHistoryEntry, ConfigHistoryState} from './history';

export const CONFIG_STORAGE_KEY = 'local:config' as const;
export const CONFIG_HISTORY_STORAGE_KEY = 'local:configHistory' as const;
export const CONFIG_PERSIST_MESSAGE = 'persistConfig' as const;
export const CONFIG_HISTORY_MESSAGE = 'configHistoryAction' as const;
const CONFIG_HISTORY_DEBOUNCE_MS = 350;

type ConfigListener = (nextConfig: Config) => void;

type ConfigHistoryListener = (nextHistory: ConfigHistoryState) => void;

const listeners = new Set<ConfigListener>();
const historyListeners = new Set<ConfigHistoryListener>();
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
let pendingHistorySnapshot: PublicConfig | null = null;
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
        console.error('[FluentRead] 配置历史读取失败，使用当前配置快照', error);
    }
}

async function appendHistorySnapshotNow(value: unknown): Promise<void> {
    await configHistoryReady;
    const nextHistory = appendConfigHistorySnapshot(historyState, value);
    if (!nextHistory) return;
    await queueHistoryWrite(nextHistory);
}

function takePendingHistorySnapshot(): PublicConfig | null {
    if (pendingHistoryTimer) clearTimeout(pendingHistoryTimer);
    pendingHistoryTimer = undefined;
    const snapshot = pendingHistorySnapshot;
    pendingHistorySnapshot = null;
    return snapshot;
}

function flushHistorySnapshot(snapshot: PublicConfig): Promise<void> {
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
    void current.catch((error) => console.error('[FluentRead] 配置历史保存失败', error));
    return current;
}

function scheduleHistorySnapshot(value: unknown): void {
    pendingHistorySnapshot = toPublicConfig(value);
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
let credentialCleanupRequired = false;
let localCredentialSnapshotPresent = false;
let sessionCredentialWatchRegistered = false;
let sessionCredentialStorageAvailable = false;

async function writeAndVerifyCredentials(
    key: typeof SESSION_CREDENTIALS_STORAGE_KEY | typeof LOCAL_CREDENTIALS_STORAGE_KEY,
    credentials: ConfigCredentials,
): Promise<void> {
    await storage.setItem<ConfigCredentials>(key, credentials);
    const verified = parseStoredCredentials(await storage.getItem<unknown>(key));
    if (!verified || !credentialsEqual(credentials, verified)) {
        throw new Error(`${key} 凭据写入校验失败`);
    }
    if (key === SESSION_CREDENTIALS_STORAGE_KEY) sessionCredentialStorageAvailable = true;
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
                const mustCheckpointCredentials = hasCredentialData(credentials)
                    || credentialCleanupRequired
                    || localCredentialSnapshotPresent
                    || sessionCredentialStorageAvailable
                    || nextConfig.persistCredentials;
                if (mustCheckpointCredentials) {
                    await writeAndVerifyCredentials(SESSION_CREDENTIALS_STORAGE_KEY, credentials);
                }
                if (nextConfig.persistCredentials) {
                    await writeAndVerifyCredentials(LOCAL_CREDENTIALS_STORAGE_KEY, credentials);
                    localCredentialSnapshotPresent = true;
                }

                await storage.setItem(CONFIG_STORAGE_KEY, {
                    ...toPublicConfig(nextConfig),
                    [CONFIG_REVISION_FIELD]: storedRevision,
                });

                if (!nextConfig.persistCredentials && (credentialCleanupRequired || localCredentialSnapshotPresent)) {
                    // 先保证 session 中有已读回确认的快照，并清理历史泄漏，再删除本地凭据。
                    await sanitizeStoredHistory();
                    await storage.removeItem(LOCAL_CREDENTIALS_STORAGE_KEY);
                    credentialCleanupRequired = false;
                    localCredentialSnapshotPresent = false;
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

function registerSessionCredentialWatch(): void {
    if (!trustedCredentialStorageContext || sessionCredentialWatchRegistered) return;
    try {
        storage.watch(SESSION_CREDENTIALS_STORAGE_KEY, (value) => {
            const nextCredentials = parseStoredCredentials(value) || extractConfigCredentials({});
            const normalized = normalizeConfig(mergeConfigCredentials(config, nextCredentials));
            const serialized = serializeConfig(normalized);
            if (serialized === serializeConfig(config)) return;
            lastPersistedSerialized = serialized;
            applyConfig(normalized);
        });
        sessionCredentialWatchRegistered = true;
    } catch (error) {
        console.warn('[FluentRead] 当前浏览器不支持 session 凭据监听', error);
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
        localCredentialSnapshotPresent = localCredentials !== null;
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
            sessionCredentialStorageAvailable = true;
        } catch (error) {
            sessionReadError = error;
        }

        const activeCredentials = sessionCredentials
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

        const hasLegacyCredentialStorage = Boolean(legacyCredentials || localCredentials || historyNeedsSanitizing);
        credentialCleanupRequired = hasLegacyCredentialStorage && !normalized.persistCredentials;
        const mustCheckpointCredentials = hasCredentialData(checkpointCredentials) || hasLegacyCredentialStorage;

        // 凭据迁移严格先写 session 并读回。失败时不改写旧 config/history，亦不删除 local 凭据。
        if (mustCheckpointCredentials) {
            try {
                if (sessionReadError) throw sessionReadError;
                await writeAndVerifyCredentials(SESSION_CREDENTIALS_STORAGE_KEY, checkpointCredentials);
            } catch (error) {
                lastPersistedSerialized = serialized;
                console.warn('[FluentRead] session 凭据不可用，保留旧凭据存储以避免数据丢失', error);
                registerSessionCredentialWatch();
                return;
            }
        }

        if (!normalized.persistCredentials
            && legacyCredentials
            && hasCredentialData(legacyCredentials)
            && !localCredentials) {
            // 旧 config 的迁移可能在后续 config/history 写入时中断。先建立一个
            // 可读回的 local 临时检查点，成功清理全部旧载体后再删，避免崩溃窗口丢 Key。
            await writeAndVerifyCredentials(LOCAL_CREDENTIALS_STORAGE_KEY, checkpointCredentials);
            localCredentialSnapshotPresent = true;
        }
        if (normalized.persistCredentials) {
            await writeAndVerifyCredentials(LOCAL_CREDENTIALS_STORAGE_KEY, checkpointCredentials);
            localCredentialSnapshotPresent = true;
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
        if (!normalized.persistCredentials && hasLegacyCredentialStorage) {
            await storage.removeItem(LOCAL_CREDENTIALS_STORAGE_KEY);
            credentialCleanupRequired = false;
            localCredentialSnapshotPresent = false;
        }
        lastPersistedSerialized = serialized;
        registerSessionCredentialWatch();
    } catch (error) {
        if (initialized) {
            lastPersistedSerialized = serializeConfig(config);
            console.error('[FluentRead] 配置安全迁移未完成，保留当前运行时与旧存储以便重试', error);
            return;
        }
        // 存储 API 暂时不可用时仍提供默认配置，避免 Firefox 设置页因初始化 rejection 反复重载。
        console.error('[FluentRead] 配置读取失败，使用默认配置', error);
        const fallback = new Config();
        const serialized = serializeConfig(fallback);
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

export function getConfigSnapshot(): Config {
    return normalizeConfig(config);
}

/**
 * 网页/content 发来的保存请求只能修改公开配置；凭据与持久化偏好必须由
 * popup/options 等扩展 origin 明确更新，避免无凭据的 content 快照清空后台 session。
 */
export function prepareConfigSaveRequest(
    value: unknown,
    currentValue: unknown = config,
    allowCredentialUpdates = false,
): Config {
    if (allowCredentialUpdates) return normalizeConfig(value);

    const currentConfig = normalizeConfig(currentValue);
    const targetConfig = normalizeConfig({
        ...sanitizeConfigCredentials(normalizeConfig(value)),
        persistCredentials: currentConfig.persistCredentials,
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
            await flushHistorySnapshot(toPublicConfig(normalized));
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
    const currentCredentials = extractConfigCredentials(config);
    const targetConfig = normalizeConfig({
        ...target.config,
        // 凭据持久化是显式安全选择，不随普通配置历史静默回滚。
        persistCredentials: config.persistCredentials,
    });
    const safeCredentials = filterConfigCredentialsForDestination(
        currentCredentials,
        config,
        targetConfig,
    );
    const normalized = normalizeConfig(mergeConfigCredentials(targetConfig, safeCredentials));
    await persistNormalizedConfig(normalized);
    if (serializeConfig(config) !== serializeConfig(normalized)) applyConfig(normalized);

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
            console.warn('[FluentRead] 后台配置历史操作失败，已回退到当前上下文', error);
        }
        return history;
    }
}
