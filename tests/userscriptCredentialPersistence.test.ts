import {beforeEach, describe, expect, it, vi} from 'vitest';

const userscriptStorage = vi.hoisted(() => ({
    values: new Map<string, unknown>(),
    writes: [] as Array<[string, unknown]>,
}));

vi.mock('@wxt-dev/storage', () => ({
    storage: {
        getItem: vi.fn(async (key: string) => userscriptStorage.values.get(key) ?? null),
        setItem: vi.fn(async (key: string, value: unknown) => {
            const snapshot = structuredClone(value);
            userscriptStorage.values.set(key, snapshot);
            userscriptStorage.writes.push([key, snapshot]);
        }),
        removeItem: vi.fn(async (key: string) => {
            userscriptStorage.values.delete(key);
        }),
        watch: vi.fn(() => () => undefined),
    },
}));

// Userscript Vite 使用同名平台替换模块；这里验证该可信 GM 模式下的完整读写生命周期。
vi.mock('@/src/platform/storage/credentialContext', () => ({
    isTrustedCredentialStorageContext: () => true,
    ENCRYPTED_CREDENTIAL_VAULT_ENABLED: false,
}));

import {createExternalTranslationService} from '@/src/core/config/translationServices';

async function loadConfigStore() {
    vi.resetModules();
    const module = await import('@/src/services/config/store');
    await Promise.all([module.configReady, module.configHistoryReady]);
    return module;
}

describe('userscript credential persistence regression', () => {
    beforeEach(() => {
        userscriptStorage.values.clear();
        userscriptStorage.writes.length = 0;
    });

    it('保存公开设置并重载后仍保留实例凭据，且公开配置不含凭据', async () => {
        const first = await loadConfigStore();
        const instance = createExternalTranslationService('openai');
        first.config.translationServices.push(instance);
        first.config.serviceCredentials[instance.id] = {
            apiKey: 'gm-secret-token',
            appKey: '',
            appSecret: '',
            secretId: '',
            secretKey: '',
        };
        first.config.to = 'ja';
        await first.saveConfig(first.config, {recordHistory: true, immediateHistory: true});

        const publicConfig = userscriptStorage.values.get('local:config') as Record<string, unknown>;
        expect(publicConfig.to).toBe('ja');
        expect(publicConfig).not.toHaveProperty('serviceCredentials');
        expect(JSON.stringify(publicConfig)).not.toContain('gm-secret-token');

        const reloaded = await loadConfigStore();
        expect(reloaded.config.to).toBe('ja');
        expect(reloaded.config.serviceCredentials[instance.id]?.apiKey).toBe('gm-secret-token');
    });
});
