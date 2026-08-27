import {resolve} from 'node:path';
import {describe, expect, it} from 'vitest';
import {injectUserscriptBrowserImports, userscriptAliases} from '@/userscript/vite.config';

const entrypointId = resolve(process.cwd(), 'entrypoints/userscript-injection-fixture.ts');
const sourceModuleId = resolve(process.cwd(), 'src/app/content/runtime.ts');
const vueScriptModuleId = `${resolve(process.cwd(), 'src/features/selection-translation/ui/SelectionTranslator.vue')}?vue&type=script&setup=true&lang.ts`;

describe('userscript browser shim injection', () => {
    it('在 app 使用的 public contract 边界替换扩展专属 feature 与可信 GM 凭据上下文', () => {
        const stringAliases = new Map(userscriptAliases
            .filter((entry): entry is {find: string; replacement: string} => typeof entry.find === 'string')
            .map((entry) => [entry.find, entry.replacement]));

        for (const feature of ['area-translation', 'image-translation', 'video-subtitle']) {
            expect(stringAliases.get(`@/src/features/${feature}/public`)).toMatch(/userscript\/unsupportedCapabilities\.ts$/u);
        }
        expect(stringAliases.get('@/src/platform/storage/credentialContext')).toMatch(/userscript\/credentialContext\.ts$/u);
        expect(stringAliases.get('wxt/browser')).toMatch(/userscript\/browser\.ts$/u);
        expect(userscriptAliases.at(-1)?.find).toBe('@');
    });

    it('imports only unresolved browser globals', () => {
        const transformed = injectUserscriptBrowserImports(
            'browser.runtime.sendMessage({}); chrome.runtime.getURL("icon.png");',
            entrypointId,
        );

        expect(transformed).toContain('import {browser, chrome}');

        expect(injectUserscriptBrowserImports(
            'browser.runtime.sendMessage({type: "from-app"});',
            sourceModuleId,
        )).toContain('import {browser}');
        expect(injectUserscriptBrowserImports(
            'chrome.runtime.getURL("from-vue.png");',
            vueScriptModuleId,
        )).toContain('import {chrome}');
    });

    it('ignores property names and lexically bound identifiers', () => {
        expect(injectUserscriptBrowserImports(
            'const extensionGlobal = {} as {browser?: unknown}; void extensionGlobal.browser;',
            entrypointId,
        )).toBeNull();
        expect(injectUserscriptBrowserImports(
            'function useBrowser(browser: {runtime: unknown}) { return browser.runtime; }',
            entrypointId,
        )).toBeNull();
        expect(injectUserscriptBrowserImports(
            'import {browser} from "wxt/browser"; void browser.runtime;',
            entrypointId,
        )).toBeNull();
        expect(injectUserscriptBrowserImports(
            'import {browser} from "wxt/browser"; void browser.runtime;',
            vueScriptModuleId,
        )).toBeNull();
        expect(injectUserscriptBrowserImports(
            'const browser = createBrowser(); void browser.runtime;',
            vueScriptModuleId,
        )).toBeNull();
        expect(injectUserscriptBrowserImports(
            'const {chrome} = createGlobals(); void chrome.runtime;',
            vueScriptModuleId,
        )).toBeNull();
        expect(injectUserscriptBrowserImports(
            'browser.runtime.sendMessage({});',
            '/tmp/fluentread-external-module.ts',
        )).toBeNull();
        expect(injectUserscriptBrowserImports(
            '<script setup>browser.runtime.sendMessage({})</script>',
            resolve(process.cwd(), 'src/RawComponent.vue'),
        )).toBeNull();
    });
});
