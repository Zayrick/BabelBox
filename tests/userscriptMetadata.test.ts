import {describe, expect, it} from 'vitest';
import {createUserscriptMetadata} from '@/userscript/metadata';

describe('userscript metadata', () => {
    it('targets classic GM APIs supported by Via and allows provider requests', () => {
        const metadata = createUserscriptMetadata({version: '1.2.3'});

        expect(metadata.startsWith('// ==UserScript==\n')).toBe(true);
        expect(metadata).toContain('// @name         翻译机');
        expect(metadata).toContain('// @namespace    https://github.com/Zayrick/BabelBox');
        expect(metadata).toContain('// @homepageURL  https://github.com/Zayrick/BabelBox');
        expect(metadata).toContain('// @supportURL   https://github.com/Zayrick/BabelBox/issues');
        expect(metadata).toContain('// @version      1.2.3');
        expect(metadata).toContain('// @grant        GM_xmlhttpRequest');
        expect(metadata).toContain('// @grant        GM_registerMenuCommand');
        expect(metadata).toContain('// @connect      *');
        expect(metadata).toContain('// @run-at       document-start');
        expect(metadata).not.toContain('@require');
    });
});
