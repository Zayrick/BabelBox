import {describe, expect, it} from 'vitest';
import {createExtensionManifest} from '@/wxt.config';

function permissionsFor(browser: string, manifestVersion: 2 | 3): string[] {
    const manifest = createExtensionManifest({browser, manifestVersion} as Parameters<typeof createExtensionManifest>[0]);
    return manifest.permissions as string[];
}

describe('extension manifest capabilities', () => {
    it('publishes the BabelBox display identity for every browser target', () => {
        const chrome = createExtensionManifest({browser: 'chrome', manifestVersion: 3});

        expect(chrome.name).toBe('BabelBox 翻译机');
        expect(chrome.description).toContain('BabelBox');
    });

    it('declares Offscreen only for supported Chrome and Edge MV3 builds', () => {
        for (const [browser, manifestVersion, expected] of [
            ['chrome', 3, 1],
            ['edge', 3, 1],
            ['chrome', 2, 0],
            ['firefox', 2, 0],
            ['firefox', 3, 0],
            ['opera', 3, 0],
        ] as const) {
            const permissions = permissionsFor(browser, manifestVersion);
            expect(permissions.filter((permission) => permission === 'offscreen'), `${browser}-mv${manifestVersion}`)
                .toHaveLength(expected);
            expect(permissions).toEqual(expect.arrayContaining(['storage', 'alarms', 'contextMenus']));
        }
    });

    it('keeps the BabelBox Firefox add-on identity out of Chromium manifests', () => {
        const firefox = createExtensionManifest({browser: 'firefox', manifestVersion: 2});
        const chrome = createExtensionManifest({browser: 'chrome', manifestVersion: 3});

        expect(firefox.browser_specific_settings).toEqual({
            gecko: {id: '{c3d6b35f-2a87-41cd-a9b8-5fa2e21f129d}'},
        });
        expect(chrome.browser_specific_settings).toBeUndefined();
    });
});
