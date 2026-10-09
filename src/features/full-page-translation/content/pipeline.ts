import {services} from "@/src/core/config/catalog";
import {styles} from "@/src/core/config/constants";
import {getTranslationServiceProvider} from '@/src/core/config/translationServices';
import {detectlang} from "@/src/core/language/detect";
import {
    applyTranslationsToSnapshot,
    collectLiveTranslationTextSlots,
    createTranslationSourceSnapshot,
    extractTranslationText,
    extractTranslationTextFromNodes,
    getCurrentTranslationCore,
    getTranslationCandidateKey,
    isClearlyTargetLanguage,
    parseTranslationSlots,
    resolveTranslationCandidate,
    serializeTranslationSlots,
} from "@/src/core/translation/public";
import type {TranslationCandidate, TranslationTextSlot} from "@/src/core/translation/public";
import {config} from "@/src/services/config/store";
import {translateText, translateTextBatch} from '@/src/services/translation/client';
import {
    cancelTranslationQueueSession,
    createTranslationQueueSession,
} from "@/src/services/translation/queue";
import {
    insertFailedTip,
    insertLoadingSpinner,
} from '@/src/features/full-page-translation/ui/translationIndicators';
import {clearTranslationLoadingAnimation} from '@/src/features/full-page-translation/ui/loadingAnimation';
import {appendBilingualTranslation} from "./renderer";
import {
    beginTranslation,
    getTranslationState,
    getWrittenText,
    isCurrentTranslation,
    restoreTranslation,
    writeTranslatedText,
    type TranslationState,
} from "./state";
import {ownWrite} from "./ownWrites";

export const TRANSLATION_SEGMENT_SELECTOR = '[data-babelbox-translation-segment="true"]';
export const TRANSLATION_ARTIFACT_SELECTOR = '[data-babelbox-translation-owned="true"]';

export type DisplayMode = "bilingual" | "single";

export type TranslationOutcome =
    | {status: "done"}
    | {status: "skipped"}
    /** 目标已是目标语言或服务返回原文；同一全文会话内不再重复请求。 */
    | {status: "unchanged"; source: string}
    /** 用户主动恢复了已译目标。 */
    | {status: "restored"; source: string}
    /** 请求期间宿主改写了原文；调用方按需重新扫描 retryRoot。 */
    | {status: "stale"; retryRoot?: Node};

const DONE: TranslationOutcome = {status: "done"};
const SKIPPED: TranslationOutcome = {status: "skipped"};
const MEMO_LIMIT = 2000;

/**
 * 当前页面已经得到的译文。宿主用相同原文重渲染时直接复用，
 * 不再显示 loading，也不再请求服务；页面恢复原文时清空。
 */
const translationMemo = new Map<string, readonly string[]>();
let memoGeneration = 0;

function memoKey(sources: readonly string[]): string {
    return [config.service, config.to, ...sources].join("\u0000");
}

function rememberTranslation(sources: readonly string[], translations: readonly string[]): void {
    const key = memoKey(sources);
    translationMemo.delete(key);
    translationMemo.set(key, translations);
    if (translationMemo.size > MEMO_LIMIT) {
        const oldest = translationMemo.keys().next().value;
        if (oldest !== undefined) translationMemo.delete(oldest);
    }
}

export function clearTranslationMemo(): void {
    translationMemo.clear();
    memoGeneration += 1;
}

export function normalizeComparableText(text: string): string {
    return text.replace(/[\s　]+/g, " ").trim();
}

export function currentDisplayMode(): DisplayMode {
    return config.display === styles.bilingualTranslation ? "bilingual" : "single";
}

export interface SourceSlot {
    slot: TranslationTextSlot;
    /** null 表示这段文字是另一个翻译目标写入的译文，不属于本目标的原文。 */
    source: string | null;
}

/**
 * 读取目标当前的原文槽位。本目标写入过的 Text 按写入记录还原为原文，
 * 其他目标写入的 Text 被排除，嵌套目标因此不会互相把对方的译文当原文。
 */
export function readSourceSlots(node: HTMLElement, synthetic: boolean): SourceSlot[] {
    const core = getCurrentTranslationCore();
    return collectLiveTranslationTextSlots(
        node,
        core.shouldStayOriginalForSource,
        synthetic ? node : undefined,
    ).map((slot) => {
        const written = getWrittenText(slot.node);
        if (!written) return {slot, source: slot.source};
        if (written.owner !== node) return {slot, source: null};
        const source = written.original.trim();
        return source ? {slot: {...slot, source}, source} : {slot, source: null};
    });
}

export function sourcesOf(entries: readonly SourceSlot[]): string[] {
    return entries.flatMap((entry) => entry.source === null ? [] : [entry.source]);
}

export function sourceTextOf(sources: readonly string[]): string {
    return normalizeComparableText(sources.join(" "));
}

export function stateRescanRoot(node: HTMLElement, state: TranslationState): Node | undefined {
    const root = state.syntheticSegment ? node.parentElement : node;
    return root?.isConnected ? root : undefined;
}

function rendersInPlace(state: TranslationState): boolean {
    return state.kind === "control" || state.mode === "single";
}

/** 已译目标的渲染结果是否仍由插件持有；宿主用相同原文覆盖后返回 false。 */
export function isRenderIntact(node: HTMLElement, state: TranslationState, entries: readonly SourceSlot[]): boolean {
    if (rendersInPlace(state)) {
        return entries.every((entry) => entry.source === null || getWrittenText(entry.slot.node)?.owner === node);
    }
    return state.bilingualContent?.parentNode === node;
}

/** 已经承载该候选状态的节点：精确元素、共享 key 的元素或 synthetic segment。 */
export function findStateTarget(candidate: TranslationCandidate): HTMLElement | null {
    const key = getTranslationCandidateKey(candidate);
    if (key.nodeType === 1 && getTranslationState(key as HTMLElement)) return key as HTMLElement;
    if (!candidate.nodes?.length) return getTranslationState(candidate.element) ? candidate.element : null;
    let current = candidate.nodes[0]?.parentElement ?? null;
    while (current && current !== candidate.element) {
        if (current.matches(TRANSLATION_SEGMENT_SELECTOR) && getTranslationState(current)) return current;
        current = current.parentElement;
    }
    return null;
}

function candidateIsCurrent(candidate: TranslationCandidate): boolean {
    const core = getCurrentTranslationCore();
    if (!candidate.element.isConnected) return false;
    if (candidate.nodes?.length) {
        if (candidate.nodes.some((node) => node.parentNode !== candidate.element)) return false;
        const fresh = core.resolve(getTranslationCandidateKey(candidate));
        return Boolean(fresh && fresh.element === candidate.element && fresh.kind === candidate.kind &&
            getTranslationCandidateKey(fresh) === getTranslationCandidateKey(candidate));
    }
    const fresh = core.inspect(candidate.element).candidate;
    return fresh?.element === candidate.element && fresh.kind === candidate.kind;
}

export function candidateSourceText(candidate: TranslationCandidate): string {
    const core = getCurrentTranslationCore();
    return normalizeComparableText(candidate.nodes?.length
        ? extractTranslationTextFromNodes(candidate.nodes, core.shouldStayOriginalForSource)
        : extractTranslationText(candidate.element, core.shouldStayOriginalForSource));
}

function isTargetLanguage(source: string): boolean {
    // 短 UI 文案只做确定性的 script 判断；统计检测至少需要一段可读文本。
    if (isClearlyTargetLanguage(source, config.to)) return true;
    try {
        return source.length >= 20 && detectlang(source) === config.to;
    } catch {
        return false;
    }
}

function createAbortError(): Error {
    return new DOMException('翻译已取消', 'AbortError');
}

async function requestTranslations(sources: readonly string[], signal: AbortSignal): Promise<string[]> {
    const queueSession = createTranslationQueueSession();
    const cancel = () => cancelTranslationQueueSession(queueSession, createAbortError());
    signal.addEventListener('abort', cancel, {once: true});
    try {
        if (getTranslationServiceProvider(config, config.service) === services.microsoft) {
            return await translateTextBatch([...sources], document.title, {useCache: config.useCache, signal, queueSession});
        }
        if (sources.length === 1) {
            return [await translateText(sources[0] ?? '', document.title, {signal, queueSession})];
        }
        const packet = serializeTranslationSlots(sources);
        const combined = await translateText(packet.payload, document.title, {
            skipLanguageDetection: true,
            signal,
            queueSession,
        });
        const parsed = parseTranslationSlots(packet, combined);
        if (parsed?.length === sources.length) return parsed;
        // 部分传统机翻会改写分隔标记；严格解析失败后才逐段请求。
        return await Promise.all(sources.map((source) => translateText(source, document.title, {signal, queueSession})));
    } catch (error) {
        cancel();
        throw error;
    } finally {
        signal.removeEventListener('abort', cancel);
    }
}

function render(
    node: HTMLElement,
    state: TranslationState,
    entries: readonly SourceSlot[],
    translations: readonly string[],
): TranslationOutcome {
    const sources = sourcesOf(entries);
    if (translations.every((translation, index) =>
        normalizeComparableText(translation) === normalizeComparableText(sources[index] ?? ""))) {
        restoreTranslation(node);
        return {status: "unchanged", source: state.sourceText};
    }

    let next = 0;
    if (rendersInPlace(state)) {
        for (const {slot, source} of entries) {
            if (source === null) continue;
            const translation = translations[next++];
            if (translation !== undefined) {
                writeTranslatedText(state, node, slot.node, `${slot.prefix}${translation}${slot.suffix}`);
            }
        }
    } else {
        // 输出骨架在提交时从当前 DOM 生成，服务文本只绑定到请求时的有序原文。
        const core = getCurrentTranslationCore();
        const snapshot = createTranslationSourceSnapshot(
            node,
            core.shouldStayOriginalForSource,
            state.syntheticSegment ? node : undefined,
        );
        if (snapshot.slots.length !== entries.length) {
            const retryRoot = stateRescanRoot(node, state);
            restoreTranslation(node);
            return {status: "stale", retryRoot};
        }
        const aligned = entries.map((entry) => entry.source === null ? undefined : translations[next++]);
        state.bilingualContent = appendBilingualTranslation(node, applyTranslationsToSnapshot(snapshot, aligned));
    }
    state.phase = "translated";
    state.writtenAt = Date.now();
    return DONE;
}

function materialize(candidate: TranslationCandidate): {node: HTMLElement; synthetic: boolean} {
    if (!candidate.nodes?.length) return {node: candidate.element, synthetic: false};
    const wrapper = candidate.element.ownerDocument.createElement('span');
    wrapper.setAttribute('data-babelbox-translation-segment', 'true');
    candidate.element.insertBefore(wrapper, candidate.nodes[0]!);
    candidate.nodes.forEach((node) => wrapper.appendChild(node));
    return {node: wrapper, synthetic: true};
}

type StartResult =
    | {outcome: TranslationOutcome}
    | {node: HTMLElement; state: TranslationState; sources: string[]};

function start(candidate: TranslationCandidate, mode: DisplayMode): StartResult {
    const {node, synthetic} = materialize(candidate);
    const entries = readSourceSlots(node, synthetic);
    const sources = sourcesOf(entries);
    const state = sources.length > 0
        ? beginTranslation(node, {mode, kind: candidate.kind, syntheticSegment: synthetic, sourceText: sourceTextOf(sources)})
        : null;
    if (!state) {
        if (synthetic) node.replaceWith(...Array.from(node.childNodes));
        return {outcome: sources.length > 0 ? DONE : SKIPPED};
    }

    const memo = translationMemo.get(memoKey(sources));
    if (memo) return {outcome: render(node, state, entries, memo)};

    state.spinner = insertLoadingSpinner(node, false, state.sourceText);
    return {node, state, sources};
}

function commit(
    node: HTMLElement,
    state: TranslationState,
    sources: readonly string[],
    translations: readonly string[],
): TranslationOutcome {
    if (!isCurrentTranslation(node, state)) {
        const retryRoot = stateRescanRoot(node, state);
        if (getTranslationState(node) === state) restoreTranslation(node);
        return {status: "stale", retryRoot};
    }
    state.spinner?.remove();
    state.spinner = undefined;
    clearTranslationLoadingAnimation(node);

    const entries = readSourceSlots(node, state.syntheticSegment);
    const current = sourcesOf(entries);
    if (current.length !== sources.length || current.some((source, index) => source !== sources[index])) {
        const retryRoot = stateRescanRoot(node, state);
        restoreTranslation(node);
        return {status: "stale", retryRoot};
    }
    if (translations.length !== sources.length) {
        restoreTranslation(node);
        return SKIPPED;
    }
    return render(node, state, entries, translations);
}

function fail(node: HTMLElement, state: TranslationState, error: unknown): TranslationOutcome {
    const retryRoot = stateRescanRoot(node, state);
    if (!isCurrentTranslation(node, state)) {
        if (getTranslationState(node) === state) restoreTranslation(node);
        return {status: "stale", retryRoot};
    }
    state.spinner?.remove();
    state.spinner = undefined;
    clearTranslationLoadingAnimation(node);
    if (sourceTextOf(sourcesOf(readSourceSlots(node, state.syntheticSegment))) !== state.sourceText) {
        restoreTranslation(node);
        return {status: "stale", retryRoot};
    }
    state.phase = "error";
    state.retryWrapper = insertFailedTip(
        node,
        error instanceof Error ? error.message : String(error || "翻译失败"),
        () => retryTranslation(node),
    );
    return DONE;
}

/** 失败提示的重试按点击时的显示模式重新解析候选。 */
function retryTranslation(node: HTMLElement): void {
    const state = getTranslationState(node);
    if (!state || state.phase !== "error") return;
    const anchor = state.syntheticSegment
        ? Array.from(node.childNodes).find((child) =>
            child !== state.retryWrapper && normalizeComparableText(child.textContent ?? "").length > 0)
        : node;
    ownWrite(() => restoreTranslation(node));
    const candidate = anchor?.isConnected ? resolveTranslationCandidate(anchor) : null;
    if (candidate) void translateTarget(candidate, currentDisplayMode(), false);
}

/**
 * 翻译一个候选，或在非滑动触发时切换回原文。全文会话与悬浮翻译都走这里。
 * memo 命中时整个渲染在调用栈内同步完成，宿主重渲染后不会闪回原文。
 */
export async function translateTarget(
    candidate: TranslationCandidate,
    mode: DisplayMode,
    slide: boolean,
): Promise<TranslationOutcome> {
    if (!candidate.element.isConnected) return SKIPPED;

    const existing = findStateTarget(candidate);
    const current = existing ? getTranslationState(existing) : undefined;
    if (existing && current) {
        if (current.phase === "loading") return DONE;
        if (current.phase === "translated") {
            // 滑动触发只翻译新目标，不在鼠标移动过程中反复恢复原文。
            if (slide) return DONE;
            ownWrite(() => restoreTranslation(existing));
            return {status: "restored", source: current.sourceText};
        }
        ownWrite(() => restoreTranslation(existing));
    }

    if (!candidateIsCurrent(candidate)) return {status: "stale", retryRoot: candidate.element};
    const source = candidateSourceText(candidate);
    if (!source) return SKIPPED;
    if (isTargetLanguage(source)) return {status: "unchanged", source};

    const started = ownWrite(() => start(candidate, mode));
    if ("outcome" in started) return started.outcome;

    const {node, state, sources} = started;
    const generation = memoGeneration;
    try {
        const translations = await requestTranslations(sources, state.controller.signal);
        // 即使目标已被宿主替换，同一原文的译文仍然有效；宿主重建节点后可直接复用。
        if (generation === memoGeneration && translations.length === sources.length) {
            rememberTranslation(sources, translations);
        }
        return ownWrite(() => commit(node, state, sources, translations));
    } catch (error) {
        return ownWrite(() => fail(node, state, error));
    }
}
