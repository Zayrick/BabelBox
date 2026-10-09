import {clearTranslationLoadingAnimation} from '@/src/features/full-page-translation/ui/loadingAnimation';
import {releaseTranslationTruncationLayout} from './layout';

/**
 * 节点翻译状态以真实 DOM 节点为 key。全文与悬浮翻译共用这一份状态，
 * 恢复时只撤销插件自己写入的内容，宿主在期间写入的新 DOM/文本保持不动。
 */
type TranslationDisplayMode = "bilingual" | "single";
type TranslationPhase = "loading" | "translated" | "error";
type TranslationTargetKind = "content" | "control";

export interface TranslationState {
    mode: TranslationDisplayMode;
    /** 内容块使用上下双语；按钮等交互控件只替换内部可见文字。 */
    kind: TranslationTargetKind;
    phase: TranslationPhase;
    /** 规范化后的原文，用于判断宿主是否真正改写了内容。 */
    sourceText: string;
    /** 运行时包裹直接内联片段的 span；所有退出路径都会解包。 */
    syntheticSegment: boolean;
    /** 翻译开始前是否有 class 属性；恢复时避免留下空 class。 */
    hadClassAttribute: boolean;
    controller: AbortController;
    spinner?: HTMLElement;
    bilingualContent?: HTMLElement;
    retryWrapper?: HTMLElement;
    /** 插件最近一次写入该目标（loading 或译文）的时间，用于识别宿主的即时回滚。 */
    writtenAt: number;
    /** single/control 渲染直接改写的宿主 Text 节点。 */
    writtenTexts: Text[];
}

export interface WrittenText {
    owner: HTMLElement;
    original: string;
    value: string;
}

const states = new WeakMap<HTMLElement, TranslationState>();
const activeNodes = new Set<WeakRef<HTMLElement>>();
const activeRefs = new WeakMap<HTMLElement, WeakRef<HTMLElement>>();
/**
 * 插件写入过的 Text 节点 -> 写入记录。判断一段文字是不是插件译文只看
 * 节点身份和精确写入值，不靠文本内容猜测，宿主重渲染的时序因此不会
 * 让译文被误当成新原文再次翻译。
 */
const writtenTexts = new WeakMap<Text, WrittenText>();

export function getTranslationState(node: HTMLElement): TranslationState | undefined {
    return states.get(node);
}

export function getWrittenText(node: Text): WrittenText | undefined {
    const record = writtenTexts.get(node);
    return record && node.nodeValue === record.value ? record : undefined;
}

export function forEachTranslationState(callback: (node: HTMLElement, state: TranslationState) => void): void {
    const entries: Array<[HTMLElement, TranslationState]> = [];
    for (const ref of activeNodes) {
        const node = ref.deref();
        const state = node && states.get(node);
        if (!node || !state) {
            activeNodes.delete(ref);
            continue;
        }
        entries.push([node, state]);
    }
    entries.forEach(([node, state]) => callback(node, state));
}

interface TranslationStateInit {
    mode: TranslationDisplayMode;
    kind: TranslationTargetKind;
    syntheticSegment: boolean;
    sourceText: string;
}

/** loading 期间同一节点不会重复开始；已有的 translated/error 状态由调用方先恢复。 */
export function beginTranslation(node: HTMLElement, init: TranslationStateInit): TranslationState | null {
    if (states.has(node)) return null;
    const state: TranslationState = {
        ...init,
        phase: "loading",
        hadClassAttribute: node.hasAttribute("class"),
        controller: new AbortController(),
        writtenAt: Date.now(),
        writtenTexts: [],
    };
    states.set(node, state);
    const ref = new WeakRef(node);
    activeRefs.set(node, ref);
    activeNodes.add(ref);
    return state;
}

export function isCurrentTranslation(node: HTMLElement, state: TranslationState): boolean {
    return states.get(node) === state && !state.controller.signal.aborted && node.isConnected;
}

export function writeTranslatedText(state: TranslationState, owner: HTMLElement, node: Text, value: string): void {
    const original = writtenTexts.get(node)?.owner === owner
        ? writtenTexts.get(node)!.original
        : node.nodeValue ?? "";
    node.nodeValue = value;
    writtenTexts.set(node, {owner, original, value});
    if (!state.writtenTexts.includes(node)) state.writtenTexts.push(node);
}

/**
 * 撤销一个节点上的插件改动并清理状态。只写回仍保持插件译值的 Text，
 * 只移除本状态自己创建的 artifact。
 */
export function restoreTranslation(node: HTMLElement): boolean {
    const state = states.get(node);
    if (!state) return false;
    state.controller.abort();
    states.delete(node);
    const ref = activeRefs.get(node);
    if (ref) activeNodes.delete(ref);
    activeRefs.delete(node);

    clearTranslationLoadingAnimation(node);
    state.spinner?.remove();
    state.bilingualContent?.remove();
    state.retryWrapper?.remove();
    releaseTranslationTruncationLayout(node);
    for (const text of state.writtenTexts) {
        const record = writtenTexts.get(text);
        if (record?.owner !== node) continue;
        writtenTexts.delete(text);
        if (text.nodeValue === record.value) text.nodeValue = record.original;
    }
    node.classList.remove("babelbox-bilingual", "babelbox-failure");
    if (!state.hadClassAttribute && node.getAttribute("class") === "") node.removeAttribute("class");
    if (state.syntheticSegment && node.parentNode) node.replaceWith(...Array.from(node.childNodes));
    return true;
}

export function restoreAllTranslations(): void {
    forEachTranslationState((node) => restoreTranslation(node));
}
