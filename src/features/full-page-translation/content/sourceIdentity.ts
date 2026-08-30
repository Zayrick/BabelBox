import {
    collectLiveTranslationTextSlots,
    extractTranslationText,
    getCurrentTranslationCore,
} from '@/src/core/translation/public';
import type {TranslationState} from './state';

function normalizeComparableText(text: string): string {
    return text.replace(/[\s\u3000]+/g, ' ').trim();
}

function protectionBoundary(node: HTMLElement, state: TranslationState): HTMLElement | undefined {
    return state.syntheticSegment ? node : undefined;
}

function stableSourceProtection(): (element: Element) => boolean {
    return getCurrentTranslationCore().shouldStayOriginalForSource;
}

/**
 * Read the source through durable content boundaries only. Visibility and modal
 * focus isolation are eligibility signals and must never erase source slots.
 */
export function currentStateSourceText(node: HTMLElement, state: TranslationState): string {
    return extractTranslationText(
        node,
        stableSourceProtection(),
        protectionBoundary(node, state),
    );
}

export function currentStateTextNodes(node: HTMLElement, state: TranslationState): Text[] {
    return collectLiveTranslationTextSlots(
        node,
        stableSourceProtection(),
        protectionBoundary(node, state),
    ).map((slot) => slot.node);
}

export function statefulSourceAndTextSlotsAreCurrent(
    node: HTMLElement,
    state: TranslationState,
): boolean {
    const currentNodes = currentStateTextNodes(node, state);
    const previousNodes = state.projection.translatedTextNodes ?? state.source.textNodes ?? [];
    if (currentNodes.length !== previousNodes.length ||
        currentNodes.some((textNode, index) => textNode !== previousNodes[index])) return false;

    if ((state.kind === 'control' || state.mode === 'single') && state.projection.textSlotsApplied) {
        return currentNodes.every((textNode) =>
            state.projection.translatedTextValues?.get(textNode) === (textNode.nodeValue ?? ''));
    }

    return normalizeComparableText(currentStateSourceText(node, state)) ===
        normalizeComparableText(state.source.text);
}

export function attemptSourceIsCurrent(node: HTMLElement, state: TranslationState): boolean {
    return normalizeComparableText(currentStateSourceText(node, state)) ===
        normalizeComparableText(state.source.text);
}

export function committedTranslationDOMIsCurrent(
    node: HTMLElement,
    state: TranslationState,
): boolean {
    return state.projection.committedHTML !== undefined &&
        node.innerHTML === state.projection.committedHTML &&
        statefulSourceAndTextSlotsAreCurrent(node, state);
}
