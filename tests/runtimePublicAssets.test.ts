import {existsSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import type {ResolvedPublicFile} from 'wxt';
import {
    injectDependencyPublicAssets,
    resolveDependencyPublicAssets,
} from '@/wxt.config';

const OCR_RUNTIME_FILES = [
    'babelbox-ocr/core/tesseract-core-lstm.wasm.js',
    'babelbox-ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js',
    'babelbox-ocr/core/tesseract-core-simd-lstm.wasm.js',
    'babelbox-ocr/worker/worker.min.js',
];
const OCR_LICENSE_FILES = [
    'babelbox-ocr/core/LICENSE',
    'babelbox-ocr/worker/LICENSE.md',
    'babelbox-ocr/worker/worker.min.js.LICENSE.txt',
];

describe('dependency public assets', () => {
    it('resolves every required OCR and PDF runtime file from installed dependencies', () => {
        const assets = resolveDependencyPublicAssets();
        const destinations = assets.map(asset => asset.relativeDest);

        expect(destinations.filter(path => OCR_RUNTIME_FILES.includes(path)).sort())
            .toEqual(OCR_RUNTIME_FILES);
        expect(destinations).toEqual(expect.arrayContaining(OCR_LICENSE_FILES));
        for (const directory of ['cmaps', 'iccs', 'standard_fonts', 'wasm']) {
            expect(destinations.some(path => path.startsWith(`pdfjs/${directory}/`))).toBe(true);
        }
        expect(new Set(destinations).size).toBe(destinations.length);
        expect(assets.every(asset => existsSync(asset.absoluteSrc))).toBe(true);
    });

    it('replaces stale public mirrors while retaining project-owned public files', () => {
        const retained = {relativeDest: 'icon/32.png', contents: 'icon'};
        const files: ResolvedPublicFile[] = [
            retained,
            {relativeDest: 'pdfjs/stale.wasm', contents: 'stale'},
            {relativeDest: 'babelbox-ocr/core/stale.js', contents: 'stale'},
        ];

        injectDependencyPublicAssets(files);

        expect(files).toContain(retained);
        expect(files.some(file => file.relativeDest.endsWith('/stale.wasm'))).toBe(false);
        expect(files.some(file => file.relativeDest.endsWith('/stale.js'))).toBe(false);
        expect(files.map(file => file.relativeDest)).toEqual(expect.arrayContaining(OCR_RUNTIME_FILES));
    });
});
