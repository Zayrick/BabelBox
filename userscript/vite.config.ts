import fs from 'node:fs';
import {resolve} from 'node:path';
import vue from '@vitejs/plugin-vue';
import ts from 'typescript';
import {defineConfig, normalizePath, type Plugin} from 'vite';
import {createUserscriptMetadata} from './metadata.ts';

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(fs.readFileSync(resolve(root, 'package.json'), 'utf8')) as {
    version: string;
    userscriptVersion: string;
};
const iconDataUrl = `data:image/png;base64,${fs.readFileSync(resolve(root, 'public/icon/128.png')).toString('base64')}`;
const metadata = createUserscriptMetadata({version: packageJson.userscriptVersion, iconDataUrl});
const browserShimPath = resolve(root, 'userscript/browser.ts');
const projectRoot = `${normalizePath(root)}/`;

export const compatibilityPreludeStart = '/* FluentRead userscript compatibility prelude:start */';
export const compatibilityPreludeEnd = '/* FluentRead userscript compatibility prelude:end */';

const compatibilityPrelude = `${compatibilityPreludeStart}
(function () {
    if (typeof Object.fromEntries !== 'function') {
        Object.defineProperty(Object, 'fromEntries', {
            configurable: true,
            writable: true,
            value: function (entries) {
                var result = {};
                Array.from(entries).forEach(function (entry) {
                    Object.defineProperty(result, entry[0], {
                        configurable: true,
                        enumerable: true,
                        writable: true,
                        value: entry[1]
                    });
                });
                return result;
            }
        });
    }
    if (typeof Promise.allSettled !== 'function') {
        Object.defineProperty(Promise, 'allSettled', {
            configurable: true,
            writable: true,
            value: function (values) {
                return Promise.all(Array.from(values, function (value) {
                    return Promise.resolve(value).then(function (fulfilledValue) {
                        return {status: 'fulfilled', value: fulfilledValue};
                    }, function (reason) {
                        return {status: 'rejected', reason: reason};
                    });
                }));
            }
        });
    }
    if (typeof Array.prototype.flatMap !== 'function') {
        Object.defineProperty(Array.prototype, 'flatMap', {
            configurable: true,
            writable: true,
            value: function (callback, thisArg) {
                if (this === null || this === undefined) throw new TypeError('Array.prototype.flatMap called on null or undefined');
                if (typeof callback !== 'function') throw new TypeError('flatMap callback must be a function');
                var source = Object(this);
                var numericLength = Number(source.length) || 0;
                var length = Math.min(Math.max(Math.floor(numericLength), 0), 9007199254740991);
                var result = [];
                for (var index = 0; index < length; index += 1) {
                    if (!(index in source)) continue;
                    var mapped = callback.call(thisArg, source[index], index, source);
                    if (!Array.isArray(mapped)) {
                        result.push(mapped);
                        continue;
                    }
                    for (var mappedIndex = 0; mappedIndex < mapped.length; mappedIndex += 1) {
                        if (mappedIndex in mapped) result.push(mapped[mappedIndex]);
                    }
                }
                return result;
            }
        });
    }
}());
${compatibilityPreludeEnd}`;

type BrowserGlobal = 'browser' | 'chrome';

function collectBindingNames(name: ts.BindingName, bindings: Set<BrowserGlobal>): void {
    if (ts.isIdentifier(name)) {
        if (name.text === 'browser' || name.text === 'chrome') bindings.add(name.text);
        return;
    }
    for (const element of name.elements) {
        if (!ts.isOmittedExpression(element)) collectBindingNames(element.name, bindings);
    }
}

function findTopLevelBrowserBindings(sourceFile: ts.SourceFile): Set<BrowserGlobal> {
    const bindings = new Set<BrowserGlobal>();
    for (const statement of sourceFile.statements) {
        if (ts.isImportDeclaration(statement)) {
            const clause = statement.importClause;
            if (!clause || clause.isTypeOnly) continue;
            if (clause.name) collectBindingNames(clause.name, bindings);
            const namedBindings = clause.namedBindings;
            if (namedBindings && ts.isNamespaceImport(namedBindings)) {
                collectBindingNames(namedBindings.name, bindings);
            } else if (namedBindings) {
                for (const element of namedBindings.elements) {
                    if (!element.isTypeOnly) collectBindingNames(element.name, bindings);
                }
            }
            continue;
        }
        if (ts.isImportEqualsDeclaration(statement)) {
            if (!statement.isTypeOnly) collectBindingNames(statement.name, bindings);
            continue;
        }
        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                collectBindingNames(declaration.name, bindings);
            }
            continue;
        }
        if ((ts.isFunctionDeclaration(statement)
            || ts.isClassDeclaration(statement)
            || ts.isEnumDeclaration(statement)) && statement.name) {
            collectBindingNames(statement.name, bindings);
            continue;
        }
        if (ts.isModuleDeclaration(statement) && ts.isIdentifier(statement.name)) {
            collectBindingNames(statement.name, bindings);
        }
    }
    return bindings;
}

function findFreeBrowserGlobals(code: string, id: string): BrowserGlobal[] {
    const scriptKind = id.endsWith('.vue') ? ts.ScriptKind.TS : undefined;
    const sourceFile = ts.createSourceFile(id, code, ts.ScriptTarget.Latest, true, scriptKind);
    const topLevelBindings = findTopLevelBrowserBindings(sourceFile);
    const options: ts.CompilerOptions = {
        module: ts.ModuleKind.ESNext,
        noLib: true,
        noResolve: true,
        target: ts.ScriptTarget.Latest,
    };
    const host: ts.CompilerHost = {
        fileExists: (fileName) => fileName === id,
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => root,
        getDefaultLibFileName: () => '',
        getNewLine: () => '\n',
        getSourceFile: (fileName) => fileName === id ? sourceFile : undefined,
        readFile: (fileName) => fileName === id ? code : undefined,
        useCaseSensitiveFileNames: () => true,
        writeFile: () => undefined,
    };
    const checker = ts.createProgram([id], options, host).getTypeChecker();
    const found = new Set<BrowserGlobal>();
    const visit = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && (node.text === 'browser' || node.text === 'chrome')) {
            const parent = node.parent;
            const isPropertyName = (ts.isPropertyAccessExpression(parent) && parent.name === node)
                || ((ts.isPropertyAssignment(parent)
                    || ts.isMethodDeclaration(parent)
                    || ts.isPropertyDeclaration(parent)
                    || ts.isPropertySignature(parent)
                    || ts.isMethodSignature(parent)) && parent.name === node);
            const isTypeOnlyReference = ts.isTypeReferenceNode(parent)
                || ts.isTypeQueryNode(parent)
                || ts.isQualifiedName(parent);
            if (!isPropertyName
                && !isTypeOnlyReference
                && !topLevelBindings.has(node.text)
                && !checker.getSymbolAtLocation(node)) {
                found.add(node.text);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return (['browser', 'chrome'] as const).filter((name) => found.has(name));
}

export function injectUserscriptBrowserImports(code: string, id: string): string | null {
    const [rawId, query = ''] = id.split('?', 2);
    const cleanId = normalizePath(rawId);
    const isScriptModule = /\.[cm]?[jt]sx?$/u.test(cleanId);
    const isVueScriptModule = cleanId.endsWith('.vue')
        && new URLSearchParams(query).get('type') === 'script';
    if (!cleanId.startsWith(projectRoot) || (!isScriptModule && !isVueScriptModule)) return null;

    const injected = findFreeBrowserGlobals(code, cleanId);
    if (injected.length === 0) return null;

    return `import {${injected.join(', ')}} from ${JSON.stringify(browserShimPath)};\n${code}`;
}

function injectUserscriptBrowserShim(): Plugin {
    return {
        name: 'inject-userscript-browser-shim',
        enforce: 'pre',
        transform(code, id) {
            const transformed = injectUserscriptBrowserImports(code, id);
            return transformed ? {code: transformed, map: null} : null;
        },
    };
}

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
                compatibilityPrelude,
                `globalThis.__FLUENTREAD_ICON_DATA__=${JSON.stringify(iconDataUrl)};`,
                `globalThis.__fluentReadUserscriptCss=${JSON.stringify(css)};`,
            ].join('\n');
            entry.code = `${metadata}${bootstrap}\n${entry.code}`;

            entry.code = entry.code.replace(/[\uFFFE\uFFFF]/gu, (character) => {
                const codePoint = character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0');
                return `\\u${codePoint}`;
            });

            const leakedGlobals = findFreeBrowserGlobals(entry.code, resolve(root, '.output/userscript/fluent-read.user.js'));
            if (leakedGlobals.length > 0) {
                throw new Error(`Userscript bundle contains unresolved extension globals: ${leakedGlobals.join(', ')}`);
            }
          },
        },
        writeBundle(_options, bundle) {
            const files = Object.values(bundle).map((item) => item.fileName);
            if (files.length !== 1 || files[0] !== 'fluent-read.user.js') {
                throw new Error(`Userscript build must emit one file, received: ${files.join(', ')}`);
            }
        },
    };
}

function unwrapWxtEntrypoints(): Plugin {
    const entrypoints = new Set([
        resolve(root, 'entrypoints/content.ts'),
    ]);
    return {
        name: 'unwrap-wxt-entrypoints',
        enforce: 'pre',
        transform(code, id) {
            if (!entrypoints.has(id)) return null;
            return code.replace(/\bdefineContentScript\s*\(/gu, '((definition) => definition)(');
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
    plugins: [unwrapWxtEntrypoints(), injectUserscriptBrowserShim(), vue(), bundleUserscriptCss()],
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
            name: 'FluentReadUserscript',
            formats: ['iife'],
            fileName: () => 'fluent-read.user.js',
        },
        rolldownOptions: {
            output: {
                codeSplitting: false,
                entryFileNames: 'fluent-read.user.js',
            },
        },
    },
});
