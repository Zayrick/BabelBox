import type { ContentScriptContext } from 'wxt/utils/content-script-context';
import type { ShadowRootContentScriptUi } from 'wxt/utils/content-script-ui/shadow-root';
import { CircleAlert, CircleCheck, LoaderCircle, type IconNode } from 'lucide';
import { createLucideIconElement } from '@/src/ui/icons/lucideDom';
import {usesAnimatedEffects, type AnimationMode} from '@/src/core/config/animation';
import {
    canCommitInputBoxTranslation,
    getDeepActiveElement,
    getInputBoxText,
    getInputBoxValueSnapshot,
    isInputElement,
    matchesInputBoxTrigger,
    removeTriggerSymbols,
    type InputBoxTrigger,
} from './inputBox';

export interface InputTranslationContentConfig {
    on?: boolean;
    inputBoxTranslationTrigger: string;
    inputBoxTranslationTarget: string;
    animationMode?: AnimationMode;
}

export interface InputTranslationContentDependencies {
    context: ContentScriptContext;
    config: InputTranslationContentConfig;
    isSiteDisabled: () => boolean;
    readConfigGeneration: () => number;
    sendMessage: (message: unknown) => Promise<unknown>;
    document: Document;
    createUi: <T extends HTMLElement>(
        context: ContentScriptContext,
        options: {
            name: string;
            position: 'overlay';
            alignment: 'top-left';
            zIndex: number;
            mode: 'closed';
            inheritStyles: false;
            css: string;
            onMount: (container: HTMLElement) => T;
        },
    ) => Promise<ShadowRootContentScriptUi<T>>;
    logger: Pick<Console, 'error'>;
}

export interface InputTranslationContentFeature {
    mount: (signal: AbortSignal) => void;
    invalidate: () => void;
}

export function inputBoxTranslationConfigKey(value: InputTranslationContentConfig): string {
    return JSON.stringify([
        value.on,
        value.inputBoxTranslationTrigger,
        value.inputBoxTranslationTarget,
    ]);
}

export function isInputBoxTranslationEnabled(
    config: Pick<InputTranslationContentConfig, 'on' | 'inputBoxTranslationTrigger'>,
    isSiteDisabled = false,
): boolean {
    return !isSiteDisabled
        && config.on !== false
        && config.inputBoxTranslationTrigger !== 'disabled';
}

export function setInputBoxText(element: HTMLElement, text: string): void {
    const tagName = element.tagName.toLowerCase();

    if (tagName === 'input' || tagName === 'textarea') {
        const inputElement = element as HTMLInputElement | HTMLTextAreaElement;
        inputElement.value = text;
        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
        inputElement.dispatchEvent(new Event('change', { bubbles: true }));
        return;
    }

    if (isInputElement(element)) {
        element.innerText = text;
        element.dispatchEvent(new Event('input', { bubbles: true }));
    }
}

function getTooltipIcon(type: 'translating' | 'success' | 'error'): IconNode {
    const icons: Record<typeof type, IconNode> = {
        translating: LoaderCircle,
        success: CircleCheck,
        error: CircleAlert,
    };
    return icons[type];
}

async function translateWithMicrosoft(
    sendMessage: (message: unknown) => Promise<unknown>,
    text: string,
    targetLang: string,
): Promise<string> {
    const result = await sendMessage({
        type: 'inputBoxTranslation',
        text,
        targetLang,
    }) as { success?: boolean; translatedText?: string; error?: string } | undefined;

    if (result?.success) return result.translatedText || '';
    throw new Error(result?.error || '微软翻译失败');
}

export function createInputTranslationContentFeature(
    deps: InputTranslationContentDependencies,
): InputTranslationContentFeature {
    const rootDocument = deps.document;
    const createUi = deps.createUi;
    const logger = deps.logger;
    let inputTooltipUi: ShadowRootContentScriptUi<HTMLElement> | null = null;
    let inputTooltipOwnerRequestId: number | null = null;
    let activeInputTranslationRequestId = 0;
    let activeInputTranslationElement: HTMLElement | null = null;

    const isEnabled = () => isInputBoxTranslationEnabled(deps.config, deps.isSiteDisabled());
    const animationsEnabled = () => usesAnimatedEffects(deps.config.animationMode);

    const removeExistingTooltip = (ownerRequestId?: number): void => {
        if (ownerRequestId !== undefined && inputTooltipOwnerRequestId !== ownerRequestId) return;

        const ui = inputTooltipUi;
        const existing = ui?.mounted;
        inputTooltipUi = null;
        inputTooltipOwnerRequestId = null;
        if (!ui) return;

        if (!existing || !animationsEnabled()) {
            ui.remove();
            return;
        }

        existing.classList.add('hide');
        setTimeout(() => ui.remove(), 300);
    };

    const invalidate = (): void => {
        activeInputTranslationRequestId += 1;
        activeInputTranslationElement?.classList.remove('fluent-input-translating');
        activeInputTranslationElement = null;
        removeExistingTooltip();
    };

    const addInputBoxAnimation = (
        element: HTMLElement,
        animationType: 'translating' | 'success' | 'error',
        ownerRequestId: number,
    ): void => {
        if (!animationsEnabled()) return;

        element.classList.remove('fluent-input-translating', 'fluent-input-success', 'fluent-input-error');
        element.classList.add(`fluent-input-${animationType}`);

        if (animationType !== 'translating') {
            setTimeout(() => {
                if (ownerRequestId !== activeInputTranslationRequestId) return;
                element.classList.remove(`fluent-input-${animationType}`);
            }, animationType === 'success' ? 1000 : 600);
        }
    };

    const createTranslationTooltip = async (
        element: HTMLElement,
        message: string,
        type: 'translating' | 'success' | 'error',
        requestId: number,
        signal: AbortSignal,
    ): Promise<HTMLElement | null> => {
        removeExistingTooltip();
        inputTooltipOwnerRequestId = requestId;
        const rect = element.getBoundingClientRect();

        const ui = await createUi<HTMLElement>(deps.context, {
            name: 'fluent-read-input-tooltip-ui',
            position: 'overlay',
            alignment: 'top-left',
            zIndex: 2_147_483_647,
            mode: 'closed',
            inheritStyles: false,
            css: `
                :host {
                    --fr-input-font-small: 11px;
                    --fr-input-weight-medium: 600;
                    all: initial !important;
                    display: block !important;
                    position: relative !important;
                    width: 0 !important;
                    height: 0 !important;
                    overflow: visible !important;
                }
                html, body {
                    width: 0 !important;
                    height: 0 !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    overflow: visible !important;
                }
                .fluent-input-tooltip {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    position: fixed;
                    box-sizing: border-box;
                    background: rgba(17, 24, 39, 0.88);
                    color: #fff;
                    padding: 8px 12px;
                    border: 0;
                    border-radius: 8px;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
                    font-size: var(--fr-input-font-small);
                    font-weight: var(--fr-input-weight-medium);
                    line-height: 1.4;
                    white-space: nowrap;
                    z-index: 2147483647;
                    pointer-events: none;
                    transition: opacity 0.2s ease, transform 0.2s ease;
                    backdrop-filter: blur(8px);
                    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.2);
                }
                .fluent-input-tooltip.show { opacity: 1; transform: translateX(-50%) translateY(0); }
                .fluent-input-tooltip.hide { opacity: 0; transform: translateX(-50%) translateY(-5px); }
                .fluent-input-tooltip.translating { background: rgba(59, 130, 246, 0.9); }
                .fluent-input-tooltip.success { background: rgba(34, 197, 94, 0.9); }
                .fluent-input-tooltip.error { background: rgba(239, 68, 68, 0.9); }
                .fluent-input-tooltip-icon { width: 14px; height: 14px; flex: 0 0 auto; stroke-width: 2; }
                ${animationsEnabled() ? '.fluent-input-tooltip.translating .fluent-input-tooltip-icon { animation: fluent-read-input-icon-spin .9s linear infinite; }' : ''}
                @keyframes fluent-read-input-icon-spin { to { transform: rotate(360deg); } }
                @media (prefers-reduced-motion: reduce) {
                    .fluent-input-tooltip { transition: none; }
                    .fluent-input-tooltip-icon { animation: none !important; }
                }
            `,
            onMount(container) {
                const tooltip = rootDocument.createElement('div');
                tooltip.className = `fluent-input-tooltip ${type}`;
                tooltip.id = 'fluent-input-translation-tooltip';
                const icon = createLucideIconElement(getTooltipIcon(type), {}, rootDocument);
                icon.classList.add('fluent-input-tooltip-icon');
                const messageElement = rootDocument.createElement('span');
                messageElement.textContent = message;
                tooltip.appendChild(icon);
                tooltip.appendChild(messageElement);
                tooltip.style.top = `${rect.bottom + 12}px`;
                tooltip.style.left = `${rect.left + (rect.width / 2)}px`;
                tooltip.style.transform = 'translateX(-50%) translateY(3px)';
                tooltip.style.opacity = animationsEnabled() ? '0' : '1';
                container.appendChild(tooltip);
                return tooltip;
            },
        });

        if (
            signal.aborted
            || requestId !== activeInputTranslationRequestId
            || inputTooltipOwnerRequestId !== requestId
            || !isEnabled()
        ) {
            ui.remove();
            return null;
        }

        inputTooltipUi = ui;
        ui.shadowHost.id = 'fluent-input-translation-tooltip-host';
        ui.shadowHost.setAttribute('data-fluent-read-ui', 'input-tooltip');
        ui.mount();

        const tooltip = ui.mounted!;
        if (!animationsEnabled()) {
            tooltip.style.opacity = '1';
            tooltip.style.transform = 'translateX(-50%) translateY(0)';
        } else {
            tooltip.style.opacity = '0';
            setTimeout(() => tooltip.classList.add('show'), 10);
        }

        return tooltip;
    };

    const handleInputBoxTranslation = async (
        element: HTMLElement,
        signal: AbortSignal,
    ): Promise<void> => {
        invalidate();
        const requestId = activeInputTranslationRequestId;
        activeInputTranslationElement = element;
        const configGeneration = deps.readConfigGeneration();
        const inputSnapshot = getInputBoxValueSnapshot(element);
        const originalText = getInputBoxText(element);
        const trigger = deps.config.inputBoxTranslationTrigger;
        const targetLanguage = deps.config.inputBoxTranslationTarget;

        const isCurrentAndUnchanged = () => requestId === activeInputTranslationRequestId
            && canCommitInputBoxTranslation({
                signal,
                expectedValue: inputSnapshot,
                currentValue: getInputBoxValueSnapshot(element),
                expectedConfigGeneration: configGeneration,
                currentConfigGeneration: deps.readConfigGeneration(),
                isEnabled: isEnabled(),
                isSiteDisabled: deps.isSiteDisabled(),
            });
        const clearOwnedVisuals = () => {
            if (requestId !== activeInputTranslationRequestId) return;
            element.classList.remove('fluent-input-translating');
            if (activeInputTranslationElement === element) activeInputTranslationElement = null;
            removeExistingTooltip(requestId);
        };
        const handleAbort = () => clearOwnedVisuals();
        signal.addEventListener('abort', handleAbort, { once: true });

        try {
            // 固定输入快照和配置 generation；任何用户编辑、关闭或站点禁用都会阻止写回。
            if (!isCurrentAndUnchanged() || !originalText) return;
            const cleanedText = removeTriggerSymbols(originalText, trigger);
            if (!cleanedText) return;

            // 只让当前请求拥有输入框动画和 tooltip，旧请求不能清理新提示。
            removeExistingTooltip();
            addInputBoxAnimation(element, 'translating', requestId);
            const loadingTooltip = await createTranslationTooltip(
                element,
                '微软翻译中',
                'translating',
                requestId,
                signal,
            );
            if (!loadingTooltip || !isCurrentAndUnchanged()) {
                clearOwnedVisuals();
                return;
            }

            try {
                // background 消息不能中断，结果落地前再次校验快照和 feature signal。
                const translatedText = await translateWithMicrosoft(deps.sendMessage, cleanedText, targetLanguage);
                if (!isCurrentAndUnchanged()) {
                    clearOwnedVisuals();
                    return;
                }

                element.classList.remove('fluent-input-translating');
                removeExistingTooltip(requestId);
                if (translatedText && translatedText !== cleanedText) {
                    setInputBoxText(element, translatedText);
                    addInputBoxAnimation(element, 'success', requestId);
                    await createTranslationTooltip(element, '翻译成功', 'success', requestId, signal);
                } else {
                    addInputBoxAnimation(element, 'error', requestId);
                    await createTranslationTooltip(element, '内容无需翻译', 'error', requestId, signal);
                }
            } catch (translationError) {
                if (!isCurrentAndUnchanged()) {
                    clearOwnedVisuals();
                    return;
                }
                element.classList.remove('fluent-input-translating');
                addInputBoxAnimation(element, 'error', requestId);
                removeExistingTooltip(requestId);
                await createTranslationTooltip(element, '微软翻译失败', 'error', requestId, signal);
                logger.error('微软翻译失败:', translationError);
            }

            setTimeout(() => removeExistingTooltip(requestId), 2500);
        } catch (error) {
            if (!isCurrentAndUnchanged()) {
                clearOwnedVisuals();
                return;
            }
            logger.error('输入框翻译失败:', error);
            element.classList.remove('fluent-input-translating');
            addInputBoxAnimation(element, 'error', requestId);
            removeExistingTooltip(requestId);
            await createTranslationTooltip(element, '翻译服务暂时不可用', 'error', requestId, signal);
            setTimeout(() => removeExistingTooltip(requestId), 3000);
        } finally {
            signal.removeEventListener('abort', handleAbort);
        }
    };

    const mount = (signal: AbortSignal): void => {
        let keyPressCount = 0;
        let keyPressTimer: ReturnType<typeof setTimeout> | null = null;
        let lastInputElement: HTMLElement | null = null;
        const tripleKeyTimeout = 1000;

        const resetKeyPresses = () => {
            keyPressCount = 0;
            lastInputElement = null;
            if (keyPressTimer) {
                clearTimeout(keyPressTimer);
                keyPressTimer = null;
            }
        };

        const handleKeyDown = async (event: KeyboardEvent) => {
            if (!event.isTrusted) return;
            if (deps.isSiteDisabled()) return;
            if (!isEnabled()) {
                resetKeyPresses();
                return;
            }

            const activeElement = getDeepActiveElement(rootDocument);
            if (!isInputElement(activeElement)) {
                resetKeyPresses();
                return;
            }

            const triggerType = deps.config.inputBoxTranslationTrigger;
            // Ctrl+Enter 立即触发；三连击只记录同一个输入目标上的连续目标按键。
            if (triggerType === 'ctrl_enter') {
                if (event.ctrlKey && event.key === 'Enter') {
                    event.preventDefault();
                    await handleInputBoxTranslation(activeElement, signal);
                }
                return;
            }

            if (triggerType === 'triple_space' || triggerType === 'triple_equal' || triggerType === 'triple_dash') {
                if (event.repeat || !matchesInputBoxTrigger(event, triggerType as InputBoxTrigger)) {
                    resetKeyPresses();
                    return;
                }

                if (lastInputElement !== activeElement) {
                    keyPressCount = 1;
                    lastInputElement = activeElement;
                } else {
                    keyPressCount += 1;
                }

                // 第三次按键先阻止触发符号继续进入页面，再启动异步翻译。
                if (keyPressCount === 3) {
                    event.preventDefault();
                    resetKeyPresses();
                    await handleInputBoxTranslation(activeElement, signal);
                    return;
                }

                if (keyPressTimer) clearTimeout(keyPressTimer);
                keyPressTimer = setTimeout(resetKeyPresses, tripleKeyTimeout);
            }
        };

        rootDocument.addEventListener('keydown', handleKeyDown, { capture: true, signal });
        signal.addEventListener('abort', resetKeyPresses, { once: true });
    };

    return { mount, invalidate };
}
