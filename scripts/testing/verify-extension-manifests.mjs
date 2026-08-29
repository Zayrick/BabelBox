#!/usr/bin/env node

import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function optionValue(args, name, fallback) {
    const index = args.indexOf(name);
    if (index < 0) return fallback;
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} 缺少目录`);
    return value;
}

async function readManifest(directory) {
    const manifestPath = path.join(directory, 'manifest.json');
    return JSON.parse(await readFile(manifestPath, 'utf8'));
}

async function readBackgroundBundle(directory, manifest) {
    const files = manifest.manifest_version === 3
        ? [manifest.background?.service_worker]
        : manifest.background?.scripts;
    assert(Array.isArray(files) && files.length > 0 && files.every((file) => typeof file === 'string'),
        `无法解析 ${directory} 的后台脚本`);
    return (await Promise.all(files.map((file) => readFile(path.join(directory, file), 'utf8')))).join('\n');
}

async function listOffscreenArtifacts(directory, current = directory) {
    const artifacts = [];
    for (const entry of await readdir(current, {withFileTypes: true})) {
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) artifacts.push(...await listOffscreenArtifacts(directory, absolute));
        else if (entry.name.toLocaleLowerCase().includes('offscreen')) {
            artifacts.push(path.relative(directory, absolute).split(path.sep).join('/'));
        }
    }
    return artifacts.sort();
}

async function readJavaScriptBundle(directory, current = directory) {
    const sources = [];
    for (const entry of await readdir(current, {withFileTypes: true})) {
        const absolute = path.join(current, entry.name);
        if (entry.isDirectory()) sources.push(await readJavaScriptBundle(directory, absolute));
        else if (entry.name.endsWith('.js')) sources.push(await readFile(absolute, 'utf8'));
    }
    return sources.join('\n');
}

function countPermission(manifest, permission) {
    return Array.isArray(manifest.permissions)
        ? manifest.permissions.filter((candidate) => candidate === permission).length
        : 0;
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

async function main() {
    const args = process.argv.slice(2);
    const chromeDir = path.resolve(PROJECT_ROOT, optionValue(args, '--chrome-dir', '.output/chrome-mv3'));
    const firefoxDir = path.resolve(PROJECT_ROOT, optionValue(args, '--firefox-dir', '.output/firefox-mv2'));
    const [chromeManifest, firefoxManifest, chromeArtifacts, firefoxArtifacts, chromeJavaScript, firefoxJavaScript] = await Promise.all([
        readManifest(chromeDir),
        readManifest(firefoxDir),
        listOffscreenArtifacts(chromeDir),
        listOffscreenArtifacts(firefoxDir),
        readJavaScriptBundle(chromeDir),
        readJavaScriptBundle(firefoxDir),
    ]);
    const [chromeBackground, firefoxBackground] = await Promise.all([
        readBackgroundBundle(chromeDir, chromeManifest),
        readBackgroundBundle(firefoxDir, firefoxManifest),
    ]);

    assert(chromeManifest.manifest_version === 3, 'Chrome 产物必须是 Manifest V3');
    assert(countPermission(chromeManifest, 'offscreen') === 1, 'Chrome MV3 必须且只能声明一次 offscreen 权限');
    assert(chromeArtifacts.includes('offscreen.html'), 'Chrome MV3 缺少 offscreen.html');
    assert(firefoxManifest.manifest_version === 2, 'Firefox 默认产物必须是 Manifest V2');
    assert(countPermission(firefoxManifest, 'offscreen') === 0, 'Firefox 不得声明 Chrome-only offscreen 权限');
    assert(firefoxArtifacts.length === 0, `Firefox 不得包含 Offscreen 页面或 chunk：${firefoxArtifacts.join(', ')}`);
    const chromeBuildMarker = '__BABELBOX_BROWSER_CAPABILITY_BUILD__:chrome:mv3__';
    const firefoxBuildMarker = '__BABELBOX_BROWSER_CAPABILITY_BUILD__:firefox:mv2__';
    assert(chromeJavaScript.includes(chromeBuildMarker), 'Chrome 产物缺少 chrome/MV3 runtime capability 构建标记');
    assert(!chromeJavaScript.includes(firefoxBuildMarker), 'Chrome 产物混入 Firefox runtime capability 构建标记');
    assert(firefoxJavaScript.includes(firefoxBuildMarker), 'Firefox 产物缺少 firefox/MV2 runtime capability 构建标记');
    assert(!firefoxJavaScript.includes(chromeBuildMarker), 'Firefox 产物混入 Chrome runtime capability 构建标记');
    assert(chromeBackground.includes(chromeBuildMarker), 'Chrome 后台脚本缺少 chrome/MV3 runtime capability 构建标记');
    assert(firefoxBackground.includes(firefoxBuildMarker), 'Firefox 后台脚本缺少 firefox/MV2 runtime capability 构建标记');
    assert(!chromeBackground.includes('import.meta'), 'Chrome classic MV3 background 不得残留 import.meta 语法');
    assert(!firefoxBackground.includes('import.meta'), 'Firefox classic MV2 background 不得残留 import.meta 语法');

    console.log(JSON.stringify({
        status: 'ok',
        chrome: {manifestVersion: 3, offscreenPermission: true, runtimeCapabilityMarker: chromeBuildMarker, artifacts: chromeArtifacts},
        firefox: {manifestVersion: 2, offscreenPermission: false, runtimeCapabilityMarker: firefoxBuildMarker, artifacts: firefoxArtifacts},
    }, null, 2));
}

main().catch((error) => {
    console.error(`[extension-manifest-verifier] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
});
