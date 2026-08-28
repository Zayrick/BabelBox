import {describe, expect, it} from 'vitest';
import {
    TRANSLATION_PROVIDER_CONFIG,
    attachTranslationProviderConfig,
    createTranslationProviderConfigSnapshot,
    getTranslationProviderConfig,
    resolveTranslationServiceConfig,
} from '@/src/services/translation/requestSnapshot';
import type {TranslationConfigSource} from '@/src/services/translation/types';
import {createAITranslationService} from '@/src/core/config/translationServices';
import {services} from '@/src/core/config/catalog';

function configSource(overrides: Partial<TranslationConfigSource> = {}): TranslationConfigSource {
    return {
        service: 'aiSdk',
        from: 'auto',
        to: 'zh-Hans',
        useCache: true,
        enableAIContext: true,
        model: {aiSdk: 'model-a'},
        customModel: {aiSdk: 'custom-model-a'},
        proxy: {aiSdk: 'https://a.example/v1'},
        custom: 'https://custom-a.example/v1',
        deeplx: 'https://deeplx-a.example',
        newApiUrl: 'https://newapi-a.example',
        minimaxBillingPlan: 'payg',
        minimaxRegion: 'cn',
        mimoBillingPlan: 'payg',
        mimoRegion: 'cn',
        azureOpenaiEndpoint: 'https://azure-a.example/chat/completions',
        robot_id: {aiSdk: 'robot-a'},
        customBody: {aiSdk: '{"snapshot":"a"}'},
        system_role: {aiSdk: 'system-a'},
        user_role: {aiSdk: 'user-a'},
        deepseekApiType: 'chat',
        deepseekThinkingMode: 'disabled',
        ...overrides,
    };
}

describe('translation provider request config snapshot', () => {
    it('clones and freezes every provider-visible nested map and credential', () => {
        const source = configSource({
            token: {aiSdk: 'token-a'},
            requireApiKey: {'aiSdk:model-a': true},
            youdaoAppKey: 'youdao-key-a',
            youdaoAppSecret: 'youdao-secret-a',
            tencentSecretId: 'tencent-id-a',
            tencentSecretKey: 'tencent-key-a',
        });
        const snapshot = createTranslationProviderConfigSnapshot(source);

        source.model.aiSdk = 'model-b';
        source.customModel.aiSdk = 'custom-model-b';
        source.proxy.aiSdk = 'https://b.example/v1';
        source.robot_id.aiSdk = 'robot-b';
        source.customBody.aiSdk = '{"snapshot":"b"}';
        source.system_role.aiSdk = 'system-b';
        source.user_role.aiSdk = 'user-b';
        source.token!.aiSdk = 'token-b';
        source.requireApiKey!['aiSdk:model-a'] = false;

        expect(snapshot).toMatchObject({
            model: {aiSdk: 'model-a'},
            customModel: {aiSdk: 'custom-model-a'},
            proxy: {aiSdk: 'https://a.example/v1'},
            robot_id: {aiSdk: 'robot-a'},
            customBody: {aiSdk: '{"snapshot":"a"}'},
            system_role: {aiSdk: 'system-a'},
            user_role: {aiSdk: 'user-a'},
            token: {aiSdk: 'token-a'},
            requireApiKey: {'aiSdk:model-a': true},
            youdaoAppKey: 'youdao-key-a',
            youdaoAppSecret: 'youdao-secret-a',
            tencentSecretId: 'tencent-id-a',
            tencentSecretKey: 'tencent-key-a',
        });
        expect([
            snapshot,
            snapshot.model,
            snapshot.customModel,
            snapshot.proxy,
            snapshot.robot_id,
            snapshot.customBody,
            snapshot.system_role,
            snapshot.user_role,
            snapshot.token,
            snapshot.requireApiKey,
        ].every(Object.isFrozen)).toBe(true);
    });

    it('uses safe credential defaults and resolves attached context without trusting message JSON', () => {
        const snapshot = createTranslationProviderConfigSnapshot(configSource());
        const currentConfig = createTranslationProviderConfigSnapshot(configSource({service: 'current'}));
        const message = {origin: 'hello'};
        const attached = attachTranslationProviderConfig(message, snapshot);

        expect(attached).toBe(message);
        expect(attached[TRANSLATION_PROVIDER_CONFIG]).toBe(snapshot);
        expect(getTranslationProviderConfig(attached, currentConfig)).toBe(snapshot);
        expect(getTranslationProviderConfig({}, currentConfig)).toBe(currentConfig);
        expect(snapshot).toMatchObject({
            token: {},
            requireApiKey: {},
            youdaoAppKey: '',
            youdaoAppSecret: '',
            tencentSecretId: '',
            tencentSecretKey: '',
        });
        expect(Object.getOwnPropertySymbols(attached)).toEqual([TRANSLATION_PROVIDER_CONFIG]);
        expect(JSON.stringify(attached)).toBe('{"origin":"hello"}');
    });

    it('projects one instance model, endpoint and credential onto its provider without inheriting siblings', () => {
        const firstId = 'service:openai:first';
        const secondId = 'service:openai:second';
        const first = createAITranslationService(services.openai, {
            id: firstId,
            modelId: 'model-first',
            endpoint: 'https://first.example.test/v1',
            customBody: '{"temperature":0}',
        });
        const second = createAITranslationService(services.openai, {
            id: secondId,
            modelId: 'model-second',
            endpoint: 'https://second.example.test/v1',
        });
        const snapshot = createTranslationProviderConfigSnapshot(configSource({
            service: firstId,
            translationServices: [first, second],
            serviceCredentials: {
                [firstId]: {apiKey: 'first-secret', appKey: '', appSecret: '', secretId: '', secretKey: ''},
                [secondId]: {apiKey: 'second-secret', appKey: '', appSecret: '', secretId: '', secretKey: ''},
            },
            model: {[services.openai]: 'legacy-model'},
            token: {[services.openai]: 'legacy-secret'},
        }));

        const firstResolved = resolveTranslationServiceConfig(snapshot, firstId);
        const secondResolved = resolveTranslationServiceConfig(snapshot, secondId);

        expect(firstResolved).toMatchObject({instanceId: firstId, provider: services.openai});
        expect(firstResolved.config).toMatchObject({
            service: services.openai,
            model: {[services.openai]: 'model-first'},
            proxy: {[services.openai]: 'https://first.example.test/v1'},
            token: {[services.openai]: 'first-secret'},
            customBody: {[services.openai]: '{"temperature":0}'},
        });
        expect(secondResolved.config.model[services.openai]).toBe('model-second');
        expect(secondResolved.config.proxy[services.openai]).toBe('https://second.example.test/v1');
        expect(secondResolved.config.token[services.openai]).toBe('second-secret');
    });

    it('does not let a generated custom endpoint instance inherit the legacy provider endpoint', () => {
        const instance = createAITranslationService(services.custom, {
            id: 'service:custom:isolated',
            modelId: 'isolated-model',
        });
        const snapshot = createTranslationProviderConfigSnapshot(configSource({
            service: instance.id,
            translationServices: [instance],
            custom: 'https://legacy-custom.example.test/v1',
            proxy: {[services.custom]: 'https://legacy-proxy.example.test/v1'},
        }));

        const resolved = resolveTranslationServiceConfig(snapshot, instance.id);

        expect(resolved.config.custom).toBe('');
        expect(resolved.config.proxy[services.custom]).toBe('');
    });

    it('rejects disabled or removed inventory entries before an adapter is selected', () => {
        const disabled = createAITranslationService(services.openai, {
            id: 'service:openai:disabled',
            modelId: 'model-disabled',
            enabled: false,
        });
        const snapshot = createTranslationProviderConfigSnapshot(configSource({
            service: disabled.id,
            translationServices: [disabled],
        }));

        expect(() => resolveTranslationServiceConfig(snapshot, disabled.id)).toThrow('已禁用');
        expect(resolveTranslationServiceConfig(snapshot, disabled.id, {allowDisabled: true}).provider)
            .toBe(services.openai);
        expect(() => resolveTranslationServiceConfig(snapshot, 'service:openai:missing')).toThrow('不存在');
    });
});
