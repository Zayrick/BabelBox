import {
    downloadImageOcrLanguages,
    recognizeImage,
    translateAreaInOffscreen,
    translateImageInOffscreen,
} from './imageTranslation';
import {createOffscreenMessageListener} from './messageRouter';
import {createSelectionTtsPlayer} from './ttsPlayback';
import {translateWithChromeApi, type ChromeTranslationEnvironment} from './translation';

function decodeAudioBase64(audioBase64: string): Uint8Array {
    const binary = atob(audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
}

/** 组装 Offscreen 的实验 API、Audio/Blob 和图片 OCR 浏览器能力。 */
export function startOffscreenApp(): void {
    const ttsPlayer = createSelectionTtsPlayer({
        createAudio: () => new Audio(),
        decodeBase64: decodeAudioBase64,
        createObjectUrl: (bytes, contentType) => URL.createObjectURL(new Blob([
            Uint8Array.from(bytes),
        ], {type: contentType})),
        revokeObjectUrl: (url) => URL.revokeObjectURL(url),
        notify: (request, state, error) => {
            void chrome.runtime.sendMessage({
                type: 'selectionTtsPlaybackState',
                tabId: request.tabId,
                clientRequestId: request.clientRequestId,
                state,
                error: error instanceof Error ? error.message : error ? String(error) : undefined,
            }).catch(() => undefined);
        },
    });
    const listener = createOffscreenMessageListener({
        translate: (data) => translateWithChromeApi(data, self as ChromeTranslationEnvironment),
        ttsPlayer,
        recognizeImage,
        translateImage: translateImageInOffscreen,
        translateArea: translateAreaInOffscreen,
        downloadOcrLanguages: downloadImageOcrLanguages,
    });

    chrome.runtime.onMessage.addListener(listener);
    window.addEventListener('pagehide', () => ttsPlayer.dispose(), {once: true});
}
