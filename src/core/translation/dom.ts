import {
    defaultTranslationFilterPolicy,
    type TranslationFilterPolicy,
} from './filters';

const extensionSelector = [
    '#fluent-read-floating-ball-container',
    '#fluent-read-selection-translator-container',
    '#fluent-read-translation-status-container',
    '[data-fluent-read-ui]',
    '.fluent-read-video-ui',
    '.fluent-read-loading',
    '.fluent-read-retry-wrapper',
    '.fluent-read-bilingual-content',
    '[data-fr-translation-segment="true"]',
    '[data-fr-translation-owned="true"]',
].join(',');

/**
 * Host pages can construct adversarially deep trees. Ancestor-dependent safety
 * checks run synchronously, so cap one lookup and conservatively prune beyond
 * the limit instead of blocking the renderer for hundreds of milliseconds.
 */
export const maxComposedAncestorDepth = 512;

export function getComposedParent(element: Element): Element | null {
    if (element.parentElement) return element.parentElement;
    const root = element.getRootNode?.() as {host?: Element};
    return root?.host?.nodeType === 1 ? root.host : null;
}

export function* composedAncestors(element: Element): Generator<Element> {
    let current: Element | null = element;
    while (current) {
        yield current;
        current = getComposedParent(current);
    }
}

export function isDocumentSurface(element: Element): boolean {
    const owner = element.ownerDocument;
    return element === owner?.documentElement || element === owner?.body;
}

export function isExtensionElementSelf(element: Element): boolean {
    return element.matches(extensionSelector);
}

/**
 * Descendant text guards are intentionally local. A protected inline child
 * must stay out of provider payloads without rejecting the readable paragraph
 * that contains it.
 */
export function isProtectedDescendantElement(
    element: Element,
    ignoreExtensionSelf = false,
    filterPolicy: TranslationFilterPolicy = defaultTranslationFilterPolicy,
): boolean {
    return (!ignoreExtensionSelf && isExtensionElementSelf(element)) ||
        filterPolicy.isExcludedSelf(element);
}

export interface HardGuardResult {
    prune: boolean;
    reason?: string;
}

export function evaluateElementHardGuard(
    element: Element,
    filterPolicy: TranslationFilterPolicy = defaultTranslationFilterPolicy,
): HardGuardResult {
    if (isExtensionElementSelf(element)) return {prune: true, reason: 'fluentread-owned'};
    const decision = filterPolicy.evaluateElement(element);
    if (decision.action === 'exclude') return {prune: true, reason: decision.reason};
    return {prune: false};
}

/**
 * Guards are shared by initial discovery, hover resolution, mutations and open
 * Shadow DOM. A site rule may override a global decision on the same element,
 * while FluentRead-owned DOM and the depth limit remain immutable boundaries.
 */
export function evaluateHardGuard(
    element: Element,
    filterPolicy: TranslationFilterPolicy = defaultTranslationFilterPolicy,
): HardGuardResult {
    let depth = 0;
    for (const current of composedAncestors(element)) {
        depth += 1;
        if (depth > maxComposedAncestorDepth) {
            return {prune: true, reason: 'ancestor-depth-limit'};
        }
        const guard = evaluateElementHardGuard(current, filterPolicy);
        if (guard.prune) return guard;
    }
    return {prune: false};
}

function collectImmediateOpenShadowRoots(root: Node): ShadowRoot[] {
    const result: ShadowRoot[] = [];
    const collect = (element: Element) => {
        if (element.shadowRoot) result.push(element.shadowRoot);
    };

    if (root.nodeType === 1) collect(root as Element);
    const document = root.ownerDocument ?? (root.nodeType === 9 ? root as Document : globalThis.document);
    if (!document?.createTreeWalker) return result;
    const walker = document.createTreeWalker(root, 1);
    let current = walker.nextNode();
    while (current) {
        if (current.nodeType === 1) collect(current as Element);
        current = walker.nextNode();
    }
    return result;
}

export function getOpenShadowRoots(root: Node): ShadowRoot[] {
    const result: ShadowRoot[] = [];
    const seen = new Set<ShadowRoot>();
    const pending: Node[] = [root];
    for (let index = 0; index < pending.length; index += 1) {
        const pendingRoot = pending[index]!;
        for (const shadowRoot of collectImmediateOpenShadowRoots(pendingRoot)) {
            if (seen.has(shadowRoot)) continue;
            seen.add(shadowRoot);
            result.push(shadowRoot);
            pending.push(shadowRoot);
        }
    }
    return result;
}

export function safeMatches(element: Element, selector: string): boolean {
    try {
        return element.matches(selector);
    } catch {
        return false;
    }
}

export function safeClosest(element: Element, selector: string): Element | null {
    try {
        return element.closest(selector);
    } catch {
        return null;
    }
}

export function findElementsAtPoint(root: Document | ShadowRoot, x: number, y: number): Element[] {
    const pointRoot = root as Document & {elementsFromPoint?: (x: number, y: number) => Element[]};
    if (typeof pointRoot.elementsFromPoint === 'function') return pointRoot.elementsFromPoint(x, y);
    const singlePointRoot = root as Document & {elementFromPoint?: (x: number, y: number) => Element | null};
    if (typeof singlePointRoot.elementFromPoint !== 'function') return [];
    const element = singlePointRoot.elementFromPoint(x, y);
    return element ? [element] : [];
}

export function findNodeAtPoint(root: Document | ShadowRoot, x: number, y: number): Node | null {
    const document = root.nodeType === 9 ? root as Document : root.ownerDocument;
    try {
        const caretPosition = document?.caretPositionFromPoint?.(x, y);
        if (caretPosition?.offsetNode && root.contains(caretPosition.offsetNode)) return caretPosition.offsetNode;
    } catch {
        // Firefox-style caret lookup is optional and may reject shadow roots.
    }
    try {
        const range = document?.caretRangeFromPoint?.(x, y);
        if (range?.startContainer && root.contains(range.startContainer)) return range.startContainer;
    } catch {
        // Chromium-style caret lookup is optional.
    }
    return null;
}
