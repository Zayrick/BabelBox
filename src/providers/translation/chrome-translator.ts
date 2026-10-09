import type {TranslationProviderRequest} from '@/src/services/translation/types';
import {
    browserCapabilities,
    type BrowserCapabilities,
} from '@/src/platform/browser/capabilities';
import {
    chromeOffscreenClient,
    type OffscreenClient,
} from '@/src/platform/offscreen/client';

interface ChromeTranslationOffscreenResponse {
    readonly success?: boolean;
    readonly result?: unknown;
    readonly error?: string;
}

export interface ChromeTranslatorDependencies {
    readonly capabilities: Pick<BrowserCapabilities, 'chromeTranslation'>;
    readonly offscreenClient: Pick<OffscreenClient, 'send'>;
}

/** Chrome Translation provider；Offscreen 生命周期与 transport 由 platform client 所有。 */
export function createChromeTranslator(dependencies: ChromeTranslatorDependencies) {
    return async (request: TranslationProviderRequest): Promise<string> => {
        if (typeof request.origin !== 'string' || !request.origin.trim()) {
            throw new Error('翻译文本不能为空');
        }
        if (!dependencies.capabilities.chromeTranslation) {
            throw new Error('当前浏览器不支持 Chrome 内置翻译，请在设置中切换翻译服务');
        }

        try {
            const response = await dependencies.offscreenClient.send<ChromeTranslationOffscreenResponse>({
                type: 'CHROME_TRANSLATE_OFFSCREEN',
                data: {text: request.origin, from: request.sourceLanguage, to: request.targetLanguage},
            });
            if (!response?.success || typeof response.result !== 'string') {
                throw new Error(response?.error || '无效的翻译响应');
            }
            return response.result;
        } catch (error) {
            const message = error instanceof Error ? error.message : '未知错误';
            throw new Error(`Chrome Translation API 不可用：${message}`);
        }
    };
}

const chromeTranslator = createChromeTranslator({
    capabilities: browserCapabilities,
    offscreenClient: chromeOffscreenClient,
});

export default chromeTranslator;
