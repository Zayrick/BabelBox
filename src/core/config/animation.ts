export const animationModeOptions = [
    {value: 'default', label: '旋转'},
    {value: 'shimmer', label: '文字流光'},
    {value: 'static', label: '静态'},
] as const;

export type AnimationMode = typeof animationModeOptions[number]['value'];

export const ANIMATION_MODES: readonly AnimationMode[] = animationModeOptions.map(({value}) => value);
export const DEFAULT_ANIMATION_MODE: AnimationMode = 'default';

export function normalizeAnimationMode(
    value: unknown,
    legacyAnimations?: unknown,
): AnimationMode {
    if (typeof value === 'string' && ANIMATION_MODES.includes(value as AnimationMode)) {
        return value as AnimationMode;
    }
    if (value === true) return 'default';
    if (value === false) return 'static';
    if (legacyAnimations === false) return 'static';
    return DEFAULT_ANIMATION_MODE;
}

export function usesAnimatedEffects(mode: AnimationMode | undefined): boolean {
    return mode !== 'static';
}
