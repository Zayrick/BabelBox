import {beforeEach, describe, expect, it, vi} from 'vitest';
import {createOffscreenMessageListener} from '@/src/app/offscreen/messageRouter';
import {OFFSCREEN_READY_MESSAGE_TYPE} from '@/src/platform/offscreen/client';

const mocks = {
    downloadOcrLanguages: vi.fn(async () => undefined),
    play: vi.fn(async () => undefined),
    recognizeImage: vi.fn(async () => [{text: 'hello'}]),
    stop: vi.fn(() => true),
    translate: vi.fn(async () => '译文'),
    translateArea: vi.fn(async () => ({image: 'area', lines: []})),
    translateImage: vi.fn(async () => ({image: 'translated', lines: []})),
};

const listener = createOffscreenMessageListener({
    translate: mocks.translate,
    ttsPlayer: {play: mocks.play, stop: mocks.stop},
    recognizeImage: mocks.recognizeImage,
    translateImage: mocks.translateImage,
    translateArea: mocks.translateArea,
    downloadOcrLanguages: mocks.downloadOcrLanguages,
});

async function dispatch(message: unknown): Promise<{handled: boolean; response?: unknown}> {
    let resolveResponse!: (response: unknown) => void;
    const response = new Promise<unknown>((resolve) => { resolveResponse = resolve; });
    const routedMessage = message && typeof message === 'object' && !Array.isArray(message)
        && !Object.hasOwn(message, 'target')
        ? {...message, target: 'offscreen'}
        : message;
    const handled = listener(routedMessage, {}, resolveResponse);
    return handled ? {handled, response: await response} : {handled};
}

describe('Offscreen 消息静态路由', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.play.mockResolvedValue(undefined);
        mocks.stop.mockReturnValue(true);
        mocks.translate.mockResolvedValue('译文');
        mocks.recognizeImage.mockResolvedValue([{text: 'hello'}]);
        mocks.translateImage.mockResolvedValue({image: 'translated', lines: []});
        mocks.translateArea.mockResolvedValue({image: 'area', lines: []});
        mocks.downloadOcrLanguages.mockResolvedValue(undefined);
    });

    it('确认 offscreen 接收端已就绪', async () => {
        await expect(dispatch({type: OFFSCREEN_READY_MESSAGE_TYPE}))
            .resolves.toEqual({handled: true, response: {success: true, ready: true}});
    });

    it('null、数组、无 type 与未知消息保持未处理', async () => {
        await expect(dispatch(null)).resolves.toEqual({handled: false});
        await expect(dispatch([])).resolves.toEqual({handled: false});
        await expect(dispatch({type: 1})).resolves.toEqual({handled: false});
        await expect(dispatch({type: 'UNKNOWN'})).resolves.toEqual({handled: false});
    });

    it('TTS 只接收 offscreen target，并统一返回成功或错误', async () => {
        await expect(dispatch({type: 'PLAY_SELECTION_TTS', target: 'page'})).resolves.toEqual({handled: false});
        await expect(dispatch({type: 'STOP_SELECTION_TTS', target: 'page'})).resolves.toEqual({handled: false});
        const play = {
            type: 'PLAY_SELECTION_TTS',
            target: 'offscreen',
            sourceUrl: 'x',
            tabId: 0,
            clientRequestId: 'client-1',
        };
        await expect(dispatch(play)).resolves.toEqual({handled: true, response: {success: true}});
        expect(mocks.play).toHaveBeenCalledWith(play);
        const stop = {type: 'STOP_SELECTION_TTS', target: 'offscreen', tabId: 0, clientRequestId: 'client-1'};
        await expect(dispatch(stop))
            .resolves.toEqual({handled: true, response: {success: true}});
        expect(mocks.stop).toHaveBeenCalledWith(stop);

        mocks.play.mockRejectedValueOnce(new Error('play failed'));
        await expect(dispatch(play)).resolves.toEqual({handled: true, response: {success: false, error: 'play failed'}});
        mocks.stop.mockImplementationOnce(() => { throw 'bad id'; });
        await expect(dispatch({type: 'STOP_SELECTION_TTS', target: 'offscreen', tabId: 0, clientRequestId: 'bad'}))
            .resolves.toEqual({handled: true, response: {success: false, error: 'bad id'}});
    });

    it('Chrome translate 转发原始 data，包含原始异常字符串', async () => {
        const data = {text: 'hello', from: 'en', to: 'ja'};
        await expect(dispatch({type: 'CHROME_TRANSLATE_OFFSCREEN', data}))
            .resolves.toEqual({handled: true, response: {success: true, result: '译文'}});
        expect(mocks.translate).toHaveBeenCalledWith(data);
        mocks.translate.mockRejectedValueOnce('translator failed');
        await expect(dispatch({type: 'CHROME_TRANSLATE_OFFSCREEN', data}))
            .resolves.toEqual({handled: true, response: {success: false, error: 'translator failed'}});
    });

    it('OCR 校验图片与语言并拒绝非数组结果', async () => {
        await expect(dispatch({
            type: 'FLUENT_READ_IMAGE_OCR_OFFSCREEN', image: 'data:image/png,x', sourceLanguage: 'en',
        })).resolves.toEqual({handled: true, response: {success: true, lines: [{text: 'hello'}]}});
        expect(mocks.recognizeImage).toHaveBeenCalledWith('data:image/png,x', 'en');

        for (const message of [
            {type: 'FLUENT_READ_IMAGE_OCR_OFFSCREEN', image: null, sourceLanguage: 'en'},
            {type: 'FLUENT_READ_IMAGE_OCR_OFFSCREEN', image: ' ', sourceLanguage: 'en'},
            {type: 'FLUENT_READ_IMAGE_OCR_OFFSCREEN', image: 'data:image/png,x', sourceLanguage: ' '},
            {type: 'FLUENT_READ_IMAGE_OCR_OFFSCREEN', image: 'data:image/png,x', sourceLanguage: 'bad!'},
            {type: 'FLUENT_READ_IMAGE_OCR_OFFSCREEN', image: 'https://host/image.png', sourceLanguage: 'en'},
        ]) {
            expect((await dispatch(message)).response).toMatchObject({success: false});
        }
        mocks.recognizeImage.mockResolvedValueOnce({bad: true} as never);
        await expect(dispatch({
            type: 'FLUENT_READ_IMAGE_OCR_OFFSCREEN', image: 'data:image/png,x', sourceLanguage: 'en',
        })).resolves.toEqual({handled: true, response: {success: false, error: '图片 OCR 结果无效'}});
    });

    it('图片翻译规范化缺省 title 并校验结果对象', async () => {
        await expect(dispatch({
            type: 'FLUENT_READ_IMAGE_TRANSLATE_OFFSCREEN', image: 'data:image/png,image', sourceLanguage: 'en',
        })).resolves.toEqual({handled: true, response: {success: true, image: 'translated', lines: []}});
        expect(mocks.translateImage).toHaveBeenCalledWith('data:image/png,image', 'en', '');
        await dispatch({
            type: 'FLUENT_READ_IMAGE_TRANSLATE_OFFSCREEN', image: 'data:image/png,image', sourceLanguage: 'en', title: 'Page',
        });
        expect(mocks.translateImage).toHaveBeenLastCalledWith('data:image/png,image', 'en', 'Page');

        expect((await dispatch({
            type: 'FLUENT_READ_IMAGE_TRANSLATE_OFFSCREEN', image: 'data:image/png,image', sourceLanguage: 'en', title: 1,
        })).response).toEqual({success: false, error: 'Offscreen title 必须是字符串'});
        mocks.translateImage.mockResolvedValueOnce([] as never);
        expect((await dispatch({
            type: 'FLUENT_READ_IMAGE_TRANSLATE_OFFSCREEN', image: 'data:image/png,image', sourceLanguage: 'en',
        })).response).toEqual({success: false, error: '图片翻译结果无效'});
        mocks.translateImage.mockResolvedValueOnce({image: 'safe', lines: [], success: false} as never);
        expect((await dispatch({
            type: 'FLUENT_READ_IMAGE_TRANSLATE_OFFSCREEN', image: 'data:image/png,image', sourceLanguage: 'en',
        })).response).toEqual({image: 'safe', lines: [], success: true});
    });

    it('区域翻译验证六个有限坐标和正尺寸', async () => {
        const selection = {left: 0, top: 1, width: 2, height: 3, viewportWidth: 100, viewportHeight: 80};
        await expect(dispatch({
            type: 'FLUENT_READ_AREA_TRANSLATE_OFFSCREEN',
            image: 'data:image/png,image',
            sourceLanguage: 'auto',
            title: 'Area',
            selection,
        })).resolves.toEqual({handled: true, response: {success: true, image: 'area', lines: []}});
        expect(mocks.translateArea).toHaveBeenCalledWith('data:image/png,image', 'auto', 'Area', selection);

        expect((await dispatch({
            type: 'FLUENT_READ_AREA_TRANSLATE_OFFSCREEN', image: 'data:image/png,image', sourceLanguage: 'en', selection: null,
        })).response).toEqual({success: false, error: 'Offscreen selection 必须是对象'});
        for (const field of Object.keys(selection)) {
            const invalid = {...selection, [field]: Number.NaN};
            expect((await dispatch({
                type: 'FLUENT_READ_AREA_TRANSLATE_OFFSCREEN', image: 'data:image/png,image', sourceLanguage: 'en', selection: invalid,
            })).response).toEqual({success: false, error: `Offscreen selection.${field} 必须是有限数字`});
        }
        for (const invalid of [
            {...selection, left: -1},
            {...selection, top: -1},
            {...selection, width: 0},
            {...selection, height: 0},
            {...selection, viewportWidth: 0},
            {...selection, viewportHeight: 0},
        ]) {
            expect((await dispatch({
                type: 'FLUENT_READ_AREA_TRANSLATE_OFFSCREEN', image: 'data:image/png,image', sourceLanguage: 'en', selection: invalid,
            })).response).toEqual({success: false, error: 'Offscreen selection 尺寸无效'});
        }
        mocks.translateArea.mockResolvedValueOnce(null as never);
        expect((await dispatch({
            type: 'FLUENT_READ_AREA_TRANSLATE_OFFSCREEN', image: 'data:image/png,image', sourceLanguage: 'en', selection,
        })).response).toEqual({success: false, error: '区域翻译结果无效'});
    });

    it('OCR 下载拒绝非数组和未知语言，并去重有效语言', async () => {
        await expect(dispatch({type: 'FLUENT_READ_IMAGE_OCR_DOWNLOAD_OFFSCREEN', languages: ['eng', 'eng', 'jpn']}))
            .resolves.toEqual({handled: true, response: {success: true}});
        expect(mocks.downloadOcrLanguages).toHaveBeenCalledWith(['eng', 'jpn']);
        expect((await dispatch({type: 'FLUENT_READ_IMAGE_OCR_DOWNLOAD_OFFSCREEN', languages: null})).response)
            .toEqual({success: false, error: 'Offscreen OCR languages 必须是非空数组'});
        expect((await dispatch({type: 'FLUENT_READ_IMAGE_OCR_DOWNLOAD_OFFSCREEN', languages: []})).response)
            .toEqual({success: false, error: 'Offscreen OCR languages 必须是非空数组'});
        expect((await dispatch({type: 'FLUENT_READ_IMAGE_OCR_DOWNLOAD_OFFSCREEN', languages: ['fra']})).response)
            .toEqual({success: false, error: 'Offscreen OCR languages 包含不支持的语言'});
        expect((await dispatch({type: 'FLUENT_READ_IMAGE_OCR_DOWNLOAD_OFFSCREEN', languages: [1]})).response)
            .toEqual({success: false, error: 'Offscreen OCR languages 包含不支持的语言'});
    });
});
