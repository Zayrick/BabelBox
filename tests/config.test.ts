import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import {services} from '@/src/core/config/catalog';
import {Config, normalizeConfig, type TranslationServiceCredential} from '@/src/core/config/model';
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
const AI_ID = 'service:openai:test';

function serviceCredential(apiKey: string): TranslationServiceCredential {
    return {apiKey, appKey: '', appSecret: '', secretId: '', secretKey: ''};
}

function aiInstance(overrides: Partial<TranslationServiceInstance> = {}): TranslationServiceInstance {
    return {...createExternalTranslationService(services.openai), id: AI_ID, ...overrides};
}

function configWithAiService(name: string, apiKey: string) {
    return normalizeConfig({
        ...storedConfig,
        service: AI_ID,
        translationServices: [...createDefaultTranslationServices(), aiInstance({name})],
        serviceCredentials: {[AI_ID]: serviceCredential(apiKey)},
    });
}

function aiService(value: {translationServices: TranslationServiceInstance[]}) {
    return value.translationServices.find((item) => item.id === AI_ID);
}

async function loadConfigModule(value: unknown = null) {
    vi.resetModules();
    storageState.clear();
    storageOperations.length = 0;
    if (value !== null) storageState.set('local:config', value);
    storageMock.getItem.mockReset().mockImplementation(async (key: string) => {
        storageOperations.push(`get:${key}`);
        return structuredClone(storageState.get(key) ?? null);
    });
    storageMock.setItem.mockReset().mockImplementation(async (key: string, nextValue: unknown) => {
        storageOperations.push(`set:${key}`);
        storageState.set(key, structuredClone(nextValue));
    });
    storageMock.removeItem.mockReset().mockImplementation(async (key: string) => {
        storageOperations.push(`remove:${key}`);
        storageState.delete(key);
    });
    storageMock.watch.mockReset().mockReturnValue(() => undefined);
    return import('@/src/services/config/store');
}

function configWatchCallback(): (value: unknown) => void {
    return storageMock.watch.mock.calls.find(([key]) => key === 'local:config')![1];
}

describe('统一配置存储', () => {
    beforeEach(() => {
        vi.useRealTimers();
    });

    it('API Key 与服务名称作为普通配置写入 local:config，重新加载后保持不变', async () => {
        const store = await loadConfigModule(storedConfig);
        await store.configReady;

        await store.saveConfig(configWithAiService('My OpenAI', 'sk-synthetic'));
        expect(aiService(storageState.get('local:config') as any)?.name).toBe('My OpenAI');
        expect((storageState.get('local:config') as any).serviceCredentials[AI_ID].apiKey).toBe('sk-synthetic');

        const reloaded = await loadConfigModule(storageState.get('local:config'));
        await reloaded.configReady;
        expect(aiService(reloaded.config)?.name).toBe('My OpenAI');
        expect(reloaded.config.serviceCredentials[AI_ID].apiKey).toBe('sk-synthetic');
    });

    it('重置为默认配置时删除自定义服务和 API Key，后台保留翻译计数', async () => {
        const store = await loadConfigModule({...configWithAiService('Service', 'sk-reset'), theme: 'dark', count: 7});
        await store.configReady;
        const sendMessage = vi.fn().mockResolvedValue({success: true});

        await store.requestConfigSave(new Config(), sendMessage);

        const patch = sendMessage.mock.calls[0][0].patch;
        expect(patch.serviceCredentials).toEqual({});
        expect(aiService(patch)).toBeUndefined();
        expect(patch.theme).not.toBe('dark');
        expect(store.config.serviceCredentials).toEqual({});
    });

    it('打开页面只读取配置，不回写存储', async () => {
        const store = await loadConfigModule({...storedConfig, theme: 'dark', legacyField: true});
        await store.configReady;

        expect(store.config.theme).toBe('dark');
        expect(storageOperations.filter((operation) => !operation.startsWith('get:'))).toEqual([]);
    });

    it('存储内容损坏时回退到默认配置，并保持初始化 Promise 可用', async () => {
        const store = await loadConfigModule('{not-json');

        await expect(store.configReady).resolves.toBeUndefined();
        expect(store.config.to).toBe('zh-Hans');
    });

    it('旧页面只提交自己改动的字段，不覆盖其他页面刚保存的服务名称和 API Key', async () => {
        const store = await loadConfigModule(storedConfig);
        await store.configReady;
        const stalePage = normalizeConfig(store.config);
        // 另一个页面已保存新服务，但本上下文尚未收到 storage 回声。
        storageState.set('local:config', configWithAiService('Saved name', 'sk-saved'));

        await store.saveConfig({...stalePage, theme: 'dark'});

        const saved = storageState.get('local:config') as ReturnType<typeof normalizeConfig>;
        expect(saved.theme).toBe('dark');
        expect(aiService(saved)?.name).toBe('Saved name');
        expect(saved.serviceCredentials[AI_ID].apiKey).toBe('sk-saved');
    });

    it('页面通过后台只发送改动字段，并转换为可结构化克隆的纯对象', async () => {
        const store = await loadConfigModule(storedConfig);
        await store.configReady;
        const sendMessage = vi.fn(async (message: unknown) => {
            structuredClone(message);
            return {success: true};
        });
        const editor = reactive(normalizeConfig(store.config));
        editor.to = 'ja';

        await expect(store.requestConfigSave(editor, sendMessage)).resolves.toBe(true);
        expect(sendMessage).toHaveBeenCalledWith({type: store.CONFIG_PERSIST_MESSAGE, patch: {to: 'ja'}});

        await expect(store.requestConfigSave(editor, sendMessage)).resolves.toBe(false);
        expect(sendMessage).toHaveBeenCalledTimes(1);
    });

    it('原地修改共享运行时配置后请求保存，仍能提交改动', async () => {
        const store = await loadConfigModule(storedConfig);
        await store.configReady;
        const sendMessage = vi.fn().mockResolvedValue({success: true});

        store.config.to = 'en';
        await store.requestConfigSave(store.config, sendMessage);

        expect(sendMessage).toHaveBeenCalledWith({type: store.CONFIG_PERSIST_MESSAGE, patch: {to: 'en'}});
    });

    it('保存进行中收到较早的 storage 回声时不回滚编辑，结束后与存储真值同步', async () => {
        const store = await loadConfigModule(configWithAiService('Old name', 'sk-old'));
        await store.configReady;
        const listener = vi.fn();
        store.subscribeConfig(listener);
        listener.mockClear();
        let release!: () => void;
        const blocked = new Promise<void>((resolve) => { release = resolve; });
        const latest = configWithAiService('New name', 'sk-new');

        const pending = store.requestConfigSave(latest, async () => {
            await blocked;
            storageState.set('local:config', latest);
            return {success: true};
        });
        await vi.waitFor(() => expect(aiService(store.config)?.name).toBe('New name'));
        configWatchCallback()(configWithAiService('Intermediate', 'sk-intermediate'));
        expect(aiService(store.config)?.name).toBe('New name');
        expect(listener.mock.calls.some(([next]) => aiService(next)?.name === 'Intermediate')).toBe(false);

        release();
        await pending;
        expect(aiService(store.config)?.name).toBe('New name');
        expect(store.config.serviceCredentials[AI_ID].apiKey).toBe('sk-new');
    });

    it('后台没有确认保存时视为失败，并回到存储中的真实配置', async () => {
        const store = await loadConfigModule(storedConfig);
        await store.configReady;

        await expect(store.requestConfigSave({...store.config, to: 'ja'}, async () => undefined))
            .rejects.toThrow('后台没有确认配置保存');
        expect(store.config.to).toBe('zh-Hans');
    });

    it('收到外部 storage 更新时同步运行时配置并通知订阅者', async () => {
        const store = await loadConfigModule(storedConfig);
        await store.configReady;
        const listener = vi.fn();
        const unsubscribe = store.subscribeConfig(listener);
        listener.mockClear();

        configWatchCallback()({...storedConfig, to: 'en'});
        expect(store.config.to).toBe('en');
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({to: 'en'}));

        unsubscribe();
        configWatchCallback()({...storedConfig, to: 'ja'});
        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('翻译计数基于存储真值做增量', async () => {
        const store = await loadConfigModule({...storedConfig, count: 3});
        await store.configReady;
        storageState.set('local:config', {...storedConfig, count: 10});

        await expect(store.incrementConfigCount(2)).resolves.toBe(12);
        expect((storageState.get('local:config') as any).count).toBe(12);
    });

    it('恢复历史只回滚设置项，保留当前 API Key', async () => {
        const store = await loadConfigModule(configWithAiService('Service', 'sk-first'));
        await Promise.all([store.configReady, store.configHistoryReady]);
        await store.saveConfig({...store.config, to: 'en'}, {recordHistory: true, immediateHistory: true});
        await store.saveConfig({
            ...store.config,
            serviceCredentials: {[AI_ID]: serviceCredential('sk-second')},
        });

        await store.applyConfigHistoryAction('undo');

        expect(store.config.to).toBe('zh-Hans');
        expect(store.config.serviceCredentials[AI_ID].apiKey).toBe('sk-second');
        expect(JSON.stringify(storageState.get('local:configHistory'))).not.toContain('sk-');
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
