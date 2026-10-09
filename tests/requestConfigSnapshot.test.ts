import {describe, expect, it} from 'vitest';
import {resolveTranslationService} from '@/src/services/translation/requestSnapshot';
import {services} from '@/src/core/config/catalog';
import {serviceInstance} from './fixtures/translationService';

function configWith(enabled = true) {
    const instance = serviceInstance(services.openai, {
        modelId: 'model-a',
        endpoint: 'https://a.example/v1/chat/completions',
        systemRole: 'system-a',
        enabled,
    });
    return {
        instance,
        config: {
            translationServices: [instance],
            serviceCredentials: {[instance.id]: {apiKey: 'token-a', appKey: '', appSecret: '', secretId: '', secretKey: ''}},
        },
    };
}

describe('resolveTranslationService', () => {
    it('copies the instance and its credential so later settings edits do not change the request', () => {
        const {instance, config} = configWith();
        const resolved = resolveTranslationService(config, instance.id);

        instance.modelId = 'model-b';
        instance.endpoint = 'https://b.example/v1/chat/completions';
        config.serviceCredentials[instance.id].apiKey = 'token-b';

        expect(resolved).toMatchObject({
            id: instance.id,
            provider: services.openai,
            modelId: 'model-a',
            endpoint: 'https://a.example/v1/chat/completions',
            systemRole: 'system-a',
            credential: {apiKey: 'token-a'},
        });
        expect(Object.isFrozen(resolved)).toBe(true);
        expect(Object.isFrozen(resolved.credential)).toBe(true);
    });

    it('uses an empty credential when the service has none', () => {
        const {instance} = configWith();
        expect(resolveTranslationService({translationServices: [instance]}, instance.id).credential.apiKey).toBe('');
    });

    it('rejects deleted services and disabled services unless explicitly allowed', () => {
        const {instance, config} = configWith(false);

        expect(() => resolveTranslationService(config, 'service:openai:missing'))
            .toThrow('翻译服务不存在或已被删除，请重新选择');
        expect(() => resolveTranslationService(config, instance.id)).toThrow('已禁用');
        expect(resolveTranslationService(config, instance.id, {allowDisabled: true}).id).toBe(instance.id);
    });
});
