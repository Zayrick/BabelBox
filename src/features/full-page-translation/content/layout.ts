import {
    findTranslationTruncationAncestors,
    getComposedParent,
    hasActiveTranslationLineClamp,
    translationTruncationStyleOverrides,
    type TranslationStyleOverride,
} from '@/src/core/translation/public';

interface TranslationLayoutPropertySnapshot extends TranslationStyleOverride {
    originalValue: string;
    originalPriority: string;
    appliedValue: string;
    appliedPriority: string;
}

interface SharedTranslationLayoutOverride {
    originalStyleAttribute: string | null;
    renderedStyleAttribute: string | null;
    properties: TranslationLayoutPropertySnapshot[];
    owners: Set<WeakRef<HTMLElement>>;
    canRestoreExactStyleAttribute: boolean;
}

const sharedOverrides = new WeakMap<HTMLElement, SharedTranslationLayoutOverride>();
const overrideElementsByOwner = new WeakMap<HTMLElement, Set<HTMLElement>>();
const ownerRefs = new WeakMap<HTMLElement, WeakRef<HTMLElement>>();

function ownerRef(owner: HTMLElement): WeakRef<HTMLElement> {
    const existing = ownerRefs.get(owner);
    if (existing) return existing;
    const reference = new WeakRef(owner);
    ownerRefs.set(owner, reference);
    return reference;
}

function stylePriority(style: CSSStyleDeclaration, property: string): string {
    return style.getPropertyPriority(property);
}

function restoreSharedOverride(
    element: HTMLElement,
    override: SharedTranslationLayoutOverride,
): void {
    if (override.canRestoreExactStyleAttribute &&
        element.getAttribute('style') === override.renderedStyleAttribute) {
        if (override.originalStyleAttribute === null) element.removeAttribute('style');
        else element.setAttribute('style', override.originalStyleAttribute);
    } else {
        for (const property of override.properties) {
            if (element.style.getPropertyValue(property.property) !== property.appliedValue ||
                stylePriority(element.style, property.property) !== property.appliedPriority) continue;
            if (property.originalValue) {
                element.style.setProperty(property.property, property.originalValue, property.originalPriority);
            } else {
                element.style.removeProperty(property.property);
            }
        }
        if (override.originalStyleAttribute === null && element.getAttribute('style') === '') {
            element.removeAttribute('style');
        }
    }
    sharedOverrides.delete(element);
}

function liveSharedOverride(element: HTMLElement): SharedTranslationLayoutOverride | undefined {
    const override = sharedOverrides.get(element);
    if (!override) return undefined;
    for (const reference of override.owners) {
        const owner = reference.deref();
        if (!owner || !owner.isConnected || !overrideElementsByOwner.has(owner)) {
            override.owners.delete(reference);
        }
    }
    if (override.owners.size > 0) return override;
    restoreSharedOverride(element, override);
    return undefined;
}

function acquireTranslationLayoutOverride(
    owner: HTMLElement,
    element: HTMLElement,
    overrides: readonly TranslationStyleOverride[],
): void {
    const reference = ownerRef(owner);
    const existing = liveSharedOverride(element);
    if (existing) {
        existing.owners.add(reference);
        const elements = overrideElementsByOwner.get(owner) ?? new Set<HTMLElement>();
        elements.add(element);
        overrideElementsByOwner.set(owner, elements);
        return;
    }

    const originalStyleAttribute = element.getAttribute('style');
    const properties = overrides.map(({property, value, priority}) => {
        const originalValue = element.style.getPropertyValue(property);
        const originalPriority = stylePriority(element.style, property);
        element.style.setProperty(property, value, priority);
        return {
            property,
            value,
            priority,
            originalValue,
            originalPriority,
            appliedValue: element.style.getPropertyValue(property),
            appliedPriority: stylePriority(element.style, property),
        };
    });
    sharedOverrides.set(element, {
        originalStyleAttribute,
        renderedStyleAttribute: element.getAttribute('style'),
        properties,
        owners: new Set([reference]),
        canRestoreExactStyleAttribute: true,
    });
    const elements = overrideElementsByOwner.get(owner) ?? new Set<HTMLElement>();
    elements.add(element);
    overrideElementsByOwner.set(owner, elements);
}

function releaseOverride(owner: HTMLElement, element: HTMLElement): void {
    const override = sharedOverrides.get(element);
    const reference = ownerRefs.get(owner);
    if (!override || !reference) return;
    override.owners.delete(reference);
    for (const candidate of override.owners) {
        const candidateOwner = candidate.deref();
        if (!candidateOwner || !candidateOwner.isConnected || !overrideElementsByOwner.has(candidateOwner)) {
            override.owners.delete(candidate);
        }
    }
    if (override.owners.size === 0) restoreSharedOverride(element, override);
}

export function releaseTranslationTruncationLayout(owner: HTMLElement): void {
    const elements = overrideElementsByOwner.get(owner);
    if (!elements) return;
    for (const element of elements) releaseOverride(owner, element);
    overrideElementsByOwner.delete(owner);
    ownerRefs.delete(owner);
}

export function isTranslationLayoutOverrideMutation(element: HTMLElement): boolean {
    const override = sharedOverrides.get(element);
    return Boolean(override && element.getAttribute('style') === override.renderedStyleAttribute);
}

function reconcileTranslationLayoutOverrides(owner: HTMLElement): boolean {
    const elements = overrideElementsByOwner.get(owner);
    if (!elements) return true;
    for (const element of elements) {
        const override = liveSharedOverride(element);
        if (!override || !element.isConnected || !isComposedAncestorOrSelf(element, owner)) return false;
        if (element.getAttribute('style') !== override.renderedStyleAttribute) {
            override.canRestoreExactStyleAttribute = false;
        }
        for (const property of override.properties) {
            const currentValue = element.style.getPropertyValue(property.property);
            const currentPriority = stylePriority(element.style, property.property);
            if (currentValue === property.appliedValue && currentPriority === property.appliedPriority) continue;
            property.originalValue = currentValue;
            property.originalPriority = currentPriority;
            element.style.setProperty(property.property, property.value, property.priority);
            property.appliedValue = element.style.getPropertyValue(property.property);
            property.appliedPriority = stylePriority(element.style, property.property);
        }
        override.renderedStyleAttribute = element.getAttribute('style');
    }
    return true;
}

function isComposedAncestorOrSelf(ancestor: Element, node: Element): boolean {
    let current: Element | null = node;
    while (current) {
        if (current === ancestor) return true;
        current = getComposedParent(current);
    }
    return false;
}

export function ensureTranslationTruncationLayout(owner: HTMLElement): boolean {
    if (!owner.isConnected) return false;
    const desired = new Set<HTMLElement>();
    if (liveSharedOverride(owner) || hasActiveTranslationLineClamp(owner)) desired.add(owner);
    findTranslationTruncationAncestors(owner, (element) => Boolean(liveSharedOverride(element)))
        .forEach((element) => desired.add(element));

    const current = overrideElementsByOwner.get(owner) ?? new Set<HTMLElement>();
    for (const element of current) {
        if (!desired.has(element)) {
            releaseOverride(owner, element);
            current.delete(element);
        }
    }
    for (const element of desired) {
        if (!current.has(element)) {
            acquireTranslationLayoutOverride(owner, element, translationTruncationStyleOverrides);
        }
    }
    if (desired.size === 0) overrideElementsByOwner.delete(owner);
    return reconcileTranslationLayoutOverrides(owner);
}
