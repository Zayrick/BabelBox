import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import {normalizeConfig} from '@/src/core/config/model';
import {sanitizeConfigCredentials} from '@/src/core/config/credentials';

const storageMock = vi.hoisted(() => ({
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    watch: vi.fn(),
}));

vi.mock('@wxt-dev/storage', () => ({ storage: storageMock }));

const storedConfig = {
    on: true,
    service: 'openai',
    from: 'auto',
    to: 'zh-Hans',
};

const storageState = new Map<string, unknown>();
const storageOperations: string[] = [];

interface LoadConfigOptions {
    trusted?: boolean;
    history?: unknown;
    sessionCredentials?: unknown;
    localCredentials?: unknown;
    failSessionWrite?: boolean;
}

async function loadConfigModule(value: unknown = null, options: LoadConfigOptions = {}) {
    vi.resetModules();
    storageState.clear();
    storageOperations.length = 0;
    if (value !== null) storageState.set('local:config', value);
    if (options.history !== undefined) storageState.set('local:configHistory', options.history);
    if (options.sessionCredentials !== undefined) storageState.set('session:credentials', options.sessionCredentials);
    if (options.localCredentials !== undefined) storageState.set('local:credentials', options.localCredentials);
    Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: {protocol: options.trusted === false ? 'https:' : 'chrome-extension:'},
    });
    storageMock.getItem.mockReset().mockImplementation(async (key: string) => {
        storageOperations.push(`get:${key}`);
        return storageState.get(key) ?? null;
    });
    storageMock.setItem.mockReset().mockImplementation(async (key: string, nextValue: unknown) => {
        storageOperations.push(`set:${key}`);
        if (options.failSessionWrite && key === 'session:credentials') {
            throw new Error('storage.session unavailable');
        }
        storageState.set(key, structuredClone(nextValue));
    });
    storageMock.removeItem.mockReset().mockImplementation(async (key: string) => {
        storageOperations.push(`remove:${key}`);
        storageState.delete(key);
    });
    storageMock.watch.mockReset().mockReturnValue(() => undefined);
    return import('@/src/services/config/store');
}

describe('统一配置存储', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('兼容旧 JSON 字符串，并只迁移成一次对象存储', async () => {
        const configStore = await loadConfigModule(JSON.stringify(storedConfig));

        await configStore.configReady;

        expect(storageMock.setItem).toHaveBeenCalledTimes(1);
        expect(storageMock.setItem).toHaveBeenCalledWith(
            'local:config',
            expect.objectContaining(storedConfig),
        );
        expect(typeof storageMock.setItem.mock.calls[0][1]).toBe('object');
    });

    it('读取已经去凭据且带版本的规范化对象时不产生初始化回写', async () => {
        const canonicalConfig = {
            ...sanitizeConfigCredentials(normalizeConfig(storedConfig)),
            __fluentConfigRevision: 5,
        };
        const configStore = await loadConfigModule(canonicalConfig);

        await configStore.configReady;

        expect(storageMock.setItem).not.toHaveBeenCalled();
        expect(configStore.config).toMatchObject(storedConfig);
    });

    it('为旧配置补齐空的始终翻译域名列表，并只迁移回写一次', async () => {
        const legacyConfig = normalizeConfig(storedConfig) as unknown as Record<string, unknown>;
        delete legacyConfig.alwaysTranslateDomains;
        delete legacyConfig.disabledExtensionDomains;
        const configStore = await loadConfigModule(legacyConfig);

        await configStore.configReady;

        expect(configStore.config.alwaysTranslateDomains).toEqual([]);
        expect(configStore.config.disabledExtensionDomains).toEqual([]);
        const localConfigWrites = storageMock.setItem.mock.calls.filter(([key]) => key === 'local:config');
        expect(localConfigWrites).toHaveLength(1);
        expect(localConfigWrites[0][1]).toEqual(expect.objectContaining({alwaysTranslateDomains: []}));
        expect(localConfigWrites[0][1]).toEqual(expect.objectContaining({disabledExtensionDomains: []}));
    });

    it('内部 storage revision 不进入运行时配置或历史快照', async () => {
        const configStore = await loadConfigModule({...storedConfig, __fluentConfigRevision: 5});
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);

        expect((configStore.config as unknown as Record<string, unknown>).__fluentConfigRevision).toBeUndefined();
        await configStore.saveConfig({ ...configStore.config, to: 'en' }, {recordHistory: true, immediateHistory: true});

        const history = configStore.getConfigHistorySnapshot();
        expect(history.entries).toHaveLength(2);
        expect((history.entries[0].config as unknown as Record<string, unknown>).__fluentConfigRevision).toBeUndefined();
        expect((history.entries[1].config as unknown as Record<string, unknown>).__fluentConfigRevision).toBeUndefined();
    });

    it('为旧配置补齐默认关闭的视频字幕 Beta、独立微软翻译服务和默认字号', async () => {
        const configStore = await loadConfigModule(storedConfig);

        await configStore.configReady;

        expect(configStore.config.videoTranslationEnabled).toBe(false);
        expect(configStore.config.videoService).toBe('microsoft');
        expect(configStore.config.videoSubtitleVisible).toBe(true);
        expect(configStore.config.videoSubtitleDisplayMode).toBe('bilingual');
        expect(configStore.config.videoSubtitleFontSize).toBe(100);
        expect(configStore.config.fullPageTranslationMode).toBe('viewport');
    });

    it('为文档翻译补齐独立服务和模型，并保留网页模型选择', async () => {
        const configStore = await loadConfigModule({
            ...storedConfig,
            service: 'openai',
            model: {openai: 'web-model'},
            documentService: 'openai',
            documentModel: {openai: 'document-model'},
        });

        await configStore.configReady;

        expect(configStore.config.documentService).toBe('openai');
        expect(configStore.config.documentModel.openai).toBe('document-model');
        expect(configStore.config.model.openai).toBe('web-model');
    });

    it('文档翻译遇到未知服务时回退到免费翻译服务', async () => {
        const configStore = await loadConfigModule({...storedConfig, documentService: 'unknown-service'});

        await configStore.configReady;

        expect(configStore.config.documentService).toBe('freeTranslation');
    });

    it('保留用户选择的视频 AI 服务，并将未知服务回退到微软翻译', async () => {
        const aiConfigStore = await loadConfigModule({ ...storedConfig, videoService: 'openai' });

        await aiConfigStore.configReady;

        expect(aiConfigStore.config.videoService).toBe('openai');

        const invalidConfigStore = await loadConfigModule({ ...storedConfig, videoService: 'not-a-service' });

        await invalidConfigStore.configReady;

        expect(invalidConfigStore.config.videoService).toBe('microsoft');
    });

    it('把早期 Beta 写入的 DeepLX 默认值一次迁移为微软翻译', async () => {
        const configStore = await loadConfigModule({ ...storedConfig, videoService: 'deeplx' });

        await configStore.configReady;

        expect(configStore.config.videoService).toBe('microsoft');
        expect(configStore.config.videoServiceDefaultMigrated).toBe(true);
        expect(storageMock.setItem).toHaveBeenCalledWith(
            'local:config',
            expect.objectContaining({ videoService: 'microsoft', videoServiceDefaultMigrated: true }),
        );
    });

    it('非法的视频字幕显示配置回退到双语和显示状态', async () => {
        const configStore = await loadConfigModule({
            ...storedConfig,
            videoSubtitleVisible: 'yes',
            videoSubtitleDisplayMode: 'side-by-side',
            videoSubtitleFontSize: 'huge',
        });

        await configStore.configReady;

        expect(configStore.config.videoSubtitleVisible).toBe(true);
        expect(configStore.config.videoSubtitleDisplayMode).toBe('bilingual');
        expect(configStore.config.videoSubtitleFontSize).toBe(100);
    });

    it('存储内容损坏时回退到默认配置，并保持初始化 Promise 可用', async () => {
        const configStore = await loadConfigModule('{not-json');

        await expect(configStore.configReady).resolves.toBeUndefined();

        expect(configStore.config.on).toBe(true);
        expect(storageMock.setItem).toHaveBeenCalledWith(
            'local:config',
            expect.objectContaining({ on: true }),
        );
    });

    it('保存相同快照时去重，并让连续保存只保留最新快照', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        storageMock.setItem.mockClear();

        const firstSave = configStore.saveConfig({ ...configStore.config, on: false });
        const latestSave = configStore.saveConfig({ ...configStore.config, on: true, to: 'en' });
        await Promise.all([firstSave, latestSave]);

        expect(storageMock.setItem).toHaveBeenCalledTimes(2);
        expect(storageMock.setItem).toHaveBeenLastCalledWith(
            'local:config',
            expect.objectContaining({ on: true, to: 'en' }),
        );

        storageMock.setItem.mockClear();
        await configStore.saveConfig({ ...configStore.config, on: true, to: 'en' });
        expect(storageMock.setItem).not.toHaveBeenCalled();
    });

    it('收到外部对象更新时立即同步运行时状态，并通知订阅者', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        const listener = vi.fn();
        const unsubscribe = configStore.subscribeConfig(listener);
        const watchCallback = storageMock.watch.mock.calls[0][1];

        watchCallback({ ...storedConfig, on: false }, storedConfig);

        expect(configStore.config.on).toBe(false);
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({ on: false }));
        unsubscribe();
    });

    it('外部更新不会被本地 watcher 再次写回，取消订阅后也不再通知', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        const listener = vi.fn();
        const unsubscribe = configStore.subscribeConfig(listener);
        const watchCallback = storageMock.watch.mock.calls[0][1];
        listener.mockClear();
        storageMock.setItem.mockClear();

        watchCallback({ ...storedConfig, on: false }, storedConfig);
        unsubscribe();
        watchCallback({ ...storedConfig, on: true }, { ...storedConfig, on: false });

        expect(storageMock.setItem).not.toHaveBeenCalled();
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('短生命周期页面通过后台提交规范化快照，而不是自行承担落盘', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        storageMock.setItem.mockClear();
        const sendMessage = vi.fn().mockResolvedValue({ success: true });

        await configStore.requestConfigSave({ ...configStore.config, to: 'en' }, sendMessage);

        expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
            type: configStore.CONFIG_PERSIST_MESSAGE,
            config: expect.objectContaining({ to: 'en' }),
        }));
        expect(storageMock.setItem).not.toHaveBeenCalled();
    });

    it('发送响应式配置时先转换为 Firefox 可结构化克隆的纯对象', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        const sendMessage = vi.fn().mockResolvedValue({ success: true });
        const reactiveConfig = reactive({
            ...configStore.config,
            to: 'ja',
            model: reactive({ openai: 'gpt-4o-mini' }),
        });

        await configStore.requestConfigSave(reactiveConfig, sendMessage);

        const sentConfig = sendMessage.mock.calls[0][0].config;
        expect(() => structuredClone(sentConfig)).not.toThrow();
        expect(sentConfig).toMatchObject({ to: 'ja', model: { openai: 'gpt-4o-mini' } });
    });

    it('后台不可用时失败关闭，不在短生命周期上下文降级落盘', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        storageMock.setItem.mockClear();
        const sendMessage = vi.fn().mockRejectedValue(new Error('Receiving end does not exist'));

        await expect(configStore.requestConfigSave({ ...configStore.config, to: 'ja' }, sendMessage))
            .rejects.toThrow('Receiving end does not exist');
        expect(storageMock.setItem).not.toHaveBeenCalled();
    });

    it('content 保存公开字段时保留后台运行时凭据与持久化偏好', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        const current = normalizeConfig({
            ...configStore.config,
            token: {openai: 'background-session-secret'},
            extra: {zhipu: {jwt: 'derived-secret'}},
            persistCredentials: true,
        });
        const contentSnapshot = normalizeConfig({...current, to: 'ja', token: {}, extra: {}, persistCredentials: false});

        const prepared = configStore.prepareConfigSaveRequest(contentSnapshot, current, false);
        const extensionPrepared = configStore.prepareConfigSaveRequest(contentSnapshot, current, true);

        expect(prepared).toMatchObject({
            to: 'ja',
            token: {openai: 'background-session-secret'},
            extra: {zhipu: {jwt: 'derived-secret'}},
            persistCredentials: true,
        });
        expect(extensionPrepared.token).toEqual({});
        expect(extensionPrepared.extra).toEqual({});
        expect(extensionPrepared.persistCredentials).toBe(false);
    });

    it('按 session 写入读回、清理 config/history、最后删除 local 的顺序迁移旧凭据', async () => {
        const secret = 'legacy-secret-sentinel';
        const legacyConfig = {
            ...storedConfig,
            token: {openai: secret},
            ak: `${secret}-ak`,
            extra: {jwt: `${secret}-jwt`},
        };
        const legacyHistory = {
            schemaVersion: 1,
            entries: [{version: 1, savedAt: new Date(0).toISOString(), config: legacyConfig}],
            cursor: 0,
            nextVersion: 2,
        };
        const configStore = await loadConfigModule(legacyConfig, {history: legacyHistory});

        await configStore.configReady;

        const setSession = storageOperations.indexOf('set:session:credentials');
        const verifySession = storageOperations.indexOf('get:session:credentials', setSession + 1);
        const setConfig = storageOperations.indexOf('set:local:config');
        const setHistory = storageOperations.indexOf('set:local:configHistory');
        const removeLocal = storageOperations.indexOf('remove:local:credentials');
        expect(setSession).toBeGreaterThan(-1);
        expect(verifySession).toBeGreaterThan(setSession);
        expect(setConfig).toBeGreaterThan(verifySession);
        expect(setHistory).toBeGreaterThan(setConfig);
        expect(removeLocal).toBeGreaterThan(setHistory);
        expect(storageState.get('session:credentials')).toMatchObject({token: {openai: secret}});
        expect(JSON.stringify(storageState.get('local:config'))).not.toContain(secret);
        expect(JSON.stringify(storageState.get('local:configHistory'))).not.toContain(secret);
    });

    it('损坏的旧历史字符串可能包含凭据时直接丢弃，不能把敏感片段原样写回', async () => {
        const secret = 'malformed-history-secret-sentinel';
        const legacyConfig = {...storedConfig, token: {openai: secret}};
        const malformedHistory = `{"entries":[{"config":{"token":{"openai":"${secret}"}}}`;
        const configStore = await loadConfigModule(legacyConfig, {history: malformedHistory});

        await configStore.configReady;

        expect(storageState.has('local:configHistory')).toBe(false);
        expect(JSON.stringify([...storageState.values()])).not.toContain(malformedHistory);
        expect(storageState.get('session:credentials')).toMatchObject({token: {openai: secret}});
    });

    it('默认只把新凭据保存到 session，local config 与历史不含敏感 sentinel', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);
        const secret = 'session-only-secret-sentinel';

        await configStore.saveConfig({
            ...configStore.config,
            token: {openai: secret},
            to: 'en',
        }, {recordHistory: true, immediateHistory: true});

        expect(storageState.get('session:credentials')).toMatchObject({token: {openai: secret}});
        expect(storageState.has('local:credentials')).toBe(false);
        expect(JSON.stringify(storageState.get('local:config'))).not.toContain(secret);
        expect(JSON.stringify(storageState.get('local:configHistory'))).not.toContain(secret);
        const persistedConfig = storageState.get('local:config') as Record<string, unknown>;
        expect(persistedConfig.token).toBeUndefined();
        expect(persistedConfig.extra).toBeUndefined();

        await configStore.saveConfig({...configStore.config, token: {}, to: 'ja'});
        expect(storageState.get('session:credentials')).toMatchObject({token: {}});
    });

    it('只有明确 opt-in 才写 local:credentials，关闭时先校验 session 再删除', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        const secret = 'opt-in-secret-sentinel';

        await configStore.saveConfig({
            ...configStore.config,
            token: {openai: secret},
            persistCredentials: true,
        });
        expect(storageState.get('local:credentials')).toMatchObject({token: {openai: secret}});
        expect(JSON.stringify(storageState.get('local:config'))).not.toContain(secret);

        storageOperations.length = 0;
        await configStore.saveConfig({...configStore.config, persistCredentials: false});
        const setSession = storageOperations.indexOf('set:session:credentials');
        const verifySession = storageOperations.indexOf('get:session:credentials', setSession + 1);
        const removeLocal = storageOperations.indexOf('remove:local:credentials');
        expect(setSession).toBeGreaterThan(-1);
        expect(verifySession).toBeGreaterThan(setSession);
        expect(removeLocal).toBeGreaterThan(verifySession);
        expect(storageState.has('local:credentials')).toBe(false);
    });

    it('恢复历史只恢复公开字段，并保留当前凭据和显式持久化选择', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);
        await configStore.saveConfig({...configStore.config, to: 'en'}, {recordHistory: true, immediateHistory: true});
        const baselineVersion = configStore.getConfigHistorySnapshot().entries[0].version;
        const secret = 'restore-secret-sentinel';
        await configStore.saveConfig({
            ...configStore.config,
            token: {openai: secret},
            persistCredentials: true,
            to: 'ja',
        }, {recordHistory: true, immediateHistory: true});

        await configStore.applyConfigHistoryAction('restore', baselineVersion);

        expect(configStore.config.to).toBe('zh-Hans');
        expect(configStore.config.token.openai).toBe(secret);
        expect(configStore.config.persistCredentials).toBe(true);
        expect(JSON.stringify(configStore.getConfigHistorySnapshot())).not.toContain(secret);
    });

    it('session 写入或读回失败时不删除或改写旧明文', async () => {
        const secret = 'must-not-delete-secret';
        const legacyConfig = {...storedConfig, token: {openai: secret}};
        const configStore = await loadConfigModule(legacyConfig, {failSessionWrite: true});

        await expect(configStore.configReady).resolves.toBeUndefined();

        expect(configStore.config.token.openai).toBe(secret);
        expect(storageMock.removeItem).not.toHaveBeenCalled();
        expect(storageMock.setItem).not.toHaveBeenCalledWith('local:config', expect.anything());
        expect(storageState.get('local:config')).toEqual(legacyConfig);
    });

    it('网页/content 上下文不访问 session，也不执行危险迁移', async () => {
        const secret = 'content-context-secret';
        const legacyConfig = {...storedConfig, token: {openai: secret}};
        const configStore = await loadConfigModule(legacyConfig, {trusted: false});

        await configStore.configReady;

        expect(configStore.config.token).toEqual({});
        expect(storageOperations.some((operation) => operation.includes('session:credentials'))).toBe(false);
        expect(storageMock.setItem).not.toHaveBeenCalled();
        expect(storageMock.removeItem).not.toHaveBeenCalled();
        expect(storageState.get('local:config')).toEqual(legacyConfig);
    });

    it('连续请求按页面顺序发送，避免旧快照覆盖最新快照', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        const sent: string[] = [];
        let releaseFirst!: () => void;
        const firstFinished = new Promise<void>((resolve) => { releaseFirst = resolve; });
        const sendMessage = vi.fn(async ({ config }: { config: { to: string } }) => {
            sent.push(config.to);
            if (sent.length === 1) await firstFinished;
            return { success: true };
        });

        const first = configStore.requestConfigSave({ ...configStore.config, to: 'en' }, sendMessage);
        const latest = configStore.requestConfigSave({ ...configStore.config, to: 'ja' }, sendMessage);
        await vi.waitFor(() => expect(sent).toEqual(['en', 'ja']));
        releaseFirst();
        await Promise.all([first, latest]);

        expect(sent).toEqual(['en', 'ja']);
    });

    it('本地存在更新请求时忽略旧 storage 回声', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        let release!: () => void;
        const pending = new Promise<void>((resolve) => { release = resolve; });
        const sendMessage = vi.fn(async () => {
            await pending;
            return { success: true };
        });
        const latest = { ...configStore.config, to: 'ja' };
        const request = configStore.requestConfigSave(latest, sendMessage);
        const listener = vi.fn();
        const unsubscribe = configStore.subscribeConfig(listener);
        listener.mockClear();
        const watchCallback = storageMock.watch.mock.calls[0][1];

        watchCallback({ ...storedConfig, to: 'en' }, storedConfig);

        expect(configStore.config.to).toBe('zh-Hans');
        expect(listener).not.toHaveBeenCalled();
        release();
        await request;
        unsubscribe();
    });

    it('迟到的旧版本 storage 快照不会回滚已同步的新版本', async () => {
        const configStore = await loadConfigModule({ ...storedConfig, __fluentConfigRevision: 5 });
        await configStore.configReady;
        const watchCallback = storageMock.watch.mock.calls[0][1];

        watchCallback({ ...storedConfig, to: 'ja', __fluentConfigRevision: 7 }, storedConfig);
        watchCallback({ ...storedConfig, to: 'en', __fluentConfigRevision: 6 }, storedConfig);

        expect(configStore.config.to).toBe('ja');
    });

    it('记录配置版本、时间，并限制为最近五条快照', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);

        for (const to of ['en', 'ja', 'ko', 'fr', 'ru', 'de']) {
            await configStore.saveConfig({ ...configStore.config, to }, {recordHistory: true, immediateHistory: true});
        }

        const history = configStore.getConfigHistorySnapshot();
        expect(history.entries).toHaveLength(5);
        expect(history.cursor).toBe(4);
        expect(history.entries.at(-1)).toMatchObject({
            version: expect.any(Number),
            savedAt: expect.any(String),
            config: expect.objectContaining({to: 'de'}),
        });
        expect(history.entries.map((entry) => entry.version)).toEqual(
            [...history.entries].sort((left, right) => left.version - right.version).map((entry) => entry.version),
        );
    });

    it('支持撤销、重做和按版本恢复，并保持配置与历史游标一致', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);
        await configStore.saveConfig({ ...configStore.config, to: 'en' }, {recordHistory: true, immediateHistory: true});
        await configStore.saveConfig({ ...configStore.config, to: 'ja' }, {recordHistory: true, immediateHistory: true});

        const beforeUndo = configStore.getConfigHistorySnapshot();
        const undo = await configStore.applyConfigHistoryAction('undo');
        expect(configStore.config.to).toBe('en');
        expect(undo.cursor).toBe(beforeUndo.cursor - 1);

        const redo = await configStore.applyConfigHistoryAction('redo');
        expect(configStore.config.to).toBe('ja');
        expect(redo.cursor).toBe(beforeUndo.cursor);

        const baselineVersion = beforeUndo.entries[0].version;
        const restored = await configStore.applyConfigHistoryAction('restore', baselineVersion);
        expect(configStore.config.to).toBe('zh-Hans');
        expect(restored.entries[restored.cursor].version).toBe(baselineVersion);
    });

    it('在配置历史中保存规范化域名，并能恢复旧配置的空名单', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);

        await configStore.saveConfig({
            ...configStore.config,
            alwaysTranslateDomains: [
                'https://news.bbc.co.uk/world',
                'BBC.CO.UK',
                'https://docs.team.github.io/guide',
            ],
        }, {recordHistory: true, immediateHistory: true});

        expect(configStore.config.alwaysTranslateDomains).toEqual(['bbc.co.uk', 'team.github.io']);
        expect(configStore.getConfigHistorySnapshot().entries.at(-1)?.config.alwaysTranslateDomains)
            .toEqual(['bbc.co.uk', 'team.github.io']);

        await configStore.applyConfigHistoryAction('undo');
        expect(configStore.config.alwaysTranslateDomains).toEqual([]);
    });

    it('配置历史操作优先通过后台消息传递，后台不可用时安全回退', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);
        const sendMessage = vi.fn().mockResolvedValue({success: true, history: configStore.getConfigHistorySnapshot()});

        await configStore.requestConfigHistoryAction('undo', undefined, sendMessage);

        expect(sendMessage).toHaveBeenCalledWith({
            type: configStore.CONFIG_HISTORY_MESSAGE,
            action: 'undo',
            version: undefined,
        });
    });

    it('快速连续编辑只保留最后一个防抖历史快照', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);

        await configStore.saveConfig({ ...configStore.config, to: 'en' }, {recordHistory: true});
        await configStore.saveConfig({ ...configStore.config, to: 'ja' }, {recordHistory: true});
        await configStore.flushConfigHistory();

        const history = configStore.getConfigHistorySnapshot();
        expect(history.entries).toHaveLength(2);
        expect(history.entries.at(-1)?.config.to).toBe('ja');
    });

    it('两个立即历史写入重叠时串行提交，不能丢失较新的快照或复用版本号', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);
        let releaseFirstHistoryWrite!: () => void;
        const firstHistoryWriteBlocked = new Promise<void>((resolve) => {
            releaseFirstHistoryWrite = resolve;
        });
        let historyWriteCount = 0;
        storageMock.setItem.mockImplementation(async (key: string, nextValue: unknown) => {
            storageOperations.push(`set:${key}`);
            if (key === 'local:configHistory' && historyWriteCount++ === 0) {
                await firstHistoryWriteBlocked;
            }
            storageState.set(key, structuredClone(nextValue));
        });

        const first = configStore.saveConfig(
            {...configStore.config, to: 'en'},
            {recordHistory: true, immediateHistory: true},
        );
        await vi.waitFor(() => expect(historyWriteCount).toBe(1));
        const second = configStore.saveConfig(
            {...configStore.config, to: 'ja'},
            {recordHistory: true, immediateHistory: true},
        );
        releaseFirstHistoryWrite();
        await Promise.all([first, second]);

        const history = configStore.getConfigHistorySnapshot();
        expect(history.entries.map((entry) => entry.config.to)).toEqual(['zh-Hans', 'en', 'ja']);
        expect(new Set(history.entries.map((entry) => entry.version)).size).toBe(history.entries.length);
        expect(storageState.get('local:configHistory')).toEqual(history);
    });

    it('配置历史 storage 外部更新会通知订阅者并保留版本结构', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);
        const listener = vi.fn();
        const unsubscribe = configStore.subscribeConfigHistory(listener);
        listener.mockClear();

        const current = configStore.getConfigHistorySnapshot();
        const external = {
            ...current,
            entries: [
                ...current.entries,
                {
                    version: current.nextVersion,
                    savedAt: new Date().toISOString(),
                    config: {...storedConfig, to: 'en'},
                },
            ],
            cursor: current.entries.length,
            nextVersion: current.nextVersion + 1,
        };
        const historyWatchCallback = storageMock.watch.mock.calls[1][1];
        historyWatchCallback(external);

        expect(listener).toHaveBeenCalledWith(expect.objectContaining({
            entries: expect.arrayContaining([expect.objectContaining({config: expect.objectContaining({to: 'en'})})]),
        }));
        expect(configStore.getConfigHistorySnapshot().entries.at(-1)?.config.to).toBe('en');
        unsubscribe();
    });

    it('配置历史后台操作失败时回退到本地，并实际保存目标配置', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);
        await configStore.saveConfig({ ...configStore.config, to: 'en' }, {recordHistory: true, immediateHistory: true});
        await configStore.saveConfig({ ...configStore.config, to: 'ja' }, {recordHistory: true, immediateHistory: true});
        storageMock.setItem.mockClear();

        const sendMessage = vi.fn().mockRejectedValue(new Error('Receiving end does not exist'));
        await configStore.requestConfigHistoryAction('undo', undefined, sendMessage);

        expect(configStore.config.to).toBe('en');
        expect(storageMock.setItem).toHaveBeenCalledWith(
            'local:config',
            expect.objectContaining({to: 'en'}),
        );
        expect(storageMock.setItem).toHaveBeenCalledWith(
            'local:configHistory',
            expect.objectContaining({cursor: 1}),
        );
    });
});
