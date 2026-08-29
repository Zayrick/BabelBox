import {afterEach, describe, expect, it} from 'vitest';
import {Config} from '@/src/core/config/model';
import {getApiKeyRequirementKey} from '@/src/core/config/validation';
import {customModelString, defaultModels, services} from '@/src/core/config/catalog';
import {createAITranslationService} from '@/src/core/config/translationServices';
import {
    ensureUserscriptConfig,
    getEnabledUserscriptServices,
    normalizeUserscriptConfig,
} from '@/userscript/initialize';

function installLegacyStorage(entries: Array<[string, unknown]>) {
    const values = new Map<string, unknown>(entries);
    let writes = 0;
    globalThis.GM_getValue = ((key, fallback) => values.has(key) ? values.get(key) : fallback) as NonNullable<typeof globalThis.GM_getValue>;
    globalThis.GM_setValue = (key, value) => {
        writes += 1;
        values.set(key, value);
    };
    return {values, get writes() { return writes; }};
}

function readStoredConfig(values: Map<string, unknown>): Config {
    return JSON.parse(String(values.get('local:config'))) as Config;
}

describe('legacy userscript migration', () => {
    afterEach(() => {
        globalThis.GM_getValue = undefined;
        globalThis.GM_setValue = undefined;
    });

    it('migrates legacy identity-scoped GM settings into Config', async () => {
        const {values} = installLegacyStorage([
            ['model', 'openai'],
            ['from', 'auto'],
            ['to', 'en'],
            ['hotkey', 'Alt'],
            ['model_openai', 'gpt-4.1-mini'],
            ['token_openai', 'legacy-test-token'],
            ['openai_url', 'https://gateway.example.test/v1/chat/completions'],
        ]);

        await ensureUserscriptConfig();

        const stored = readStoredConfig(values);
        expect(stored.service).toBe('openai');
        expect(stored.to).toBe('en');
        expect(stored.hotkey).toBe('Alt');
        expect(stored.model.openai).toBe('gpt-4.1-mini');
        expect(stored.token.openai).toBe('legacy-test-token');
        expect(stored.proxy.openai).toBe('https://gateway.example.test/v1/chat/completions');
        expect(stored.disableFloatingBall).toBe(false);
        expect(stored.disableImageTranslator).toBe(true);
    });

    it('migrates the v1.31 defaults, arbitrary Ollama model, prompts, and object credentials', async () => {
        const yiyanCredentials = {
            ak: 'legacy-yiyan-ak',
            sk: 'legacy-yiyan-sk',
            token: 'legacy-yiyan-access-token',
            expiration: Date.now() + 60_000,
        };
        const {values} = installLegacyStorage([
            ['model', 'ollama'],
            ['model_openai', 'gpt-3.5-turbo'],
            ['model_gemini', 'gemini-pro'],
            ['model_yiyan', 'completions'],
            ['model_tongyi', 'qwen-turbo'],
            ['model_zhipu', 'glm-3-turbo'],
            ['model_moonshot', 'moonshot-v1-8'],
            ['model_ollama', 'private-ollama-model:latest'],
            ['token_yiyan', yiyanCredentials],
            ['token_zhipu', {apikey: 'legacy-zhipu-key', token: 'discard-generated-jwt'}],
            ['ollama_url', 'http://127.0.0.1:11434/v1/chat/completions'],
            ['systemMsg', 'Legacy system prompt'],
            ['userMsg', 'Legacy user prompt with {{origin}} and {{to}}'],
        ]);

        await ensureUserscriptConfig();

        const stored = readStoredConfig(values);
        expect(stored.service).toBe(services.custom);
        expect(stored.model[services.openai]).toBe(defaultModels.get(services.openai));
        expect(stored.model[services.gemini]).toBe(defaultModels.get(services.gemini));
        expect(stored.model[services.yiyan]).toBe(defaultModels.get(services.yiyan));
        expect(stored.model[services.tongyi]).toBe(defaultModels.get(services.tongyi));
        expect(stored.model[services.zhipu]).toBe(defaultModels.get(services.zhipu));
        expect(stored.model[services.moonshot]).toBe(defaultModels.get(services.moonshot));
        expect(stored.model[services.custom]).toBe(customModelString);
        expect(stored.customModel[services.custom]).toBe('private-ollama-model:latest');
        expect(stored.custom).toBe('http://127.0.0.1:11434/v1/chat/completions');
        expect(stored.requireApiKey[getApiKeyRequirementKey(services.custom, stored)]).toBe(false);
        expect(stored.token[services.yiyan]).toBe('legacy-yiyan-access-token');
        expect(stored.ak).toBe('legacy-yiyan-ak');
        expect(stored.sk).toBe('legacy-yiyan-sk');
        expect(stored.token[services.zhipu]).toBe('legacy-zhipu-key');
        expect(stored.system_role[services.openai]).toBe('Legacy system prompt');
        expect(stored.system_role[services.custom]).toBe('Legacy system prompt');
        expect(stored.user_role[services.gemini]).toBe('Legacy user prompt with {{origin}} and {{to}}');
        expect(values.get('token_yiyan')).toEqual(yiyanCredentials);
    });

    it.each([services.chromeTranslator, 'removed-service'])('sanitizes an existing userscript config using unsupported service %s', async (service) => {
        const existing = new Config();
        existing.service = service;
        existing.videoService = service;
        existing.contextMenuEnabled = true;
        existing.selectionAreaEnabled = true;
        existing.disableImageTranslator = false;
        existing.videoTranslationEnabled = true;
        existing.maxConcurrentTranslations = 250;
        existing.token[services.openai] = 'preserved-token';
        existing.extra = {preserved: true};
        const {values} = installLegacyStorage([
            ['local:config', JSON.stringify(existing)],
        ]);

        await ensureUserscriptConfig();

        const stored = readStoredConfig(values);
        expect(stored.service).toBe(services.microsoft);
        expect(stored.videoService).toBe(services.microsoft);
        expect(stored.contextMenuEnabled).toBe(false);
        expect(stored.selectionAreaEnabled).toBe(false);
        expect(stored.disableImageTranslator).toBe(true);
        expect(stored.videoTranslationEnabled).toBe(false);
        expect(stored.maxConcurrentTranslations).toBe(250);
        expect(stored.token[services.openai]).toBe('preserved-token');
        expect(stored.extra).toEqual({preserved: true});
    });

    it('does not rewrite an already-safe config only because it has an internal revision', async () => {
        const safe = normalizeUserscriptConfig(new Config()) as Config & {__babelboxConfigRevision?: number};
        safe.__babelboxConfigRevision = 7;
        const storage = installLegacyStorage([
            ['local:config', JSON.stringify(safe)],
        ]);

        await ensureUserscriptConfig();

        expect(storage.writes).toBe(0);
    });

    it('preserves multiple instances of one provider and reconciles a disabled selection', () => {
        const config = new Config();
        const first = createAITranslationService(services.openai, {
            id: 'service:openai:first',
            modelId: 'gpt-first',
            name: 'First model',
            enabled: false,
            endpoint: 'https://first.example.test/v1',
        });
        const second = createAITranslationService(services.openai, {
            id: 'service:openai:second',
            modelId: 'gpt-second',
            name: 'Second model',
            endpoint: 'https://second.example.test/v1',
        });
        config.translationServices.push(first, second);
        config.service = first.id;
        config.serviceCredentials[first.id] = {
            apiKey: 'first-key',
            appKey: '',
            appSecret: '',
            secretId: '',
            secretKey: '',
        };
        config.serviceCredentials[second.id] = {
            apiKey: 'second-key',
            appKey: '',
            appSecret: '',
            secretId: '',
            secretKey: '',
        };

        const safe = normalizeUserscriptConfig(config);

        expect(safe.service).not.toBe(first.id);
        expect(safe.translationServices.filter(item => item.provider === services.openai)).toEqual([
            expect.objectContaining({id: first.id, modelId: 'gpt-first', enabled: false}),
            expect.objectContaining({id: second.id, modelId: 'gpt-second', enabled: true}),
        ]);
        expect(safe.serviceCredentials[first.id].apiKey).toBe('first-key');
        expect(safe.serviceCredentials[second.id].apiKey).toBe('second-key');
        expect(getEnabledUserscriptServices(safe).map(item => item.id)).not.toContain(first.id);
    });

    it('reenables Microsoft when every userscript-supported service is disabled', () => {
        const config = new Config();
        config.translationServices.forEach((instance) => {
            instance.enabled = instance.provider === services.chromeTranslator;
        });
        config.service = services.chromeTranslator;

        const safe = normalizeUserscriptConfig(config);

        expect(safe.service).toBe(services.microsoft);
        expect(safe.translationServices.find(item => item.id === services.microsoft)?.enabled).toBe(true);
        expect(getEnabledUserscriptServices(safe).map(item => item.id)).toContain(services.microsoft);
        expect(getEnabledUserscriptServices(safe).map(item => item.id)).not.toContain(services.chromeTranslator);
    });
});
