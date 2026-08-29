import {beforeEach, describe, expect, it, vi} from 'vitest';
import {
    captureVisibleAreaInExtension,
    translateCapturedAreaInExtension,
} from '@/src/features/area-translation/services/client';
import {
    fetchImageInExtension,
    translateImageInExtension,
} from '@/src/features/image-translation/services/client';

const {sendMessage} = vi.hoisted(() => ({sendMessage: vi.fn()}));

vi.mock('wxt/browser', () => ({
    browser: {runtime: {sendMessage}},
}));

beforeEach(() => {
    sendMessage.mockReset();
});

describe('圈选翻译内容脚本客户端', () => {
    it('通过后台读取当前可见页面，并保留协议消息', async () => {
        sendMessage.mockResolvedValue({success: true, image: 'data:image/png;base64,area'});

        await expect(captureVisibleAreaInExtension()).resolves.toBe('data:image/png;base64,area');
        expect(sendMessage).toHaveBeenCalledWith({type: 'babelboxAreaCapture'});
    });

    it.each([
        [{success: false, error: '截图权限不足'}, '截图权限不足'],
        [undefined, '无法读取当前页面区域'],
        [{success: true}, '无法读取当前页面区域'],
    ])('拒绝无效截图响应 %#', async (response, message) => {
        sendMessage.mockResolvedValue(response);
        await expect(captureVisibleAreaInExtension()).rejects.toThrow(message);
    });

    it('发送完整选区上下文并验证返回的译图和行信息', async () => {
        const lines = [{text: '你好', bbox: {x0: 0, y0: 0, x1: 10, y1: 8}, backgroundColor: '#fff'}];
        sendMessage.mockResolvedValue({success: true, image: 'translated', lines});
        const selection = {left: 1, top: 2, width: 30, height: 20, viewportWidth: 800, viewportHeight: 600};

        await expect(translateCapturedAreaInExtension('capture', selection, 'en', 'Article')).resolves.toEqual({
            image: 'translated',
            lines,
        });
        expect(sendMessage).toHaveBeenCalledWith({
            type: 'babelboxAreaTranslateCapture',
            image: 'capture',
            selection,
            sourceLanguage: 'en',
            title: 'Article',
        });
    });

    it.each([
        [{success: false, error: 'OCR 失败'}, 'OCR 失败'],
        [undefined, '圈选翻译服务不可用'],
        [{success: true, image: 'translated', lines: null}, '圈选翻译服务不可用'],
        [{success: true, lines: []}, '圈选翻译服务不可用'],
    ])('拒绝无效圈选翻译响应 %#', async (response, message) => {
        sendMessage.mockResolvedValue(response);
        await expect(translateCapturedAreaInExtension('capture', {
            left: 0,
            top: 0,
            width: 10,
            height: 10,
            viewportWidth: 100,
            viewportHeight: 100,
        }, 'auto', '')).rejects.toThrow(message);
    });
});

describe('图片翻译内容脚本客户端', () => {
    it('返回完整图片翻译结果并保留页面上下文', async () => {
        const lines = [{text: '你好', bbox: {x0: 1, y0: 2, x1: 3, y1: 4}, backgroundColor: '#fff'}];
        sendMessage.mockResolvedValue({success: true, image: 'translated', lines});

        await expect(translateImageInExtension('image', 'en', 'Page')).resolves.toEqual({image: 'translated', lines});
        expect(sendMessage).toHaveBeenCalledWith({
            type: 'babelboxImageTranslate',
            image: 'image',
            sourceLanguage: 'en',
            title: 'Page',
        });
    });

    it.each([
        [{success: false, error: '翻译失败'}, '翻译失败'],
        [undefined, '图片翻译服务不可用'],
        [{success: true, image: 'translated'}, '图片翻译服务不可用'],
        [{success: true, lines: []}, '图片翻译服务不可用'],
    ])('拒绝无效图片翻译响应 %#', async (response, message) => {
        sendMessage.mockResolvedValue(response);
        await expect(translateImageInExtension('image', 'auto', '')).rejects.toThrow(message);
    });

    it('通过后台读取跨域图片', async () => {
        sendMessage.mockResolvedValue({success: true, image: 'data:image/png;base64,remote'});

        await expect(fetchImageInExtension('https://example.com/a.png')).resolves.toBe('data:image/png;base64,remote');
        expect(sendMessage).toHaveBeenCalledWith({
            type: 'babelboxImageFetch',
            url: 'https://example.com/a.png',
        });
    });

    it.each([
        [{success: false, error: '读取失败'}, '读取失败'],
        [undefined, '无法读取远程图片'],
        [{success: true}, '无法读取远程图片'],
    ])('拒绝无效跨域图片响应 %#', async (response, message) => {
        sendMessage.mockResolvedValue(response);
        await expect(fetchImageInExtension('https://example.com/a.png')).rejects.toThrow(message);
    });
});
