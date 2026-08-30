import {getCurrentTranslationCore} from '@/src/core/translation/public';
import type {TranslationEligibilityStatus, TranslationState} from './state';

export interface TranslationEligibilityEvaluation {
    status: TranslationEligibilityStatus;
    reason?: string;
}

function eligibilityOwner(node: HTMLElement, state: TranslationState): HTMLElement {
    return state.syntheticSegment ? node.parentElement ?? node : node;
}

/**
 * Eligibility controls scheduling and explicit policy revocation. It is kept
 * separate from source identity so menus, dialogs and temporary CSS cannot
 * invalidate an already committed projection.
 */
export function evaluateTranslationEligibility(
    node: HTMLElement,
    state: TranslationState,
): TranslationEligibilityEvaluation {
    const owner = eligibilityOwner(node, state);
    const core = getCurrentTranslationCore();
    if (core.shouldStayOriginalForSource(owner)) {
        return {status: 'durably-excluded', reason: 'translation-policy'};
    }
    if (core.isTemporarilyIneligible(owner)) {
        return {status: 'temporarily-suppressed', reason: 'presentation'};
    }
    return {status: 'eligible'};
}
