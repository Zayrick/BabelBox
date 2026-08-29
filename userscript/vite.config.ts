import fs from 'node:fs';
import {resolve} from 'node:path';
import vue from '@vitejs/plugin-vue';
import {defineConfig, type Plugin} from 'vite';
import {createUserscriptMetadata} from './metadata.ts';

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(resolve(root, 'package.json'), 'utf8')) as {
    version: string;
    userscriptVersion: string;
};
const iconDataUrl = `data:image/png;base64,${fs.readFileSync(resolve(root, 'public/icon/128.png')).toString('base64')}`;
const metadata = createUserscriptMetadata({version: packageJson.userscriptVersion, iconDataUrl});

function bundleUserscriptCss(): Plugin {
    return {
        name: 'bundle-userscript-css',
        enforce: 'post',
        generateBundle: {
          order: 'post',
          handler(_options, bundle) {
            const cssEntries = Object.entries(bundle).filter(([, item]) => item.type === 'asset' && item.fileName.endsWith('.css'));
            const css = cssEntries.map(([, item]) => String(item.type === 'asset' ? item.source : '')).join('\n');
            cssEntries.forEach(([fileName]) => delete bundle[fileName]);

            const entry = Object.values(bundle).find((item) => item.type === 'chunk' && item.isEntry);
            if (!entry || entry.type !== 'chunk') throw new Error('Userscript entry chunk was not generated');

            const bootstrap = [
                `globalThis.__BABELBOX_ICON_DATA__=${JSON.stringify(iconDataUrl)};`,
                `globalThis.__babelboxUserscriptCss=${JSON.stringify(css)};`,
            ].join('\n');
            entry.code = `${metadata}${bootstrap}\n${entry.code}`;

            entry.code = entry.code.replace(/[\uFFFE\uFFFF]/gu, (character) => {
                const codePoint = character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
                return `\\u${codePoint}`;
            });

          },
        },
        writeBundle(_options, bundle) {
            const files = Object.values(bundle).map((item) => item.fileName);
            if (files.length !== 1 || files[0] !== 'babelbox.user.js') {
                throw new Error(`Userscript build must emit one file, received: ${files.join(', ')}`);
            }
        },
    };
}

export const userscriptAliases = [
    {find: '@/src/platform/storage/credentialContext', replacement: resolve(root, 'userscript/credentialContext.ts')},
    // app/content 只依赖 feature public contract；在这个边界替换才能保证扩展专属 runtime 不进入产物。
    {find: '@/src/features/area-translation/public', replacement: resolve(root, 'userscript/unsupportedCapabilities.ts')},
    {find: '@/src/features/image-translation/public', replacement: resolve(root, 'userscript/unsupportedCapabilities.ts')},
    {find: '@/src/features/video-subtitle/public', replacement: resolve(root, 'userscript/unsupportedCapabilities.ts')},
    {find: /^\.\/chrome-translator$/u, replacement: resolve(root, 'userscript/chromeTranslator.ts')},
    {find: '@wxt-dev/storage', replacement: resolve(root, 'userscript/storage.ts')},
    {find: 'wxt/browser', replacement: resolve(root, 'userscript/browser.ts')},
    {find: 'wxt/utils/content-script-ui/shadow-root', replacement: resolve(root, 'userscript/shadow-root.ts')},
    {find: '@', replacement: root},
];

export default defineConfig({
    root,
    publicDir: false,
    plugins: [vue(), bundleUserscriptCss()],
    resolve: {
        alias: userscriptAliases,
    },
    define: {
        'process.env.NODE_ENV': JSON.stringify('production'),
        'process.env.VUE_APP_VERSION': JSON.stringify(packageJson.version),
        'process.env.VUE_APP_USERSCRIPT_VERSION': JSON.stringify(packageJson.userscriptVersion),
    },
    build: {
        outDir: resolve(root, '.output/userscript'),
        emptyOutDir: true,
        target: 'es2018',
        minify: 'oxc',
        sourcemap: false,
        cssCodeSplit: false,
        assetsInlineLimit: Number.MAX_SAFE_INTEGER,
        lib: {
            entry: resolve(root, 'userscript/main.ts'),
            name: 'BabelBoxUserscript',
            formats: ['iife'],
            fileName: () => 'babelbox.user.js',
        },
        rolldownOptions: {
            output: {
                codeSplitting: false,
                entryFileNames: 'babelbox.user.js',
            },
        },
    },
});
