import type {ContentScriptContext} from 'wxt/utils/content-script-context';
import {normalizeSelectionTranslatorDelay} from '@/src/core/config/model';
import {config} from '@/src/services/config/store';
import {
    autoTranslateEnglishPage,
    isFullPageTranslationActive,
    mountAreaTranslator,
    mountFloatingBall,
    mountImageTranslator,
    mountSelectionTranslator,
    mountTranslationProgressPanel,
    restoreOriginalContent,
    unmountAreaTranslator,
    unmountFloatingBall,
    unmountImageTranslator,
    unmountSelectionTranslator,
    unmountTranslationProgressPanel,
} from './features';
import {browserCapabilities, type BrowserCapabilities} from '@/src/platform/browser/capabilities';
import {rejectUnsupportedContentFeature} from './featureRegistry';
export interface ContentRuntimeMessageState {
    isSiteDisabled(): boolean;
    updateSiteDisabled(disabled: boolean): Promise<void>;
}
export type ContentRuntimeMessageHandler = (
    message: unknown,
    sender: unknown,
    sendResponse: (response?: unknown) => void,
) => boolean;
/** 创建当前 document 私有的 runtime message handler，避免跨生命周期共享可变状态。 */
export function createContentRuntimeMessageHandler(ctx: ContentScriptContext, state: ContentRuntimeMessageState,
    capabilities: BrowserCapabilities = browserCapabilities): ContentRuntimeMessageHandler {
    return (message, _sender, sendResponse) => {
        if (!message || typeof message !== 'object') return false;
        const payload = message as Record<string, unknown>;

        if (payload.type === 'updateSiteExtensionDisabled') {
            if (typeof payload.isDisabled !== 'boolean') return false;
            void state.updateSiteDisabled(payload.isDisabled)
                .then(() => sendResponse({status: 'success'}))
                .catch(() => sendResponse({status: 'failed'}));
            return true;
        }
        if (state.isSiteDisabled() && payload.type !== 'getFullPageTranslationState') {
            sendResponse({status: 'disabled'});
            return true;
        }
        if (payload.type === 'toggleFloatingBall') {
            const isEnabled = payload.isEnabled === true;
            config.disableFloatingBall = !isEnabled;
            if (isEnabled) void mountFloatingBall(ctx);
            else unmountFloatingBall();
            sendResponse();
            return true;
        }

        if (payload.type === 'updateSelectionTranslatorMode') {
            const mode = payload.mode;
            if (mode !== 'disabled' && mode !== 'bilingual' && mode !== 'translation-only') return false;

            config.selectionTranslatorMode = mode;
            config.disableSelectionTranslator = mode === 'disabled';
            if (mode === 'disabled') unmountSelectionTranslator();
            else if (!document.getElementById('fluent-read-selection-translator-container')) {
                void mountSelectionTranslator(ctx);
            }
            sendResponse();
            return true;
        }

        if (payload.type === 'updateSelectionTranslatorSettings') {
            const {trigger, customHotkey, delay} = payload;
            if (trigger !== 'direct' && trigger !== 'icon' && trigger !== 'dot'
                && trigger !== 'Control' && trigger !== 'Alt' && trigger !== 'Shift' && trigger !== 'custom') return false;
            if (customHotkey !== undefined && typeof customHotkey !== 'string') return false;
            if (delay !== undefined && typeof delay !== 'number' && typeof delay !== 'string') return false;

            config.selectionTranslatorTrigger = trigger;
            config.selectionTranslatorHotkey = trigger === 'Control' || trigger === 'Alt'
                || trigger === 'Shift' || trigger === 'custom'
                ? trigger
                : 'none';
            config.customSelectionTranslatorHotkey = typeof customHotkey === 'string' ? customHotkey : '';
            if (delay !== undefined) config.selectionTranslatorDelay = normalizeSelectionTranslatorDelay(delay);
            sendResponse();
            return true;
        }

        if (payload.type === 'toggleSelectionAreaTranslator') {
            if (rejectUnsupportedContentFeature(capabilities.areaTranslation, unmountAreaTranslator,
                sendResponse, '当前浏览器暂不支持圈选翻译')) return true;
            const isEnabled = payload.isEnabled === true;
            config.selectionAreaEnabled = isEnabled;
            if (isEnabled) void mountAreaTranslator(ctx);
            else unmountAreaTranslator();
            sendResponse();
            return true;
        }

        if (payload.type === 'toggleImageTranslator') {
            if (rejectUnsupportedContentFeature(capabilities.imageTranslation, unmountImageTranslator,
                sendResponse, '当前浏览器暂不支持图片翻译与 OCR')) return true;
            const isEnabled = payload.isEnabled === true;
            config.disableImageTranslator = !isEnabled;
            if (isEnabled) mountImageTranslator();
            else unmountImageTranslator();
            sendResponse();
            return true;
        }

        if (payload.type === 'toggleTranslationProgressPanel') {
            const isEnabled = payload.isEnabled === true;
            config.translationProgressPanelEnabled = isEnabled;
            if (isEnabled) void mountTranslationProgressPanel(ctx);
            else unmountTranslationProgressPanel();
            sendResponse();
            return true;
        }

        if (payload.type === 'getFullPageTranslationState') {
            sendResponse({
                status: 'success',
                isTranslated: !state.isSiteDisabled() && isFullPageTranslationActive(),
                isSiteDisabled: state.isSiteDisabled(),
            });
            return true;
        }

        if (payload.type === 'contextMenuTranslate') {
            if (config.on === false || state.isSiteDisabled()) {
                sendResponse({status: 'disabled'});
                return true;
            }
            if (payload.action === 'fullPage') {
                autoTranslateEnglishPage();
                const isTranslated = isFullPageTranslationActive();
                sendResponse({
                    status: isTranslated ? 'success' : 'failed',
                    action: isTranslated ? 'translated' : 'unchanged',
                    isTranslated,
                });
                return true;
            }
            if (payload.action === 'restore') {
                restoreOriginalContent();
                const isTranslated = isFullPageTranslationActive();
                sendResponse({
                    status: isTranslated ? 'failed' : 'success',
                    action: isTranslated ? 'unchanged' : 'restored',
                    isTranslated,
                });
                return true;
            }
        }

        return false;
    };
}
