import {browser} from 'wxt/browser';
import {resolveTranslationCandidateAtPoint} from "@/src/core/translation/public";
import {checkConfig} from './configCheck';
import {clearTranslationMemo, currentDisplayMode, translateTarget} from "./pipeline";
import {
    isFullPageSessionActive,
    rememberUserRestore,
    startFullPageSession,
    stopFullPageSession,
} from "./session";
import {restoreAllTranslations} from "./state";

let hoverTimer: ReturnType<typeof setTimeout> | undefined;

function notifyFullPageTranslationState(isTranslated: boolean): void {
    const CustomEventConstructor = document.defaultView?.CustomEvent ??
        (typeof CustomEvent !== "undefined" ? CustomEvent : null);
    if (CustomEventConstructor) {
        document.dispatchEvent(new CustomEventConstructor(
            isTranslated ? "babelbox-translation-started" : "babelbox-translation-ended",
        ));
    }
    void browser.runtime.sendMessage({type: "fullPageTranslationState", isTranslated}).catch(() => {
        // 后台可能正在重载；页面内的翻译状态不应因此失败。
    });
}

/** 恢复整页原文。全文和悬浮翻译共享节点状态，因此一次恢复全部。 */
export function restoreOriginalContent(): void {
    cancelPendingHoverTranslation();
    stopFullPageSession();
    restoreAllTranslations();
    clearTranslationMemo();
    notifyFullPageTranslationState(false);
}

/**
 * 启动全文翻译会话：从 documentElement 扫描候选，按可见性预取窗口调度，
 * 并持续观察新增 DOM 与 open ShadowRoot。网络并发由统一翻译队列控制。
 */
export function autoTranslateEnglishPage(): void {
    if (!checkConfig() || isFullPageSessionActive()) return;
    const root = document.documentElement;
    if (!root) return;
    startFullPageSession(root);
    notifyFullPageTranslationState(true);
}

export function isFullPageTranslationActive(): boolean {
    return isFullPageSessionActive();
}

export function cancelPendingHoverTranslation(): void {
    if (hoverTimer === undefined) return;
    clearTimeout(hoverTimer);
    hoverTimer = undefined;
}

/**
 * 鼠标悬浮/快捷键翻译。坐标只用于定位内容块，翻译与恢复和全文会话
 * 共用同一条管线。delayTime > 0 表示滑动触发，不会把已译段落切回原文。
 */
export function handleTranslation(mouseX: number, mouseY: number, delayTime = 0): void {
    if (!checkConfig()) return;
    cancelPendingHoverTranslation();
    hoverTimer = setTimeout(() => {
        hoverTimer = undefined;
        const candidate = resolveTranslationCandidateAtPoint(mouseX, mouseY);
        if (!candidate) return;
        void translateTarget(candidate, currentDisplayMode(), delayTime > 0).then((outcome) => {
            if (outcome.status === "restored") rememberUserRestore(candidate, outcome.source);
        });
    }, delayTime);
}
