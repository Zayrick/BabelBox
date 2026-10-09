import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import {services} from '@/src/core/config/catalog';
import {normalizeConfig, type TranslationServiceCredential} from '@/src/core/config/model';
import {sanitizeConfigCredentials} from '@/src/core/config/credentials';
import {
    createDefaultTranslationServices,
    createExternalTranslationService,
    type TranslationServiceInstance,
} from '@/src/core/config/translationServices';

const storageMock = vi.hoisted(() => ({
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    watch: vi.fn(),
}));

vi.mock('@wxt-dev/storage', () => ({ storage: storageMock }));

const storedConfig = {
    service: 'microsoft',
    from: 'auto',
    to: 'zh-Hans',
};

const storageState = new Map<string, unknown>();
const storageOperations: string[] = [];

function serviceCredential(secret: string): TranslationServiceCredential {
    return {
        apiKey: secret,
        appKey: secret,
        appSecret: secret,
        secretId: secret,
        secretKey: secret,
    };
}

const AI_ID = 'service:openai:test';

function aiInstance(overrides: Partial<TranslationServiceInstance> = {}): TranslationServiceInstance {
    return {...createExternalTranslationService(services.openai), id: AI_ID, ...overrides};
}

function withCredential(secret: string, overrides: Partial<TranslationServiceInstance> = {}) {
    return normalizeConfig({
        ...configWithServiceInstance(aiInstance(overrides)),
        serviceCredentials: {[AI_ID]: serviceCredential(secret)},
    });
}

function configWithServiceInstance(instance: TranslationServiceInstance) {
    return normalizeConfig({
        ...storedConfig,
        service: instance.id,
        translationServices: [...createDefaultTranslationServices(), instance],
    });
}

interface LoadConfigOptions {
    trusted?: boolean;
    history?: unknown;
    sessionCredentials?: unknown;
    localCredentials?: unknown;
    credentialState?: unknown;
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
    if (options.credentialState !== undefined) storageState.set('local:credentialStorageState', options.credentialState);
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
            __babelboxConfigRevision: 5,
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
        const configStore = await loadConfigModule({...storedConfig, __babelboxConfigRevision: 5});
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);

        expect((configStore.config as unknown as Record<string, unknown>).__babelboxConfigRevision).toBeUndefined();
        await configStore.saveConfig({ ...configStore.config, to: 'en' }, {recordHistory: true, immediateHistory: true});

        const history = configStore.getConfigHistorySnapshot();
        expect(history.entries).toHaveLength(2);
        expect((history.entries[0].config as unknown as Record<string, unknown>).__babelboxConfigRevision).toBeUndefined();
        expect((history.entries[1].config as unknown as Record<string, unknown>).__babelboxConfigRevision).toBeUndefined();
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

    it('文档翻译遇到未知服务时回退到微软翻译', async () => {
        const configStore = await loadConfigModule({...storedConfig, documentService: 'unknown-service'});

        await configStore.configReady;

        expect(configStore.config.documentService).toBe('microsoft');
    });

    it('已移除的免费翻译服务迁移到微软翻译', () => {
        const config = normalizeConfig({
            service: 'freeTranslation',
            documentService: 'freeTranslation',
            translationServices: [
                {id: 'freeTranslation', provider: 'freeTranslation', kind: 'machine'},
                ...createDefaultTranslationServices(),
            ],
            translationCenterServices: ['freeTranslation', 'google'],
        });

        expect(config.translationServices.some(item => item.id === 'freeTranslation')).toBe(false);
        expect(config.service).toBe('microsoft');
        expect(config.documentService).toBe('microsoft');
        expect(config.translationCenterServices).toEqual(['google']);
    });

    it('保留用户选择的视频 AI 服务，并将未知服务回退到微软翻译', async () => {
        const instance = aiInstance();
        const aiConfigStore = await loadConfigModule({
            ...storedConfig,
            translationServices: [...createDefaultTranslationServices(), instance],
            videoService: instance.id,
        });

        await aiConfigStore.configReady;

        expect(aiConfigStore.config.videoService).toBe(instance.id);

        const invalidConfigStore = await loadConfigModule({ ...storedConfig, videoService: 'not-a-service' });

        await invalidConfigStore.configReady;

        expect(invalidConfigStore.config.videoService).toBe('microsoft');
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

        expect(configStore.config.to).toBe('zh-Hans');
        expect(storageMock.setItem).toHaveBeenCalledWith(
            'local:config',
            expect.objectContaining({ to: 'zh-Hans' }),
        );
    });

    it('保存相同快照时去重，并让连续保存只保留最新快照', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        storageMock.setItem.mockClear();

        const firstSave = configStore.saveConfig({ ...configStore.config, to: 'ja' });
        const latestSave = configStore.saveConfig({ ...configStore.config, to: 'en' });
        await Promise.all([firstSave, latestSave]);

        const configWrites = storageMock.setItem.mock.calls.filter(([key]) => key === 'local:config');
        expect(configWrites).toHaveLength(1);
        expect(configWrites[0]).toEqual([
            'local:config',
            expect.objectContaining({ to: 'en' }),
        ]);

        storageMock.setItem.mockClear();
        await configStore.saveConfig({ ...configStore.config, to: 'en' });
        expect(storageMock.setItem).not.toHaveBeenCalled();
    });

    it('收到外部对象更新时立即同步运行时状态，并通知订阅者', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        const listener = vi.fn();
        const unsubscribe = configStore.subscribeConfig(listener);
        const watchCallback = storageMock.watch.mock.calls[0][1];

        watchCallback({ ...storedConfig, to: 'en' }, storedConfig);

        expect(configStore.config.to).toBe('en');
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({ to: 'en' }));
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

        watchCallback({ ...storedConfig, to: 'en' }, storedConfig);
        unsubscribe();
        watchCallback({ ...storedConfig, to: 'ja' }, { ...storedConfig, to: 'en' });

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
        const instance = aiInstance({modelId: 'gpt-4o-mini'});
        const reactiveConfig = reactive({
            ...configStore.config,
            to: 'ja',
            translationServices: reactive([...configStore.config.translationServices, reactive(instance)]),
        });

        await configStore.requestConfigSave(reactiveConfig, sendMessage);

        const sentConfig = sendMessage.mock.calls[0][0].config;
        expect(() => structuredClone(sentConfig)).not.toThrow();
        expect(sentConfig.to).toBe('ja');
        expect(sentConfig.translationServices.at(-1)).toMatchObject({id: instance.id, modelId: 'gpt-4o-mini'});
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

    it('content 保存公开字段时保留后台运行时凭据', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        const current = withCredential('background-session-secret');
        const contentSnapshot = normalizeConfig({...sanitizeConfigCredentials(current), to: 'ja'});

        const prepared = configStore.prepareConfigSaveRequest(contentSnapshot, current, false);
        const extensionPrepared = configStore.prepareConfigSaveRequest(contentSnapshot, current, true);

        expect(prepared.to).toBe('ja');
        expect(prepared.serviceCredentials[AI_ID]?.apiKey).toBe('background-session-secret');
        expect(extensionPrepared.serviceCredentials).toEqual({});
    });

    it('content 公共快照只有在服务实例目标未变时才继承后台凭据', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        const secret = 'content-instance-destination-secret';
        const current = withCredential(secret, {endpoint: 'https://safe.example.test/v1'});

        const matchingSnapshot = configWithServiceInstance(aiInstance({endpoint: 'https://safe.example.test/v1'}));
        expect(configStore.prepareConfigSaveRequest(matchingSnapshot, current, false)
            .serviceCredentials[AI_ID]?.apiKey).toBe(secret);

        const changedEndpoint = configWithServiceInstance(aiInstance({endpoint: 'https://different.example.test/v1'}));
        expect(configStore.prepareConfigSaveRequest(changedEndpoint, current, false)
            .serviceCredentials[AI_ID]).toBeUndefined();
    });

    it('content 修改有道或腾讯服务的请求地址时不继承对应凭据', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await configStore.configReady;
        const youdao = {...createExternalTranslationService(services.youdao), endpoint: 'https://youdao.safe.example.test'};
        const tencent = {...createExternalTranslationService(services.tencent), endpoint: 'https://tencent.safe.example.test'};
        const current = normalizeConfig({
            ...storedConfig,
            translationServices: [...createDefaultTranslationServices(), youdao, tencent],
            serviceCredentials: {
                [youdao.id]: serviceCredential('youdao-secret'),
                [tencent.id]: serviceCredential('tencent-secret'),
            },
        });
        const contentSnapshot = normalizeConfig({
            ...sanitizeConfigCredentials(current),
            translationServices: [
                ...createDefaultTranslationServices(),
                {...youdao, endpoint: 'https://youdao.different.example.test'},
                tencent,
            ],
        });

        const prepared = configStore.prepareConfigSaveRequest(contentSnapshot, current, false);

        expect(prepared.serviceCredentials[youdao.id]).toBeUndefined();
        expect(prepared.serviceCredentials[tencent.id]?.secretKey).toBe('tencent-secret');
    });

    it('丢弃旧版本的明文凭据载体，且不把它们写回存储', async () => {
        const secret = 'legacy-secret-sentinel';
        const legacyConfig = {
            ...storedConfig,
            token: {openai: secret},
            ak: `${secret}-ak`,
            extra: {jwt: `${secret}-jwt`},
        };
        const configStore = await loadConfigModule(legacyConfig, {
            localCredentials: {schemaVersion: 1, token: {openai: secret}},
        });

        await configStore.configReady;

        expect(JSON.stringify(configStore.config)).not.toContain(secret);
        expect(JSON.stringify([...storageState.values()])).not.toContain(secret);
        expect(storageState.has('local:credentials')).toBe(false);
    });

    it('浏览器重启清空 session 后仍从设备密文恢复实例凭据', async () => {
        const secret = 'device-instance-secret';
        const firstLoad = await loadConfigModule(storedConfig);
        await firstLoad.configReady;
        await firstLoad.saveConfig(withCredential(secret));

        const persistedConfig = structuredClone(storageState.get('local:config'));
        const persistedCredentialState = structuredClone(storageState.get('local:credentialStorageState'));
        const reloaded = await loadConfigModule(persistedConfig, {
            credentialState: persistedCredentialState,
        });

        await reloaded.configReady;

        expect(reloaded.config.translationServices.some((item) => item.id === AI_ID)).toBe(true);
        expect(reloaded.config.serviceCredentials[AI_ID]?.apiKey).toBe(secret);
    });

    it('损坏的旧历史字符串可能包含凭据时直接丢弃，不能把敏感片段原样写回', async () => {
        const secret = 'malformed-history-secret-sentinel';
        const malformedHistory = `{"entries":[{"config":{"token":{"openai":"${secret}"}}}`;
        const configStore = await loadConfigModule(storedConfig, {history: malformedHistory});

        await configStore.configReady;

        expect(storageState.has('local:configHistory')).toBe(false);
        expect(JSON.stringify([...storageState.values()])).not.toContain(secret);
    });

    it('默认把新凭据保存为设备密文，local config 与历史不含敏感 sentinel', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);
        const secret = 'device-vault-secret-sentinel';

        await configStore.saveConfig({...withCredential(secret), to: 'en'}, {recordHistory: true, immediateHistory: true});

        expect(storageState.get('session:credentials')).toMatchObject({
            serviceCredentials: {[AI_ID]: expect.objectContaining({apiKey: secret})},
        });
        expect(storageState.has('local:credentials')).toBe(false);
        expect(storageState.get('local:credentialStorageState')).toMatchObject({
            mode: 'device',
            encryptedCredentials: expect.objectContaining({ciphertext: expect.any(String)}),
        });
        expect(JSON.stringify(storageState.get('local:credentialStorageState'))).not.toContain(secret);
        expect(JSON.stringify(storageState.get('local:config'))).not.toContain(secret);
        expect(JSON.stringify(storageState.get('local:configHistory'))).not.toContain(secret);
        expect(storageState.get('local:config')).not.toHaveProperty('serviceCredentials');

        await configStore.saveConfig({...configStore.config, serviceCredentials: {}, to: 'ja'});
        expect(storageState.get('session:credentials')).toMatchObject({serviceCredentials: {}});
    });

    it('在设备密文与仅会话两种存储方式间切换', async () => {
        const secret = 'credential-mode-secret-sentinel';
        const configStore = await loadConfigModule(withCredential(secret), {
            credentialState: {schemaVersion: 1, mode: 'session'},
            sessionCredentials: {schemaVersion: 2, serviceCredentials: {[AI_ID]: serviceCredential(secret)}},
        });

        await configStore.configReady;
        expect(configStore.getCredentialStorageMode()).toBe('session');
        expect(configStore.config.serviceCredentials[AI_ID]?.apiKey).toBe(secret);

        await configStore.setCredentialStorageMode('device');
        expect(storageState.get('local:credentialStorageState')).toMatchObject({
            mode: 'device',
            encryptedCredentials: expect.objectContaining({ciphertext: expect.any(String)}),
        });

        await configStore.setCredentialStorageMode('session');
        expect(storageState.get('local:credentialStorageState')).toEqual({schemaVersion: 1, mode: 'session'});
        expect(storageState.get('session:credentials')).toMatchObject({
            serviceCredentials: {[AI_ID]: expect.objectContaining({apiKey: secret})},
        });

        const sessionPublicConfig = structuredClone(storageState.get('local:config'));
        const sessionState = structuredClone(storageState.get('local:credentialStorageState'));
        const afterSessionEnded = await loadConfigModule(sessionPublicConfig, {
            credentialState: sessionState,
        });
        await afterSessionEnded.configReady;
        expect(afterSessionEnded.getCredentialStorageMode()).toBe('session');
        expect(afterSessionEnded.config.serviceCredentials[AI_ID]).toBeUndefined();
    });

    it('恢复历史只恢复公开字段，并保留当前凭据', async () => {
        const configStore = await loadConfigModule(configWithServiceInstance(aiInstance()));
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);
        await configStore.saveConfig({...configStore.config, to: 'en'}, {recordHistory: true, immediateHistory: true});
        const baselineVersion = configStore.getConfigHistorySnapshot().entries[0].version;
        const secret = 'restore-secret-sentinel';
        await configStore.saveConfig({
            ...configStore.config,
            count: 37,
            serviceCredentials: {[AI_ID]: serviceCredential(secret)},
            to: 'ja',
        }, {recordHistory: true, immediateHistory: true});

        await configStore.applyConfigHistoryAction('restore', baselineVersion);

        expect(configStore.config.to).toBe('zh-Hans');
        expect(configStore.config.count).toBe(37);
        expect(configStore.config.serviceCredentials[AI_ID]?.apiKey).toBe(secret);
        expect(JSON.stringify(configStore.getConfigHistorySnapshot())).not.toContain(secret);
    });

    it.each([
        {action: 'undo' as const, cursor: 1, currentEntry: 1, version: undefined},
        {action: 'redo' as const, cursor: 0, currentEntry: 0, version: undefined},
        {action: 'restore' as const, cursor: 1, currentEntry: 1, version: 1},
    ])('历史 $action 切换实例请求地址时不把当前凭据带到目标', async ({
        action,
        cursor,
        currentEntry,
        version,
    }) => {
        const secret = `history-${action}-destination-secret`;
        const endpoints = ['https://first.safe.example.test/v1', 'https://second.safe.example.test/v1'];
        const publicConfigs = endpoints
            .map((endpoint) => sanitizeConfigCredentials(configWithServiceInstance(aiInstance({endpoint}))));
        const configStore = await loadConfigModule(publicConfigs[currentEntry], {
            history: {
                schemaVersion: 1,
                entries: publicConfigs.map((config, index) => ({
                    version: index + 1,
                    savedAt: new Date(index).toISOString(),
                    config,
                })),
                cursor,
                nextVersion: 3,
            },
            sessionCredentials: {
                schemaVersion: 2,
                serviceCredentials: {[AI_ID]: serviceCredential(secret)},
            },
        });
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);
        expect(configStore.config.serviceCredentials[AI_ID]?.apiKey).toBe(secret);

        await configStore.applyConfigHistoryAction(action, version);

        expect(configStore.config.serviceCredentials[AI_ID]).toBeUndefined();
        expect(configStore.config.translationServices.find((item) => item.id === AI_ID)?.endpoint)
            .toBe(endpoints[action === 'redo' ? 1 : 0]);
    });

    it('session 写入失败时不改写存储，避免丢失设备凭据', async () => {
        const secret = 'must-not-delete-secret';
        const seed = await loadConfigModule(storedConfig);
        await seed.configReady;
        await seed.saveConfig(withCredential(secret));
        const persistedConfig = structuredClone(storageState.get('local:config'));
        const persistedCredentialState = structuredClone(storageState.get('local:credentialStorageState'));

        const configStore = await loadConfigModule(persistedConfig, {
            credentialState: persistedCredentialState,
            failSessionWrite: true,
        });
        await expect(configStore.configReady).resolves.toBeUndefined();

        expect(configStore.config.serviceCredentials[AI_ID]?.apiKey).toBe(secret);
        expect(storageMock.removeItem).not.toHaveBeenCalled();
        expect(storageMock.setItem).not.toHaveBeenCalledWith('local:config', expect.anything());
        expect(storageState.get('local:credentialStorageState')).toEqual(persistedCredentialState);
    });

    it('网页/content 上下文不访问 session，也不改写存储', async () => {
        const configStore = await loadConfigModule(configWithServiceInstance(aiInstance()), {trusted: false});

        await configStore.configReady;

        expect(configStore.config.serviceCredentials).toEqual({});
        expect(storageOperations.some((operation) => operation.includes('session:credentials'))).toBe(false);
        expect(storageMock.setItem).not.toHaveBeenCalled();
        expect(storageMock.removeItem).not.toHaveBeenCalled();
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
        const configStore = await loadConfigModule({ ...storedConfig, __babelboxConfigRevision: 5 });
        await configStore.configReady;
        const watchCallback = storageMock.watch.mock.calls[0][1];

        watchCallback({ ...storedConfig, to: 'ja', __babelboxConfigRevision: 7 }, storedConfig);
        watchCallback({ ...storedConfig, to: 'en', __babelboxConfigRevision: 6 }, storedConfig);

        expect(configStore.config.to).toBe('ja');
    });

    it('记录配置版本、时间，并限制为最近十条快照', async () => {
        const configStore = await loadConfigModule(storedConfig);
        await Promise.all([configStore.configReady, configStore.configHistoryReady]);

        for (const to of ['en', 'ja', 'ko', 'fr', 'ru', 'de', 'es', 'it', 'pt', 'ar', 'th']) {
            await configStore.saveConfig({ ...configStore.config, to }, {recordHistory: true, immediateHistory: true});
        }

        const history = configStore.getConfigHistorySnapshot();
        expect(history.entries).toHaveLength(10);
        expect(history.cursor).toBe(9);
        expect(history.entries.at(-1)).toMatchObject({
            version: expect.any(Number),
            savedAt: expect.any(String),
            config: expect.objectContaining({to: 'th'}),
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
        expect(restored.cursor).toBe(restored.entries.length - 1);
        expect(restored.entries.at(-1)).toMatchObject({
            version: beforeUndo.nextVersion,
            config: expect.objectContaining({to: 'zh-Hans'}),
        });
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
