import {
    getComposedParent,
    getCurrentTranslationCore,
    getOpenShadowRoots,
    getTranslationCandidateKey,
    resolveTranslationCandidate,
    selectPreferredTranslationCandidate,
} from "@/src/core/translation/public";
import type {TranslationCandidate, TranslationDiscoveryStep} from "@/src/core/translation/public";
import type {FullPageTranslationMode} from "@/src/core/config/model";
import {config} from "@/src/services/config/store";
import {
    finishFullPageTranslationProgress,
    startFullPageTranslationProgress,
    updateFullPageTranslationProgress,
} from '@/src/features/full-page-translation/progress';
import {ensureTranslationTruncationLayout} from "./layout";
import {ownWrite, setMutationSink} from "./ownWrites";
import {
    TRANSLATION_ARTIFACT_SELECTOR,
    candidateSourceText,
    currentDisplayMode,
    findStateTarget,
    isRenderIntact,
    readSourceSlots,
    sourceTextOf,
    sourcesOf,
    stateRescanRoot,
    translateTarget,
    type TranslationOutcome,
} from "./pipeline";
import {
    forEachTranslationState,
    getTranslationState,
    restoreTranslation,
} from "./state";

/**
 * 宿主在插件写入后立即撤销（移除目标或用相同原文覆盖）视为一次回滚。
 * 同一原文回滚达到上限后，本次会话让出这段内容，避免与宿主无限拉锯。
 */
const MAX_HOST_UNDOS = 3;
const HOST_REACTION_MS = 1000;
const MUTATION_FLUSH_DELAY_MS = 50;
const DISCOVERY_BUDGET_MS = 8;
const PRUNE_BUDGET_MS = 4;

interface FullPageSession {
    active: boolean;
    mode: FullPageTranslationMode;
    progressId: number;
    progressScheduled: boolean;
    visibility: IntersectionObserver;
    mutations: MutationObserver;
    shadowEvents: AbortController;
    roots: Set<Node>;
    /** 已发现、尚未完成的候选，以候选 key 去重。 */
    known: Map<Node, TranslationCandidate>;
    /** 已通过可见性门禁、等待启动的 key。 */
    ready: Set<Node>;
    running: Set<Node>;
    /** 可见性锚点 -> 等待它进入视口的候选 key；锚点可以是候选的布局后代。 */
    anchorKeys: Map<HTMLElement, Set<Node>>;
    anchorOf: Map<Node, HTMLElement>;
    /** 候选 key -> 不再翻译的原文（用户恢复、无需翻译）；原文变化后失效。 */
    settled: WeakMap<Node, string>;
    /** 原文 -> 宿主即时回滚次数；达到上限的原文本次会话不再翻译。 */
    hostUndos: Map<string, number>;
    dirtyRoots: Set<Node>;
    discovery: Generator<TranslationDiscoveryStep> | null;
    discoveryTimer: number | null;
    drainTimer: number | null;
    pruneTimer: number | null;
}

let session: FullPageSession | null = null;

function isElementNode(node: Node | null | undefined): node is Element {
    return Boolean(node && node.nodeType === 1 && typeof (node as Element).matches === "function");
}

function asHTMLElement(node: unknown): HTMLElement | null {
    if (!node || typeof node !== "object" || (node as Node).nodeType !== 1) return null;
    const element = node as HTMLElement;
    return typeof element.tagName === "string" && typeof element.style === "object" ? element : null;
}

function publishProgress(s: FullPageSession): void {
    if (!s.active || s.progressScheduled) return;
    s.progressScheduled = true;
    queueMicrotask(() => {
        s.progressScheduled = false;
        if (!s.active) return;
        let runningKnown = 0;
        for (const key of s.running) if (s.known.has(key)) runningKnown += 1;
        const remaining = Math.max(0, s.known.size - runningKnown);
        const queued = Math.min(s.ready.size, remaining);
        updateFullPageTranslationProgress(s.progressId, {
            running: s.running.size,
            queued,
            offscreen: remaining - queued,
        });
    });
}

// ---- visibility -----------------------------------------------------------

function hasLayoutBox(element: HTMLElement): boolean {
    if (typeof element.getClientRects !== "function") return false;
    try {
        return Array.from(element.getClientRects()).some((rect) => rect.width > 0 && rect.height > 0);
    } catch {
        return false;
    }
}

/**
 * IntersectionObserver 无法唤醒没有布局盒的目标（例如 display: contents）。
 * 优先观察候选自身，否则按文档顺序找第一个有布局盒的非插件后代（含 open
 * shadow 内容）；找不到时调用方直接放行，并发仍由翻译队列控制。
 */
function resolveVisibilityAnchor(candidate: HTMLElement): HTMLElement | null {
    if (hasLayoutBox(candidate)) return candidate;
    const pending: Element[] = [];
    const pushChildren = (container: ParentNode) => {
        for (let index = container.children.length - 1; index >= 0; index -= 1) {
            const child = container.children.item(index);
            if (child) pending.push(child);
        }
    };
    pushChildren(candidate);
    while (pending.length > 0) {
        const element = pending.pop()!;
        if (element.matches(TRANSLATION_ARTIFACT_SELECTOR)) continue;
        const htmlElement = asHTMLElement(element);
        if (htmlElement && hasLayoutBox(htmlElement)) return htmlElement;
        pushChildren(element);
        if (element.shadowRoot) pushChildren(element.shadowRoot);
    }
    return null;
}

function unbindAnchor(s: FullPageSession, key: Node): void {
    const anchor = s.anchorOf.get(key);
    if (!anchor) return;
    s.anchorOf.delete(key);
    const keys = s.anchorKeys.get(anchor);
    keys?.delete(key);
    if (keys?.size === 0) {
        s.anchorKeys.delete(anchor);
        s.visibility.unobserve(anchor);
    }
}

function bindVisibility(s: FullPageSession, key: Node, candidate: TranslationCandidate): void {
    // “翻译到网页底部”只绕过视口门禁，不操纵页面滚动位置。
    const anchor = s.mode === "all" || !candidate.element.isConnected
        ? null
        : resolveVisibilityAnchor(candidate.element);
    if (anchor && s.anchorOf.get(key) === anchor) return;
    unbindAnchor(s, key);
    if (!anchor) {
        s.ready.add(key);
        scheduleDrain(s);
    } else {
        let keys = s.anchorKeys.get(anchor);
        if (!keys) s.anchorKeys.set(anchor, keys = new Set());
        keys.add(key);
        s.anchorOf.set(key, anchor);
        s.visibility.observe(anchor);
    }
    publishProgress(s);
}

// ---- queue ----------------------------------------------------------------

function scheduleDrain(s: FullPageSession): void {
    if (!s.active || s.drainTimer !== null) return;
    s.drainTimer = window.setTimeout(() => {
        s.drainTimer = null;
        drain(s);
    }, 0);
}

function drain(s: FullPageSession): void {
    for (const key of Array.from(s.ready)) {
        if (!s.active) return;
        if (s.running.has(key)) continue;
        s.ready.delete(key);
        const candidate = s.known.get(key);
        if (!candidate) continue;
        unbindAnchor(s, key);
        s.running.add(key);
        void translateTarget(candidate, currentDisplayMode(), true)
            .catch((): TranslationOutcome => ({status: "skipped"}))
            .then((outcome) => finish(s, key, candidate, outcome));
    }
    publishProgress(s);
}

function finish(s: FullPageSession, key: Node, candidate: TranslationCandidate, outcome: TranslationOutcome): void {
    s.running.delete(key);
    if (!s.active) return;
    if (s.known.get(key) === candidate) s.known.delete(key);
    if (outcome.status === "unchanged") s.settled.set(key, outcome.source);
    if (outcome.status === "stale" && outcome.retryRoot) enqueueRescan(s, outcome.retryRoot);
    publishProgress(s);
    scheduleDrain(s);
}

function isSettled(s: FullPageSession, key: Node, candidate: TranslationCandidate): boolean {
    const source = s.settled.get(key);
    if (source === undefined) return false;
    if (source === candidateSourceText(candidate)) return true;
    // 宿主复用了同一节点承载新内容，旧的“不再翻译”记录不能压住新原文。
    s.settled.delete(key);
    return false;
}

function isContested(s: FullPageSession, source: string): boolean {
    return (s.hostUndos.get(source) ?? 0) >= MAX_HOST_UNDOS;
}

/** 记录宿主对插件写入的即时撤销；返回该原文是否已经达到让出上限。 */
function recordHostUndo(s: FullPageSession, node: HTMLElement): boolean {
    const state = getTranslationState(node);
    if (!state) return false;
    if (Date.now() - state.writtenAt <= HOST_REACTION_MS) {
        s.hostUndos.set(state.sourceText, (s.hostUndos.get(state.sourceText) ?? 0) + 1);
    }
    return isContested(s, state.sourceText);
}

function addCandidate(s: FullPageSession, candidate: TranslationCandidate): void {
    if (!s.active || !candidate.element.isConnected) return;
    const key = getTranslationCandidateKey(candidate);
    if (isSettled(s, key, candidate) || findStateTarget(candidate)) return;
    if (s.hostUndos.size > 0 && isContested(s, candidateSourceText(candidate))) return;
    // 站点适配器给出的精确候选优先于共享同一 key 的通用 inline-run。
    const existing = s.known.get(key);
    const preferred = existing ? selectPreferredTranslationCandidate(existing, candidate) : candidate;
    s.known.set(key, preferred);
    bindVisibility(s, key, preferred);
}

// ---- discovery ------------------------------------------------------------

/**
 * React/Vue 页面每帧可能产生数百条 mutation。回调只合并脏子树，
 * 再分片扫描，避免阻塞宿主的输入与滚动。
 */
function enqueueRescan(s: FullPageSession, changed: Node): void {
    if (!s.active) return;
    const root = changed.nodeType === 3 ? changed.parentElement : changed;
    if (!root || (isElementNode(root) && !root.isConnected)) return;
    for (const existing of s.dirtyRoots) {
        if (existing === root || existing.contains(root)) return;
        if (root.contains(existing)) s.dirtyRoots.delete(existing);
    }
    s.dirtyRoots.add(root);
    if (s.discoveryTimer === null && !s.discovery) {
        s.discoveryTimer = window.setTimeout(() => runDiscovery(s), MUTATION_FLUSH_DELAY_MS);
    }
}

function runDiscovery(s: FullPageSession): void {
    s.discoveryTimer = null;
    if (!s.active) return;
    const startedAt = performance.now();
    while (s.discovery || s.dirtyRoots.size > 0) {
        if (!s.discovery) {
            const root = s.dirtyRoots.values().next().value as Node;
            s.dirtyRoots.delete(root);
            if (isElementNode(root) && !root.isConnected) continue;
            s.discovery = getCurrentTranslationCore().discoverSteps(root);
        }
        const step = s.discovery.next();
        if (step.done) {
            s.discovery = null;
            continue;
        }
        if (step.value.element.shadowRoot) observeRoot(s, step.value.element.shadowRoot);
        if (step.value.candidate) addCandidate(s, step.value.candidate);
        if (performance.now() - startedAt >= DISCOVERY_BUDGET_MS) break;
    }
    if (s.discovery || s.dirtyRoots.size > 0) {
        s.discoveryTimer = window.setTimeout(() => runDiscovery(s), 16);
    }
}

function observeRoot(s: FullPageSession, root: Node): void {
    if (s.roots.has(root)) return;
    s.roots.add(root);
    s.mutations.observe(root, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: [...getCurrentTranslationCore().filterPolicy.observedAttributes],
    });
}

function pruneDetachedCandidates(s: FullPageSession): void {
    if (s.pruneTimer !== null) return;
    let iterator: Iterator<[Node, TranslationCandidate]> | null = null;
    const step = () => {
        s.pruneTimer = null;
        if (!s.active) return;
        iterator ??= Array.from(s.known).values();
        const startedAt = performance.now();
        for (let next = iterator.next(); !next.done; next = iterator.next()) {
            const [key, candidate] = next.value;
            if (s.known.get(key) === candidate && !s.running.has(key)) {
                if (!candidate.element.isConnected || candidate.nodes?.some((node) => !node.isConnected)) {
                    s.known.delete(key);
                    s.ready.delete(key);
                    unbindAnchor(s, key);
                } else if (s.anchorOf.get(key)?.isConnected === false) {
                    bindVisibility(s, key, candidate);
                }
            }
            if (performance.now() - startedAt >= PRUNE_BUDGET_MS) {
                s.pruneTimer = window.setTimeout(step, 16);
                return;
            }
        }
        publishProgress(s);
    };
    s.pruneTimer = window.setTimeout(step, 0);
}

// ---- host mutations -------------------------------------------------------

function closestStateTarget(element: Element): HTMLElement | null {
    let current: Element | null = element;
    while (current) {
        const htmlElement = asHTMLElement(current);
        if (htmlElement && getTranslationState(htmlElement)) return htmlElement;
        current = getComposedParent(current);
    }
    return null;
}

function reapplyAfterHostUndo(s: FullPageSession, target: HTMLElement): void {
    const state = getTranslationState(target)!;
    const contested = recordHostUndo(s, target);
    const anchor = state.syntheticSegment
        ? Array.from(target.childNodes).find((child) =>
            child.nodeType === 3 || (isElementNode(child) && !child.matches(TRANSLATION_ARTIFACT_SELECTOR)))
        : target;
    const rescanRoot = stateRescanRoot(target, state);
    ownWrite(() => restoreTranslation(target));
    if (contested || !anchor) return;
    const candidate = resolveTranslationCandidate(anchor);
    if (candidate && getTranslationCandidateKey(candidate) === anchor) {
        void translateTarget(candidate, state.mode, true);
    } else if (rescanRoot) {
        enqueueRescan(s, rescanRoot);
    }
}

/**
 * 宿主改动了某个已有翻译状态的目标。原文变化则撤销并重新扫描；
 * 原文不变但译文被覆盖时用 memo 原地重新应用。
 */
function refreshTarget(s: FullPageSession, target: HTMLElement): void {
    const state = getTranslationState(target);
    if (!state) return;
    if (!target.isConnected) {
        recordHostUndo(s, target);
        ownWrite(() => restoreTranslation(target));
        return;
    }
    if (getCurrentTranslationCore().shouldStayOriginalForSource(target)) {
        ownWrite(() => restoreTranslation(target));
        return;
    }
    const entries = readSourceSlots(target, state.syntheticSegment);
    if (sourceTextOf(sourcesOf(entries)) !== state.sourceText) {
        const rescanRoot = stateRescanRoot(target, state);
        ownWrite(() => restoreTranslation(target));
        if (rescanRoot) enqueueRescan(s, rescanRoot);
        return;
    }
    if (state.phase !== "translated") return;
    if (!isRenderIntact(target, state, entries)) {
        reapplyAfterHostUndo(s, target);
    } else if (state.bilingualContent) {
        ownWrite(() => ensureTranslationTruncationLayout(target));
    }
}

function handleMutations(s: FullPageSession, records: readonly MutationRecord[]): void {
    if (!s.active) return;
    const touched = new Set<HTMLElement>();
    const guardChanged = new Set<Element>();
    let removedNodes = false;

    for (const record of records) {
        const target = record.target;
        const element = isElementNode(target)
            ? target
            : target.nodeType === 11 ? (target as ShadowRoot).host : target.parentElement;
        // 宿主改写插件自己的译文/提示节点不影响原文。
        if (!element || element.closest(TRANSLATION_ARTIFACT_SELECTOR)) continue;
        const stateTarget = closestStateTarget(element);
        if (stateTarget) touched.add(stateTarget);
        else if (record.type === "attributes") guardChanged.add(element);
        if (record.type === "childList" && record.removedNodes.length > 0) removedNodes = true;
        if (record.type !== "characterData" || !stateTarget) enqueueRescan(s, target);
    }

    touched.forEach((target) => refreshTarget(s, target));

    // 祖先新增 translate=no 等持久排除时，撤销其下全部译文；临时隐藏不撤销。
    const core = getCurrentTranslationCore();
    const excluded = Array.from(guardChanged).filter((element) => core.shouldStayOriginalForSource(element));
    if (excluded.length > 0 || removedNodes) {
        forEachTranslationState((node) => {
            if (!node.isConnected) recordHostUndo(s, node);
            if (!node.isConnected || excluded.some((element) => element.contains(node))) {
                ownWrite(() => restoreTranslation(node));
            }
        });
    }
    if (removedNodes) pruneDetachedCandidates(s);
}

// ---- lifecycle ------------------------------------------------------------

export function startFullPageSession(root: HTMLElement): void {
    if (session?.active) return;
    let s!: FullPageSession;
    const visibility = new IntersectionObserver((entries) => {
        if (!s.active) return;
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            s.anchorKeys.get(entry.target as HTMLElement)?.forEach((key) => {
                if (s.known.has(key)) s.ready.add(key);
            });
        }
        publishProgress(s);
        scheduleDrain(s);
    }, {root: null, rootMargin: "600px 0px", threshold: 0.01});
    const mutations = new MutationObserver((records) => handleMutations(s, records));

    s = {
        active: true,
        mode: config.fullPageTranslationMode,
        progressId: startFullPageTranslationProgress(),
        progressScheduled: false,
        visibility,
        mutations,
        shadowEvents: new AbortController(),
        roots: new Set(),
        known: new Map(),
        ready: new Set(),
        running: new Set(),
        anchorKeys: new Map(),
        anchorOf: new Map(),
        settled: new WeakMap(),
        hostUndos: new Map(),
        dirtyRoots: new Set(),
        discovery: null,
        discoveryTimer: null,
        drainTimer: null,
        pruneTimer: null,
    };
    session = s;
    setMutationSink({observer: mutations, handle: (records) => handleMutations(s, records)});

    root.ownerDocument.addEventListener('babelbox-open-shadow-root', (event) => {
        const shadowRoot = isElementNode(event.target as Node) ? (event.target as Element).shadowRoot : null;
        if (!s.active || !shadowRoot) return;
        observeRoot(s, shadowRoot);
        enqueueRescan(s, shadowRoot);
    }, {capture: true, signal: s.shadowEvents.signal});
    observeRoot(s, root);
    for (const shadowRoot of getOpenShadowRoots(root)) observeRoot(s, shadowRoot);
    enqueueRescan(s, root);
}

export function stopFullPageSession(): void {
    const s = session;
    if (!s) return;
    session = null;
    s.active = false;
    setMutationSink(null);
    for (const timer of [s.discoveryTimer, s.drainTimer, s.pruneTimer]) {
        if (timer !== null) window.clearTimeout(timer);
    }
    s.visibility.disconnect();
    s.mutations.disconnect();
    s.shadowEvents.abort();
    s.roots.clear();
    s.known.clear();
    s.ready.clear();
    s.running.clear();
    s.anchorKeys.clear();
    s.anchorOf.clear();
    s.dirtyRoots.clear();
    s.discovery = null;
    finishFullPageTranslationProgress(s.progressId);
}

export function isFullPageSessionActive(): boolean {
    return session?.active === true;
}

/** 用户在全文会话中手动恢复的段落，本次会话不再自动重新翻译。 */
export function rememberUserRestore(candidate: TranslationCandidate, source: string): void {
    if (session?.active) session.settled.set(getTranslationCandidateKey(candidate), source);
}
