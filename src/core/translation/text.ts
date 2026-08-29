import {
    composedAncestors,
    getComposedParent,
    isExtensionElementSelf,
    isProtectedDescendantElement,
} from './dom';

const identifierPatterns = [
    /^https?:\/\/\S+$/iu,
    /^\S+@\S+\.\S+$/u,
    /^@[\p{L}\p{N}_-]+$/u,
    /^u\/[\p{L}\p{N}_-]+$/u,
    /^#[0-9]+$/u,
    /^[a-f0-9]{7,40}$/iu,
    /^\d+(?:[.,:/-]\d+)*(?:%|[a-z]+)?$/iu,
    /^[\p{L}\p{N}_.-]+\.(?:js|ts|tsx|jsx|vue|json|css|html|md|py|rs|go|java|c|cpp|h)$/iu,
];

export function normalizeTranslationText(value: string): string {
    return value.replace(/[\s\u3000]+/gu, ' ').trim();
}

export function isIdentifierLikeText(value: string): boolean {
    const text = normalizeTranslationText(value);
    return Boolean(text && identifierPatterns.some((pattern) => pattern.test(text)));
}

export function isMeaningfulTranslationText(value: string): boolean {
    const text = normalizeTranslationText(value);
    if (!text || isIdentifierLikeText(text)) return false;
    const letters = text.match(/\p{L}/gu)?.length ?? 0;
    return letters >= 2;
}

export function isTranslationTextNodeProtected(
    node: Text,
    shouldStayOriginal?: (element: Element) => boolean,
    ignoredExtensionElement?: Element,
): boolean {
    const parent = node.parentElement;
    if (!parent) return true;
    if (shouldStayOriginal?.(parent)) return true;
    for (const ancestor of composedAncestors(parent)) {
        if (isExtensionElementSelf(ancestor) && ancestor !== ignoredExtensionElement) return true;
        if (!shouldStayOriginal &&
            isProtectedDescendantElement(ancestor, ancestor === ignoredExtensionElement)) return true;
    }
    return false;
}

function collectReadableText(
    roots: readonly Node[],
    shouldStayOriginal?: (element: Element) => boolean,
    ignoredExtensionElement?: Element,
): string {
    const parts: string[] = [];
    for (const root of roots) {
        if (root.nodeType === 3) {
            const textNode = root as Text;
            if (!isTranslationTextNodeProtected(textNode, shouldStayOriginal, ignoredExtensionElement)) {
                const value = normalizeTranslationText(textNode.nodeValue ?? '');
                if (value) parts.push(value);
            }
            continue;
        }
        if (root.nodeType !== 1) continue;
        const element = root as Element;
        const document = element.ownerDocument;
        if (!document?.createTreeWalker) continue;
        const walker = document.createTreeWalker(element, 4);
        let current = walker.nextNode();
        while (current) {
            const textNode = current as Text;
            if (!isTranslationTextNodeProtected(textNode, shouldStayOriginal, ignoredExtensionElement)) {
                const value = normalizeTranslationText(textNode.nodeValue ?? '');
                if (value) parts.push(value);
            }
            current = walker.nextNode();
        }
    }
    return normalizeTranslationText(parts.join(' '));
}

export type TranslationTextProtectionCache = WeakMap<Element, boolean>;

export function createTranslationTextProtectionCache(): TranslationTextProtectionCache {
    return new WeakMap<Element, boolean>();
}

/** Cache inherited text protection for one hover or discovery operation. */
export function isTranslationTextElementProtected(
    element: Element,
    shouldStayOriginal: ((element: Element) => boolean) | undefined,
    protectionCache: TranslationTextProtectionCache,
): boolean {
    const cached = protectionCache.get(element);
    if (cached !== undefined) return cached;

    const chain: Element[] = [];
    let current: Element | null = element;
    while (current && !protectionCache.has(current)) {
        chain.push(current);
        current = getComposedParent(current);
    }

    let protectedByAncestor = current ? protectionCache.get(current) === true : false;
    for (let index = chain.length - 1; index >= 0; index -= 1) {
        const item = chain[index]!;
        protectedByAncestor = protectedByAncestor ||
            isExtensionElementSelf(item) ||
            (shouldStayOriginal
                ? shouldStayOriginal(item) === true
                : isProtectedDescendantElement(item));
        protectionCache.set(item, protectedByAncestor);
    }
    return protectionCache.get(element) === true;
}

export function hasMeaningfulTranslationTextInNodes(
    roots: readonly Node[],
    shouldStayOriginal?: (element: Element) => boolean,
    protectionCache = createTranslationTextProtectionCache(),
): boolean {
    const stack = [...roots].reverse();
    const parts: string[] = [];
    while (stack.length > 0) {
        const current = stack.pop()!;
        if (current.nodeType === 3) {
            const textNode = current as Text;
            if (!textNode.parentElement || isTranslationTextElementProtected(
                textNode.parentElement,
                shouldStayOriginal,
                protectionCache,
            )) continue;
            const value = normalizeTranslationText(textNode.nodeValue ?? '');
            if (!value) continue;
            parts.push(value);
            continue;
        }
        if (current.nodeType !== 1) continue;
        const element = current as Element;
        if (isTranslationTextElementProtected(element, shouldStayOriginal, protectionCache)) continue;
        for (let index = element.childNodes.length - 1; index >= 0; index -= 1) {
            const child = element.childNodes.item(index);
            if (child) stack.push(child);
        }
    }

    return isMeaningfulTranslationText(parts.join(' '));
}

export function extractTranslationTextFromNodes(
    nodes: readonly Node[],
    shouldStayOriginal?: (element: Element) => boolean,
    ignoredExtensionElement?: Element,
): string {
    return collectReadableText(nodes, shouldStayOriginal, ignoredExtensionElement);
}

/** Extract readable host-page text without cloning the candidate subtree. */
export function extractTranslationText(
    element: Element,
    shouldStayOriginal?: (element: Element) => boolean,
    ignoredExtensionElement?: Element,
): string {
    return collectReadableText([element], shouldStayOriginal, ignoredExtensionElement);
}

const hanPattern = /\p{Script=Han}/gu;
const japanesePattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu;
const hangulPattern = /\p{Script=Hangul}/gu;
const latinPattern = /\p{Script=Latin}/gu;

/**
 * Short UI strings are where statistical language detection is least reliable.
 * Only skip them when the target script is clearly dominant; otherwise let the
 * provider translate them. Long-text detection remains a secondary check in
 * the runtime.
 */
export function isClearlyTargetLanguage(value: string, targetLanguage: string): boolean {
    const text = normalizeTranslationText(value);
    if (!text) return true;
    const target = targetLanguage.toLowerCase();
    const letters = text.match(/\p{L}/gu)?.length ?? 0;
    if (letters === 0) return true;

    if (target.startsWith('zh') || target.startsWith('ja') || target.startsWith('ko')) {
        const targetPattern = target.startsWith('zh')
            ? hanPattern
            : target.startsWith('ja') ? japanesePattern : hangulPattern;
        const targetScript = text.match(targetPattern)?.length ?? 0;
        const latin = text.match(latinPattern)?.length ?? 0;
        return targetScript > 0 && targetScript >= latin * 2;
    }
    if (target.startsWith('en')) {
        const latin = text.match(latinPattern)?.length ?? 0;
        return latin >= 3 && latin / letters >= 0.85;
    }
    return false;
}
