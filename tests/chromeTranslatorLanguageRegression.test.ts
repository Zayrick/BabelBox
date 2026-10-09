import {beforeEach, describe, expect, it, vi} from 'vitest';
import defaultChromeTranslator, {createChromeTranslator} from '@/src/providers/translation/chrome-translator';
import {providerRequest, resolvedService} from './fixtures/translationService';

const send = vi.fn();
const chromeTranslator = createChromeTranslator({
    capabilities: {chromeTranslation: true},
    offscreenClient: {send},
});
const service = resolvedService('chromeTranslator');

describe('Chrome translator 请求级语言回归', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        send.mockResolvedValue({success: true, result: '翻译结果'});
    });

    it('发往 offscreen 的 data 与 broker 解析的请求语言完全一致', async () => {
        await expect(chromeTranslator(providerRequest(service, {
            origin: 'hello',
            sourceLanguage: 'en',
            targetLanguage: 'ja',
        }))).resolves.toBe('翻译结果');

        expect(send).toHaveBeenCalledWith({
            type: 'CHROME_TRANSLATE_OFFSCREEN',
            data: {text: 'hello', from: 'en', to: 'ja'},
        });
    });

    it('非法原文不会发消息', async () => {
        await expect(chromeTranslator(providerRequest(service, {origin: ''}))).rejects.toThrow('翻译文本不能为空');
        await expect(chromeTranslator(providerRequest(service, {origin: '   '}))).rejects.toThrow('翻译文本不能为空');
        expect(send).not.toHaveBeenCalled();
    });

    it('默认 unknown 构建保守拒绝 Chrome provider，且不会触碰 Offscreen', async () => {
        await expect(defaultChromeTranslator(providerRequest(service)))
            .rejects.toThrow('当前浏览器不支持 Chrome 内置翻译');
        expect(send).not.toHaveBeenCalled();
    });
});
