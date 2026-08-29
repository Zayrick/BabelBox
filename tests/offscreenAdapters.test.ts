import {beforeEach, describe, expect, it, vi} from 'vitest';
import {createAreaTranslationOffscreenAdapter} from '@/src/features/area-translation/background/offscreenAdapter';
import {createImageTranslationOffscreenAdapter} from '@/src/features/image-translation/background/offscreenAdapter';
import {createSelectionTtsOffscreenAdapter} from '@/src/features/selection-translation/background/offscreenAdapter';
import type {OffscreenClient} from '@/src/platform/offscreen/client';

const send = vi.fn();
const sendIfPresent = vi.fn();
const client = {
    ensureDocument: vi.fn(async () => undefined),
    hasDocument: vi.fn(async () => false),
    send,
    sendIfPresent,
} as unknown as OffscreenClient;

beforeEach(() => {
    vi.clearAllMocks();
});

describe('area translation Offscreen adapter', () => {
    const adapter = createAreaTranslationOffscreenAdapter(client);
    const selection = {left: 1, top: 2, width: 3, height: 4, viewportWidth: 100, viewportHeight: 80};

    it('sends the complete feature payload and returns a validated result', async () => {
        send.mockResolvedValueOnce({success: true, image: 'translated-area', lines: [{text: 'line'}]});
        await expect(adapter.translateArea('data:image/png,area', 'en', 'Page', selection)).resolves.toEqual({
            image: 'translated-area',
            lines: [{text: 'line'}],
        });
        expect(send).toHaveBeenCalledWith({
            type: 'BABELBOX_AREA_TRANSLATE_OFFSCREEN',
            image: 'data:image/png,area',
            sourceLanguage: 'en',
            title: 'Page',
            selection,
        });
    });

    it('rejects failed and structurally invalid results with custom or fallback errors', async () => {
        send.mockResolvedValueOnce({success: false, error: 'area custom'});
        await expect(adapter.translateArea('image', 'en', '', selection)).rejects.toThrow('area custom');

        send.mockResolvedValueOnce({success: true, image: 1, lines: []});
        await expect(adapter.translateArea('image', 'en', '', selection)).rejects.toThrow('圈选翻译失败');

        send.mockResolvedValueOnce({success: true, image: 'image', lines: {}});
        await expect(adapter.translateArea('image', 'en', '', selection)).rejects.toThrow('圈选翻译失败');

        send.mockResolvedValueOnce(undefined);
        await expect(adapter.translateArea('image', 'en', '', selection)).rejects.toThrow('圈选翻译失败');
    });
});

describe('image translation Offscreen adapter', () => {
    const adapter = createImageTranslationOffscreenAdapter(client);

    it('recognizes image lines and rejects failed or invalid OCR responses', async () => {
        send.mockResolvedValueOnce({success: true, lines: [{text: 'hello'}]});
        await expect(adapter.recognizeImage('data:image/png,image', 'eng')).resolves.toEqual([{text: 'hello'}]);
        expect(send).toHaveBeenCalledWith({
            type: 'BABELBOX_IMAGE_OCR_OFFSCREEN',
            image: 'data:image/png,image',
            sourceLanguage: 'eng',
        });

        send.mockResolvedValueOnce({success: false, error: 'ocr custom'});
        await expect(adapter.recognizeImage('image', 'eng')).rejects.toThrow('ocr custom');
        send.mockResolvedValueOnce({success: true, lines: 'bad'});
        await expect(adapter.recognizeImage('image', 'eng')).rejects.toThrow('图片 OCR 失败');
        send.mockResolvedValueOnce(undefined);
        await expect(adapter.recognizeImage('image', 'eng')).rejects.toThrow('图片 OCR 失败');
    });

    it('translates images and validates success, image and line fields independently', async () => {
        send.mockResolvedValueOnce({success: true, image: 'translated', lines: []});
        await expect(adapter.translateImage('data:image/png,image', 'en', 'Page')).resolves.toEqual({
            image: 'translated', lines: [],
        });
        expect(send).toHaveBeenCalledWith({
            type: 'BABELBOX_IMAGE_TRANSLATE_OFFSCREEN',
            image: 'data:image/png,image',
            sourceLanguage: 'en',
            title: 'Page',
        });

        send.mockResolvedValueOnce({success: false, error: 'translation custom'});
        await expect(adapter.translateImage('image', 'en', '')).rejects.toThrow('translation custom');
        send.mockResolvedValueOnce({success: true, image: null, lines: [], error: 1});
        await expect(adapter.translateImage('image', 'en', '')).rejects.toThrow('图片翻译失败');
        send.mockResolvedValueOnce({success: true, image: 'translated', lines: null});
        await expect(adapter.translateImage('image', 'en', '')).rejects.toThrow('图片翻译失败');
    });

    it('downloads OCR languages and reports custom, empty and fallback failures', async () => {
        send.mockResolvedValueOnce({success: true});
        await expect(adapter.downloadLanguages(['eng', 'jpn'])).resolves.toBeUndefined();
        expect(send).toHaveBeenCalledWith({
            type: 'BABELBOX_IMAGE_OCR_DOWNLOAD_OFFSCREEN',
            languages: ['eng', 'jpn'],
        });

        send.mockResolvedValueOnce({success: false, error: 'download custom'});
        await expect(adapter.downloadLanguages(['eng'])).rejects.toThrow('download custom');
        send.mockResolvedValueOnce({success: false, error: ''});
        await expect(adapter.downloadLanguages(['eng'])).rejects.toThrow('图片 OCR 语言包下载失败');
        send.mockResolvedValueOnce(undefined);
        await expect(adapter.downloadLanguages(['eng'])).rejects.toThrow('图片 OCR 语言包下载失败');
    });
});

describe('selection TTS Offscreen adapter', () => {
    const adapter = createSelectionTtsOffscreenAdapter(client);
    const route = {tabId: 7, clientRequestId: 'request-1'};

    it('plays audio/source payloads and rejects unsuccessful playback', async () => {
        send.mockResolvedValueOnce({success: true});
        await expect(adapter.play({...route, sourceUrl: 'https://example.test/audio'})).resolves.toBeUndefined();
        expect(send).toHaveBeenCalledWith({
            type: 'PLAY_SELECTION_TTS',
            ...route,
            sourceUrl: 'https://example.test/audio',
        });

        send.mockResolvedValueOnce({success: false, error: 'play custom'});
        await expect(adapter.play({...route, audioBase64: 'AA==', contentType: 'audio/mpeg'}))
            .rejects.toThrow('play custom');
        send.mockResolvedValueOnce(undefined);
        await expect(adapter.play({...route, audioBase64: 'AA==', contentType: 'audio/mpeg'}))
            .rejects.toThrow('Offscreen TTS 播放失败');
    });

    it('uses optional delivery for stop and accepts missing or successful documents', async () => {
        sendIfPresent.mockResolvedValueOnce(undefined);
        await expect(adapter.stop(route)).resolves.toBeUndefined();
        expect(sendIfPresent).toHaveBeenCalledWith({type: 'STOP_SELECTION_TTS', ...route});

        sendIfPresent.mockResolvedValueOnce({success: true});
        await expect(adapter.stop(route)).resolves.toBeUndefined();

        sendIfPresent.mockResolvedValueOnce({success: false, error: 'stop custom'});
        await expect(adapter.stop(route)).rejects.toThrow('stop custom');
        sendIfPresent.mockResolvedValueOnce({success: false});
        await expect(adapter.stop(route)).rejects.toThrow('Offscreen TTS 停止失败');
    });
});
