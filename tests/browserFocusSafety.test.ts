import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {describe, expect, it, vi} from 'vitest';

const PROJECT_ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const USER_SCRIPT_RUNNER = 'scripts/run-userscript-smoke-test.cjs';
const REQUIRED_ARGS = [
    '--artifact', '.output/userscript/fluent-read.user.js',
    '--playwright-root', '/tmp/playwright-runtime',
    '--artifacts-dir', '/tmp/userscript-artifacts',
];

describe('browser regression focus safety', () => {
    it('uses an isolated page when the focus-safe helper owns the startup page', async () => {
        const {selectUserscriptTestPage} = require(resolve(
            PROJECT_ROOT,
            USER_SCRIPT_RUNNER,
        ));
        const startupPage = {id: 'startup'};
        const isolatedPage = {id: 'isolated'};
        const context = {pages: vi.fn(() => [startupPage])};
        const createIsolatedPage = vi.fn(async () => isolatedPage);

        await expect(selectUserscriptTestPage(true, context, createIsolatedPage)).resolves.toBe(isolatedPage);
        expect(context.pages).not.toHaveBeenCalled();
        expect(createIsolatedPage).toHaveBeenCalledOnce();

        createIsolatedPage.mockClear();
        await expect(selectUserscriptTestPage(false, context, createIsolatedPage)).resolves.toBe(startupPage);
        expect(context.pages).toHaveBeenCalledOnce();
        expect(createIsolatedPage).not.toHaveBeenCalled();
    });

    it('requires a focus-safe helper in background mode', () => {
        const {parseArgs} = require(resolve(PROJECT_ROOT, USER_SCRIPT_RUNNER));
        expect(() => parseArgs(REQUIRED_ARGS, {})).toThrow(/--focus-safe-helper|FLUENTREAD_FOCUS_SAFE_HELPER/);
    });

    it('accepts an explicit helper, environment helper, or headed mode', () => {
        const {parseArgs} = require(resolve(PROJECT_ROOT, USER_SCRIPT_RUNNER));
        const explicit = parseArgs([...REQUIRED_ARGS, '--focus-safe-helper', '/tmp/focus-safe-browser.cjs'], {});
        const fromEnv = parseArgs(REQUIRED_ARGS, {FLUENTREAD_FOCUS_SAFE_HELPER: '/tmp/focus-safe-browser.cjs'});
        const headed = parseArgs([...REQUIRED_ARGS, '--headed'], {});

        expect(explicit).toMatchObject({background: true, focusSafeHelper: '/tmp/focus-safe-browser.cjs'});
        expect(fromEnv).toMatchObject({background: true, focusSafeHelper: '/tmp/focus-safe-browser.cjs'});
        expect(headed).toMatchObject({background: false, focusSafeHelper: ''});
    });
});
