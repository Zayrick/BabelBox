import {clearTranslationLoadingAnimation} from '@/src/features/full-page-translation/ui/loadingAnimation';
import {releaseTranslationTruncationLayout} from './layout';

/**
 * 指定节点翻译的生命周期状态。
 *
 * 这里使用真实 DOM 节点作为 WeakMap 的 key，而不是 outerHTML。
 * outerHTML 会因为属性、站点重渲染或相同段落而产生身份冲突；
 * 节点状态则可以准确绑定到本次用户操作的目标。
 */
type TranslationDisplayMode = "bilingual" | "single";
type TranslationPhase = "loading" | "translated" | "error";
type TranslationTargetKind = "content" | "control";

export interface TranslationState {
    mode: TranslationDisplayMode;
    /** 内容块使用上下双语；按钮等交互控件只替换内部可见文字。 */
    kind: TranslationTargetKind;
    phase: TranslationPhase;
    generation: number;
    sourceText: string;
    /** Text-slot identities visible at request creation, before any live replacement. */
    sourceTextNodes?: readonly Text[];
    /** Runtime-only wrapper around a direct inline run; removed on every exit path. */
    syntheticSegment: boolean;
    /** Exact direct children captured before the loading spinner is appended. */
    syntheticSourceNodes?: readonly ChildNode[];
    /** 翻译开始前的内联 style 属性，用于可条件恢复。 */
    originalStyleAttribute: string | null;
    /** 翻译开始前的 class 属性；恢复时避免留下空 class。 */
    originalClassAttribute: string | null;
    /** 插件完成渲染后记录的 style 属性；undefined 表示尚未改动样式。 */
    renderedStyleAttribute?: string | null;
    /** 插件完成渲染后记录的 class 属性，用于过滤自身添加 bilingual class 的 mutation。 */
    renderedClassAttribute?: string | null;
    /** Translation changed only the original Text nodes; DOM structure stayed live. */
    textSlotsApplied?: boolean;
    /** 控件翻译直接修改原 Text 节点；恢复时需要把节点内容写回原值。 */
    originalTextValues: Array<{node: Text; value: string}>;
    /** Exact values written by the live text-slot renderer. */
    translatedTextValues?: WeakMap<Text, string>;
    /** Text nodes that were visible/translatable when single/control rendering ran. */
    translatedTextNodes?: readonly Text[];
    controller: AbortController;
    spinner?: HTMLElement;
    bilingualContent?: HTMLElement;
    /** 失败态的重试控件。 */
    retryWrapper?: HTMLElement;
}

interface TranslationAttempt {
    state: TranslationState;
    generation: number;
}

const states = new WeakMap<HTMLElement, TranslationState>();
const activeNodeRefs = new Set<WeakRef<HTMLElement>>();
const activeRefsByNode = new WeakMap<HTMLElement, WeakRef<HTMLElement>>();

function forEachActiveNode(callback: (node: HTMLElement, state: TranslationState) => void): void {
    for (const ref of activeNodeRefs) {
        const node = ref.deref();
        if (!node) {
            activeNodeRefs.delete(ref);
            continue;
        }
        const state = states.get(node);
        if (!state) {
            activeNodeRefs.delete(ref);
            continue;
        }
        callback(node, state);
    }
}

function trackActiveNode(node: HTMLElement): WeakRef<HTMLElement> {
    const existing = activeRefsByNode.get(node);
    if (existing) return existing;
    const ref = new WeakRef(node);
    activeRefsByNode.set(node, ref);
    activeNodeRefs.add(ref);
    return ref;
}

export function getTranslationState(node: HTMLElement): TranslationState | undefined {
    return states.get(node);
}

/**
 * 开始一次新的节点翻译请求。
 * loading 状态不能重复发起请求；error 状态可以被调用方先恢复后重试。
 */
export function beginTranslation(
    node: HTMLElement,
    mode: TranslationDisplayMode,
    kind: TranslationTargetKind = "content",
    syntheticSegment = false,
    sourceText = node.textContent ?? "",
    sourceTextNodes?: readonly Text[],
): TranslationAttempt | null {
    const previous = states.get(node);
    if (previous?.phase === "loading") return null;

    previous?.controller.abort();

    const originalTextValues: Array<{node: Text; value: string}> = [];
    if ((mode === "single" || kind === "control") && node.ownerDocument?.createTreeWalker) {
        const textWalker = node.ownerDocument.createTreeWalker(node, 4);
        let textNode = textWalker.nextNode();
        while (textNode) {
            originalTextValues.push({node: textNode as Text, value: textNode.nodeValue ?? ""});
            textNode = textWalker.nextNode();
        }
    }

    const state: TranslationState = {
        mode,
        kind,
        phase: "loading",
        generation: (previous?.generation ?? 0) + 1,
        sourceText,
        sourceTextNodes: sourceTextNodes ? [...sourceTextNodes] : undefined,
        syntheticSegment,
        syntheticSourceNodes: syntheticSegment ? Array.from(node.childNodes) : undefined,
        originalStyleAttribute: node.getAttribute("style"),
        originalClassAttribute: node.getAttribute("class"),
        originalTextValues,
        controller: new AbortController(),
    };

    states.set(node, state);
    trackActiveNode(node);
    return { state, generation: state.generation };
}

function isCurrentTranslation(
    node: HTMLElement,
    state: TranslationState,
    generation: number,
): boolean {
    return (
        states.get(node) === state &&
        state.generation === generation &&
        !state.controller.signal.aborted &&
        node.isConnected
    );
}

export function markTranslationComplete(
    node: HTMLElement,
    state: TranslationState,
    generation: number,
): boolean {
    return transitionPhase(node, state, generation, "translated");
}

export function markTranslationError(
    node: HTMLElement,
    state: TranslationState,
    generation: number,
): boolean {
    return transitionPhase(node, state, generation, "error");
}

function transitionPhase(
    node: HTMLElement,
    state: TranslationState,
    generation: number,
    phase: Extract<TranslationPhase, "translated" | "error">,
): boolean {
    if (!isCurrentTranslation(node, state, generation)) return false;
    state.phase = phase;
    state.spinner = undefined;
    return true;
}

type TranslationArtifactKey = "spinner" | "bilingualContent" | "retryWrapper";

function setArtifact(
    node: HTMLElement,
    key: TranslationArtifactKey,
    artifact: HTMLElement,
): void {
    const state = states.get(node);
    if (!state) return;
    state[key] = artifact;
}

export function setSpinner(node: HTMLElement, spinner: HTMLElement): void {
    setArtifact(node, "spinner", spinner);
}

export function setBilingualContent(node: HTMLElement, content: HTMLElement): void {
    setArtifact(node, "bilingualContent", content);
}

export function setRetryWrapper(node: HTMLElement, wrapper: HTMLElement): void {
    setArtifact(node, "retryWrapper", wrapper);
}

/**
 * 记录插件完成渲染后的内联样式。
 *
 * 恢复时只有当节点仍保持这个值，才会写回原始样式；如果网站已经
 * 修改过 style，则保留网站的新值，避免翻译恢复覆盖宿主页面更新。
 */
export function setRenderedStyleAttribute(node: HTMLElement): void {
    const state = states.get(node);
    if (state) {
        state.renderedStyleAttribute = node.getAttribute("style");
        state.renderedClassAttribute = node.getAttribute("class");
    }
}

function removeExtensionNode(node: Node | undefined): void {
    if (node?.parentNode) node.parentNode.removeChild(node);
}

function removeRetryArtifacts(node: HTMLElement): void {
    node.querySelectorAll('[data-babelbox-translation-owned="true"]')
        .forEach((child) => child.remove());
}

function clearState(node: HTMLElement): void {
    states.delete(node);
    const ref = activeRefsByNode.get(node);
    if (ref) activeNodeRefs.delete(ref);
    activeRefsByNode.delete(node);
}

function unwrapSyntheticSegment(node: HTMLElement, state: TranslationState): void {
    if (!state.syntheticSegment || !node.parentNode) return;
    const parent = node.parentNode;
    while (node.firstChild) parent.insertBefore(node.firstChild, node);
    parent.removeChild(node);
}

function restoreOriginalStyle(node: HTMLElement, state: TranslationState): void {
    if (state.renderedStyleAttribute === undefined) return;
    if (node.getAttribute("style") !== state.renderedStyleAttribute) return;

    if (state.originalStyleAttribute === null) {
        node.removeAttribute("style");
    } else {
        node.setAttribute("style", state.originalStyleAttribute);
    }
}

function restoreOriginalClass(node: HTMLElement, state: TranslationState): void {
    if (state.renderedClassAttribute === undefined) return;
    if (node.getAttribute("class") === state.renderedClassAttribute) {
        if (state.originalClassAttribute === null) node.removeAttribute("class");
        else node.setAttribute("class", state.originalClassAttribute);
        return;
    }

    node.classList.remove("babelbox-bilingual", "babelbox-failure");
    if (state.originalClassAttribute === null && node.getAttribute("class") === "") {
        node.removeAttribute("class");
    }
}

/**
 * 恢复单个节点并清理状态。
 * 双语模式只移除译文节点；single/control 只恢复仍保持插件译值的 Text。
 * 宿主在翻译期间写入的新 DOM 或新文本永远不会被旧快照覆盖。
 */
export function restoreTranslation(node: HTMLElement): boolean {
    const state = states.get(node);
    if (!state) return false;
    teardownAttempt(node, state, true);
    return true;
}

/**
 * 丢弃一个已经失效的请求，但保留站点在请求期间写入的内容。
 * 这与 restoreTranslation 不同：它只适用于翻译结果尚未写回页面的情况。
 */
export function discardTranslation(
    node: HTMLElement,
    state: TranslationState,
): boolean {
    if (states.get(node) !== state) return false;
    teardownAttempt(node, state, false);
    return true;
}

function teardownAttempt(
    node: HTMLElement,
    state: TranslationState,
    restoreTextSlots: boolean,
): void {
    state.generation += 1;
    state.controller.abort();
    clearTranslationLoadingAnimation(node);
    removeExtensionNode(state.spinner);
    removeExtensionNode(state.bilingualContent);
    removeRetryArtifacts(node);
    releaseTranslationTruncationLayout(node);

    if (restoreTextSlots && state.textSlotsApplied) {
        state.originalTextValues.forEach(({node: textNode, value}) => {
            if (!node.contains(textNode)) return;
            const translatedValue = state.translatedTextValues?.get(textNode);
            if (translatedValue === undefined || textNode.nodeValue === translatedValue) {
                textNode.nodeValue = value;
            }
        });
    }

    restoreOriginalStyle(node, state);
    restoreOriginalClass(node, state);
    clearState(node);
    unwrapSyntheticSegment(node, state);
}

export function setTextSlotsApplied(
    node: HTMLElement,
    translatedTextNodes?: readonly Text[],
): void {
    const state = states.get(node);
    if (state) {
        state.textSlotsApplied = true;
        state.translatedTextNodes = translatedTextNodes
            ? [...translatedTextNodes]
            : state.originalTextValues.map(({node: textNode}) => textNode);
        state.translatedTextValues = new WeakMap(
            state.originalTextValues.map(({node: textNode}) => [textNode, textNode.nodeValue ?? ""]),
        );
    }
}

export function reconcileEquivalentTranslation(
    node: HTMLElement,
    state: TranslationState,
    currentTextNodes: readonly Text[],
): boolean {
    if (states.get(node) !== state || state.phase !== "translated" || !node.isConnected) return false;

    if (state.textSlotsApplied) {
        const previousNodes = state.translatedTextNodes;
        const translatedValues = state.translatedTextValues;
        const originalValues = new Map(
            state.originalTextValues.map(({node: textNode, value}) => [textNode, value]),
        );
        if (!previousNodes || !translatedValues || previousNodes.length !== currentTextNodes.length) return false;
        const sources = previousNodes.map((textNode) => originalValues.get(textNode));
        const replacements = previousNodes.map((textNode) => translatedValues.get(textNode));
        if (sources.some((value) => value === undefined) || replacements.some((value) => value === undefined) ||
            currentTextNodes.some((textNode, index) => (textNode.nodeValue ?? "") !== sources[index])) return false;

        state.originalTextValues = currentTextNodes.map((textNode, index) => ({
            node: textNode,
            value: sources[index]!,
        }));
        currentTextNodes.forEach((textNode, index) => {
            textNode.nodeValue = replacements[index]!;
        });
        setTextSlotsApplied(node, currentTextNodes);
        return true;
    }

    // The caller has already compared the effective source text. DOM shape and
    // attributes are not translation identity, so a detached bilingual wrapper
    // can be reattached without another provider request.
    const content = state.bilingualContent;
    if (!content || (content.isConnected && content.parentNode !== node)) return false;
    state.sourceTextNodes = [...currentTextNodes];
    if (!content.isConnected) {
        node.classList.add("babelbox-bilingual");
        node.appendChild(content);
    }
    return true;
}

/**
 * 恢复所有由指定节点翻译状态机管理的节点。
 * Set 只用于可枚举生命周期；真正的状态仍然存储在 WeakMap 中。
 */
export function restoreAllTranslations(): void {
    const nodes: HTMLElement[] = [];
    forEachActiveNode((node) => nodes.push(node));
    nodes.forEach((node) => restoreTranslation(node));
}
