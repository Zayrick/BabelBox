export {
    getTranslationCandidateKey,
    selectPreferredTranslationCandidate,
    TranslationCandidateCore,
} from './engine';
export type {TranslationDiscoveryStep} from './engine';
export {
    evaluateHardGuard,
    getComposedParent,
    getOpenShadowRoots,
    isProtectedDescendantElement,
} from './dom';
export {
    extractTranslationText,
    extractTranslationTextFromNodes,
    isClearlyTargetLanguage,
    isMeaningfulTranslationText,
} from './text';
export {
    applyTranslationsToSnapshot,
    collectLiveTranslationTextSlots,
    createTranslationSourceSnapshot,
    findTranslationTruncationAncestors,
    hasActiveTranslationLineClamp,
    parseTranslationSlots,
    removeTranslationTruncation,
    serializeTranslationSlots,
    translationTruncationStyleOverrides,
} from './serialization';
export type {
    SerializedTranslationSlots,
    TranslationSourceSnapshot,
    TranslationStyleOverride,
    TranslationTextSlot,
} from './serialization';
export {createDeclarativeAdapter} from './adapters/declarative';
export {
    createTranslationCore,
    getCurrentTranslationCore,
    resolveTranslationCandidate,
    resolveTranslationCandidateAtPoint,
} from './current';
export type * from './types';
