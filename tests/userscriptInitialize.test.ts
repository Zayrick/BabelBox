import {afterEach, describe, expect, it} from 'vitest';
import {Config} from '@/src/core/config/model';
import {services} from '@/src/core/config/catalog';
import {createExternalTranslationService} from '@/src/core/config/translationServices';
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

describe('userscript config initialization', () => {
    afterEach(() => {
        globalThis.GM_getValue = undefined;
        globalThis.GM_setValue = undefined;
    });

    it('seeds a fresh userscript config with the floating ball and extension-only features off', async () => {
        const storage = installLegacyStorage([]);

        await ensureUserscriptConfig();

        const stored = readStoredConfig(storage.values);
        expect(stored.disableFloatingBall).toBe(false);
        expect(stored.contextMenuEnabled).toBe(false);
        expect(stored.selectionAreaEnabled).toBe(false);
        expect(stored.disableImageTranslator).toBe(true);
        expect(stored.videoTranslationEnabled).toBe(false);
        expect(stored.service).toBe(services.microsoft);
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
        const first = {
            ...createExternalTranslationService(services.openai),
            modelId: 'gpt-first',
            name: 'First model',
            enabled: false,
            endpoint: 'https://first.example.test/v1',
        };
        const second = {
            ...createExternalTranslationService(services.openai, [first]),
            modelId: 'gpt-second',
            name: 'Second model',
            endpoint: 'https://second.example.test/v1',
        };
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
