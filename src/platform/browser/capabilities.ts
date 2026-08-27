export interface BrowserBuildTarget {
    readonly browser: string;
    readonly manifestVersion: 2 | 3;
}

export interface BrowserCapabilities extends BrowserBuildTarget {
    /** Chrome MV3 extension-owned DOM used by Translation API, OCR and CSP-safe audio. */
    readonly offscreenDocument: boolean;
    readonly chromeTranslation: boolean;
    readonly imageOcr: boolean;
    readonly imageTranslation: boolean;
    readonly areaTranslation: boolean;
    readonly selectionTtsOffscreen: boolean;
    /** Edge TTS can always return synthesized bytes for playback in the content page. */
    readonly selectionTtsPageFallback: true;
}

export type BrowserFeatureCapability =
    | 'areaTranslation'
    | 'chromeTranslation'
    | 'imageOcr'
    | 'imageTranslation'
    | 'offscreenDocument'
    | 'selectionTtsOffscreen'
    | 'selectionTtsPageFallback';

function normalizeBrowser(browser: string): string {
    return browser.trim().toLocaleLowerCase() || 'unknown';
}

/**
 * 浏览器能力的唯一纯契约。WXT manifest 与扩展各 runtime 都从同一个构建目标解析，
 * 测试可直接注入 browser/MV，不需要伪造真实浏览器全局。
 */
export function resolveBrowserCapabilities(target: BrowserBuildTarget): BrowserCapabilities {
    const browser = normalizeBrowser(target.browser);
    const chromiumMv3 = target.manifestVersion === 3 && (browser === 'chrome' || browser === 'edge');

    return Object.freeze({
        browser,
        manifestVersion: target.manifestVersion,
        offscreenDocument: chromiumMv3,
        // Offscreen 只是 transport 前提；offscreen runtime 仍会动态检查 Translator API readiness。
        chromeTranslation: target.manifestVersion === 3 && browser === 'chrome',
        imageOcr: chromiumMv3,
        imageTranslation: chromiumMv3,
        areaTranslation: chromiumMv3,
        selectionTtsOffscreen: chromiumMv3,
        selectionTtsPageFallback: true as const,
    });
}

/** Chrome 产物也可由 Edge 加载；宿主 UA 必须在运行时关闭 Edge 不提供的 Chrome Translation API。 */
export function applyRuntimeBrowserConstraints(
    capabilities: BrowserCapabilities,
    userAgent: string,
): BrowserCapabilities {
    if (capabilities.browser !== 'chrome' || !/\bEdg(?:A|iOS)?\//i.test(userAgent)) return capabilities;
    return Object.freeze({...capabilities, browser: 'edge', chromeTranslation: false});
}

export function readRuntimeUserAgent(host: {navigator?: {userAgent?: unknown}}): string {
    return typeof host.navigator?.userAgent === 'string' ? host.navigator.userAgent : '';
}

function defaultManifestVersion(browser: string): 2 | 3 {
    return browser === 'chrome' || browser === 'edge' ? 3 : 2;
}

/** Read WXT's compile-time constants without making Node/Vitest provide them. */
export function browserBuildTargetFromEnv(env?: Partial<ImportMetaEnv>): BrowserBuildTarget {
    const browser = normalizeBrowser(typeof env?.BROWSER === 'string' ? env.BROWSER : 'unknown');
    const manifestVersion = env?.MANIFEST_VERSION === 2 || env?.MANIFEST_VERSION === 3
        ? env.MANIFEST_VERSION
        : defaultManifestVersion(browser);
    return {browser, manifestVersion};
}

/** Keep a missing import.meta.env conservative and independently testable. */
export function browserBuildTargetFromImportMeta(
    meta?: {readonly env?: Partial<ImportMetaEnv>},
): BrowserBuildTarget {
    return browserBuildTargetFromEnv(meta?.env);
}

/**
 * 构建标记同时服务于产物审计。这里必须直接读取静态属性；把整个 import.meta 传给函数会绕过
 * Vite/WXT 的 compile-time replacement，导致 Chrome 生产包被误判为 unknown/MV2。
 */
export const browserCapabilityBuildMarker = `__FLUENTREAD_BROWSER_CAPABILITY_BUILD__:${import.meta.env.BROWSER}:mv${import.meta.env.MANIFEST_VERSION}__`;
const compiledBrowserBuildTarget = browserBuildTargetFromEnv({
    BROWSER: import.meta.env.BROWSER,
    MANIFEST_VERSION: import.meta.env.MANIFEST_VERSION,
});
const runtimeBrowserCapabilities = applyRuntimeBrowserConstraints(
    resolveBrowserCapabilities(compiledBrowserBuildTarget),
    readRuntimeUserAgent(globalThis),
);

/** Production singleton; composition roots accept an override for deterministic capability tests. */
export const browserCapabilities = Object.freeze({
    ...runtimeBrowserCapabilities,
    buildTargetMarker: browserCapabilityBuildMarker,
});
