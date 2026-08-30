export type TranslationMutationChannel = 'source' | 'eligibility';
export type EligibilityMutationKind = 'transient-presentation' | 'layout-or-policy' | 'durable-policy';

export interface ClassifiedSourceMutation {
    channel: 'source';
    kind: 'structure' | 'text';
}

export interface ClassifiedEligibilityMutation {
    channel: 'eligibility';
    kind: EligibilityMutationKind;
    attributeName: string;
}

export type ClassifiedTranslationMutation = ClassifiedSourceMutation | ClassifiedEligibilityMutation;

const transientPresentationAttributes = new Set([
    'hidden',
    'inert',
    'aria-hidden',
]);

const layoutOrPolicyAttributes = new Set([
    'class',
    'style',
]);

/** Map raw browser records to semantic translation channels without reading DOM state. */
export function classifyTranslationMutation(
    mutation: Pick<MutationRecord, 'type' | 'attributeName'>,
): ClassifiedTranslationMutation | null {
    if (mutation.type === 'childList') return {channel: 'source', kind: 'structure'};
    if (mutation.type === 'characterData') return {channel: 'source', kind: 'text'};
    if (mutation.type !== 'attributes' || !mutation.attributeName) return null;

    const attributeName = mutation.attributeName.toLowerCase();
    if (transientPresentationAttributes.has(attributeName)) {
        return {channel: 'eligibility', kind: 'transient-presentation', attributeName};
    }
    if (layoutOrPolicyAttributes.has(attributeName)) {
        return {channel: 'eligibility', kind: 'layout-or-policy', attributeName};
    }
    return {channel: 'eligibility', kind: 'durable-policy', attributeName};
}
