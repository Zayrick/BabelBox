import {describe, expect, it} from 'vitest';
import {resolvesToDarkTheme} from '@/src/ui/theme/theme';

describe('theme resolution', () => {
    it.each([
        ['light', true, false],
        ['dark', false, true],
        ['auto', false, false],
        ['auto', true, true],
        [undefined, true, true],
    ] as const)('resolves %s with system preference %s', (theme, prefersDark, expected) => {
        expect(resolvesToDarkTheme(theme, prefersDark)).toBe(expected);
    });
});
