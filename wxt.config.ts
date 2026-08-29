import {
    defineConfig,
    type ConfigEnv,
    type CopiedPublicFile,
    type ResolvedPublicFile,
    type UserManifest,
} from 'wxt';
import vue from '@vitejs/plugin-vue';
import {createRequire} from 'node:module';
import {dirname, relative, resolve, sep} from 'path';
import fs from 'fs';
import {resolveBrowserCapabilities} from './src/platform/browser/capabilities';


const packageJson = JSON.parse(fs.readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf-8'));
const firefoxRunnerBinary = process.env.BABELBOX_FIREFOX_RUNNER_BINARY;
const firefoxRunnerProfile = process.env.BABELBOX_FIREFOX_RUNNER_PROFILE;
const firefoxRunnerStartUrl = process.env.BABELBOX_FIREFOX_RUNNER_START_URL;
const requireFromConfig = createRequire(import.meta.url);
const dependencyPublicAssetPrefixes = [
    'babelbox-ocr/core/',
    'babelbox-ocr/worker/',
    'pdfjs/',
];

function copiedDirectoryAssets(sourceRoot: string, outputRoot: string): CopiedPublicFile[] {
    const assets: CopiedPublicFile[] = [];
    const visit = (directory: string) => {
        const entries = fs.readdirSync(directory, {withFileTypes: true})
            .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
        for (const entry of entries) {
            const absolutePath = resolve(directory, entry.name);
            if (entry.isDirectory()) {
                visit(absolutePath);
            } else if (entry.isFile()) {
                const packagePath = relative(sourceRoot, absolutePath).split(sep).join('/');
                assets.push({
                    absoluteSrc: absolutePath,
                    relativeDest: `${outputRoot}/${packagePath}`,
                });
            }
        }
    };

    visit(sourceRoot);
    return assets;
}

/** Resolve extension runtime files from the exact package versions selected by pnpm. */
export function resolveDependencyPublicAssets(): CopiedPublicFile[] {
    const tesseractRoot = dirname(requireFromConfig.resolve('tesseract.js/package.json'));
    const requireFromTesseract = createRequire(resolve(tesseractRoot, 'package.json'));
    const tesseractCoreRoot = dirname(requireFromTesseract.resolve('tesseract.js-core/package.json'));
    const pdfjsRoot = dirname(requireFromConfig.resolve('pdfjs-dist/package.json'));

    return [
        {
            absoluteSrc: resolve(tesseractRoot, 'dist/worker.min.js'),
            relativeDest: 'babelbox-ocr/worker/worker.min.js',
        },
        {
            absoluteSrc: resolve(tesseractRoot, 'dist/worker.min.js.LICENSE.txt'),
            relativeDest: 'babelbox-ocr/worker/worker.min.js.LICENSE.txt',
        },
        {
            absoluteSrc: resolve(tesseractRoot, 'LICENSE.md'),
            relativeDest: 'babelbox-ocr/worker/LICENSE.md',
        },
        {
            absoluteSrc: resolve(tesseractCoreRoot, 'LICENSE'),
            relativeDest: 'babelbox-ocr/core/LICENSE',
        },
        ...[
            'tesseract-core-lstm.wasm.js',
            'tesseract-core-relaxedsimd-lstm.wasm.js',
            'tesseract-core-simd-lstm.wasm.js',
        ].map((fileName): CopiedPublicFile => ({
            absoluteSrc: resolve(tesseractCoreRoot, fileName),
            relativeDest: `babelbox-ocr/core/${fileName}`,
        })),
        ...['cmaps', 'iccs', 'standard_fonts', 'wasm'].flatMap(directory =>
            copiedDirectoryAssets(resolve(pdfjsRoot, directory), `pdfjs/${directory}`)),
    ];
}

function isDependencyPublicAsset(relativeDest: string): boolean {
    const normalizedPath = relativeDest.split(sep).join('/');
    return dependencyPublicAssetPrefixes.some(prefix => normalizedPath.startsWith(prefix));
}

/** Replace ignored local mirrors with dependency-owned sources before WXT copies public assets. */
export function injectDependencyPublicAssets(files: ResolvedPublicFile[]): void {
    const retainedFiles = files.filter(file => !isDependencyPublicAsset(file.relativeDest));
    files.splice(0, files.length, ...retainedFiles, ...resolveDependencyPublicAssets());
}

/**
 * Edge 的扩展内容脚本加载器会拒绝产物中的 Unicode 非字符 U+FFFE/U+FFFF，
 * 并把它们误报成“不是 UTF-8 编码”。部分第三方解析器会把源码中的转义
 * 序列展开成这些字符，因此在最终 JavaScript chunk 中重新写成 ASCII 转义，
 * 保持运行时值不变，同时避免扩展加载失败。
 */
function escapeExtensionNoncharacters() {
    const escapeActualNoncharacters = (code: string) => code.replace(/[\uFFFE\uFFFF]/g, (character) => {
        const codePoint = character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
        return `\\u${codePoint}`;
    });

    return {
        name: 'escape-extension-noncharacters',
        generateBundle(_options: unknown, bundle: Record<string, {type: string; code?: string}>) {
            // 部分构建阶段会在 renderChunk 之后再次序列化字符串，因此在
            // 写入扩展目录前再检查一次最终 chunk，覆盖后台脚本等产物。
            for (const chunk of Object.values(bundle)) {
                if (chunk.type !== 'chunk' || chunk.code === undefined) continue;

                const escaped = escapeActualNoncharacters(chunk.code);
                if (escaped !== chunk.code) chunk.code = escaped;
            }
        },
    };
}

export function createExtensionManifest(
    env: Pick<ConfigEnv, 'browser' | 'manifestVersion'>,
): UserManifest {
    const capabilities = resolveBrowserCapabilities(env);
    return {
        name: 'BabelBox 翻译机',
        description: 'BabelBox 提供全文双语翻译、划词翻译和多翻译服务支持。',
        permissions: [
            'storage',
            'alarms',
            'contextMenus',
            ...(capabilities.offscreenDocument ? ['offscreen'] : []),
        ],
        content_security_policy: {
            extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
        },
        host_permissions: [
            'https://translate.google.com/*',
            'https://translate.google.co.uk/*',
            'https://translate.googleapis.com/*',
            'https://dev.microsofttranslator.com/*',
            'https://*.tts.speech.microsoft.com/*',
            'https://deeplx.1stg.me/*',
            'https://freeapi.fanyimao.cn/*',
            'https://api.deeplx.org/*',
            'http://localhost/*',
            'http://127.0.0.1/*',
            'http://*/*',
            'https://*/*',
        ],
        browser_specific_settings: env.browser === 'firefox' ? {
            gecko: {
                id: '{c3d6b35f-2a87-41cd-a9b8-5fa2e21f129d}',
            },
        } : undefined,
        web_accessible_resources: [
            {
                resources: ['icon/32.png', 'icon/48.png', 'icon/128.png'],
                matches: ['<all_urls>'],
                use_dynamic_url: true,
            },
        ],
    };
}


// See https://wxt.dev/api/config.html
export default defineConfig({
    hooks: {
        'build:publicAssets': (_, files) => injectDependencyPublicAssets(files),
        'prepare:tsconfig': (_, {tsconfig}) => {
            // WXT 0.21 enables this globally; the existing indexed-access contracts
            // require a dedicated hardening pass before this can be enabled safely.
            delete tsconfig.compilerOptions.noUncheckedIndexedAccess;
        },
    },
    // Firefox 的开发 runner 使用一次性 profile；预置启动参数，避免每轮 UI
    // 回归都被 about:welcome 首次启动引导遮挡。仅影响 pnpm dev:firefox，
    // 不会写入用户 Firefox profile，也不会进入扩展发布产物。
    webExt: {
        binaries: firefoxRunnerBinary ? {firefox: firefoxRunnerBinary} : undefined,
        firefoxProfile: firefoxRunnerProfile || undefined,
        startUrls: [firefoxRunnerStartUrl || 'about:blank'],
        firefoxPref: {
            'browser.aboutwelcome.enabled': false,
            'browser.aboutwelcome.screens': '',
            'browser.startup.homepage_override.mstone': 'ignore',
            'browser.startup.homepage_override.buildID': 'ignore',
            'startup.homepage_override_url': 'about:blank',
            'startup.homepage_override_nimbus_disable_wnp': true,
            'browser.messaging-system.whatsNewPanel.enabled': false,
            'browser.startup.homepage': 'about:blank',
            'startup.homepage_welcome_url': 'about:blank',
            'startup.homepage_welcome_url.additional': '',
            'trailhead.firstrun.didSeeAboutWelcome': true,
            'trailhead.firstrun.branches': 'nofirstrun-exp',
            'browser.shell.checkDefaultBrowser': false,
        },
    },
    imports: {
        addons: {
            vueTemplate: true,
        },
    },
    vite: (env) => {
        const isProductionBuild = env.command === 'build' && env.mode === 'production';
        return {
            plugins: [vue(), escapeExtensionNoncharacters()],
            define: {
                'process.env.VUE_APP_VERSION': JSON.stringify(packageJson.version),
            },
            // Source-level redaction is the primary control. Production-only
            // stripping is defense in depth for future diagnostics added later.
            build: isProductionBuild ? {
                rolldownOptions: {
                    output: {
                        minify: {
                            compress: {
                                dropConsole: true,
                                dropDebugger: true,
                            },
                        },
                    },
                },
            } : undefined,
        };
    },
    manifest: createExtensionManifest,

});
