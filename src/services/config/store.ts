import { storage } from '@wxt-dev/storage';
import { Config, normalizeConfig } from '@/src/core/config/model';
import {
    CONFIG_HISTORY_LIMIT,
    appendConfigHistorySnapshot,
    cloneConfigHistory,
    createBaselineConfigHistory,
    parseConfigHistory,
    resolveConfigHistoryTargetIndex,
    serializeConfigHistory,
    toRestorableConfig,
    restoreRestorableConfig,
    type ConfigHistoryAction,
    type ConfigHistoryState,
    type RestorableConfig,
} from './history';
import {
    parseStoredConfig,
    serializeConfig,
} from './schema';
import {
    CONFIG_COUNT_INCREMENT_MESSAGE,
    parseConfigCountIncrement,
} from './count';

export {CONFIG_HISTORY_LIMIT, parseStoredConfig, serializeConfig};
export type {ConfigHistoryAction, ConfigHistoryEntry, ConfigHistoryState} from './history';

/** 完整配置（含 API 凭据）只保存在这一个键里。 */
export const CONFIG_STORAGE_KEY = 'local:config' as const;
export const CONFIG_HISTORY_STORAGE_KEY = 'local:configHistory' as const;
export const CONFIG_PERSIST_MESSAGE = 'persistConfig' as const;
export const CONFIG_HISTORY_MESSAGE = 'configHistoryAction' as const;
const CONFIG_HISTORY_DEBOUNCE_MS = 350;

export type ConfigPatch = Partial<Config>;
type ConfigListener = (nextConfig: Config) => void;
type ConfigHistoryListener = (nextHistory: ConfigHistoryState) => void;

const listeners = new Set<ConfigListener>();
const historyListeners = new Set<ConfigHistoryListener>();
let initialized = false;
let historyState: ConfigHistoryState;
let historyInitialized = false;
let historyLastSerialized = '';
let historyPendingSerialized = '';
let historyWriteRevision = 0;
let historyWriteQueue: Promise<void> = Promise.resolve();
let pendingHistorySnapshot: RestorableConfig | null = null;
let pendingHistoryTimer: ReturnType<typeof setTimeout> | undefined;
let historyFlushPromise: Promise<void> | null = null;

// 所有运行时模块共享同一个可变配置对象；调用方可以直接修改它再请求保存。
export const config = new Config();
// 本上下文最后确认的存储状态。保存时与它比较得到改动字段，因此不受调用方原地修改 config 的影响。
let knownConfig = new Config();

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
            setHistoryState(createBaselineConfigHistory(config), false);
        }
    } catch (error) {
        historyInitialized = true;
        setHistoryState(createBaselineConfigHistory(config), false);
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
    knownConfig = normalizeConfig(nextConfig);
    Object.assign(config, normalizeConfig(nextConfig));
    notifyListeners(config);
}

/** 返回 next 相对 base 发生变化的顶层字段；没有变化时返回 null。 */
export function diffConfig(next: unknown, base: unknown): ConfigPatch | null {
    const nextConfig = normalizeConfig(next) as unknown as Record<string, unknown>;
    const baseConfig = normalizeConfig(base) as unknown as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(nextConfig)) {
        if (serializeConfig(value) !== serializeConfig(baseConfig[key])) patch[key] = value;
    }
    return Object.keys(patch).length ? patch as ConfigPatch : null;
}

// 本上下文有写入未完成时，storage 回声可能是更早的快照；先记下，写入全部结束后再读一次真值。
let pendingWrites = 0;
let storageChangedWhilePending = false;

function applyStoredConfig(value: unknown): void {
    const parsed = parseStoredConfig(value);
    const next = parsed ? normalizeConfig(parsed) : new Config();
    if (initialized && serializeConfig(next) === serializeConfig(knownConfig)) return;
    initialized = true;
    applyConfig(next);
}

async function syncFromStorage(): Promise<void> {
    applyStoredConfig(await storage.getItem<unknown>(CONFIG_STORAGE_KEY));
}

async function trackWrite<T>(task: () => Promise<T>): Promise<T> {
    pendingWrites += 1;
    try {
        return await task();
    } finally {
        pendingWrites -= 1;
        if (pendingWrites === 0 && storageChangedWhilePending) {
            storageChangedWhilePending = false;
            await syncFromStorage().catch((error) => console.warn('[BabelBox] 配置同步失败', error));
        }
    }
}

storage.watch(CONFIG_STORAGE_KEY, (value) => {
    if (pendingWrites > 0) {
        storageChangedWhilePending = true;
        return;
    }
    applyStoredConfig(value);
});
storage.watch(CONFIG_HISTORY_STORAGE_KEY, handleStoredHistoryChange);

async function initializeConfig(): Promise<void> {
    try {
        await trackWrite(syncFromStorage);
    } catch (error) {
        // 存储暂时不可用时仍提供默认配置，避免 Firefox 设置页因初始化 rejection 反复重载。
        console.error('[BabelBox] 配置读取失败，使用默认配置', error);
        if (!initialized) applyStoredConfig(null);
    }
}

export const configReady = initializeConfig();
export const configHistoryReady = initializeConfigHistory();

export function subscribeConfig(listener: ConfigListener): () => void {
    listeners.add(listener);
    if (initialized) listener(normalizeConfig(config));
    return () => listeners.delete(listener);
}

export interface SaveConfigOptions {
    recordHistory?: boolean;
    immediateHistory?: boolean;
}

type ConfigPatchSource = ConfigPatch | ((current: Config) => ConfigPatch | null);
let writeQueue: Promise<unknown> = Promise.resolve();

/**
 * 配置唯一写入口：串行地读取存储中的最新配置、合并改动字段并整体写回。
 * 合并基于存储真值而非本上下文缓存，其他页面刚保存的字段不会被覆盖。
 */
export function persistConfigPatch(
    source: ConfigPatchSource | null,
    options: SaveConfigOptions = {},
): Promise<Config> {
    const task = writeQueue.catch(() => undefined).then(() => trackWrite(async () => {
        await configReady;
        const stored = parseStoredConfig(await storage.getItem<unknown>(CONFIG_STORAGE_KEY));
        const current = stored ? normalizeConfig(stored) : normalizeConfig(knownConfig);
        const patch = typeof source === 'function' ? source(current) : source;
        const next = normalizeConfig({...current, ...patch});
        if (patch && (!stored || serializeConfig(next) !== serializeConfig(current))) {
            await storage.setItem(CONFIG_STORAGE_KEY, next);
        }
        if (serializeConfig(next) !== serializeConfig(knownConfig)) applyConfig(next);
        return next;
    }));
    writeQueue = task;
    return task.then(async (next) => {
        if (options.recordHistory) {
            if (options.immediateHistory) {
                await flushConfigHistory();
                await flushHistorySnapshot(toRestorableConfig(next));
            } else {
                scheduleHistorySnapshot(next);
            }
        }
        return next;
    });
}

/** 保存一份完整配置中相对当前已知状态改变的字段。 */
export async function saveConfig(value: unknown = config, options: SaveConfigOptions = {}): Promise<void> {
    await configReady;
    await persistConfigPatch(diffConfig(value, knownConfig), options);
}

/** 翻译计数只做原子增量，不提交可能过期的整份页面配置。 */
export async function incrementConfigCount(delta: number): Promise<number> {
    const normalizedDelta = parseConfigCountIncrement(delta);
    if (normalizedDelta === null) throw new TypeError('无效的翻译计数增量');
    const next = await persistConfigPatch((current) => ({count: current.count + normalizedDelta}));
    return next.count;
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

type ConfigMessageResponse = { success?: boolean; error?: string } | undefined;
type ConfigMessageSender = (message: {
    type: typeof CONFIG_PERSIST_MESSAGE;
    patch: ConfigPatch;
}) => Promise<ConfigMessageResponse>;

/**
 * 页面请求保存配置：只把相对已知存储状态改变的字段交给后台合并。
 * Firefox 可能在 popup 关闭时销毁页面上下文，因此写入由后台完成。
 * 返回值表示是否确实提交了改动。
 */
export async function requestConfigSave(value: unknown = config, sendMessage?: ConfigMessageSender): Promise<boolean> {
    await configReady;
    const patch = diffConfig(value, knownConfig);
    if (!patch) return false;
    if (!sendMessage) {
        await persistConfigPatch(patch, {recordHistory: true, immediateHistory: true});
        return true;
    }

    return trackWrite(async () => {
        // 先在本上下文生效，连续编辑时下一次比较才不会重复提交同一字段。
        applyConfig(normalizeConfig({...knownConfig, ...patch}));
        try {
            const response = await sendMessage({type: CONFIG_PERSIST_MESSAGE, patch});
            if (response?.success !== true) throw new Error(response?.error || '后台没有确认配置保存');
        } catch (error) {
            storageChangedWhilePending = true;
            throw error;
        }
        return true;
    });
}

export function getConfigHistorySnapshot(): ConfigHistoryState {
    return cloneConfigHistory(
        historyState || createBaselineConfigHistory(config),
    );
}

export function subscribeConfigHistory(listener: ConfigHistoryListener): () => void {
    historyListeners.add(listener);
    if (historyInitialized && historyState) listener(cloneConfigHistory(historyState));
    return () => historyListeners.delete(listener);
}

export async function applyConfigHistoryAction(action: ConfigHistoryAction, version?: number): Promise<ConfigHistoryState> {
    await configHistoryReady;
    await flushConfigHistory();

    const targetIndex = resolveConfigHistoryTargetIndex(historyState, action, version);

    if (targetIndex === historyState.cursor) return getConfigHistorySnapshot();
    const target = historyState.entries[targetIndex];
    const normalized = restoreRestorableConfig(target.config, knownConfig);
    await persistConfigPatch(diffConfig(normalized, knownConfig));

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
