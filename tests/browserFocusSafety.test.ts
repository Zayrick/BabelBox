import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {describe, expect, it, vi} from 'vitest';

const PROJECT_ROOT = resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const RUNNER_CLI_CASES = [
    {
        path: 'scripts/run-userscript-smoke-test.cjs',
        requiredArgs: [
            '--artifact', '.output/userscript/fluent-read.user.js',
            '--playwright-root', '/tmp/playwright-runtime',
            '--artifacts-dir', '/tmp/userscript-artifacts',
        ],
    },
    {
        path: 'scripts/run-video-subtitle-test.cjs',
        requiredArgs: ['--playwright-root', '/tmp/playwright-runtime'],
    },
    {
        path: 'scripts/run-video-performance-test.cjs',
        requiredArgs: ['--playwright-root', '/tmp/playwright-runtime'],
    },
];

describe('browser regression focus safety', () => {
    it('uses an isolated page when the focus-safe helper owns the startup page', async () => {
        const {selectUserscriptTestPage} = require(resolve(
            PROJECT_ROOT,
            'scripts/run-userscript-smoke-test.cjs',
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

    it.each(RUNNER_CLI_CASES)('$path requires a focus-safe helper in background mode', ({path, requiredArgs}) => {
        const {parseArgs} = require(resolve(PROJECT_ROOT, path));
        expect(() => parseArgs(requiredArgs, {})).toThrow(/--focus-safe-helper|FLUENTREAD_FOCUS_SAFE_HELPER/);
    });

    it.each(RUNNER_CLI_CASES)('$path accepts an explicit helper, environment helper, or headed mode', ({path, requiredArgs}) => {
        const {parseArgs} = require(resolve(PROJECT_ROOT, path));
        const explicit = parseArgs([...requiredArgs, '--focus-safe-helper', '/tmp/focus-safe-browser.cjs'], {});
        const fromEnv = parseArgs(requiredArgs, {FLUENTREAD_FOCUS_SAFE_HELPER: '/tmp/focus-safe-browser.cjs'});
        const headed = parseArgs([...requiredArgs, '--headed'], {});

        expect(explicit).toMatchObject({background: true, focusSafeHelper: '/tmp/focus-safe-browser.cjs'});
        expect(fromEnv).toMatchObject({background: true, focusSafeHelper: '/tmp/focus-safe-browser.cjs'});
        expect(headed).toMatchObject({background: false, focusSafeHelper: ''});
    });
});
