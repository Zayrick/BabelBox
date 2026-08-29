import {describe, expect, it, vi} from 'vitest';
import {createCredentialStorageModeHandler} from '@/src/app/background/handlers/credentialStorageMode';

const extensionPrefix = 'chrome-extension://babelbox-id/';

describe('API 凭据存储方式后台边界', () => {
    it('只接受扩展自身页面发出的有效模式', async () => {
        const setMode = vi.fn(async (mode: 'device' | 'session') => mode);
        const handler = createCredentialStorageModeHandler(
            setMode,
            (url) => url.startsWith(extensionPrefix),
        );

        await expect(handler.handle(
            {type: 'credentialStorageModeAction', mode: 'session'},
            {sender: {url: `${extensionPrefix}options.html`}},
        )).resolves.toEqual({success: true, mode: 'session'});
        expect(setMode).toHaveBeenCalledWith('session');
    });

    it('拒绝 content script 与伪造模式修改安全策略', async () => {
        const setMode = vi.fn();
        const handler = createCredentialStorageModeHandler(
            setMode,
            (url) => url.startsWith(extensionPrefix),
        );

        await expect(handler.handle(
            {type: 'credentialStorageModeAction', mode: 'device'},
            {sender: {url: 'https://example.test/page'}},
        )).rejects.toThrow('只有扩展设置页面');
        await expect(handler.handle(
            {type: 'credentialStorageModeAction', mode: 'cloud'},
            {sender: {url: `${extensionPrefix}options.html`}},
        )).rejects.toThrow('无效的 API 凭据存储方式');
        expect(setMode).not.toHaveBeenCalled();
    });
});
