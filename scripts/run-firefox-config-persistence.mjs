#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {randomUUID} from 'node:crypto';
import {connect} from '../node_modules/.pnpm/web-ext-run@0.2.4/node_modules/web-ext-run/lib/firefox/remote.js';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
    const key = process.argv[index];
    if (!key.startsWith('--')) continue;
    args.set(key.slice(2), process.argv[index + 1] || '');
    index += 1;
}

const port = Number(args.get('port') || 50593);
const artifactsDir = path.resolve(args.get('artifacts-dir') || '/private/tmp/fluentread-firefox-persistence-20260816');
fs.mkdirSync(artifactsDir, {recursive: true});

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function packetFromError(error) {
    const message = String(error?.message || error);
    const start = message.indexOf('{');
    if (start < 0) return null;
    try {
        return JSON.parse(message.slice(start));
    } catch {
        return null;
    }
}

async function selectedTab(client) {
    const response = await client.request('listTabs');
    return response.tabs.find(tab => tab.selected) || response.tabs[0];
}

async function selectedFrame(client) {
    const tab = await selectedTab(client);
    const target = await client.request({to: tab.actor, type: 'getTarget'});
    return {tab, frame: target.frame};
}

async function evaluate(client, frame, source) {
    let resultPacket;
    const onError = error => {
        const packet = packetFromError(error);
        if (packet?.type === 'evaluationResult') resultPacket = packet;
    };
    client.on('error', onError);
    try {
        const response = await client.request({
            to: frame.consoleActor,
            type: 'evaluateJSAsync',
            text: source,
            frameActor: frame.actor,
        });
        const deadline = Date.now() + 10000;
        while (!resultPacket && Date.now() < deadline) await sleep(25);
        if (!resultPacket) throw new Error(`Firefox RDP evaluation timeout: ${response.resultID}`);
        if (resultPacket.hasException) throw new Error(`Firefox RDP evaluation failed: ${JSON.stringify(resultPacket)}`);
        return resultPacket.result;
    } finally {
        client.off('error', onError);
    }
}

async function evaluateJson(client, frame, source) {
    const value = await evaluate(client, frame, `JSON.stringify(${source})`);
    const serialized = value && typeof value === 'object' && 'value' in value ? value.value : value;
    if (typeof serialized !== 'string') return serialized;
    return JSON.parse(serialized);
}

async function evaluateAsyncJson(client, frame, source) {
    const marker = '__fluentReadRdpAsyncResult';
    await evaluate(client, frame, `(() => {
        globalThis.${marker} = {pending: true};
        Promise.resolve().then(() => (${source})).then(
            value => { globalThis.${marker} = {pending: false, value}; },
            error => { globalThis.${marker} = {pending: false, error: String(error)}; },
        );
        return true;
    })()`);
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        const current = await selectedFrame(client);
        const state = await evaluateJson(client, current.frame, `globalThis.${marker}`);
        if (!state?.pending) {
            if (state?.error) throw new Error(`Firefox async evaluation failed: ${state.error}`);
            return state?.value;
        }
        await sleep(50);
    }
    throw new Error('Firefox async evaluation timeout');
}

const CONFIG_PROJECTION_SOURCE = `browser.storage.local.get(null).then(all => {
    const value = all.config || all['local:config'];
    return {on: value?.on, from: value?.from, to: value?.to, service: value?.service, style: value?.style, display: value?.display, theme: value?.theme};
})`;

function readConfigProjection(client, frame) {
    return evaluateAsyncJson(client, frame, CONFIG_PROJECTION_SOURCE);
}

const CREDENTIAL_FIELDS = [
    'token',
    'ak',
    'sk',
    'appid',
    'key',
    'youdaoAppKey',
    'youdaoAppSecret',
    'tencentSecretId',
    'tencentSecretKey',
    'extra',
];

function credentialStorageSnapshotSource(sentinel) {
    return `(async () => {
        if (!browser.storage.session || typeof browser.storage.session.get !== 'function') {
            throw new Error('browser.storage.session is unavailable');
        }
        const [local, session] = await Promise.all([
            browser.storage.local.get(null),
            browser.storage.session.get(null),
        ]);
        const config = local.config || local['local:config'] || null;
        const history = local.configHistory || local['local:configHistory'] || null;
        const localCredentials = local.credentials || local['local:credentials'] || null;
        const sessionCredentials = session.credentials || session['session:credentials'] || null;
        const credentialFields = ${JSON.stringify(CREDENTIAL_FIELDS)};
        const historyConfigs = Array.isArray(history?.entries)
            ? history.entries.map(entry => entry?.config).filter(Boolean)
            : [];
        const containsSentinel = value => JSON.stringify(value ?? null).includes(${JSON.stringify(sentinel)});
        return {
            sessionAvailable: true,
            persistCredentials: config?.persistCredentials === true,
            localConfigCredentialFields: credentialFields.filter(field => Object.prototype.hasOwnProperty.call(config || {}, field)),
            historyCredentialFields: [...new Set(historyConfigs.flatMap(item => credentialFields.filter(field => Object.prototype.hasOwnProperty.call(item || {}, field))))],
            configHasSentinel: containsSentinel(config),
            historyHasSentinel: containsSentinel(history),
            sessionHasSentinel: containsSentinel(sessionCredentials),
            localCredentialsPresent: localCredentials !== null,
            localCredentialsHasSentinel: containsSentinel(localCredentials),
        };
    })()`;
}

async function readCredentialStorageSnapshot(client, sentinel) {
    const current = await selectedFrame(client);
    return evaluateAsyncJson(client, current.frame, credentialStorageSnapshotSource(sentinel));
}

function credentialSnapshotMatches(snapshot, expected) {
    return Object.entries(expected).every(([key, value]) => {
        if (Array.isArray(value)) return JSON.stringify(snapshot?.[key]) === JSON.stringify(value);
        return snapshot?.[key] === value;
    });
}

async function waitForCredentialStorage(client, sentinel, expected, label) {
    const deadline = Date.now() + 10000;
    let lastSnapshot;
    let consecutiveMatches = 0;
    while (Date.now() < deadline) {
        lastSnapshot = await readCredentialStorageSnapshot(client, sentinel);
        if (credentialSnapshotMatches(lastSnapshot, expected)) {
            consecutiveMatches += 1;
            if (consecutiveMatches >= 2) return lastSnapshot;
        } else {
            consecutiveMatches = 0;
        }
        await sleep(100);
    }
    throw new Error(`Firefox credential storage did not stabilize for ${label}: ${JSON.stringify({expected, actual: lastSnapshot})}`);
}

function credentialSaveSource({clientId, sequence, sentinel, sentinelKey, persistCredentials, removeSentinel = false}) {
    return `(async () => {
        if (!browser.storage.session || typeof browser.storage.session.get !== 'function') {
            throw new Error('browser.storage.session is unavailable');
        }
        const [local, session] = await Promise.all([
            browser.storage.local.get(null),
            browser.storage.session.get(null),
        ]);
        const current = local.config || local['local:config'];
        if (!current || typeof current !== 'object') throw new Error('local config is unavailable');
        const activeCredentials = session.credentials
            || session['session:credentials']
            || local.credentials
            || local['local:credentials']
            || {};
        const config = {...current, persistCredentials: ${persistCredentials ? 'true' : 'false'}};
        for (const field of ${JSON.stringify(CREDENTIAL_FIELDS)}) {
            if (Object.prototype.hasOwnProperty.call(activeCredentials, field)) {
                config[field] = activeCredentials[field];
            }
        }
        config.token = {...(activeCredentials.token || {})};
        ${removeSentinel
            ? `delete config.token[${JSON.stringify(sentinelKey)}];`
            : `config.token[${JSON.stringify(sentinelKey)}] = ${JSON.stringify(sentinel)};`}
        const response = await browser.runtime.sendMessage({
            type: 'persistConfig',
            config,
            clientId: ${JSON.stringify(clientId)},
            sequence: ${sequence},
        });
        if (response?.success !== true) {
            throw new Error('persistConfig failed: ' + JSON.stringify(response));
        }
        return {response, sequence: ${sequence}};
    })()`;
}

async function sendCredentialSave(client, options) {
    const current = await selectedFrame(client);
    return evaluateAsyncJson(client, current.frame, credentialSaveSource(options));
}

async function navigate(client, url) {
    const current = await selectedFrame(client);
    await client.request({to: current.frame.actor, type: 'navigateTo', url});
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
        try {
            const next = await selectedFrame(client);
            if (next.frame.url === url) return next;
        } catch {
            // The browsing context is replaced during navigation.
        }
        await sleep(100);
    }
    throw new Error(`Firefox RDP navigation timeout: ${url}`);
}

async function waitForDom(client, predicate, label) {
    const deadline = Date.now() + 15000;
    let lastError;
    while (Date.now() < deadline) {
        try {
            const current = await selectedFrame(client);
            const value = await evaluateJson(client, current.frame, predicate);
            if (value) return {current, value};
        } catch (error) {
            lastError = error;
        }
        await sleep(100);
    }
    throw new Error(`Firefox RDP DOM wait timeout: ${label}; ${lastError?.message || ''}`);
}

async function runCredentialLifecycle(client, result) {
    const sentinel = `fluentread-firefox-credential-${randomUUID()}`;
    const sentinelKey = `__firefox_persistence_${randomUUID().replaceAll('-', '')}`;
    const clientId = `firefox-config-persistence-${randomUUID()}`;
    let sequence = 0;
    let sentinelWriteAttempted = false;
    let lifecycleError;
    const commonCleanState = {
        sessionAvailable: true,
        localConfigCredentialFields: [],
        historyCredentialFields: [],
        configHasSentinel: false,
        historyHasSentinel: false,
    };

    result.credentialCases = {
        sessionRequired: true,
        sessionAvailable: false,
        clientId,
        sentinel,
        sentinelKey,
        sessionOnly: null,
        persistentOptIn: null,
        sessionOnlyAfterOptOut: null,
        cleanup: null,
    };

    try {
        const initial = await readCredentialStorageSnapshot(client, sentinel);
        result.credentialCases.sessionAvailable = initial?.sessionAvailable === true;
        if (!result.credentialCases.sessionAvailable) {
            throw new Error('Firefox credential lifecycle requires browser.storage.session');
        }

        sequence += 1;
        sentinelWriteAttempted = true;
        const sessionOnlyRequest = await sendCredentialSave(client, {
            clientId,
            sequence,
            sentinel,
            sentinelKey,
            persistCredentials: false,
        });
        await sleep(500);
        const sessionOnlyStorage = await waitForCredentialStorage(client, sentinel, {
            ...commonCleanState,
            persistCredentials: false,
            sessionHasSentinel: true,
            localCredentialsPresent: false,
            localCredentialsHasSentinel: false,
        }, 'default session-only credentials');
        result.credentialCases.sessionOnly = {request: sessionOnlyRequest, storage: sessionOnlyStorage};

        sequence += 1;
        const persistentRequest = await sendCredentialSave(client, {
            clientId,
            sequence,
            sentinel,
            sentinelKey,
            persistCredentials: true,
        });
        await sleep(500);
        const persistentStorage = await waitForCredentialStorage(client, sentinel, {
            ...commonCleanState,
            persistCredentials: true,
            sessionHasSentinel: true,
            localCredentialsPresent: true,
            localCredentialsHasSentinel: true,
        }, 'explicit local credential opt-in');
        result.credentialCases.persistentOptIn = {request: persistentRequest, storage: persistentStorage};

        sequence += 1;
        const optOutRequest = await sendCredentialSave(client, {
            clientId,
            sequence,
            sentinel,
            sentinelKey,
            persistCredentials: false,
        });
        await sleep(500);
        const optOutStorage = await waitForCredentialStorage(client, sentinel, {
            ...commonCleanState,
            persistCredentials: false,
            sessionHasSentinel: true,
            localCredentialsPresent: false,
            localCredentialsHasSentinel: false,
        }, 'local credential opt-out');
        result.credentialCases.sessionOnlyAfterOptOut = {request: optOutRequest, storage: optOutStorage};
    } catch (error) {
        lifecycleError = error;
        throw error;
    } finally {
        if (sentinelWriteAttempted) {
            try {
                sequence += 1;
                const cleanupRequest = await sendCredentialSave(client, {
                    clientId,
                    sequence,
                    sentinel,
                    sentinelKey,
                    persistCredentials: false,
                    removeSentinel: true,
                });
                await sleep(500);
                const cleanupStorage = await waitForCredentialStorage(client, sentinel, {
                    ...commonCleanState,
                    persistCredentials: false,
                    sessionHasSentinel: false,
                    localCredentialsPresent: false,
                    localCredentialsHasSentinel: false,
                }, 'credential sentinel cleanup');
                result.credentialCases.cleanup = {request: cleanupRequest, storage: cleanupStorage};
            } catch (error) {
                result.credentialCases.cleanupError = String(error?.stack || error?.message || error);
                if (!lifecycleError) throw error;
            }
        }
        result.credentialCases.lastSequence = sequence;
    }
}

async function main() {
    console.error(`[firefox-test] connecting to ${port}`);
    const firefox = await connect(port);
    const client = firefox.client;
    const result = {
        ok: false,
        browser: 'Firefox',
        port,
        artifactsDir,
        browserBootstrap: {
            firstRunDetected: false,
            firstRunBlocked: false,
            remainingDialogs: [],
        },
        persistenceCases: {
            before: 'zh-Hans',
            after: null,
            quickClose: false,
            crossPageSync: false,
            latestWriteWins: false,
        },
        credentialCases: {
            sessionRequired: true,
            sessionAvailable: false,
        },
        errors: [],
        evidence: [],
    };

    try {
        const initial = await selectedFrame(client);
        console.error(`[firefox-test] initial ${initial.frame.url}`);
        result.browserBootstrap.initialTab = {
            url: initial.frame.url,
            title: initial.frame.title,
        };
        if (initial.frame.url.includes('about:welcome') || initial.frame.url.includes('spotlight')) {
            result.browserBootstrap.firstRunDetected = true;
            result.browserBootstrap.firstRunBlocked = true;
            throw new Error('Firefox runner remained on a first-run page; no UI click was attempted');
        }

        const addons = await client.request('listAddons');
        const addon = addons.addons.find(item => item.temporarilyInstalled && item.name === '流畅阅读');
        if (!addon) throw new Error('Firefox runner did not install the temporary FluentRead add-on');
        const extensionBase = addon.manifestURL.replace(/\/manifest\.json$/, '');
        const popupUrl = `${extensionBase}/popup.html`;
        const optionsUrl = `${extensionBase}/options.html`;
        result.extensionId = addon.id;
        console.error(`[firefox-test] addon ${addon.id}`);

        console.error(`[firefox-test] navigate popup ${popupUrl}`);
        let current = await navigate(client, popupUrl);
        console.error(`[firefox-test] popup navigation complete ${current.frame.url}`);
        const popup = await waitForDom(client, `document.querySelector('.popup-shell')`, 'popup mount');
        result.popup = await evaluateJson(client, popup.current.frame, `({
            title: document.title,
            url: location.href,
            shell: Boolean(document.querySelector('.popup-shell')),
            target: document.querySelector('[aria-label="网页翻译目标语言"]')?.closest('.el-select')?.querySelector('.el-select__selected-item:not(.el-select__input-wrapper)')?.textContent?.trim() || null,
            text: document.body?.innerText?.slice(0, 1200) || ''
        })`);
        result.evidence.push({step: 'popup-loaded', url: popup.current.frame.url, ...result.popup});

        console.error(`[firefox-test] navigate options ${optionsUrl}`);
        current = await navigate(client, optionsUrl);
        console.error(`[firefox-test] options navigation complete ${current.frame.url}`);
        const options = await waitForDom(client, `document.querySelector('.settings-app')`, 'options mount');
        result.options = await evaluateJson(client, options.current.frame, `({
            title: document.title,
            url: location.href,
            app: Boolean(document.querySelector('.settings-app')),
            target: document.querySelector('[aria-label="默认目标语言"]')?.parentElement?.parentElement?.querySelector('.el-select__selected-item:not(.el-select__input-wrapper)')?.textContent?.trim() || null
        })`);
        // Allow configReady/hydration and the first storage echo to settle before editing.
        await sleep(500);

        const selectLanguage = async (label) => {
            const before = await selectedFrame(client);
            await evaluate(client, before.frame, `(() => {
                const input = document.querySelector('[aria-label="默认目标语言"]');
                if (!(input instanceof HTMLElement)) throw new Error('target language combobox not found');
                input.click();
                return true;
            })()`);
            await waitForDom(client, `document.querySelector('[aria-label="默认目标语言"]')?.getAttribute('aria-expanded') === 'true'`, `open target language ${label}`);
            const open = await selectedFrame(client);
            const clicked = await evaluateJson(client, open.frame, `(() => {
                const options = [...document.querySelectorAll('[role="option"]')];
                const option = options.find(item => item.textContent?.trim() === ${JSON.stringify(label)});
                if (!(option instanceof HTMLElement)) return false;
                option.click();
                return true;
            })()`);
            if (!clicked) throw new Error(`target language option not found: ${label}`);
            await waitForDom(client, `document.querySelector('[aria-label="默认目标语言"]')?.parentElement?.parentElement?.querySelector('.el-select__selected-item:not(.el-select__input-wrapper)')?.textContent?.trim() === ${JSON.stringify(label)}`, `selected target language ${label}`);
        };

        await selectLanguage('英语');
        // 让一个离散设置完成历史防抖，再执行下一次离散修改；快速关闭场景
        // 仍在后面单独验证，避免把两个用户明确选择误合并为一条历史。
        await sleep(500);
        await selectLanguage('日语');
        const beforeClose = await selectedFrame(client);
        result.persistenceCases.optionsLabel = await evaluateJson(client, beforeClose.frame, `document.querySelector('[aria-label="默认目标语言"]')?.parentElement?.parentElement?.querySelector('.el-select__selected-item:not(.el-select__input-wrapper)')?.textContent?.trim() || null`);
        const storageDeadline = Date.now() + 5000;
        do {
            result.persistenceCases.storageBeforeClose = await evaluateAsyncJson(client, beforeClose.frame, `browser.storage.local.get(null).then(all => { const value = all.config || all['local:config']; return {keys: Object.keys(all), to: value?.to, revision: value?.__fluentConfigRevision}; })`);
            if (result.persistenceCases.storageBeforeClose.to === 'ja') break;
            await sleep(100);
        } while (Date.now() < storageDeadline);

        // Trigger the real short-lifecycle path without touching the visible browser:
        // navigating the same extension tab away fires pagehide/unmount, then opens the
        // popup again in that same browsing context.
        console.error('[firefox-test] quick close via extension navigation');
        await navigate(client, popupUrl);
        result.persistenceCases.quickClose = true;
        const reopened = await waitForDom(client, `document.querySelector('[aria-label="网页翻译目标语言"]')?.closest('.el-select')?.querySelector('.el-select__selected-item:not(.el-select__input-wrapper)')?.textContent?.trim() === '日语'`, 'popup reopen target language');
        result.persistenceCases.after = await evaluateJson(client, reopened.current.frame, `document.querySelector('[aria-label="网页翻译目标语言"]')?.closest('.el-select')?.querySelector('.el-select__selected-item:not(.el-select__input-wrapper)')?.textContent?.trim() || null`);
        result.persistenceCases.storageAfterClose = await evaluateAsyncJson(client, reopened.current.frame, `browser.storage.local.get(null).then(all => { const value = all.config || all['local:config']; return {keys: Object.keys(all), to: value?.to, revision: value?.__fluentConfigRevision}; })`);
        result.persistenceCases.crossPageSync = result.persistenceCases.after === '日语';
        result.persistenceCases.latestWriteWins = result.persistenceCases.crossPageSync;
        result.evidence.push({step: 'popup-reopen', url: reopened.current.frame.url, target: result.persistenceCases.after, storage: result.persistenceCases.storageAfterClose});
        if (!result.persistenceCases.crossPageSync) throw new Error(`Firefox config did not persist across close/reopen: ${JSON.stringify(result.persistenceCases)}`);

        console.error('[firefox-test] verify config history');
        await sleep(800);
        await navigate(client, optionsUrl);
        const historyOptions = await waitForDom(client, `document.querySelector('.settings-app')`, 'history options mount');
        await evaluate(client, historyOptions.current.frame, `(() => {
            const button = [...document.querySelectorAll('nav[aria-label="设置分类"] button')]
                .find(item => item.textContent?.includes('配置管理'));
            if (!(button instanceof HTMLElement)) throw new Error('配置管理导航不存在');
            button.click();
            return true;
        })()`);
        const historyPanel = await waitForDom(client, `document.querySelector('.config-history-panel')?.offsetParent !== null`, 'config history panel');
        result.historyCases = await evaluateJson(client, historyPanel.current.frame, `(() => {
            const entries = [...document.querySelectorAll('.config-history-entry')];
            const current = document.querySelector('.config-history-entry.current .config-history-version b')?.textContent?.trim() || null;
            const undoButton = document.querySelector('[aria-label="撤销配置恢复"]');
            const redoButton = document.querySelector('[aria-label="重做配置恢复"]');
            return {
                count: entries.length,
                versions: entries.map(entry => entry.querySelector('.config-history-version b')?.textContent?.trim() || null),
                timestamps: entries.map(entry => entry.querySelector('.config-history-detail small')?.textContent?.trim() || null),
                current,
                hasUndo: undoButton instanceof HTMLButtonElement,
                hasRedo: redoButton instanceof HTMLButtonElement,
                canUndo: undoButton instanceof HTMLButtonElement && !undoButton.disabled,
                canRedo: redoButton instanceof HTMLButtonElement && !redoButton.disabled,
            };
        })()`);
        if (result.historyCases.count < 3 || result.historyCases.count > 5) throw new Error(`Firefox 配置历史条目数量异常: ${JSON.stringify(result.historyCases)}`);
        if (!result.historyCases.hasUndo || !result.historyCases.hasRedo || !result.historyCases.canUndo || result.historyCases.canRedo) {
            throw new Error(`Firefox 配置历史撤销/重做按钮状态异常: ${JSON.stringify(result.historyCases)}`);
        }
        if (new Set(result.historyCases.versions).size !== result.historyCases.count || result.historyCases.versions.some(value => !/^v\d+$/.test(value))) {
            throw new Error(`Firefox 配置历史版本号异常: ${JSON.stringify(result.historyCases)}`);
        }
        if (result.historyCases.timestamps.some(value => !value)) throw new Error('Firefox 配置历史缺少时间');

        const persistedHistory = await evaluateAsyncJson(client, (await selectedFrame(client)).frame, `browser.storage.local.get(null).then(all => {
            const history = all.configHistory || all['local:configHistory'];
            return {
                cursor: history?.cursor ?? null,
                entries: Array.isArray(history?.entries) ? history.entries.map(entry => ({
                    version: entry.version,
                    savedAt: entry.savedAt,
                    config: {
                        on: entry.config?.on,
                        from: entry.config?.from,
                        to: entry.config?.to,
                        service: entry.config?.service,
                        style: entry.config?.style,
                        display: entry.config?.display,
                        theme: entry.config?.theme,
                    },
                })) : [],
            };
        })`);
        const currentIndex = persistedHistory?.cursor;
        result.historyCases.storageEntries = persistedHistory?.entries || [];
        const restoreIndex = persistedHistory?.entries?.findIndex(entry => entry.config?.to === 'en') ?? -1;
        const restoreEntry = restoreIndex >= 0 ? persistedHistory.entries[restoreIndex] : null;
        if (!restoreEntry || typeof restoreEntry.version !== 'number' || !persistedHistory.entries.some(entry => entry.config?.to === 'ja')) {
            throw new Error(`Firefox 配置历史未记录本次用户配置快照: ${JSON.stringify({entries: persistedHistory?.entries || [], currentIndex})}`);
        }

        const historyClick = async (selector, label) => {
            const before = await selectedFrame(client);
            const clicked = await evaluateJson(client, before.frame, `(() => {
                const element = document.querySelector(${JSON.stringify(selector)});
                if (!(element instanceof HTMLElement) || (element instanceof HTMLButtonElement && element.disabled)) return false;
                element.click();
                return true;
            })()`);
            if (!clicked) throw new Error(`Firefox 配置历史按钮不可用: ${label}`);
            await sleep(450);
        };
        const currentVersion = result.historyCases.current;
        await historyClick(`[aria-label="恢复配置 v${restoreEntry.version}"]`, 'restore');
        const restoredVersion = await evaluateJson(client, (await selectedFrame(client)).frame, `document.querySelector('.config-history-entry.current .config-history-version b')?.textContent?.trim() || null`);
        const restoredStorage = await readConfigProjection(client, (await selectedFrame(client)).frame);
        if (!restoredVersion || restoredVersion === currentVersion) throw new Error('Firefox 配置历史恢复没有改变当前版本');
        if (JSON.stringify(restoredStorage) !== JSON.stringify(restoreEntry.config)) throw new Error(`Firefox 配置恢复未写入目标配置: ${JSON.stringify({expected: restoreEntry.config, actual: restoredStorage})}`);
        await historyClick('[aria-label="撤销配置恢复"]', 'undo');
        const undoneVersion = await evaluateJson(client, (await selectedFrame(client)).frame, `document.querySelector('.config-history-entry.current .config-history-version b')?.textContent?.trim() || null`);
        const undoneStorage = await readConfigProjection(client, (await selectedFrame(client)).frame);
        await historyClick('[aria-label="重做配置恢复"]', 'redo');
        const redoneVersion = await evaluateJson(client, (await selectedFrame(client)).frame, `document.querySelector('.config-history-entry.current .config-history-version b')?.textContent?.trim() || null`);
        const redoneStorage = await readConfigProjection(client, (await selectedFrame(client)).frame);
        result.historyCases.restore = {before: currentVersion, restored: restoredVersion, undone: undoneVersion, redone: redoneVersion};
        result.historyCases.storageAfterActions = {
            restoredTo: restoredStorage?.to || null,
            undoneTo: undoneStorage?.to || null,
            redoneTo: redoneStorage?.to || null,
        };
        const undoEntry = persistedHistory?.entries?.[restoreIndex - 1];
        if (redoneVersion !== restoredVersion || undoneVersion === restoredVersion || !undoEntry || JSON.stringify(undoneStorage) !== JSON.stringify(undoEntry.config) || JSON.stringify(redoneStorage) !== JSON.stringify(restoreEntry.config)) {
            throw new Error(`Firefox 配置历史撤销/重做结果异常: ${JSON.stringify(result.historyCases)}`);
        }
        result.evidence.push({step: 'config-history', url: (await selectedFrame(client)).frame.url, history: result.historyCases});

        console.error('[firefox-test] verify credential storage lifecycle');
        const credentialFrame = await selectedFrame(client);
        if (!credentialFrame.frame.url.startsWith(optionsUrl)) {
            throw new Error(`Firefox credential test must run in options extension origin: ${credentialFrame.frame.url}`);
        }
        await runCredentialLifecycle(client, result);
        result.evidence.push({
            step: 'credential-lifecycle',
            url: (await selectedFrame(client)).frame.url,
            credentials: result.credentialCases,
        });

        result.ok = true;
    } catch (error) {
        result.errors.push(String(error?.stack || error?.message || error));
        throw error;
    } finally {
        fs.writeFileSync(path.join(artifactsDir, 'firefox-config-persistence.json'), `${JSON.stringify(result, null, 2)}\n`);
        firefox.disconnect();
    }

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch(error => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
});
