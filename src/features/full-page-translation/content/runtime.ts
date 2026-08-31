import {browser} from 'wxt/browser';
import {checkConfig} from './configCheck';
import { services } from "@/src/core/config/catalog";
import {getTranslationServiceProvider} from '@/src/core/config/translationServices';
import {
    insertFailedTip,
    insertLoadingSpinner,
    removeLoadingSpinner,
} from '@/src/features/full-page-translation/ui/translationIndicators';
import { styles } from "@/src/core/config/constants";
import {
    extractTranslationText,
    extractTranslationTextFromNodes,
    applyTranslationsToSnapshot,
    collectLiveTranslationTextSlots,
    createTranslationSourceSnapshot,
    getComposedParent,
    getCurrentTranslationCore,
    getOpenShadowRoots,
    getTranslationCandidateKey,
    isClearlyTargetLanguage,
    parseTranslationSlots,
    resolveTranslationCandidate,
    resolveTranslationCandidateAtPoint,
    selectPreferredTranslationCandidate,
    serializeTranslationSlots,
} from "@/src/core/translation/public";
import type {TranslationCandidate, TranslationDiscoveryStep} from "@/src/core/translation/public";
import { detectlang } from "@/src/core/language/detect";
import { config } from "@/src/services/config/store";
import type { FullPageTranslationMode } from "@/src/core/config/model";
import {translateText, translateTextBatch} from '@/src/services/translation/client';
import {
    cancelTranslationQueueSession,
    createTranslationQueueSession,
    type TranslationQueueSession,
} from "@/src/services/translation/queue";
import {
    finishFullPageTranslationProgress,
    startFullPageTranslationProgress,
    updateFullPageTranslationProgress,
} from '@/src/features/full-page-translation/progress';
import {
    appendBilingualTranslation,
} from "@/src/features/full-page-translation/content/renderer";
import {ensureTranslationTruncationLayout} from "@/src/features/full-page-translation/content/layout";
import {
    beginTranslation,
    discardTranslation,
    getTranslationState,
    markTranslationComplete,
    markTranslationError,
    reconcileEquivalentTranslation,
    restoreAllTranslations,
    restoreTranslation,
    setBilingualContent,
    setRenderedStyleAttribute,
    setRetryWrapper,
    setSpinner,
    setTextSlotsApplied,
    type TranslationState,
} from "@/src/features/full-page-translation/content/state";

const TRANSLATION_ARTIFACT_SELECTOR = [
    '[data-babelbox-translation-segment="true"]',
    '[data-babelbox-translation-owned="true"]',
].join(",");

type TranslationResult = SnapshotTranslationResult | LiveTextTranslationResult;

type TranslationTargetOutcome =
    | {status: "committed" | "failed" | "owned"}
    | {status: "unchanged"; source: string; attemptNode?: HTMLElement}
    | {
        status: "stale" | "not-current" | "empty";
        retryRoot?: Node;
        /** Attempt owner used to reject retries after a newer generation took over. */
        attemptNode?: HTMLElement;
    };

interface FullPageCandidateSnapshot {
    source: string;
}

interface SnapshotTranslationResult {
    kind: "snapshot";
    sources: readonly string[];
    translations: readonly string[];
}

interface LiveTextTranslationResult {
    kind: "live-text";
    complete: boolean;
    changed: boolean;
    sources: readonly string[];
    translations: readonly string[];
}

interface FullPageSession {
    active: boolean;
    translationMode: FullPageTranslationMode;
    progressSessionId: number;
    progressPublishScheduled: boolean;
    observer: IntersectionObserver;
    mutationObserver: MutationObserver;
    shadowEventController: AbortController;
    roots: Set<Node>;
    pending: Map<Node, TranslationCandidate>;
    scheduled: Map<Node, TranslationCandidate>;
    /** Visibility anchor -> candidates waiting for that anchor to enter the viewport. */
    observedCandidates: Map<HTMLElement, Map<Node, TranslationCandidate>>;
    /** Candidate key -> its actual IntersectionObserver target (which can be a descendant). */
    candidateAnchors: Map<Node, HTMLElement>;
    /** Candidate element -> candidate keys, kept separate from visibility anchors for cleanup. */
    candidateOwnerKeys: Map<HTMLElement, Set<Node>>;
    /** Host owner/ancestor -> active translation targets below it, avoiding a global state scan on mutations. */
    statefulTargetsByAncestor: Map<Element, Set<HTMLElement>>;
    /** Active target -> the exact ancestor keys registered above. */
    statefulAncestorsByTarget: WeakMap<HTMLElement, readonly Element[]>;
    /** Explicit provider/language no-change decisions, scoped to this full-page session. */
    unchangedCandidates: WeakMap<Node, FullPageCandidateSnapshot>;
    /**
     * Candidate identities explicitly restored by the user during this full-page
     * session. The source snapshot lets a real host edit clear the tombstone,
     * while the extension's own restore mutations keep the segment excluded.
     */
    userCancelledCandidates: Map<Node, string>;
    /** Candidate keys whose translation pipelines have started and not settled. */
    inFlightCandidates: Map<Node, TranslationCandidate>;
    draining: boolean;
    flushTimer: number | null;
    dirtyRoots: Set<Node>;
    mutationFlushTimer: number | null;
    activeDiscovery: {root: Node; steps: Generator<TranslationDiscoveryStep>} | null;
    pruneTimer: number | null;
    pruneIterator: Iterator<TranslationCandidate> | null;
    pruneRequested: boolean;
}

const CANDIDATE_PRUNE_BUDGET_MS = 4;

let hoverTimer: ReturnType<typeof setTimeout> | undefined;
let fullPageSession: FullPageSession | null = null;

function scheduleFullPageProgressPublish(session: FullPageSession): void {
    if (!session.active || session.progressPublishScheduled) return;
    session.progressPublishScheduled = true;
    queueMicrotask(() => {
        session.progressPublishScheduled = false;
        if (!session.active || fullPageSession !== session) return;

        const running = session.inFlightCandidates.size;
        let runningScheduled = 0;
        for (const [key, candidate] of session.inFlightCandidates) {
            if (session.scheduled.get(key) === candidate) runningScheduled += 1;
        }
        // 同一个 key 的新候选可以在旧请求 settle 前替换 scheduled 所有权。
        // 旧请求仍算进行中，但不能把新的待处理候选从 remaining 中扣掉。
        const remaining = Math.max(0, session.scheduled.size - runningScheduled);
        const queued = Math.min(session.pending.size, remaining);
        updateFullPageTranslationProgress(session.progressSessionId, {
            running,
            queued,
            offscreen: Math.max(0, remaining - queued),
        });
    });
}

function isElementNode(node: Node | null | undefined): node is Element {
    return Boolean(node && node.nodeType === 1 && typeof (node as Element).matches === "function");
}

function notifyFullPageTranslationState(isTranslated: boolean): void {
    if (typeof document !== "undefined" && typeof document.dispatchEvent === "function") {
        const CustomEventConstructor = document.defaultView?.CustomEvent ??
            (typeof CustomEvent !== "undefined" ? CustomEvent : null);
        if (CustomEventConstructor) {
            document.dispatchEvent(new CustomEventConstructor(
                isTranslated ? "babelbox-translation-started" : "babelbox-translation-ended",
            ));
        }
    }
    void browser.runtime.sendMessage({
        type: "fullPageTranslationState",
        isTranslated,
    }).catch(() => {
        // 后台可能正在重载；页面内的翻译状态不应因此失败。
    });
}

function asHTMLElement(node: unknown): HTMLElement | null {
    if (!node || typeof node !== "object" || (node as Node).nodeType !== 1) return null;
    const element = node as HTMLElement;
    return typeof element.tagName === "string" && typeof element.style === "object" ? element : null;
}

function currentTranslationDisplayMode(): "bilingual" | "single" {
    return config.display === styles.bilingualTranslation ? "bilingual" : "single";
}

function translateNode(node: unknown, displayMode: "bilingual" | "single", slide: boolean): void {
    const target = asHTMLElement(node);
    if (!target) return;
    const candidate = resolveTranslationCandidate(target);
    if (candidate) void translateTarget(candidate, displayMode, slide);
}

function mutationTargetElement(node: Node): Element | null {
    if (isElementNode(node)) return node;
    if (node.nodeType === 11) {
        const host = (node as ShadowRoot).host;
        if (isElementNode(host)) return host;
    }
    return node.parentElement;
}

function normalizeComparableText(text: string): string {
    return text.replace(/[\s\u3000]+/g, " ").trim();
}

function stateProtectionBoundary(
    node: HTMLElement,
    state: TranslationState,
): HTMLElement | undefined {
    return state.syntheticSegment ? node : undefined;
}

function currentStateSourceText(node: HTMLElement, state: TranslationState): string {
    const slots = collectLiveTranslationTextSlots(
        node,
        getCurrentTranslationCore().shouldStayOriginalForSource,
        stateProtectionBoundary(node, state),
    );
    if (state.textSlotsApplied) {
        const originalValues = new Map(
            state.originalTextValues.map(({node: textNode, value}) => [textNode, value]),
        );
        return normalizeComparableText(slots.map((slot) => {
            const translatedValue = state.translatedTextValues?.get(slot.node);
            return translatedValue !== undefined && slot.node.nodeValue === translatedValue
                ? originalValues.get(slot.node) ?? slot.source
                : slot.source;
        }).join(" "));
    }
    return extractTranslationText(
        node,
        getCurrentTranslationCore().shouldStayOriginalForSource,
        stateProtectionBoundary(node, state),
    );
}

function currentStateTextNodes(node: HTMLElement, state: TranslationState): Text[] {
    return collectLiveTranslationTextSlots(
        node,
        getCurrentTranslationCore().shouldStayOriginalForSource,
        stateProtectionBoundary(node, state),
    ).map((slot) => slot.node);
}

function reconcileEquivalentHostRerender(
    node: HTMLElement,
    state: TranslationState,
): boolean {
    const currentTextNodes = currentStateTextNodes(node, state);
    if (!reconcileEquivalentTranslation(node, state, currentTextNodes)) return false;
    if (state.bilingualContent) {
        ensureTranslationTruncationLayout(node);
        setRenderedStyleAttribute(node);
    }
    return true;
}

function isTranslationArtifact(node: Node): boolean {
    const element = isElementNode(node) ? node : node.parentElement;
    return Boolean(element &&
        (element.matches(TRANSLATION_ARTIFACT_SELECTOR) || element.closest(TRANSLATION_ARTIFACT_SELECTOR)));
}

function isBatchFriendlyService(): boolean {
    const provider = getTranslationServiceProvider(config, config.service);
    return provider === services.microsoft || provider === services.freeTranslation;
}

function createAbortError(): Error {
    return new DOMException('翻译已取消', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw createAbortError();
}

async function translateSlotsIndividually(
    origins: readonly string[],
    signal?: AbortSignal,
    queueSession?: TranslationQueueSession,
): Promise<string[]> {
    throwIfAborted(signal);
    try {
        return await Promise.all(origins.map((origin) => translateText(origin, document.title, {
            signal,
            queueSession,
        })));
    } catch (error) {
        if (queueSession) cancelTranslationQueueSession(queueSession, error);
        throw error;
    }
}

async function translateTextSlots(
    origins: readonly string[],
    signal?: AbortSignal,
    queueSession?: TranslationQueueSession,
): Promise<string[]> {
    if (origins.length === 0) return [];
    throwIfAborted(signal);
    if (isBatchFriendlyService()) {
        return translateTextBatch([...origins], document.title, {
            useCache: config.useCache,
            signal,
            queueSession,
        });
    }
    if (origins.length === 1) {
        return [await translateText(origins[0] ?? '', document.title, {signal, queueSession})];
    }

    const packet = serializeTranslationSlots(origins);
    const combined = await translateText(packet.payload, document.title, {
        skipLanguageDetection: true,
        signal,
        queueSession,
    });
    const parsed = parseTranslationSlots(packet, combined);
    if (parsed?.length === origins.length) return parsed;

    // Some classic MT engines rewrite sentinel tokens. Fall back only after a
    // strict parse failure; AI providers normally keep the paragraph in one call.
    return translateSlotsIndividually(origins, signal, queueSession);
}

/**
 * 对机器翻译的 HTML 克隆逐个替换文本节点。标签、链接、图标和原文 DOM
 * 都不直接交给服务端，避免响应把网页结构打碎；微软/免费翻译的数组接口
 * 还可以把同一段中的多个文本节点合并成一次请求。
 */
async function translateElementHTML(
    node: HTMLElement,
    signal?: AbortSignal,
    queueSession?: TranslationQueueSession,
): Promise<SnapshotTranslationResult> {
    const core = getCurrentTranslationCore();
    const slots = collectLiveTranslationTextSlots(node, core.shouldStayOriginalForSource);
    if (slots.length === 0) return {kind: "snapshot", sources: [], translations: []};

    const origins = slots.map((part) => part.source);
    const translations = await translateTextSlots(origins, signal, queueSession);
    return {kind: "snapshot", sources: origins, translations};
}

/**
 * 按钮、role=button 等交互控件必须保持原有 DOM 结构和行为，因此即使当前
 * 页面选择了双语模式，也只替换控件内的可见文本，不追加第二段译文。
 */
async function translateLiveText(
    node: HTMLElement,
    signal?: AbortSignal,
    queueSession?: TranslationQueueSession,
): Promise<LiveTextTranslationResult> {
    const parts = collectLiveTranslationTextSlots(node, getCurrentTranslationCore().shouldStayOriginalForSource);
    if (parts.length === 0) return {
        kind: "live-text",
        complete: false,
        changed: false,
        sources: [],
        translations: [],
    };

    const origins = parts.map((part) => part.source);
    const translations = await translateTextSlots(origins, signal, queueSession);
    const changed = translations.some((translation, index) =>
        normalizeComparableText(translation) !== normalizeComparableText(origins[index] || ""),
    );

    return {
        kind: "live-text",
        complete: translations.length === origins.length,
        changed,
        sources: origins,
        translations,
    };
}

async function createTranslationRequest(
    node: HTMLElement,
    kind: "content" | "control",
    mode: "bilingual" | "single",
    signal?: AbortSignal,
    queueSession?: TranslationQueueSession,
): Promise<TranslationResult> {
    if (kind === "control" || mode === "single") {
        return translateLiveText(node, signal, queueSession);
    }
    return translateElementHTML(node, signal, queueSession);
}

function sourceContentIsCurrent(node: HTMLElement, state: TranslationState): boolean {
    return normalizeComparableText(currentStateSourceText(node, state)) ===
        normalizeComparableText(state.sourceText);
}

function discardStaleAttempt(
    node: HTMLElement,
    state: TranslationState,
): Node | undefined {
    const rescanRoot = state.syntheticSegment ? node.parentElement : node;
    if (getTranslationState(node) === state) discardTranslation(node, state);
    return rescanRoot?.isConnected ? rescanRoot : undefined;
}

function markFailedTranslation(
    node: HTMLElement,
    attempt: NonNullable<ReturnType<typeof beginTranslation>>,
    spinner: HTMLElement | undefined,
    error: unknown,
): TranslationTargetOutcome {
    removeLoadingSpinner(node, spinner);
    if (!node.isConnected ||
        !sourceContentIsCurrent(node, attempt.state) ||
        !markTranslationError(node, attempt.state, attempt.generation)) {
        return {
            status: "stale",
            retryRoot: discardStaleAttempt(node, attempt.state),
            attemptNode: node,
        };
    }
    const retryWrapper = insertFailedTip(
        node,
        error instanceof Error ? error.message : String(error || "翻译失败"),
        () => translateNode(node, currentTranslationDisplayMode(), false),
    );
    setRetryWrapper(node, retryWrapper);
    setRenderedStyleAttribute(node);
    return {status: "failed"};
}

async function renderTranslation(
    node: HTMLElement,
    attempt: NonNullable<ReturnType<typeof beginTranslation>>,
    request: Promise<TranslationResult>,
): Promise<TranslationTargetOutcome> {
    const { state, generation } = attempt;
    const spinner = state.spinner;

    const staleOutcome = (): TranslationTargetOutcome => ({
        status: "stale",
        retryRoot: discardStaleAttempt(node, state),
        attemptNode: node,
    });

    try {
        const result = await request;
        removeLoadingSpinner(node, spinner);

        if (!node.isConnected || !sourceContentIsCurrent(node, state)) return staleOutcome();

        if (result.kind === "live-text") {
            const liveResult = result;
            if (!liveResult.complete) {
                discardTranslation(node, state);
                return {status: "empty", retryRoot: node.isConnected ? node : undefined, attemptNode: node};
            }
            if (!liveResult.changed) {
                discardTranslation(node, state);
                return liveResult.sources.length === 0
                    ? {status: "empty", retryRoot: node.isConnected ? node : undefined, attemptNode: node}
                    : {status: "unchanged", source: state.sourceText, attemptNode: node};
            }
            const currentSlots = collectLiveTranslationTextSlots(
                node,
                getCurrentTranslationCore().shouldStayOriginalForSource,
                stateProtectionBoundary(node, state),
            );
            if (currentSlots.length !== liveResult.sources.length ||
                currentSlots.some((slot, index) => slot.source !== liveResult.sources[index])) {
                return staleOutcome();
            }
            if (!markTranslationComplete(node, state, generation)) {
                return staleOutcome();
            }
            currentSlots.forEach((slot, index) => {
                const translation = liveResult.translations[index];
                if (translation !== undefined) {
                    slot.node.nodeValue = `${slot.prefix}${translation}${slot.suffix}`;
                }
            });
            setTextSlotsApplied(node, currentSlots.map((slot) => slot.node));
            return {status: "committed"};
        }

        if (result.sources.length === 0 || result.translations.length !== result.sources.length) {
            discardTranslation(node, state);
            return {status: "empty", retryRoot: node.isConnected ? node : undefined, attemptNode: node};
        }
        if (!result.translations.some((translation, index) =>
            normalizeComparableText(translation) !== normalizeComparableText(result.sources[index] ?? ""))) {
            discardTranslation(node, state);
            return {status: "unchanged", source: state.sourceText, attemptNode: node};
        }

        // Build the output skeleton at commit time. Host attributes and safe
        // structure (for example a link changing href from /a to /b) therefore
        // come from the current DOM, while provider text remains bound to the
        // exact ordered sources captured at request creation.
        const core = getCurrentTranslationCore();
        const freshSnapshot = createTranslationSourceSnapshot(
            node,
            core.shouldStayOriginalForSource,
            stateProtectionBoundary(node, state),
        );
        const freshSources = freshSnapshot.slots.map((slot) => slot.source);
        if (freshSources.length !== result.sources.length ||
            freshSources.some((source, index) => source !== result.sources[index])) {
            return staleOutcome();
        }
        const translatedText = applyTranslationsToSnapshot(freshSnapshot, result.translations);
        if (!markTranslationComplete(node, state, generation)) {
            return staleOutcome();
        }

        const content = appendBilingualTranslation(node, translatedText);
        setBilingualContent(node, content);
        setRenderedStyleAttribute(node);
        return {status: "committed"};
    } catch (error) {
        return markFailedTranslation(node, attempt, spinner, error);
    }
}

function candidateIsCurrent(candidate: TranslationCandidate): boolean {
    const core = getCurrentTranslationCore();
    if (!candidate.element.isConnected) return false;
    if (candidate.nodes?.length) {
        if (candidate.nodes.some((node) => node.parentNode !== candidate.element)) return false;
        const fresh = core.resolve(getTranslationCandidateKey(candidate));
        return Boolean(fresh && fresh.element === candidate.element &&
            fresh.kind === candidate.kind &&
            getTranslationCandidateKey(fresh) === getTranslationCandidateKey(candidate));
    }
    const fresh = core.inspect(candidate.element).candidate;
    return fresh?.element === candidate.element && fresh.kind === candidate.kind;
}

function materializeCandidate(candidate: TranslationCandidate): {node: HTMLElement; synthetic: boolean} | null {
    if (!candidate.nodes?.length) return {node: candidate.element, synthetic: false};
    if (candidate.nodes.some((node) => node.parentNode !== candidate.element)) return null;
    const first = candidate.nodes[0];
    if (!first) return null;
    const wrapper = candidate.element.ownerDocument.createElement('span');
    candidate.element.insertBefore(wrapper, first);
    candidate.nodes.forEach((node) => wrapper.appendChild(node));
    return {node: wrapper, synthetic: true};
}

function hasIntersectionLayoutBox(element: HTMLElement): boolean {
    if (typeof element.getClientRects !== "function") return false;
    try {
        const rects = element.getClientRects();
        for (let index = 0; index < rects.length; index += 1) {
            const rect = rects[index];
            if (rect && rect.width > 0 && rect.height > 0) return true;
        }
    } catch {
        // Detached/custom elements can throw while their layout is being rebuilt.
    }
    return false;
}

/**
 * IntersectionObserver cannot reliably wake targets which generate no layout
 * box (notably `display: contents`). Prefer the candidate itself when it has a
 * box, then walk non-extension descendants in document order. If no element can
 * act as an anchor the caller queues the candidate directly; concurrency is
 * still enforced by the normal full-page drain.
 */
function resolveFullPageVisibilityAnchor(candidate: HTMLElement): HTMLElement | null {
    if (hasIntersectionLayoutBox(candidate)) return candidate;

    const pending: Element[] = [];
    const pushChildrenInReverse = (container: ParentNode) => {
        for (let index = container.children.length - 1; index >= 0; index -= 1) {
            const child = container.children.item(index);
            if (child) pending.push(child);
        }
    };
    pushChildrenInReverse(candidate);

    while (pending.length > 0) {
        const element = pending.pop();
        if (!element || element.matches(TRANSLATION_ARTIFACT_SELECTOR)) continue;
        const htmlElement = asHTMLElement(element);
        if (htmlElement && hasIntersectionLayoutBox(htmlElement)) return htmlElement;

        // Open shadow content participates in full-page translation as its own
        // observed root, but it can also be the only rendered box of a host.
        // Push light children first so shadow children are visited first by LIFO.
        pushChildrenInReverse(element);
        if (element.shadowRoot) pushChildrenInReverse(element.shadowRoot);
    }
    return null;
}

function removeCandidateObservation(session: FullPageSession, key: Node): void {
    const anchor = session.candidateAnchors.get(key);
    if (!anchor) return;
    session.candidateAnchors.delete(key);
    const observed = session.observedCandidates.get(anchor);
    observed?.delete(key);
    if (observed?.size === 0) {
        session.observedCandidates.delete(anchor);
        session.observer.unobserve(anchor);
    }
}

function addCandidateOwnerKey(session: FullPageSession, owner: HTMLElement, key: Node): void {
    let keys = session.candidateOwnerKeys.get(owner);
    if (!keys) {
        keys = new Set();
        session.candidateOwnerKeys.set(owner, keys);
    }
    keys.add(key);
}

function removeCandidateOwnerKey(session: FullPageSession, owner: HTMLElement, key: Node): void {
    const keys = session.candidateOwnerKeys.get(owner);
    keys?.delete(key);
    if (keys?.size === 0) session.candidateOwnerKeys.delete(owner);
}

function unregisterSessionStatefulTarget(session: FullPageSession | undefined, target: HTMLElement): void {
    if (!session) return;
    const ancestors = session.statefulAncestorsByTarget.get(target);
    if (!ancestors) return;
    session.statefulAncestorsByTarget.delete(target);
    for (const ancestor of ancestors) {
        const targets = session.statefulTargetsByAncestor.get(ancestor);
        targets?.delete(target);
        if (targets?.size === 0) session.statefulTargetsByAncestor.delete(ancestor);
    }
}

function rememberUserCancelledCandidate(
    session: FullPageSession,
    candidate: TranslationCandidate,
    target: HTMLElement,
    state: TranslationState,
): void {
    const source = normalizeComparableText(state.sourceText || candidateLifecycleSource(candidate));
    const remember = (node: Node | null | undefined) => {
        if (node) session.userCancelledCandidates.set(node, source);
    };

    // Exact candidates use their element as the key. Synthetic inline runs use
    // the first source node as the key, so retain every captured source node to
    // survive the segment unwrap performed by restoreTranslation().
    remember(getTranslationCandidateKey(candidate));
    if (!candidate.nodes?.length) remember(candidate.element);
    state.sourceTextNodes?.forEach((node) => remember(node));
    state.syntheticSourceNodes?.forEach((node) => remember(node));
    remember(target);
}

function isUserCancelledCandidate(
    session: FullPageSession,
    candidate: TranslationCandidate,
): boolean {
    const source = candidateLifecycleSource(candidate);
    const identities = [
        getTranslationCandidateKey(candidate),
        ...(candidate.nodes ?? []),
    ];
    let cancelled = false;
    identities.forEach((identity) => {
        const cancelledSource = session.userCancelledCandidates.get(identity);
        if (cancelledSource === undefined) return;
        if (cancelledSource === source) {
            cancelled = true;
        } else {
            // The host reused the same DOM node for different content. A
            // previous user cancellation must not suppress the new source.
            session.userCancelledCandidates.delete(identity);
        }
    });
    return cancelled;
}

function registerSessionStatefulTarget(
    session: FullPageSession | undefined,
    candidateOwner: HTMLElement,
    target: HTMLElement,
): void {
    if (!session?.active) return;
    unregisterSessionStatefulTarget(session, target);
    const ancestors: Element[] = [];
    let current: Element | null = candidateOwner;
    while (current) {
        ancestors.push(current);
        let targets = session.statefulTargetsByAncestor.get(current);
        if (!targets) {
            targets = new Set();
            session.statefulTargetsByAncestor.set(current, targets);
        }
        targets.add(target);
        current = getComposedParent(current);
    }
    session.statefulAncestorsByTarget.set(target, ancestors);
}

function refreshCandidateVisibilityBinding(
    session: FullPageSession,
    key: Node,
    candidate: TranslationCandidate,
): void {
    if (session.translationMode === "all") {
        // “翻译到网页底部”只绕过视口门禁，不操纵页面滚动位置。
        // 初次扫描和 MutationObserver 后续发现的内容都会进入同一受限队列。
        removeCandidateObservation(session, key);
        session.pending.set(key, candidate);
        scheduleFullPageDrain(session);
        return;
    }

    const target = asHTMLElement(candidate.element);
    const nextAnchor = target?.isConnected ? resolveFullPageVisibilityAnchor(target) : null;
    const currentAnchor = session.candidateAnchors.get(key) ?? null;

    if (currentAnchor === nextAnchor && (nextAnchor !== null || session.pending.has(key))) return;
    removeCandidateObservation(session, key);

    if (!nextAnchor) {
        // Keep an already-visible candidate pending while its display:contents
        // subtree is being rebuilt. If it was still waiting on the old anchor,
        // direct scheduling is the only visibility-safe fallback.
        if (!session.pending.has(key)) session.pending.set(key, candidate);
        scheduleFullPageProgressPublish(session);
        scheduleFullPageDrain(session);
        return;
    }

    let observed = session.observedCandidates.get(nextAnchor);
    if (!observed) {
        observed = new Map();
        session.observedCandidates.set(nextAnchor, observed);
    }
    observed.set(key, candidate);
    session.candidateAnchors.set(key, nextAnchor);
    session.observer.observe(nextAnchor);
    scheduleFullPageProgressPublish(session);
}

function forgetCandidate(session: FullPageSession | undefined, candidate: TranslationCandidate): void {
    if (!session) return;
    const key = getTranslationCandidateKey(candidate);
    const removedPending = session.pending.get(key) === candidate && session.pending.delete(key);
    if (session.scheduled.get(key) !== candidate) {
        if (removedPending) scheduleFullPageProgressPublish(session);
        return;
    }
    session.scheduled.delete(key);
    removeCandidateObservation(session, key);
    removeCandidateOwnerKey(session, candidate.element, key);
    scheduleFullPageProgressPublish(session);
}

async function translateTarget(
    candidate: TranslationCandidate,
    displayMode: "bilingual" | "single",
    slide: boolean,
    owner?: FullPageSession,
): Promise<TranslationTargetOutcome> {
    if (!candidate.element.isConnected) {
        return {status: "not-current"};
    }

    const statefulSession = owner?.active
        ? owner
        : fullPageSession?.active ? fullPageSession : undefined;
    const existingNode = candidate.nodes?.length
        ? (() => {
            const firstSourceNode = candidate.nodes?.[0];
            let current = firstSourceNode?.parentElement ?? null;
            while (current) {
                if (current.matches('[data-babelbox-translation-segment="true"]') &&
                    getTranslationState(current)) return current;
                current = current.parentElement;
            }
            return null;
        })()
        : candidate.element;
    const current = existingNode ? getTranslationState(existingNode) : undefined;
    if (current?.phase === "loading") return {status: "owned"};
    if (current?.phase === "translated") {
        // 滑动触发只对当前鼠标下的新目标翻译，不在移动过程中反复恢复原文。
        if (!slide && existingNode) {
            if (statefulSession?.active && fullPageSession === statefulSession) {
                rememberUserCancelledCandidate(statefulSession, candidate, existingNode, current);
            }
            unregisterSessionStatefulTarget(statefulSession, existingNode);
            restoreTranslation(existingNode);
        }
        return {status: "committed"};
    }
    if (current?.phase === "error" && existingNode) {
        if (current.syntheticSegment) {
            const sourceNodes = Array.from(existingNode.childNodes).filter((node) =>
                !isElementNode(node) || !node.matches('[data-babelbox-translation-owned="true"]'),
            );
            const sourceAnchor = sourceNodes.find((node) =>
                normalizeComparableText(node.textContent ?? node.nodeValue ?? "").length > 0,
            ) ?? sourceNodes[0];
            const retryRoot = existingNode.parentElement ?? undefined;
            unregisterSessionStatefulTarget(statefulSession, existingNode);
            restoreTranslation(existingNode);
            if (!sourceAnchor?.isConnected) return {status: "not-current", retryRoot};
            const refreshedCandidate = getCurrentTranslationCore().resolve(sourceAnchor);
            if (!refreshedCandidate) return {status: "not-current", retryRoot};
            return translateTarget(refreshedCandidate, displayMode, slide, owner);
        }
        unregisterSessionStatefulTarget(statefulSession, existingNode);
        restoreTranslation(existingNode);
    }

    if (!candidateIsCurrent(candidate)) {
        return {
            status: "not-current",
            retryRoot: candidate.element.isConnected ? candidate.element : undefined,
        };
    }

    const core = getCurrentTranslationCore();
    const sourceText = candidate.nodes?.length
        ? extractTranslationTextFromNodes(candidate.nodes, core.shouldStayOriginalForSource)
        : extractTranslationText(candidate.element, core.shouldStayOriginalForSource);
    if (!normalizeComparableText(sourceText)) {
        return {
            status: "empty",
            retryRoot: candidate.element.isConnected ? candidate.element : undefined,
        };
    }

    // 短 UI 文案只做确定性的 script 判断；统计检测至少需要一段可读文本，
    // 否则 GitHub 的短标题/按钮很容易被 franc 误判后静默漏译。
    if (isClearlyTargetLanguage(sourceText, config.to)) return {status: "unchanged", source: sourceText};
    try {
        const detected = sourceText.length >= 20 ? detectlang(normalizeComparableText(sourceText)) : '';
        if (detected && detected === config.to) return {status: "unchanged", source: sourceText};
    } catch {
        // 语言检测只是优化，不影响正常翻译流程。
    }

    const materialized = materializeCandidate(candidate);
    if (!materialized) {
        return {
            status: "not-current",
            retryRoot: candidate.element.isConnected ? candidate.element : undefined,
        };
    }
    const {node, synthetic} = materialized;

    const kind = candidate.kind;
    // Keep the source slots so a same-text host rerender can reuse the committed
    // translation without issuing another provider request.
    const sourceTextNodes = collectLiveTranslationTextSlots(
        node,
        core.shouldStayOriginalForSource,
        synthetic ? node : undefined,
    ).map((slot) => slot.node);
    const attempt = beginTranslation(
        node,
        displayMode,
        kind,
        synthetic,
        sourceText,
        sourceTextNodes,
    );
    if (!attempt) {
        if (synthetic) node.replaceWith(...Array.from(node.childNodes));
        return {status: "owned"};
    }
    // 请求必须在 spinner 插入前创建；微软 HTML 克隆和文本节点快照不能把
    // 插件自己的 loading 元素送到服务端。
    const queueSession = createTranslationQueueSession();
    const signal = attempt.state.controller.signal;
    const cancelQueuedRequest = () => cancelTranslationQueueSession(queueSession, createAbortError());
    signal.addEventListener('abort', cancelQueuedRequest, {once: true});
    const request = createTranslationRequest(
        node,
        kind,
        displayMode,
        signal,
        queueSession,
    )
        .finally(() => signal.removeEventListener('abort', cancelQueuedRequest));
    if (synthetic) node.setAttribute('data-babelbox-translation-segment', 'true');
    const spinner = insertLoadingSpinner(node, false, attempt.state.sourceText);
    setSpinner(node, spinner);
    registerSessionStatefulTarget(statefulSession, candidate.element, node);
    const outcome = await renderTranslation(node, attempt, request);
    if (outcome.status === "stale" || outcome.status === "not-current" ||
        outcome.status === "empty" || outcome.status === "unchanged") {
        unregisterSessionStatefulTarget(statefulSession, node);
    }
    return outcome;
}

function candidateLifecycleSource(candidate: TranslationCandidate): string {
    const core = getCurrentTranslationCore();
    return normalizeComparableText(candidate.nodes?.length
        ? extractTranslationTextFromNodes(candidate.nodes, core.shouldStayOriginalForSource)
        : extractTranslationText(candidate.element, core.shouldStayOriginalForSource));
}

function createCandidateSnapshot(source: string): FullPageCandidateSnapshot {
    return {source: normalizeComparableText(source)};
}

function matchesCandidateSnapshot(
    previous: FullPageCandidateSnapshot | undefined,
    source: string,
): boolean {
    return previous?.source === source;
}

function finalizeFullPageCandidate(
    session: FullPageSession,
    candidate: TranslationCandidate,
    outcome: TranslationTargetOutcome,
): void {
    const originalKey = getTranslationCandidateKey(candidate);

    // A mutation restart or a newer discovery generation may already have
    // replaced this scheduled entry. The old provider completion cannot delete
    // or enqueue work for that newer owner.
    if (!session.active || fullPageSession !== session || session.scheduled.get(originalKey) !== candidate) return;

    if (outcome.status !== "stale" && outcome.status !== "not-current" && outcome.status !== "empty") {
        if (outcome.status === "unchanged") {
            session.unchangedCandidates.set(
                originalKey,
                createCandidateSnapshot(outcome.source),
            );
        } else {
            session.unchangedCandidates.delete(originalKey);
        }
        forgetCandidate(session, candidate);
        return;
    }

    session.unchangedCandidates.delete(originalKey);

    // A new hover/full generation owns the same node already. Its own completion
    // is authoritative, so the stale generation only releases its queue entry.
    if (outcome.attemptNode && getTranslationState(outcome.attemptNode)) {
        forgetCandidate(session, candidate);
        return;
    }

    forgetCandidate(session, candidate);
    if (outcome.status !== "empty" && outcome.retryRoot?.isConnected) {
        enqueueFullPageRescan(session, outcome.retryRoot);
    }
}

function scheduleFullPageDrain(session: FullPageSession): void {
    if (!session.active || session.flushTimer !== null) return;
    session.flushTimer = window.setTimeout(() => {
        session.flushTimer = null;
        drainFullPage(session);
    }, 0);
}

function drainFullPage(session: FullPageSession): void {
    if (!session.active || session.draining) return;
    session.draining = true;

    while (session.active && session.pending.size > 0) {
        let entry: [Node, TranslationCandidate] | undefined;
        for (const pendingEntry of session.pending.entries()) {
            if (!session.inFlightCandidates.has(pendingEntry[0])) {
                entry = pendingEntry;
                break;
            }
        }
        if (!entry) break;
        const [key, candidate] = entry;
        session.pending.delete(key);
        session.inFlightCandidates.set(key, candidate);
        void translateTarget(candidate, currentTranslationDisplayMode(), true, session)
            .then(
                (outcome) => finalizeFullPageCandidate(session, candidate, outcome),
                () => {
                    // Provider failures are represented by translateTarget and
                    // render retry UI; unexpected runtime failures end this candidate.
                    forgetCandidate(session, candidate);
                },
            )
            .finally(() => {
                if (session.inFlightCandidates.get(key) === candidate) {
                    session.inFlightCandidates.delete(key);
                }
                if (session.active) {
                    scheduleFullPageProgressPublish(session);
                    scheduleFullPageDrain(session);
                }
            });
    }
    session.draining = false;
    scheduleFullPageProgressPublish(session);
}

function scheduleDiscoveredCandidate(session: FullPageSession, candidate: TranslationCandidate): void {
    const target = asHTMLElement(candidate.element);
    if (!session.active || !target || !target.isConnected) return;
    const key = getTranslationCandidateKey(candidate);
    if (isUserCancelledCandidate(session, candidate)) {
        // The restore mutation that follows an explicit user cancellation is
        // still observed by the full-page session. Remove any stale queue entry
        // before dropping the rediscovered candidate, otherwise it can be
        // reintroduced by a delayed visibility callback.
        const queuedCandidate = session.scheduled.get(key);
        if (queuedCandidate) {
            forgetCandidate(session, queuedCandidate);
        } else if (session.pending.get(key) === candidate) {
            session.pending.delete(key);
            removeCandidateObservation(session, key);
            scheduleFullPageProgressPublish(session);
        }
        return;
    }
    const targetState = getTranslationState(target);
    if (targetState) {
        // Hover can commit this state before the full-page session exists. Add
        // it to this session's observer-only ancestor index without replacing
        // the state's generation/controller ownership, so ancestor hard guards
        // still restore it and normal session teardown can drop the index.
        registerSessionStatefulTarget(session, candidate.element, target);
        return;
    }
    const unchanged = session.unchangedCandidates.get(key);
    if (unchanged) {
        const source = candidateLifecycleSource(candidate);
        if (matchesCandidateSnapshot(unchanged, source)) return;
        session.unchangedCandidates.delete(key);
    }

    // The exact descendant may already have finished while a very large
    // ancestor is still being discovered in later frame slices. Its scheduled
    // entry is intentionally forgotten after completion, so also consult the
    // state attached to the shared key before accepting a late generic run.
    const keyedTarget = asHTMLElement(key);
    if (keyedTarget && getTranslationState(keyedTarget)) {
        registerSessionStatefulTarget(session, candidate.element, keyedTarget);
        return;
    }

    // Post-order discovery can produce a generic inline run on an ancestor
    // whose first node is also the key of an exact adapter target. Keep the
    // explicit site decision: otherwise GitHub's `.markdown-title` candidate
    // is replaced by a synthetic parent run and the title itself never owns
    // its translation wrapper.
    const existing = session.scheduled.get(key);
    if (existing) {
        if (selectPreferredTranslationCandidate(existing, candidate) === existing) {
            // A stable candidate can outlive the rendered descendant used as
            // its IO target. Hydration and display changes must refresh that
            // anchor without replacing scheduled/pending ownership.
            refreshCandidateVisibilityBinding(session, key, existing);
            return;
        }
        removeCandidateObservation(session, key);
        removeCandidateOwnerKey(session, existing.element, key);
        if (session.pending.has(key)) session.pending.set(key, candidate);
    }
    session.scheduled.set(key, candidate);
    addCandidateOwnerKey(session, target, key);
    refreshCandidateVisibilityBinding(session, key, candidate);
    scheduleFullPageProgressPublish(session);
}

function nodeContains(ancestor: Node, descendant: Node): boolean {
    return ancestor === descendant || ancestor.contains(descendant);
}

/**
 * React/Vue pages can emit hundreds of style/class mutations per scroll frame.
 * Keep the observer callback O(records), merge overlapping dirty subtrees, then
 * discover them in short tasks so host input/scroll callbacks keep running.
 */
function enqueueFullPageRescan(session: FullPageSession, changedNode: Node): void {
    if (!session.active) return;
    const root = changedNode.nodeType === 3 ? changedNode.parentElement : changedNode;
    if (!root) return;
    if (isElementNode(root) && !root.isConnected) return;

    const dirtyRoot: Node = root;

    for (const existing of session.dirtyRoots) {
        if (nodeContains(existing, dirtyRoot)) return;
        if (nodeContains(dirtyRoot, existing)) session.dirtyRoots.delete(existing);
    }
    session.dirtyRoots.add(dirtyRoot);
    if (session.mutationFlushTimer !== null) return;
    session.mutationFlushTimer = window.setTimeout(() => flushMutationRescans(session), 50);
}

function flushMutationRescans(session: FullPageSession): void {
    session.mutationFlushTimer = null;
    if (!session.active) return;
    const startedAt = performance.now();
    while (session.activeDiscovery || session.dirtyRoots.size > 0) {
        if (!session.activeDiscovery) {
            const iterator = session.dirtyRoots.values().next();
            const root = iterator.value as Node | undefined;
            if (!root) break;
            session.dirtyRoots.delete(root);
            if (isElementNode(root) && !root.isConnected) continue;
            session.activeDiscovery = {
                root,
                steps: getCurrentTranslationCore().discoverSteps(root),
            };
        }

        const active = session.activeDiscovery;
        const step = active.steps.next();
        if (step.done) {
            session.activeDiscovery = null;
            continue;
        }
        if (step.value.element.shadowRoot) observeFullPageRoot(session, step.value.element.shadowRoot);
        if (step.value.phase === "enter") {
            const statefulStepTarget = asHTMLElement(step.value.element);
            const statefulStepState = statefulStepTarget
                ? getTranslationState(statefulStepTarget)
                : undefined;
            if (statefulStepTarget && statefulStepState) {
                const candidateOwner = statefulStepState.syntheticSegment
                    ? asHTMLElement(statefulStepTarget.parentElement) ?? statefulStepTarget
                    : statefulStepTarget;
                registerSessionStatefulTarget(session, candidateOwner, statefulStepTarget);
            }
        }
        if (step.value.candidate) scheduleDiscoveredCandidate(session, step.value.candidate);

        // Each step represents at most one visited element. Yield after a small
        // frame budget even when one dirty root is an entire Reddit/Wikipedia DOM.
        if (performance.now() - startedAt >= 8) break;
    }

    if (session.activeDiscovery || session.dirtyRoots.size > 0) {
        session.mutationFlushTimer = window.setTimeout(() => flushMutationRescans(session), 16);
    }
    scheduleFullPageDrain(session);
}

function observeFullPageRoot(session: FullPageSession, root: Node): void {
    if (session.roots.has(root)) return;
    session.roots.add(root);
    const observedAttributes = getCurrentTranslationCore().filterPolicy?.observedAttributes ?? [
        "style", "class", "id", "role", "hidden", "inert", "contenteditable",
        "aria-hidden", "translate", "data-notranslate",
    ];
    session.mutationObserver.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: [...observedAttributes],
    });
}

function resolveStatefulMutationTarget(element: Element): HTMLElement | false {
    let current: Element | null = element;
    while (current) {
        const htmlCurrent = asHTMLElement(current);
        if (htmlCurrent && getTranslationState(htmlCurrent)) return htmlCurrent;
        current = current.parentElement;
    }
    return false;
}

function removeScheduledForStateTarget(session: FullPageSession, target: HTMLElement): void {
    const state = getTranslationState(target);
    const host = state?.syntheticSegment ? target.parentElement : target;
    const candidateElements = new Set<HTMLElement>([target]);
    if (host) candidateElements.add(host);
    for (const element of candidateElements) {
        const keys = session.candidateOwnerKeys.get(element);
        if (!keys) continue;
        for (const key of Array.from(keys)) {
            const candidate = session.scheduled.get(key);
            if (!candidate) continue;
            const matches = candidate.element === target || candidate.element === host ||
                Boolean(candidate.nodes?.some((node) => target.contains(node)));
            if (matches) forgetCandidate(session, candidate);
        }
    }
}

function runDisconnectedCandidatePrune(session: FullPageSession): void {
    session.pruneTimer = null;
    if (!session.active) return;
    if (!session.pruneIterator) {
        session.pruneIterator = session.scheduled.values();
        session.pruneRequested = false;
    }
    const startedAt = performance.now();

    while (session.pruneIterator) {
        const next = session.pruneIterator.next();
        if (next.done) {
            session.pruneIterator = null;
            if (session.pruneRequested && session.pruneTimer === null) {
                session.pruneTimer = window.setTimeout(() => runDisconnectedCandidatePrune(session), 0);
            }
            return;
        }
        const candidate = next.value;
        if (!candidate.element.isConnected || candidate.nodes?.some((node) => !node.isConnected)) {
            forgetCandidate(session, candidate);
        } else {
            const key = getTranslationCandidateKey(candidate);
            const anchor = session.candidateAnchors.get(key);
            if (anchor && !anchor.isConnected) {
                refreshCandidateVisibilityBinding(session, key, candidate);
            }
        }
        if (performance.now() - startedAt >= CANDIDATE_PRUNE_BUDGET_MS) break;
    }

    if (session.pruneIterator && session.pruneTimer === null) {
        session.pruneTimer = window.setTimeout(() => runDisconnectedCandidatePrune(session), 16);
    }
}

function scheduleDisconnectedCandidatePrune(session: FullPageSession): void {
    if (!session.active) return;
    session.pruneRequested = true;
    if (session.pruneTimer !== null || session.pruneIterator) return;
    session.pruneTimer = window.setTimeout(() => runDisconnectedCandidatePrune(session), 0);
}

function restartStatefulTarget(session: FullPageSession, target: HTMLElement): boolean {
    unregisterSessionStatefulTarget(session, target);
    const state = getTranslationState(target);
    if (!state) return false;
    const rescanRoot = state.syntheticSegment ? target.parentElement : target;
    removeScheduledForStateTarget(session, target);

    if (state.phase === "loading") {
        discardTranslation(target, state);
    } else {
        restoreTranslation(target);
    }
    if (rescanRoot?.isConnected) enqueueFullPageRescan(session, rescanRoot);
    return true;
}

function refreshStatefulTarget(session: FullPageSession, target: HTMLElement): void {
    const state = getTranslationState(target);
    if (!state) {
        unregisterSessionStatefulTarget(session, target);
        return;
    }
    if (!target.isConnected) {
        unregisterSessionStatefulTarget(session, target);
        removeScheduledForStateTarget(session, target);
        discardTranslation(target, state);
        return;
    }
    if (!sourceContentIsCurrent(target, state)) {
        restartStatefulTarget(session, target);
        return;
    }
    if (state.phase === "translated") reconcileEquivalentHostRerender(target, state);
}

function resolveStatefulMutationTargets(
    session: FullPageSession,
    element: Element,
): HTMLElement[] {
    const targets = new Set<HTMLElement>();
    const direct = resolveStatefulMutationTarget(element);
    if (direct) targets.add(direct);
    const descendants = session.statefulTargetsByAncestor.get(element);
    if (descendants) {
        for (const target of Array.from(descendants)) {
            if (getTranslationState(target)) targets.add(target);
            else unregisterSessionStatefulTarget(session, target);
        }
    }
    return [...targets];
}

function createFullPageMutationObserver(
    getSession: () => FullPageSession,
): MutationObserver {
    return new MutationObserver((mutations) => {
        const session = getSession();
        if (!session.active || fullPageSession !== session) return;
        scheduleDisconnectedCandidatePrune(session);
        const statefulTargets = new Set<HTMLElement>();

        for (const mutation of mutations) {
            const mutationElement = mutationTargetElement(mutation.target);
            if (mutationElement) {
                resolveStatefulMutationTargets(session, mutationElement)
                    .forEach((target) => statefulTargets.add(target));
            }

            if (mutation.type === "characterData") {
                if (!mutationElement || resolveStatefulMutationTarget(mutationElement) === false) {
                    enqueueFullPageRescan(session, mutation.target);
                }
                continue;
            }

            if (mutation.type === "attributes") {
                if (mutationElement) enqueueFullPageRescan(session, mutationElement);
                continue;
            }

            const changedNodes = [...Array.from(mutation.addedNodes), ...Array.from(mutation.removedNodes)];
            if (changedNodes.length === 0 || !changedNodes.every(isTranslationArtifact)) {
                enqueueFullPageRescan(session, mutation.target);
            }
        }

        statefulTargets.forEach((target) => refreshStatefulTarget(session, target));
    });
}

function createFullPageSession(): FullPageSession {
    let session!: FullPageSession;
    const observer = new IntersectionObserver((entries) => {
        if (!session.active || fullPageSession !== session) return;
        for (const entry of entries) {
            const node = entry.target as HTMLElement;
            if (!entry.isIntersecting) continue;
            const candidates = session.observedCandidates.get(node);
            candidates?.forEach((candidate, key) => session.pending.set(key, candidate));
        }
        scheduleFullPageProgressPublish(session);
        scheduleFullPageDrain(session);
    }, {
        root: null,
        rootMargin: "600px 0px",
        threshold: 0.01,
    });
    const mutationObserver = createFullPageMutationObserver(() => session);

    session = {
        active: true,
        translationMode: config.fullPageTranslationMode,
        progressSessionId: startFullPageTranslationProgress(),
        progressPublishScheduled: false,
        observer,
        mutationObserver,
        shadowEventController: new AbortController(),
        roots: new Set(),
        pending: new Map(),
        scheduled: new Map(),
        observedCandidates: new Map(),
        candidateAnchors: new Map(),
        candidateOwnerKeys: new Map(),
        statefulTargetsByAncestor: new Map(),
        statefulAncestorsByTarget: new WeakMap(),
        unchangedCandidates: new WeakMap(),
        userCancelledCandidates: new Map(),
        inFlightCandidates: new Map(),
        draining: false,
        flushTimer: null,
        dirtyRoots: new Set(),
        mutationFlushTimer: null,
        activeDiscovery: null,
        pruneTimer: null,
        pruneIterator: null,
        pruneRequested: false,
    };
    return session;
}

function disposeFullPageSession(session: FullPageSession): void {
    session.active = false;
    if (session.flushTimer !== null) window.clearTimeout(session.flushTimer);
    if (session.mutationFlushTimer !== null) window.clearTimeout(session.mutationFlushTimer);
    if (session.pruneTimer !== null) window.clearTimeout(session.pruneTimer);
    session.observer.disconnect();
    session.mutationObserver.disconnect();
    session.shadowEventController.abort();
    session.roots.clear();
    session.pending.clear();
    session.scheduled.clear();
    session.observedCandidates.clear();
    session.candidateAnchors.clear();
    session.candidateOwnerKeys.clear();
    session.statefulTargetsByAncestor.clear();
    session.statefulAncestorsByTarget = new WeakMap();
    session.inFlightCandidates.clear();
    session.userCancelledCandidates.clear();
    session.dirtyRoots.clear();
    session.activeDiscovery = null;
    session.pruneIterator = null;
    session.pruneRequested = false;
    finishFullPageTranslationProgress(session.progressSessionId);
}

function stopFullPageSession(): void {
    const session = fullPageSession;
    if (!session) return;
    fullPageSession = null;
    disposeFullPageSession(session);
}

/**
 * 恢复全文翻译。全文和悬浮翻译共享同一份节点状态，因此这里无需再用
 * data-babelbox-node-id + innerHTML 覆盖页面，也能处理 Shadow DOM 和动态节点。
 */
export function restoreOriginalContent(): void {
    cancelPendingHoverTranslation();
    stopFullPageSession();
    restoreAllTranslations();
    notifyFullPageTranslationState(false);
}

/**
 * 启动全文翻译会话：根固定为 documentElement，使用可见性预取窗口，并持续
 * 观察新增 DOM/open ShadowRoot。候选调度只管理 DOM 生命周期，网络并发统一
 * 交给翻译队列控制。
 */
export function autoTranslateEnglishPage(): void {
    if (!checkConfig() || fullPageSession?.active) return;
    const root = document.documentElement;
    if (!root) return;

    const session = createFullPageSession();
    fullPageSession = session;
    document.addEventListener('babelbox-open-shadow-root', (event) => {
        if (!session.active || fullPageSession !== session) return;
        const host = isElementNode(event.target as Node) ? event.target as Element : null;
        const shadowRoot = host?.shadowRoot;
        if (!shadowRoot) return;
        observeFullPageRoot(session, shadowRoot);
        enqueueFullPageRescan(session, shadowRoot);
    }, {capture: true, signal: session.shadowEventController.signal});
    observeFullPageRoot(session, root);
    enqueueFullPageRescan(session, root);
    for (const shadowRoot of getOpenShadowRoots(root)) observeFullPageRoot(session, shadowRoot);
    notifyFullPageTranslationState(true);
}

export function isFullPageTranslationActive(): boolean {
    return fullPageSession?.active === true;
}

export function cancelPendingHoverTranslation(): void {
    if (hoverTimer === undefined) return;
    clearTimeout(hoverTimer);
    hoverTimer = undefined;
}

/**
 * 处理鼠标悬浮/快捷键翻译。坐标只负责找到内容块，真正的翻译调用与全文
 * 会话共用 translateTarget，因此按钮、富文本和恢复行为不会出现两套规则。
 */
export function handleTranslation(mouseX: number, mouseY: number, delayTime = 0): void {
    if (!checkConfig()) return;
    cancelPendingHoverTranslation();
    hoverTimer = setTimeout(() => {
        hoverTimer = undefined;
        const candidate = resolveTranslationCandidateAtPoint(mouseX, mouseY);
        if (!candidate) return;
        void translateTarget(candidate, currentTranslationDisplayMode(), delayTime > 0);
    }, delayTime);
}
