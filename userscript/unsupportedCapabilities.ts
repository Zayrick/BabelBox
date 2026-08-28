/** Build-only no-op adapters for features that require extension-only APIs. */
export function mountAreaTranslator(): undefined {
    return undefined;
}

export function unmountAreaTranslator(): void {}

export function isAreaTranslatorMounted(): boolean {
    return false;
}

export function mountImageTranslator(): void {}

export function unmountImageTranslator(): void {}

export function mountVideoSubtitleTranslation(): () => void {
    return () => undefined;
}
