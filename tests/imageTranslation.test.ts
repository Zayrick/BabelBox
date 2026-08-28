import { describe, expect, it } from 'vitest';
import { imageBufferToDataUrl, MAX_REMOTE_IMAGE_BYTES, normalizeRemoteImageUrl } from '@/src/features/image-translation/services/remoteImage';
import { getOcrLanguages, normalizeOcrLines, selectChangedTranslations } from '@/src/features/image-translation/core';
import { inpaintTextRegions } from '@/src/features/image-translation/services/inpainting';
import { normalizeImageOcrLanguageCodes } from '@/src/features/image-translation/ocrLanguages';
import { getImageTextBackgroundColor, getImageTextColor } from '@/src/features/image-translation/services/rendering';

describe('图片翻译 OCR 工具', () => {
    it('按源语言选择最小 OCR 语言集', () => {
        expect(getOcrLanguages('en')).toEqual(['eng']);
        expect(getOcrLanguages('zh-Hans')).toEqual(['chi_sim', 'eng']);
        expect(getOcrLanguages('ja')).toEqual(['jpn', 'eng']);
        expect(getOcrLanguages('auto')).toEqual(['chi_sim', 'eng']);
    });

    it('只接受支持的语言包并去重，保证下载状态可持久化', () => {
        expect(normalizeImageOcrLanguageCodes(['eng', 'jpn', 'eng', 'unsupported', null])).toEqual(['eng', 'jpn']);
        expect(normalizeImageOcrLanguageCodes('eng')).toEqual([]);
    });

    it('过滤空 OCR 行并保留文本框', () => {
        expect(normalizeOcrLines(null)).toEqual([]);
        expect(normalizeOcrLines([{paragraphs: undefined}, {paragraphs: [{lines: undefined}]}])).toEqual([]);
        const lines = normalizeOcrLines([
            {
                paragraphs: [{
                    lines: [
                        { text: ' Hello   world ', bbox: { x0: 0, y0: 0, x1: 20, y1: 10 } },
                        { text: '   ', bbox: { x0: 0, y0: 0, x1: 20, y1: 10 } },
                    ],
                }],
            } as never,
        ]);

        expect(lines).toEqual([{ text: 'Hello world', bbox: { x0: 0, y0: 0, x1: 20, y1: 10 } }]);
    });

    it('不为微软原样返回的 OCR 行生成翻译覆盖层', () => {
        const lines = [
            { text: '中文标题', bbox: { x0: 0, y0: 0, x1: 40, y1: 12 } },
            { text: 'Hello world', bbox: { x0: 0, y0: 20, x1: 80, y1: 32 } },
            { text: 'Missing translation', bbox: { x0: 0, y0: 40, x1: 80, y1: 52 } },
        ];

        expect(selectChangedTranslations(lines, ['中文标题', '你好世界'])).toEqual([{
            text: '你好世界',
            bbox: { x0: 0, y0: 20, x1: 80, y1: 32 },
        }]);
    });

    it('优先使用紧凑的 OCR word 框，避免整行控件被合并成一个大框', () => {
        const lines = normalizeOcrLines([
            {
                paragraphs: [{
                    lines: [{
                        text: 'ignored wide line',
                        bbox: { x0: 0, y0: 0, x1: 200, y1: 30 },
                        words: [
                            { text: 'Translate', confidence: 90, bbox: { x0: 20, y0: 8, x1: 75, y1: 20 } },
                            { text: 'the', confidence: 90, bbox: { x0: 80, y0: 8, x1: 100, y1: 20 } },
                            { text: 'following', confidence: 90, bbox: { x0: 106, y0: 8, x1: 164, y1: 20 } },
                            { text: 'button', confidence: 90, bbox: { x0: 240, y0: 8, x1: 280, y1: 20 } },
                        ],
                    }],
                }],
            },
        ]);

        expect(lines).toEqual([
            { text: 'Translate the following', bbox: { x0: 20, y0: 8, x1: 164, y1: 20 } },
            { text: 'button', bbox: { x0: 240, y0: 8, x1: 280, y1: 20 } },
        ]);
    });

    it('过滤低置信度和无效 word，并按 CJK 连写规则合并同一行', () => {
        const lines = normalizeOcrLines([
            {
                paragraphs: [{
                    lines: [{
                        text: 'ignored',
                        bbox: { x0: 0, y0: 0, x1: 80, y1: 20 },
                        words: [
                            { text: ' 你 ', bbox: { x0: 0, y0: 0, x1: 10, y1: 10 } },
                            { text: ' 好 ', confidence: 90, bbox: { x0: 11, y0: 0, x1: 21, y1: 10 } },
                            { text: 'bad', confidence: 10, bbox: { x0: 22, y0: 0, x1: 32, y1: 10 } },
                            { text: 'flat', confidence: 90, bbox: { x0: 33, y0: 0, x1: 33, y1: 10 } },
                        ],
                    }],
                }],
            },
        ]);

        expect(lines).toEqual([
            {text: '你好', bbox: {x0: 0, y0: 0, x1: 21, y1: 10}},
        ]);
    });

    it('只允许通过扩展后台读取网页图片地址', () => {
        expect(normalizeRemoteImageUrl('https://cdn.example.com/image.png')).toBe('https://cdn.example.com/image.png');
        expect(normalizeRemoteImageUrl('http://cdn.example.com/image.png')).toBe('http://cdn.example.com/image.png');
        expect(() => normalizeRemoteImageUrl('not a url')).toThrow('图片地址无效');
        expect(() => normalizeRemoteImageUrl('data:image/png;base64,AA==')).toThrow('只支持网页图片地址');
    });

    it('把远程图片字节转换成 OCR 可读取的数据地址', () => {
        const data = imageBufferToDataUrl(new Uint8Array([1, 2, 255]).buffer, 'image/png; charset=binary');
        expect(data).toBe('data:image/png;base64,AQL/');
        expect(() => imageBufferToDataUrl(new ArrayBuffer(0), '')).toThrow('远程地址不是图片');
        expect(() => imageBufferToDataUrl(new ArrayBuffer(0), 'text/plain')).toThrow('远程地址不是图片');
        expect(() => imageBufferToDataUrl(new ArrayBuffer(MAX_REMOTE_IMAGE_BYTES + 1), 'image/png')).toThrow('图片文件过大');
    });

    it('对无效输入原样复制，并为无法扩散的整图遮罩保留原像素', () => {
        const source = new Uint8ClampedArray([12, 34, 56, 255]);
        const line = {text: 'x', bbox: {x0: 0, y0: 0, x1: 1, y1: 1}};

        expect(inpaintTextRegions(source, 0, 1, [line])).toEqual(source);
        expect(inpaintTextRegions(source, 1, 0, [line])).toEqual(source);
        expect(inpaintTextRegions(new Uint8ClampedArray([1, 2, 3]), 1, 1, [line])).toEqual(new Uint8ClampedArray([1, 2, 3]));
        expect(inpaintTextRegions(source, 1, 1, [])).toEqual(source);
        expect(inpaintTextRegions(source, 1, 1, [line])).toEqual(source);
    });

    it('从 OCR 框外围选择主背景色并自动选择可读文字颜色', () => {
        const pixels = new Uint8ClampedArray(3 * 3 * 4);
        for (let index = 0; index < pixels.length; index += 4) {
            pixels[index] = 245;
            pixels[index + 1] = 245;
            pixels[index + 2] = 245;
            pixels[index + 3] = 255;
        }
        // 放入一个少数深色像素，确保主色选择不会被单个噪点覆盖。
        pixels[0] = 16;
        pixels[1] = 16;
        pixels[2] = 16;

        expect(getImageTextBackgroundColor(pixels, 3, 3, {x0: 1, y0: 1, x1: 2, y1: 2}))
            .toBe('rgb(240,240,240)');
        expect(getImageTextBackgroundColor(new Uint8ClampedArray(), 0, 0, {x0: 0, y0: 0, x1: 0, y1: 0}))
            .toBe('rgb(255,255,255)');
        expect(getImageTextColor('rgb(240,240,240)')).toBe('#111827');
        expect(getImageTextColor('rgb(16,16,16)')).toBe('#ffffff');
        expect(getImageTextColor('invalid')).toBe('#111827');
    });

    it('用周边像素修复文字区域，而不是用整块纯色覆盖', () => {
        const width = 9;
        const height = 5;
        const source = new Uint8ClampedArray(width * height * 4);
        for (let y = 0; y < height; y += 1) {
            for (let x = 0; x < width; x += 1) {
                const offset = (y * width + x) * 4;
                source[offset] = x * 20;
                source[offset + 1] = y * 30;
                source[offset + 2] = 100;
                source[offset + 3] = 255;
            }
        }
        // 模拟文字像素：修复后不应继续保留这个明显的黑色残影。
        const textPixel = (2 * width + 4) * 4;
        source[textPixel] = 0;
        source[textPixel + 1] = 0;
        source[textPixel + 2] = 0;
        const result = inpaintTextRegions(source, width, height, [{
            text: 'text',
            bbox: { x0: 3, y0: 1, x1: 6, y1: 4 },
        }]);

        const centre = textPixel;
        expect(result[centre]).toBeGreaterThan(source[centre]);
        expect(result[centre + 1]).toBeGreaterThan(source[centre + 1]);
        expect(result[centre + 2]).toBe(100);
        expect(result[centre + 3]).toBe(255);
    });
});
