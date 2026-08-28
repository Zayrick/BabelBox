import { describe, expect, it } from 'vitest';

import {getMissingCredentialMessage} from '@/src/core/config/validation';
import {services} from '@/src/core/config/catalog';

describe('翻译服务凭据校验', () => {
    it('API Key 为空时不阻止请求，由服务端连接测试给出结果', () => {
        expect(getMissingCredentialMessage(services.openai, { token: {} })).toBeNull();
        expect(getMissingCredentialMessage(services.openai, { token: { [services.openai]: '  ' } })).toBeNull();
        expect(getMissingCredentialMessage(services.openai, { token: { [services.openai]: 'configured' } })).toBeNull();
    });

    it('DeepSeek API Key 为空时同样允许发起无鉴权请求', () => {
        expect(getMissingCredentialMessage(services.deepseek, { token: {} })).toBeNull();
        expect(getMissingCredentialMessage(services.deepseek, { token: { [services.deepseek]: 'configured' } })).toBeNull();
    });

    it('旧版 API Key 校验配置不再改变请求前校验', () => {
        const config = {
            model: { [services.deepseek]: 'deepseek-v4-pro' },
            requireApiKey: { [`${services.deepseek}:deepseek-v4-flash`]: false },
            token: {},
        };
        expect(getMissingCredentialMessage(services.deepseek, config)).toBeNull();
    });

    it('保留 DeepLX 可选令牌的行为', () => {
        expect(getMissingCredentialMessage(services.deeplx, { token: {} })).toBeNull();
    });

    it('覆盖有道和腾讯云的专用凭据', () => {
        expect(getMissingCredentialMessage(services.youdao, { token: {}, youdaoAppKey: 'key' })).toContain('App Secret');
        expect(getMissingCredentialMessage(services.tencent, { token: {}, tencentSecretId: 'id' })).toContain('SecretKey');
        expect(getMissingCredentialMessage(services.tencent, { token: {}, tencentSecretId: 'id', tencentSecretKey: 'secret' })).toBeNull();
    });
});
