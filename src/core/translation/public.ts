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
    configureCurrentTranslationFilters,
    createTranslationCore,
    getCurrentTranslationFilterConfig,
    getCurrentTranslationCore,
    resolveTranslationCandidate,
    resolveTranslationCandidateAtPoint,
} from './current';
export {
    createDefaultTranslationFilterConfig,
    createTranslationFilterPolicy,
    createTranslationFilterSite,
    getTranslationFilterSite,
    normalizeTranslationFilterConfig,
    normalizeTranslationFilterRules,
    removeTranslationFilterSite,
    translationFilterConfigSignature,
    upsertTranslationFilterSite,
} from './filters';
export type * from './filters';
export type * from './types';
