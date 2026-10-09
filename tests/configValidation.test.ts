import {describe, expect, it} from 'vitest';

import {getMissingCredentialMessage} from '@/src/core/config/validation';
import {services} from '@/src/core/config/catalog';
import {EMPTY_TRANSLATION_SERVICE_CREDENTIAL} from '@/src/core/config/translationServices';
import {serviceInstance} from './fixtures/translationService';

function configFor(provider: string, credential: Partial<typeof EMPTY_TRANSLATION_SERVICE_CREDENTIAL> = {}) {
    const instance = serviceInstance(provider);
    return {
        id: instance.id,
        config: {
            translationServices: [instance],
            serviceCredentials: {[instance.id]: {...EMPTY_TRANSLATION_SERVICE_CREDENTIAL, ...credential}},
        },
    };
}

describe('翻译服务凭据校验', () => {
    it('API Key 为空时不阻止请求，由服务端连接测试给出结果', () => {
        for (const provider of [services.openai, services.deepseek, services.deeplx]) {
            const {id, config} = configFor(provider);
            expect(getMissingCredentialMessage(id, config)).toBeNull();
        }
    });

    it('有道和腾讯云的专用凭据缺失时给出提示', () => {
        const youdao = configFor(services.youdao, {appKey: 'key'});
        expect(getMissingCredentialMessage(youdao.id, youdao.config)).toContain('App Secret');

        const partialTencent = configFor(services.tencent, {secretId: 'id'});
        expect(getMissingCredentialMessage(partialTencent.id, partialTencent.config)).toContain('SecretKey');

        const tencent = configFor(services.tencent, {secretId: 'id', secretKey: 'secret'});
        expect(getMissingCredentialMessage(tencent.id, tencent.config)).toBeNull();
    });

    it('同一供应商的凭据按实例隔离', () => {
        const first = configFor(services.youdao, {appKey: 'key', appSecret: 'secret'});
        const second = serviceInstance(services.youdao);
        const config = {...first.config, translationServices: [...first.config.translationServices, second]};

        expect(getMissingCredentialMessage(first.id, config)).toBeNull();
        expect(getMissingCredentialMessage(second.id, config)).toContain('App Key');
    });
});
