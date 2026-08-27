import {TranslationCandidateCore} from './engine';
import {defaultTranslationAdapters} from './registry';
import type {TranslationCandidate} from './types';

let cachedHref = '';
let cachedCore: TranslationCandidateCore | null = null;

function currentHref(): string {
    const href = globalThis.location?.href ?? 'https://invalid.local/';
    try {
        return new URL(href).href;
    } catch {
        return 'https://invalid.local/';
    }
}

/** Return the URL-scoped core used by all content-script entry paths. */
export function getCurrentTranslationCore(): TranslationCandidateCore {
    const href = currentHref();
    if (!cachedCore || cachedHref !== href) {
        cachedHref = href;
        cachedCore = new TranslationCandidateCore({url: new URL(href), adapters: defaultTranslationAdapters});
    }
    return cachedCore;
}

export function resolveTranslationCandidate(node: Node | null | undefined): TranslationCandidate | null {
    return getCurrentTranslationCore().resolve(node);
}

export function resolveTranslationCandidateAtPoint(x: number, y: number): TranslationCandidate | null {
    if (typeof document === 'undefined') return null;
    return getCurrentTranslationCore().resolveAtPoint(document, x, y);
}
