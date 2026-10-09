#!/usr/bin/env node

// 在临时 Chromium/Edge profile 中验证 BabelBox 的网页隐私边界：
// 1. 内容脚本不修改宿主站点 localStorage；
// 2. 扩展 UI 保持 closed Shadow DOM，宿主页面不能访问扩展存储；
// 3. 设置页经后台消息保存的 API 凭据写入 local:config，并在设置页重载后保持不变。

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');

const HOST_SENTINEL_KEY = 'host-sentinel';
const HOST_SENTINEL_VALUE = 'keep-host-data';
const HOST_PREFERENCE_KEY = 'host-preference';
const HOST_PREFERENCE_VALUE = 'keep-preference';
const CREDENTIAL_SENTINEL_PREFIX = 'babelbox-api-key-lifecycle-sentinel-';
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

function parseArgs(argv) {
  const args = {
    background: true,
    timeout: 45_000,
    browserPath: null,
    focusSafeHelper: process.env.BABELBOX_FOCUS_SAFE_HELPER || '',
    artifactsDir: path.join(os.tmpdir(), 'babelbox-privacy-boundary-evidence'),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--background') continue;
    if (token === '--headed') {
      args.background = false;
      continue;
    }
    if (!token.startsWith('--')) throw new Error(`无法识别参数：${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数缺少值：${token}`);
    args[key] = value;
    index += 1;
  }

  if (!args.extensionDir) throw new Error('必须传入 --extension-dir');
  if (!args.playwrightRoot) throw new Error('必须传入 --playwright-root');
  args.timeout = Number(args.timeout);
  if (!Number.isFinite(args.timeout) || args.timeout <= 0) throw new Error('--timeout 必须为正数');
  return args;
}

function loadPlaywright(playwrightRoot) {
  try {
    return require('playwright');
  } catch (localError) {
    if (!playwrightRoot) throw localError;
    const root = path.resolve(playwrightRoot);
    const loader = createRequire(path.join(root, '__babelbox_privacy_boundary_loader__.cjs'));
    return loader('playwright');
  }
}

function loadFocusSafeBrowser(helperPath) {
  if (!helperPath) {
    throw new Error('后台浏览器测试必须传入 --focus-safe-helper 或设置 BABELBOX_FOCUS_SAFE_HELPER');
  }
  const resolved = path.resolve(helperPath);
  if (!fs.existsSync(resolved)) throw new Error(`focus-safe helper 不存在：${resolved}`);
  const helper = require(resolved);
  if (typeof helper.launchFocusSafePersistentContext !== 'function'
    || typeof helper.newPageWithoutForeground !== 'function'
    || typeof helper.activateExtensionTabWithoutForeground !== 'function') {
    throw new Error(`focus-safe helper 缺少必要导出：${resolved}`);
  }
  return helper;
}

function resolveBrowserExecutable(configuredPath) {
  if (configuredPath) {
    const resolved = path.resolve(configuredPath);
    if (!fs.existsSync(resolved)) throw new Error(`浏览器不存在：${resolved}`);
    return resolved;
  }

  const candidates = [
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/microsoft-edge',
    '/usr/bin/microsoft-edge-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
  ];
  const executable = candidates.find((candidate) => fs.existsSync(candidate));
  if (!executable) throw new Error('没有找到 Edge/Chrome/Chromium；请传入 --browser-path');
  return executable;
}

function assertDedicatedTemporaryProfile(profileDir) {
  const resolved = path.resolve(profileDir);
  const temporaryRoot = path.resolve(os.tmpdir());
  const relativeToTemp = path.relative(temporaryRoot, resolved);
  if (relativeToTemp.startsWith('..') || path.isAbsolute(relativeToTemp)) {
    throw new Error(`profile 不在系统临时目录：${resolved}`);
  }

  const home = os.homedir();
  const forbidden = [
    path.join(home, 'Library/Application Support/Google/Chrome'),
    path.join(home, 'Library/Application Support/Microsoft Edge'),
    path.join(home, '.config/google-chrome'),
    path.join(home, '.config/microsoft-edge'),
  ];
  if (forbidden.some((root) => {
    const relative = path.relative(root, resolved);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  })) {
    throw new Error(`拒绝使用日常浏览器 profile：${resolved}`);
  }
}

function readManifest(extensionDir) {
  const manifestPath = path.join(extensionDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`插件 manifest.json 不存在：${manifestPath}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  return {
    manifestPath,
    manifestVersion: manifest.manifest_version,
    optionsPage: manifest.options_ui?.page || manifest.options_page || 'options.html',
  };
}

function fixtureHtml() {
  const initialStorage = {
    [HOST_SENTINEL_KEY]: HOST_SENTINEL_VALUE,
    [HOST_PREFERENCE_KEY]: HOST_PREFERENCE_VALUE,
  };
  const imageSvg = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="100%" height="100%" fill="#dbeafe"/><text x="20" y="68" font-size="24" fill="#1e3a8a">Privacy fixture</text></svg>');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>BabelBox Privacy Boundary Fixture</title>
  <script>
    (() => {
      const entries = ${JSON.stringify(initialStorage)};
      for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
      window.__privacyBoundaryInitialStorage = Object.fromEntries(
        Array.from({length: localStorage.length}, (_, index) => localStorage.key(index))
          .filter(Boolean)
          .map((key) => [key, localStorage.getItem(key)]),
      );
    })();
  </script>
  <style>
    body { max-width: 820px; margin: 40px auto; padding: 0 24px; color: #172033; font: 18px/1.6 system-ui, sans-serif; }
    main { padding: 28px; border: 1px solid #dbe3ef; border-radius: 18px; background: #fff; box-shadow: 0 18px 50px rgba(15,23,42,.08); }
    img { display: block; width: 240px; height: 120px; margin-top: 24px; border-radius: 12px; }
  </style>
</head>
<body>
  <main>
    <h1>Host privacy sentinel</h1>
    <p id="privacy-target">This paragraph must remain untranslated after untrusted page events.</p>
    <img id="privacy-image" alt="Privacy fixture" src="data:image/svg+xml,${imageSvg}">
  </main>
</body>
</html>`;
}

async function startFixtureServer() {
  const html = fixtureHtml();
  const server = http.createServer((request, response) => {
    if (request.url === '/favicon.ico') {
      response.writeHead(204, { 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    if (request.url === '/' || request.url?.startsWith('/privacy-boundary')) {
      response.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      response.end(html);
      return;
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('not found');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('无法确定本地 fixture 端口');
  return {
    server,
    url: `http://127.0.0.1:${address.port}/privacy-boundary.html`,
  };
}

function closeServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve) => server.close(() => resolve()));
}

function storageObjectFromPage() {
  return Object.fromEntries(
    Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
      .filter((key) => typeof key === 'string')
      .map((key) => [key, localStorage.getItem(key)]),
  );
}

function containsMarker(value, marker) {
  try {
    return JSON.stringify(value).includes(marker);
  } catch {
    return false;
  }
}

function hasCredentialFields(value) {
  return Boolean(value && typeof value === 'object' && CREDENTIAL_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(value, field)));
}

async function extensionStorageEvidence(extensionContext, credentialMarker = null) {
  const local = await extensionContext.evaluate(() => chrome.storage.local.get(null));
  const rawConfig = local.config ?? local['local:config'];
  const rawHistory = local.configHistory ?? local['local:configHistory'];
  const config = typeof rawConfig === 'string' ? JSON.parse(rawConfig) : rawConfig;
  const history = typeof rawHistory === 'string' ? JSON.parse(rawHistory) : rawHistory;
  const historyEntries = Array.isArray(history?.entries) ? history.entries : [];
  return {
    localKeys: Object.keys(local).sort(),
    configContainsCredentialFields: hasCredentialFields(config),
    historyContainsCredentialFields: historyEntries.some((entry) => hasCredentialFields(entry?.config)),
    credentialLifecycle: credentialMarker ? {
      configContainsSentinel: containsMarker(config?.serviceCredentials, credentialMarker),
      historyContainsSentinel: containsMarker(history, credentialMarker),
    } : null,
  };
}

async function waitForStoredCredential(extensionContext, marker, timeout) {
  const deadline = Date.now() + timeout;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await extensionStorageEvidence(extensionContext, marker);
    if (latest.credentialLifecycle.configContainsSentinel) return latest;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`API 凭据没有写入 local:config：${JSON.stringify(latest?.credentialLifecycle)}`);
}

async function configurePrivacySurfaces(worker) {
  return worker.evaluate(async () => {
    const parseConfig = (value) => {
      if (typeof value !== 'string') return value && typeof value === 'object' ? value : {};
      try {
        return JSON.parse(value);
      } catch {
        return {};
      }
    };
    const stored = await chrome.storage.local.get('config');
    // 新安装时尚未写入配置；补齐存储层识别配置所需的最小字段。
    const current = {service: 'microsoft', from: 'auto', to: 'zh-Hans', ...parseConfig(stored.config)};
    const next = {
      ...current,
      autoTranslate: false,
      floatingBallHotkey: 'Alt+T',
      disableFloatingBall: false,
      selectionTranslatorMode: 'bilingual',
      disableSelectionTranslator: false,
      selectionAreaEnabled: true,
      disableImageTranslator: false,
    };
    await chrome.storage.local.set({ config: next });
    const matchesExpectedSurfaces = (value) => value.disableFloatingBall === false
      && value.disableSelectionTranslator === false
      && value.selectionAreaEnabled === true
      && value.disableImageTranslator === false;
    const writeDeadline = Date.now() + 10_000;
    let verified = {};
    while (Date.now() < writeDeadline) {
      const stored = await chrome.storage.local.get('config');
      verified = parseConfig(stored.config);
      if (matchesExpectedSurfaces(verified)) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!matchesExpectedSurfaces(verified)) {
      throw new Error('privacy surface config was not durably written');
    }
    return {
      autoTranslate: verified.autoTranslate,
      disableFloatingBall: verified.disableFloatingBall,
      selectionTranslatorMode: verified.selectionTranslatorMode,
      disableSelectionTranslator: verified.disableSelectionTranslator,
      selectionAreaEnabled: verified.selectionAreaEnabled,
      disableImageTranslator: verified.disableImageTranslator,
    };
  });
}

async function waitForExtensionWorker(context, timeout) {
  const existing = context.serviceWorkers().find((worker) => worker.url().startsWith('chrome-extension://'));
  if (existing) return existing;
  return context.waitForEvent('serviceworker', {
    timeout: Math.min(timeout, 30_000),
    predicate: (worker) => worker.url().startsWith('chrome-extension://'),
  });
}

async function waitForOptionsUi(page, timeout) {
  await page.waitForSelector('#settings-data', { state: 'visible', timeout });
}

async function openOptionsPage(createPage, activatePage, extensionId, optionsPath, timeout) {
  const optionsUrl = new URL(optionsPath, `chrome-extension://${extensionId}/`);
  optionsUrl.hash = 'settings-data';
  const optionsPage = await createPage();
  await optionsPage.goto(optionsUrl.href, { waitUntil: 'domcontentloaded', timeout });
  await activatePage(optionsPage);
  await waitForOptionsUi(optionsPage, timeout);
  return optionsPage;
}

async function persistCredentialViaExtensionMessage(optionsPage, marker) {
  const response = await optionsPage.evaluate((credentialMarker) => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({
      type: 'persistConfig',
      patch: {
        serviceCredentials: {
          microsoft: { apiKey: credentialMarker, appKey: '', appSecret: '', secretId: '', secretKey: '' },
        },
      },
    }, (reply) => {
      const lastError = chrome.runtime.lastError;
      if (lastError) reject(new Error(lastError.message || 'runtime message failed'));
      else resolve(reply);
    });
  }), marker);
  if (response?.success !== true) throw new Error('后台未确认设置页发出的凭据保存消息');
  return { acknowledged: true };
}

async function pageBoundaryState(page) {
  return page.evaluate(() => {
    const storage = Object.fromEntries(
      Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
        .filter((key) => typeof key === 'string')
        .map((key) => [key, localStorage.getItem(key)]),
    );
    const extensionHosts = Array.from(document.querySelectorAll('[data-babelbox-ui], [id^="babelbox-"]'));
    return {
      storage,
      pageCanAccessChromeStorage: Boolean(globalThis.chrome?.storage),
      pageCanAccessBrowserStorage: Boolean(globalThis.browser?.storage),
      extensionHosts: extensionHosts.map((host) => ({
        id: host.id,
        ui: host.getAttribute('data-babelbox-ui'),
        hasOpenShadowRoot: Boolean(host.shadowRoot),
      })),
      areaBoundary: (() => {
        const host = document.querySelector('#babelbox-area-translator-container');
        return { present: Boolean(host), pageVisibleShadowRoot: Boolean(host?.shadowRoot) };
      })(),
      floatingBoundary: (() => {
        const host = document.querySelector('#babelbox-floating-ball-container');
        return { present: Boolean(host), pageVisibleShadowRoot: Boolean(host?.shadowRoot) };
      })(),
      selectionBoundary: (() => {
        const host = document.querySelector('#babelbox-selection-translator-container');
        return { present: Boolean(host), pageVisibleShadowRoot: Boolean(host?.shadowRoot) };
      })(),
      imageBoundary: (() => {
        const host = document.querySelector('#babelbox-image-translation-root');
        return { present: Boolean(host), pageVisibleShadowRoot: Boolean(host?.shadowRoot) };
      })(),
    };
  });
}

function assertHostStorageBoundary(initialStorage, currentStorage) {
  if (initialStorage[HOST_SENTINEL_KEY] !== HOST_SENTINEL_VALUE) throw new Error('fixture 未正确预置 host sentinel');
  if (currentStorage[HOST_SENTINEL_KEY] !== HOST_SENTINEL_VALUE || currentStorage[HOST_PREFERENCE_KEY] !== HOST_PREFERENCE_VALUE) {
    throw new Error(`内容脚本修改了宿主 localStorage：${JSON.stringify(currentStorage)}`);
  }
  const remainingKeys = Object.keys(currentStorage).sort();
  const expectedKeys = [HOST_PREFERENCE_KEY, HOST_SENTINEL_KEY].sort();
  if (JSON.stringify(remainingKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`页面 localStorage 出现非宿主键：${JSON.stringify(remainingKeys)}`);
  }
}

function assertPageBoundary(state, storageEvidence) {
  if (storageEvidence.configContainsCredentialFields || storageEvidence.historyContainsCredentialFields) {
    throw new Error('公开 local config/configHistory 仍包含凭据字段');
  }
  if (state.pageCanAccessChromeStorage || state.pageCanAccessBrowserStorage) {
    throw new Error(`宿主页面能够访问扩展存储：${JSON.stringify(state)}`);
  }
  if (!state.areaBoundary.present || state.areaBoundary.pageVisibleShadowRoot) {
    throw new Error(`圈选翻译没有保持 closed Shadow DOM：${JSON.stringify(state.areaBoundary)}`);
  }
  if (!state.floatingBoundary.present || state.floatingBoundary.pageVisibleShadowRoot) {
    throw new Error(`悬浮球没有保持 closed Shadow DOM：${JSON.stringify(state.floatingBoundary)}`);
  }
  if (!state.selectionBoundary.present || state.selectionBoundary.pageVisibleShadowRoot) {
    throw new Error(`划词翻译没有保持 closed Shadow DOM：${JSON.stringify(state.selectionBoundary)}`);
  }
  if (!state.imageBoundary.present || state.imageBoundary.pageVisibleShadowRoot) {
    throw new Error(`图片翻译没有保持 closed Shadow DOM：${JSON.stringify(state.imageBoundary)}`);
  }
}

async function writeEvidence(artifactsDir, evidence) {
  fs.mkdirSync(artifactsDir, { recursive: true });
  const evidencePath = path.join(artifactsDir, 'privacy-boundary-evidence.json');
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return evidencePath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const extensionDir = path.resolve(args.extensionDir);
  const playwrightRoot = path.resolve(args.playwrightRoot);
  const artifactsDir = path.resolve(args.artifactsDir);
  const browserPath = resolveBrowserExecutable(args.browserPath);
  const manifestEvidence = readManifest(extensionDir);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'babelbox-privacy-boundary-'));
  const credentialSentinel = `${CREDENTIAL_SENTINEL_PREFIX}${randomUUID()}`;
  const credentialSentinelSha256 = createHash('sha256').update(credentialSentinel).digest('hex');
  assertDedicatedTemporaryProfile(profileDir);
  fs.mkdirSync(artifactsDir, { recursive: true });

  const { chromium } = loadPlaywright(playwrightRoot);
  const fixture = await startFixtureServer();
  const browserArgs = [
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];
  let browserSession;
  let context;
  let createPage;
  let activatePage;
  let page;
  let optionsPage;
  let evidence = {
    ok: false,
    extensionDir,
    browserPath,
    fixtureUrl: fixture.url,
    windowMode: args.background ? 'background-screen-off' : 'headed-isolated',
    launchMode: null,
    focusPolicy: null,
    windowPlacement: null,
    isolation: { temporaryProfile: true, profileDir, reusedUserProfile: false },
    manifest: manifestEvidence,
    credentialSentinelSha256,
    screenshots: [],
  };

  const consoleErrors = [];
  const redactEvidenceText = (value) => String(value)
    .replaceAll(credentialSentinel, '[redacted-credential-sentinel]');

  try {
    if (args.background) {
      const {
        activateExtensionTabWithoutForeground,
        launchFocusSafePersistentContext,
        newPageWithoutForeground,
      } = loadFocusSafeBrowser(args.focusSafeHelper);
      browserSession = await launchFocusSafePersistentContext({
        chromium,
        profileDir,
        browserPath,
        headless: false,
        background: true,
        browserArgs,
        viewport: { width: 1280, height: 900 },
        timeout: args.timeout,
      });
      context = browserSession.context;
      createPage = () => newPageWithoutForeground(context, args.timeout);
      activatePage = (targetPage) => activateExtensionTabWithoutForeground(context, targetPage, args.timeout);
      evidence = {
        ...evidence,
        launchMode: browserSession.launchMode,
        focusPolicy: browserSession.focusPolicy,
        windowPlacement: browserSession.windowPlacement,
      };
    } else {
      context = await chromium.launchPersistentContext(profileDir, {
        executablePath: browserPath,
        headless: false,
        viewport: { width: 1280, height: 900 },
        args: browserArgs,
      });
      createPage = () => context.newPage();
      activatePage = async () => undefined;
      evidence = {
        ...evidence,
        launchMode: 'playwright-headed',
        focusPolicy: 'foreground-authorized',
        windowPlacement: { state: 'normal', width: 1280, height: 900 },
      };
    }
    const worker = await waitForExtensionWorker(context, args.timeout);
    const extensionId = new URL(worker.url()).hostname;
    page = await createPage();
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(redactEvidenceText(message.text()).slice(0, 500));
      }
    });

    await page.goto(fixture.url, { waitUntil: 'domcontentloaded', timeout: args.timeout });
    await activatePage(page);
    await page.waitForSelector('#babelbox-page-styles', { state: 'attached', timeout: args.timeout });
    const initialStorage = await page.evaluate(() => window.__privacyBoundaryInitialStorage);
    assertHostStorageBoundary(initialStorage, await page.evaluate(storageObjectFromPage));

    const configuredSurfaces = await configurePrivacySurfaces(worker);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: args.timeout });
    await page.waitForSelector('#babelbox-page-styles', { state: 'attached', timeout: args.timeout });
    await page.waitForSelector('#babelbox-floating-ball-container', { state: 'attached', timeout: args.timeout });
    await page.waitForSelector('#babelbox-selection-translator-container', { state: 'attached', timeout: args.timeout });
    await page.waitForSelector('#babelbox-area-translator-container', { state: 'attached', timeout: args.timeout });
    await page.hover('#privacy-image');
    await page.waitForSelector('#babelbox-image-translation-root', { state: 'attached', timeout: args.timeout });
    await page.screenshot({ path: path.join(artifactsDir, 'privacy-boundary-before-events.png'), fullPage: true });
    evidence.screenshots.push(path.join(artifactsDir, 'privacy-boundary-before-events.png'));

    const storageEvidence = await extensionStorageEvidence(worker);
    const finalState = await pageBoundaryState(page);
    assertHostStorageBoundary(initialStorage, finalState.storage);
    assertPageBoundary(finalState, storageEvidence);

    const finalScreenshot = path.join(artifactsDir, 'privacy-boundary-final.png');
    await page.screenshot({ path: finalScreenshot, fullPage: true });
    evidence.screenshots.push(finalScreenshot);

    optionsPage = await openOptionsPage(
      createPage,
      activatePage,
      extensionId,
      manifestEvidence.optionsPage,
      args.timeout,
    );
    optionsPage.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(redactEvidenceText(message.text()).slice(0, 500));
      }
    });

    const credentialMessage = await persistCredentialViaExtensionMessage(optionsPage, credentialSentinel);
    const afterSave = await waitForStoredCredential(optionsPage, credentialSentinel, args.timeout);

    // 打开设置页只读取配置；重载后凭据必须仍在 local:config 中。
    await optionsPage.reload({ waitUntil: 'domcontentloaded', timeout: args.timeout });
    await waitForOptionsUi(optionsPage, args.timeout);
    await optionsPage.waitForTimeout(600);
    const afterReload = await waitForStoredCredential(optionsPage, credentialSentinel, args.timeout);
    if (afterReload.credentialLifecycle.historyContainsSentinel) {
      throw new Error('配置历史不应包含 API 凭据');
    }
    const credentialScreenshot = path.join(artifactsDir, 'credentials-after-reload.png');
    await optionsPage.screenshot({ path: credentialScreenshot, fullPage: true });
    evidence.screenshots.push(credentialScreenshot);
    if (consoleErrors.length > 0) {
      throw new Error(`隔离隐私回归出现控制台错误：${JSON.stringify(consoleErrors)}`);
    }

    evidence = {
      ...evidence,
      ok: true,
      extensionId,
      configuredSurfaces,
      hostStorage: {
        initialKeys: Object.keys(initialStorage).sort(),
        finalKeys: Object.keys(finalState.storage).sort(),
        hostSentinelPreserved: finalState.storage[HOST_SENTINEL_KEY] === HOST_SENTINEL_VALUE,
      },
      storageEvidence,
      hostBoundary: {
        pageCanAccessChromeStorage: finalState.pageCanAccessChromeStorage,
        pageCanAccessBrowserStorage: finalState.pageCanAccessBrowserStorage,
      },
      shadowBoundary: {
        area: finalState.areaBoundary,
        floating: finalState.floatingBoundary,
        selection: finalState.selectionBoundary,
        image: finalState.imageBoundary,
        extensionHosts: finalState.extensionHosts,
      },
      credentialLifecycle: {
        saveTransport: 'chrome.runtime.sendMessage patch from options extension origin',
        saveAcknowledged: credentialMessage.acknowledged,
        afterSave,
        afterOptionsReload: afterReload,
      },
      consoleErrors,
    };
  } catch (error) {
    evidence = {
      ...evidence,
      error: redactEvidenceText(error instanceof Error ? error.message : String(error)),
      consoleErrors,
    };
    if (optionsPage && !optionsPage.isClosed()) {
      const credentialFailureScreenshot = path.join(artifactsDir, 'credentials-lifecycle-failure.png');
      await optionsPage.screenshot({ path: credentialFailureScreenshot, fullPage: true }).then(() => {
        evidence.screenshots.push(credentialFailureScreenshot);
      }).catch(() => {});
    }
    if (page && !page.isClosed()) {
      const failureScreenshot = path.join(artifactsDir, 'privacy-boundary-failure.png');
      await page.screenshot({ path: failureScreenshot, fullPage: true }).then(() => {
        evidence.screenshots.push(failureScreenshot);
      }).catch(() => {});
    }
  } finally {
    if (browserSession) await browserSession.close().catch(() => {});
    else if (context) await context.close().catch(() => {});
    await closeServer(fixture.server).catch(() => {});
    fs.rmSync(profileDir, { recursive: true, force: true });
    evidence.isolation.temporaryProfileRemoved = !fs.existsSync(profileDir);
  }

  const evidencePath = await writeEvidence(artifactsDir, evidence);
  const output = { ...evidence, evidencePath };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (!evidence.ok) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
