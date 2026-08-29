export const TRANSLATION_SHIMMER_ATTRIBUTE = 'data-babelbox-translation-shimmer';

export function applyTranslationShimmer(node: HTMLElement): void {
    node.setAttribute(TRANSLATION_SHIMMER_ATTRIBUTE, 'true');
}

export function clearTranslationLoadingAnimation(node: HTMLElement): void {
    node.removeAttribute(TRANSLATION_SHIMMER_ATTRIBUTE);
}
