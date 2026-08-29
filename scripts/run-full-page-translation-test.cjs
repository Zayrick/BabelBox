#!/usr/bin/env node

// 这个脚本只使用临时 Edge profile 和真实 Alt+T 键盘手势，回归全文翻译的
// 识别、按钮特殊处理、富文本结构、动态节点、Shadow DOM 以及恢复流程。
// 它不会连接用户正在使用的浏览器 profile，也不会通过 JS 合成键盘事件。

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

function parseArgs(argv) {
  const args = {
    url: null,
    browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    background: true,
    timeout: 120000,
    // 当前 main 的默认服务是“免费翻译服务”，内部按微软、DeepLX、谷歌顺序回退；
    // --service 只用于断言已预置的隔离 profile 配置，不会偷偷修改服务选择。
    service: 'freeTranslation',
    // 仅在本次临时 profile 中写入服务，便于把“回退服务慢”和“全文机制问题”分开。
    // 不传此参数时，脚本不会修改任何配置。
    configureService: null,
    focusSafeHelper: null,
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
  args.timeout = Number(args.timeout);
  if (!Number.isFinite(args.timeout) || args.timeout <= 0) throw new Error('--timeout 必须为正数');
  if (!args.extensionDir) throw new Error('必须传入 --extension-dir');
  if (!args.playwrightRoot) throw new Error('必须传入 --playwright-root');
  if (args.service !== 'freeTranslation' || (args.configureService && args.configureService !== 'freeTranslation')) {
    throw new Error('全文本地 fixture 只允许 freeTranslation；真实 provider 必须使用显式 network matrix');
  }
  if (args.url) {
    const url = new URL(args.url);
    if (!['127.0.0.1', 'localhost', '::1'].includes(url.hostname)) {
      throw new Error('全文本地 fixture 只允许 loopback URL；真实站点必须使用显式 network matrix');
    }
  }
  if (args.background && !args.focusSafeHelper) {
    throw new Error('后台模式必须传入 --focus-safe-helper，确保真实浏览器不抢占前台焦点');
  }
  if (args.focusSafeHelper) args.focusSafeHelper = path.resolve(args.focusSafeHelper);
  return args;
}

function createFixtureRequestHandler(html) {
  return (request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    if (pathname !== '/unified-translation-fixture.html') {
      response.writeHead(404, {'content-type': 'text/plain; charset=utf-8'});
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(html);
  };
}

function buildFixtureMicrosoftResponseBody(payload) {
  const texts = Array.isArray(payload) ? payload.map((value) => String(value)) : [];
  return JSON.stringify(texts.map((text) => ({
    translations: [{text: `测试译文：${text}`}],
  })));
}

function assertNoRuntimeErrors(runtimeErrors) {
  if (runtimeErrors.length > 0) {
    throw new Error(`全文翻译浏览器回归出现运行时错误：${JSON.stringify(runtimeErrors)}`);
  }
}

function assertDeterministicFixtureTraffic(fixtureTranslationRequestCount, unexpectedNetworkRequests) {
  if (fixtureTranslationRequestCount <= 0) {
    throw new Error('全文本地 fixture 未命中确定性微软翻译路由');
  }
  if (unexpectedNetworkRequests.length > 0) {
    throw new Error(`全文本地 fixture 尝试访问未授权网络：${JSON.stringify(unexpectedNetworkRequests)}`);
  }
}

async function startFixtureServer() {
  const fixturePath = path.resolve(__dirname, '../tests/fixtures/unified-translation-fixture.html');
  const html = fs.readFileSync(fixturePath);
  const server = http.createServer(createFixtureRequestHandler(html));
  await new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once('error', onError);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise((resolve) => server.close(resolve));
    throw new Error('无法取得全文翻译 fixture server 地址');
  }
  return {
    url: `http://127.0.0.1:${address.port}/unified-translation-fixture.html`,
    isListening: () => server.listening,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function loadPlaywright(root) {
  try {
    return require('playwright');
  } catch {
    const resolvedRoot = path.resolve(root);
    const loader = createRequire(path.join(resolvedRoot, '__babelbox_full_page_loader__.cjs'));
    return loader('playwright');
  }
}

function loadFocusSafeBrowser(helperPath) {
  if (!helperPath) throw new Error('必须传入 --focus-safe-helper，确保真实浏览器在后台隔离运行');
  if (!fs.existsSync(helperPath)) throw new Error(`找不到后台浏览器辅助脚本：${helperPath}`);
  const helper = require(helperPath);
  for (const name of ['launchFocusSafePersistentContext', 'newPageWithoutForeground', 'activateExtensionTabWithoutForeground']) {
    if (typeof helper[name] !== 'function') throw new Error(`后台浏览器辅助脚本缺少接口：${name}`);
  }
  return helper;
}

function assertDedicatedProfile(profileDir) {
  const resolved = path.resolve(profileDir);
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

async function waitFor(page, predicate, timeout, description) {
  await page.waitForFunction(predicate, undefined, { timeout });
  if (description) return description;
}

async function readConfig(context, timeout, updates = null, createPage = () => context.newPage()) {
  const workers = context.serviceWorkers();
  const worker = workers[0] || await context.waitForEvent('serviceworker', { timeout: Math.min(timeout, 30000) });
  const match = worker.url().match(/^chrome-extension:\/\/([^/]+)/);
  if (!match) throw new Error('没有找到扩展 service worker');
  const popup = await createPage();
  try {
    await popup.goto(`chrome-extension://${match[1]}/popup.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const stored = await popup.evaluate(() => chrome.storage.local.get('config'));
    let config = typeof stored.config === 'string' ? JSON.parse(stored.config) : stored.config;
    if (updates && Object.keys(updates).length > 0) {
      config = { ...(config || {}), ...updates };
      // 只写入当前脚本创建的临时 profile；不会触碰用户正在使用的配置。
      await popup.evaluate((nextConfig) => new Promise((resolve, reject) => {
        chrome.storage.local.set({ config: JSON.stringify(nextConfig) }, () => {
          const error = chrome.runtime.lastError;
          if (error) reject(new Error(error.message));
          else resolve();
        });
      }), config);
    }
    return { extensionId: match[1], config };
  } finally {
    await popup.close();
  }
}

async function toggleFullPage(page, activatePage) {
  await activatePage(page);
  // 使用 Playwright 的真实 Alt/T 键序列，对应插件默认全文快捷键 Alt+T。
  await page.keyboard.down('Alt');
  await page.keyboard.press('t');
  await page.keyboard.up('Alt');
}

async function installShortcutDiagnostics(page) {
  await page.evaluate(() => {
    window.__babelboxFullPageDebug = { keydowns: [], toggleEvents: 0 };
    document.addEventListener('keydown', (event) => {
      window.__babelboxFullPageDebug.keydowns.push({
        key: event.key,
        code: event.code,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        defaultPrevented: event.defaultPrevented,
      });
    });
    document.addEventListener('babelbox-toggle-translation', () => {
      window.__babelboxFullPageDebug.toggleEvents += 1;
    });
  });
}

async function readShortcutDiagnostics(page) {
  return page.evaluate(() => ({
    debug: window.__babelboxFullPageDebug || null,
    bilingualCount: document.querySelectorAll('.babelbox-bilingual-content').length,
    loadingCount: document.querySelectorAll('.babelbox-loading').length,
    retryCount: document.querySelectorAll('.babelbox-retry-wrapper').length,
    buttonTexts: {
      save: document.querySelector('#save-button')?.textContent?.trim() || '',
      cancel: document.querySelector('#cancel-button')?.textContent?.trim() || '',
    },
    targetStates: ['#paragraph-one', '#paragraph-two', '#model-description', '#save-button', '#cancel-button']
      .map((selector) => ({
        selector,
        bilingual: document.querySelector(selector)?.querySelectorAll('.babelbox-bilingual-content').length || 0,
        loading: document.querySelector(selector)?.querySelectorAll('.babelbox-loading').length || 0,
      })),
    shadowState: (() => {
      const shadow = document.querySelector('#shadow-host')?.shadowRoot?.querySelector('#shadow-paragraph');
      return { bilingual: shadow?.querySelectorAll('.babelbox-bilingual-content').length || 0, loading: shadow?.querySelectorAll('.babelbox-loading').length || 0 };
    })(),
  }));
}

async function pageState(page) {
  return page.evaluate(() => {
    const get = (selector) => document.querySelector(selector);
    const count = (selector) => get(selector)?.querySelectorAll('.babelbox-bilingual-content').length || 0;
    const clampState = (clampSelector, targetSelector) => {
      const clamp = get(clampSelector);
      const target = get(targetSelector);
      const wrapper = target?.querySelector('.babelbox-bilingual-content');
      if (!clamp || !target) return null;
      const clampRect = clamp.getBoundingClientRect();
      const wrapperRect = wrapper?.getBoundingClientRect();
      return {
        bilingual: target.querySelectorAll('.babelbox-bilingual-content').length,
        lineClamp: getComputedStyle(clamp).webkitLineClamp,
        inlineStyle: clamp.getAttribute('style'),
        clientHeight: clamp.clientHeight,
        scrollHeight: clamp.scrollHeight,
        wrapperVisible: Boolean(wrapperRect && wrapperRect.width > 0 && wrapperRect.height > 0 &&
          wrapperRect.top >= clampRect.top - 1 && wrapperRect.bottom <= clampRect.bottom + 1),
        translationText: wrapper?.textContent?.trim() || '',
      };
    };
    const shadowParagraph = get('#shadow-host')?.shadowRoot?.querySelector('#shadow-paragraph');
    const button = get('#save-button');
    const cancelButton = get('#cancel-button');
    return {
      paragraphOne: count('#paragraph-one'),
      paragraphTwo: count('#paragraph-two'),
      paragraphTwoText: get('#paragraph-two')?.textContent?.trim() || '',
      heading: count('h1'),
      dynamic: count('#dynamic-paragraph'),
      staticClamp: clampState('#model-description-clamp', '#model-description'),
      dynamicClamp: clampState('#dynamic-model-description-clamp', '#dynamic-paragraph'),
      shadow: shadowParagraph?.querySelectorAll('.babelbox-bilingual-content').length || 0,
      header: count('header'),
      nav: count('nav'),
      footer: count('footer'),
      buttonBilingualCount: button?.querySelectorAll('.babelbox-bilingual-content').length || 0,
      buttonText: button?.textContent?.trim() || '',
      cancelButtonText: cancelButton?.textContent?.trim() || '',
      cancelButtonBilingualCount: cancelButton?.querySelectorAll('.babelbox-bilingual-content').length || 0,
      buttonIconPresent: Boolean(button?.querySelector('[aria-hidden="true"]')),
      codePreserved: Boolean(get('#paragraph-one .babelbox-bilingual-content code')?.textContent.includes('const value = 42')),
      linkPreserved: get('#paragraph-one .babelbox-bilingual-content a')?.getAttribute('href') || null,
    };
  });
}

function assertTranslated(state, label) {
  if (state.paragraphOne !== 1 || state.paragraphTwo !== 1 || state.heading !== 1 || state.dynamic !== 1 || state.shadow !== 1) {
    throw new Error(`${label} 内容块翻译数量不正确：${JSON.stringify(state)}`);
  }
  if (!state.paragraphTwoText.includes('changed after full-page translation')) {
    throw new Error(`${label} 没有响应宿主页面的动态文本更新：${JSON.stringify(state)}`);
  }
  for (const [name, clamp] of [['static', state.staticClamp], ['dynamic', state.dynamicClamp]]) {
    if (!clamp || clamp.bilingual !== 1 || !clamp.wrapperVisible ||
        !/[\u3400-\u9fff]/u.test(clamp.translationText) ||
        !['none', 'unset'].includes(clamp.lineClamp)) {
      throw new Error(`${label} ${name} line-clamp 译文仍被裁剪：${JSON.stringify(clamp)}`);
    }
  }
  if (state.header !== 0 || state.nav !== 0 || state.footer !== 0) throw new Error(`${label} 导航/页脚被误翻译`);
  if (state.buttonBilingualCount !== 0 || state.cancelButtonBilingualCount !== 0 ||
      !/[\u3400-\u9fff]/u.test(state.buttonText) || !/[\u3400-\u9fff]/u.test(state.cancelButtonText) ||
      !state.buttonIconPresent) {
    throw new Error(`${label} 按钮没有按控件规则保留结构并替换文字：${JSON.stringify(state)}`);
  }
  if (!state.codePreserved || !['https://example.com', 'https://example.com/'].includes(state.linkPreserved)) {
    throw new Error(`${label} 富文本结构没有保留：${JSON.stringify(state)}`);
  }
}

function assertRestored(state) {
  if (state.paragraphOne || state.paragraphTwo || state.heading || state.dynamic || state.shadow) {
    throw new Error(`全文恢复后仍残留译文：${JSON.stringify(state)}`);
  }
  if (!state.paragraphTwoText.includes('changed after full-page translation')) {
    throw new Error(`全文恢复覆盖了宿主页面更新：${JSON.stringify(state)}`);
  }
  for (const [name, clamp] of [['static', state.staticClamp], ['dynamic', state.dynamicClamp]]) {
    if (!clamp || clamp.bilingual !== 0 || clamp.lineClamp !== '2' || clamp.inlineStyle !== null) {
      throw new Error(`全文恢复后 ${name} line-clamp 样式没有精确还原：${JSON.stringify(clamp)}`);
    }
  }
  if (state.buttonText !== '★Save changes' || state.cancelButtonText !== 'Cancel' ||
      !state.buttonIconPresent || state.buttonBilingualCount !== 0 || state.cancelButtonBilingualCount !== 0) {
    throw new Error(`按钮恢复不完整：${JSON.stringify(state)}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const extensionDir = path.resolve(args.extensionDir);
  if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) throw new Error('插件 manifest.json 不存在');
  if (!fs.existsSync(args.browserPath)) throw new Error(`浏览器不存在：${args.browserPath}`);

  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'babelbox-full-page-'));
  assertDedicatedProfile(profileDir);
  const artifactsDir = args.artifactsDir ? path.resolve(args.artifactsDir) : null;
  if (artifactsDir) fs.mkdirSync(artifactsDir, { recursive: true });
  const { chromium } = loadPlaywright(args.playwrightRoot);
  const focusSafe = args.background ? loadFocusSafeBrowser(args.focusSafeHelper) : null;
  let context;
  let closeBrowser = async () => { if (context) await context.close().catch(() => {}); };
  let createIsolatedPage = () => context.newPage();
  let activateTestPage = async () => undefined;
  let launchMode = args.background ? null : 'playwright-headed';
  let focusPolicy = args.background ? null : 'foreground-authorized';
  let windowPlacement = args.background
    ? null
    : { mode: 'headed-explicit-foreground', windowState: 'normal', viewport: { width: 1280, height: 900 } };
  let fixtureServer = null;
  let fixtureTranslationRequestCount = 0;
  const unexpectedNetworkRequests = [];
  try {
    // 默认回归必须自包含；只有显式 --url 才使用调用方提供的页面。
    if (!args.url) {
      fixtureServer = await startFixtureServer();
      args.url = fixtureServer.url;
    }
    const browserArgs = [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      '--no-first-run',
      '--no-default-browser-check',
    ];
    if (args.background) {
      const browserSession = await focusSafe.launchFocusSafePersistentContext({
        chromium,
        profileDir,
        browserPath: args.browserPath,
        headless: false,
        background: true,
        browserArgs,
        viewport: { width: 1280, height: 900 },
        timeout: args.timeout,
      });
      context = browserSession.context;
      closeBrowser = browserSession.close;
      createIsolatedPage = () => focusSafe.newPageWithoutForeground(context, args.timeout);
      activateTestPage = page => focusSafe.activateExtensionTabWithoutForeground(context, page, args.timeout);
      launchMode = browserSession.launchMode;
      focusPolicy = browserSession.focusPolicy;
      windowPlacement = browserSession.windowPlacement;
    } else {
      context = await chromium.launchPersistentContext(profileDir, {
        executablePath: args.browserPath,
        headless: false,
        viewport: { width: 1280, height: 900 },
        args: browserArgs,
      });
    }
    // 本地 fixture 对所有非 loopback 网络 fail-closed；唯一例外是被本地确定性响应
    // 完整替代的 Microsoft 请求。真实站点/真实 provider 只属于显式 network matrix。
    await context.route('**/*', async (route) => {
      const request = route.request();
      const requestUrl = new URL(request.url());
      const isDeterministicMicrosoftRoute = requestUrl.hostname === 'edge.microsoft.com'
        && requestUrl.pathname === '/translate/translatetext';
      if (isDeterministicMicrosoftRoute) {
        let payload = [];
        try {
          payload = request.postDataJSON();
        } catch {
          payload = [];
        }
        fixtureTranslationRequestCount += Array.isArray(payload) ? payload.length : 0;
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: buildFixtureMicrosoftResponseBody(payload),
        });
        return;
      }
      const isNetworkRequest = requestUrl.protocol === 'http:' || requestUrl.protocol === 'https:';
      const isLoopbackRequest = ['127.0.0.1', 'localhost', '::1'].includes(requestUrl.hostname);
      if (isNetworkRequest && !isLoopbackRequest) {
        unexpectedNetworkRequests.push(request.url());
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    });
    if (args.configureService) {
      await readConfig(context, args.timeout, { service: args.configureService }, createIsolatedPage);
    }
    const page = await createIsolatedPage();
    const networkEvents = [];
    const runtimeErrors = [];
    let omittedNetworkEvents = 0;
    const recordNetworkEvent = (event) => {
      if (networkEvents.length < 20) networkEvents.push(event);
      else omittedNetworkEvents += 1;
    };
    const recordFailedRequest = (request) => {
      if (/translate|translatetext|deeplx|google/i.test(request.url())) {
        recordNetworkEvent({ type: 'requestfailed', url: request.url(), error: request.failure()?.errorText || 'unknown' });
      }
    };
    const recordResponse = (response) => {
      if (/translate|translatetext|deeplx|google/i.test(response.url())) {
        recordNetworkEvent({ type: 'response', url: response.url(), status: response.status() });
      }
    };
    // 翻译请求由扩展 service worker 发出，BrowserContext 级监听比 page 级更完整。
    context.on('requestfailed', recordFailedRequest);
    context.on('response', recordResponse);
    page.on('requestfailed', recordFailedRequest);
    page.on('response', recordResponse);
    page.on('pageerror', (error) => {
      runtimeErrors.push(`pageerror: ${error.message}`);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') {
        const text = message.text();
        runtimeErrors.push(`console: ${text}`);
        recordNetworkEvent({ type: 'console-error', text });
      }
    });
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: args.timeout });
    // 当前 main 默认关闭悬浮球，但悬浮/全文快捷键仍由 content script 独立监听；
    // 不能把“悬浮球是否挂载”当作扩展已加载的判据。
    await page.waitForTimeout(1000);
    const configResult = await readConfig(context, args.timeout, null, createIsolatedPage);
    if (configResult.config?.floatingBallHotkey !== 'Alt+T') throw new Error(`全文快捷键不是 Alt+T：${configResult.config?.floatingBallHotkey}`);
    if (configResult.config?.service !== args.service) throw new Error(`翻译服务不符：预期 ${args.service}，实际 ${configResult.config?.service}`);

    const initialClamp = await page.evaluate(() => {
      const clamp = document.querySelector('#model-description-clamp');
      return clamp ? {
        lineClamp: getComputedStyle(clamp).webkitLineClamp,
        clientHeight: clamp.clientHeight,
        scrollHeight: clamp.scrollHeight,
        inlineStyle: clamp.getAttribute('style'),
      } : null;
    });
    if (!initialClamp || initialClamp.lineClamp !== '2' || initialClamp.inlineStyle !== null ||
        initialClamp.scrollHeight <= initialClamp.clientHeight) {
      throw new Error(`line-clamp fixture 初始状态无效：${JSON.stringify(initialClamp)}`);
    }

    await installShortcutDiagnostics(page);
    await toggleFullPage(page, activateTestPage);
    try {
      await waitFor(page, () => document.querySelector('#paragraph-one .babelbox-bilingual-content') &&
        document.querySelector('#model-description .babelbox-bilingual-content') &&
        document.querySelector('#shadow-host')?.shadowRoot?.querySelector('#shadow-paragraph .babelbox-bilingual-content') &&
        /[\u3400-\u9fff]/u.test(document.querySelector('#save-button')?.textContent || '') &&
        /[\u3400-\u9fff]/u.test(document.querySelector('#cancel-button')?.textContent || ''), args.timeout);
    } catch (error) {
      const diagnostics = await readShortcutDiagnostics(page);
      throw new Error(`${error.message}\n全文快捷键诊断：${JSON.stringify(diagnostics)}\n翻译请求诊断：${JSON.stringify({ events: networkEvents, omitted: omittedNetworkEvents })}`);
    }

    // 在会话已经启动后再插入节点，确认 MutationObserver 能把新内容纳入全文队列。
    await page.evaluate(() => {
      const container = document.querySelector('#dynamic-container');
      const clamp = document.createElement('div');
      clamp.id = 'dynamic-model-description-clamp';
      clamp.className = 'model-description-clamp';
      const paragraph = document.createElement('p');
      paragraph.id = 'dynamic-paragraph';
      paragraph.textContent = 'This virtualized model description is inserted after the full page session starts. Its translated text must expand the newly mounted two-line clamp instead of remaining hidden beneath the source content.';
      clamp.appendChild(paragraph);
      container.appendChild(clamp);
    });
    await waitFor(page, () => document.querySelector('#dynamic-paragraph .babelbox-bilingual-content'), args.timeout);

    // React/Vue 页面可能在译文已插入后重建原文节点。确认全文观察器不会把
    // 这次宿主 characterData/childList mutation 当成插件自身写入而留下旧译文。
    await page.evaluate(() => {
      const paragraph = document.querySelector('#paragraph-two');
      if (paragraph) paragraph.textContent = 'The second paragraph changed after full-page translation.';
    });
    await waitFor(page, () => {
      const paragraph = document.querySelector('#paragraph-two');
      return paragraph?.textContent?.includes('changed after full-page translation') &&
        Boolean(paragraph.querySelector('.babelbox-bilingual-content'));
    }, args.timeout);
    const translated = await pageState(page);
    assertTranslated(translated, '第一次全文翻译');
    if (artifactsDir) await page.screenshot({ path: path.join(artifactsDir, 'full-page-translated.png'), fullPage: true });

    await toggleFullPage(page, activateTestPage);
    await waitFor(page, () => !document.querySelector('.babelbox-bilingual-content'), args.timeout);
    const restored = await pageState(page);
    assertRestored(restored);
    if (artifactsDir) await page.screenshot({ path: path.join(artifactsDir, 'full-page-restored.png'), fullPage: true });

    await toggleFullPage(page, activateTestPage);
    await waitFor(page, () => document.querySelector('#paragraph-one .babelbox-bilingual-content') &&
      document.querySelector('#model-description .babelbox-bilingual-content') &&
      document.querySelector('#dynamic-paragraph .babelbox-bilingual-content') &&
      document.querySelector('#shadow-host')?.shadowRoot?.querySelector('#shadow-paragraph .babelbox-bilingual-content') &&
      /[\u3400-\u9fff]/u.test(document.querySelector('#save-button')?.textContent || '') &&
      /[\u3400-\u9fff]/u.test(document.querySelector('#cancel-button')?.textContent || ''), args.timeout);
    const retranslated = await pageState(page);
    assertTranslated(retranslated, '再次全文翻译');
    if (artifactsDir) await page.screenshot({ path: path.join(artifactsDir, 'full-page-retranslated.png'), fullPage: true });
    assertNoRuntimeErrors(runtimeErrors);
    assertDeterministicFixtureTraffic(fixtureTranslationRequestCount, unexpectedNetworkRequests);

    const evidence = {
      ok: true,
      windowMode: args.background ? 'background-screen-off' : 'headed-isolated',
      launchMode,
      focusPolicy,
      windowPlacement,
      profileDir,
      url: args.url,
      extensionId: configResult.extensionId,
      config: { floatingBallHotkey: configResult.config.floatingBallHotkey, service: configResult.config.service, display: configResult.config.display },
      fixtureTranslationRequestCount,
      unexpectedNetworkRequests,
      translated,
      restored,
      retranslated,
      consoleErrors: runtimeErrors,
      screenshots: artifactsDir ? [
        path.join(artifactsDir, 'full-page-translated.png'),
        path.join(artifactsDir, 'full-page-restored.png'),
        path.join(artifactsDir, 'full-page-retranslated.png'),
      ] : [],
    };
    if (artifactsDir) {
      fs.writeFileSync(path.join(artifactsDir, 'report.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    }
    process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
  } finally {
    await closeBrowser();
    await fixtureServer?.close().catch(() => {});
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  assertDeterministicFixtureTraffic,
  assertNoRuntimeErrors,
  buildFixtureMicrosoftResponseBody,
  createFixtureRequestHandler,
  parseArgs,
  startFixtureServer,
};
