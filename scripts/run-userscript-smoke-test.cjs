#!/usr/bin/env node

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const {createRequire} = require('node:module');

function parseArgs(argv, env = process.env) {
  const args = {
    browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    background: true,
    focusSafeHelper: env.FLUENTREAD_FOCUS_SAFE_HELPER || '',
    timeout: 60000,
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
  if (!args.artifact) throw new Error('必须传入 --artifact');
  if (!args.playwrightRoot) throw new Error('必须传入 --playwright-root');
  if (!args.artifactsDir) throw new Error('必须传入 --artifacts-dir');
  if (args.background && !args.focusSafeHelper) {
    throw new Error('后台模式必须传入 --focus-safe-helper 或设置 FLUENTREAD_FOCUS_SAFE_HELPER');
  }
  if (args.focusSafeHelper) args.focusSafeHelper = path.resolve(args.focusSafeHelper);
  return args;
}

function loadPlaywright(root) {
  try {
    return require('playwright');
  } catch {
    return createRequire(path.join(path.resolve(root), '__fluentread_userscript_loader__.cjs'))('playwright');
  }
}

function loadFocusSafeBrowser(helperPath) {
  if (!fs.existsSync(helperPath)) throw new Error(`找不到后台浏览器辅助脚本：${helperPath}`);
  const helper = require(helperPath);
  for (const name of [
    'launchFocusSafePersistentContext',
    'newPageWithoutForeground',
    'activateExtensionTabWithoutForeground',
  ]) {
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
  ];
  if (forbidden.some((root) => {
    const relative = path.relative(root, resolved);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  })) throw new Error(`拒绝使用日常浏览器 profile：${resolved}`);
}

async function startFixtureServer() {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>FluentRead userscript fixture</title></head>
<body>
  <nav id="forbidden-nav">Navigation should remain original</nav>
  <main>
    <h1 id="heading">Userscript translation fixture</h1>
    <p id="target">FluentRead keeps the original paragraph and adds a safe bilingual translation.</p>
    <p id="adjacent">This adjacent paragraph must stay untouched during hover translation.</p>
    <img id="unsupported-image" width="24" height="24" alt="" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">
    <div id="dynamic-root"></div>
    <div id="shadow-host"></div>
  </main>
  <script>
    const root = document.querySelector('#shadow-host').attachShadow({mode: 'open'});
    root.innerHTML = '<p id="shadow-paragraph">Open shadow root content should be translated.</p>';
  <\/script>
</body></html>`;
  const server = http.createServer((_request, response) => {
    response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/fixture`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function waitForCount(page, selector, expected, timeout) {
  await page.waitForFunction(
    ({selector: targetSelector, expected: count}) =>
      document.querySelector(targetSelector)?.querySelectorAll('.fluent-read-bilingual-content').length === count,
    {selector, expected},
    {timeout},
  );
}

async function waitForShadowCount(page, hostSelector, targetSelector, expected, timeout) {
  await page.waitForFunction(
    ({hostSelector: host, targetSelector: target, expected: count}) =>
      document.querySelector(host)?.shadowRoot?.querySelector(target)
        ?.querySelectorAll('.fluent-read-bilingual-content').length === count,
    {hostSelector, targetSelector, expected},
    {timeout},
  );
}

async function hoverToggle(page, expected, timeout) {
  const target = page.locator('#target');
  const box = await target.boundingBox();
  if (!box) throw new Error('hover 目标不可见');
  const x = box.x + Math.min(Math.max(box.width * .35, 10), box.width - 10);
  const y = box.y + box.height * .5;
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
  await page.keyboard.down('Control');
  await page.keyboard.up('Control');
  await waitForCount(page, '#target', expected, timeout);
}

async function fullPageToggle(page, targetCount, adjacentCount, timeout) {
  await page.keyboard.down('Alt');
  await page.keyboard.press('t');
  await page.keyboard.up('Alt');
  await Promise.all([
    waitForCount(page, '#target', targetCount, timeout),
    waitForCount(page, '#adjacent', adjacentCount, timeout),
  ]);
}

async function readState(page) {
  return page.evaluate(() => ({
    url: location.href,
    injected: Boolean(document.querySelector('#fluent-read-page-styles')),
    floatingBall: Boolean(document.querySelector('#fluent-read-floating-ball-container')),
    settings: Boolean(document.querySelector('#fluent-read-userscript-settings-container')),
    target: document.querySelector('#target')?.querySelectorAll('.fluent-read-bilingual-content').length || 0,
    adjacent: document.querySelector('#adjacent')?.querySelectorAll('.fluent-read-bilingual-content').length || 0,
    heading: document.querySelector('#heading')?.querySelectorAll('.fluent-read-bilingual-content').length || 0,
    nav: document.querySelector('#forbidden-nav')?.querySelectorAll('.fluent-read-bilingual-content').length || 0,
    dynamic: document.querySelector('#dynamic-paragraph')?.querySelectorAll('.fluent-read-bilingual-content').length || 0,
    shadow: document.querySelector('#shadow-host')?.shadowRoot?.querySelector('#shadow-paragraph')
      ?.querySelectorAll('.fluent-read-bilingual-content').length || 0,
    dynamicShadow: document.querySelector('#dynamic-shadow-host')?.shadowRoot?.querySelector('#dynamic-shadow-paragraph')
      ?.querySelectorAll('.fluent-read-bilingual-content').length || 0,
    targetTranslation: document.querySelector('#target .fluent-read-bilingual-content')?.textContent?.trim() || '',
  }));
}

async function selectUserscriptTestPage(background, context, createIsolatedPage) {
  // focus-safe helper 可能持有并异步关闭自己的启动页；后台回归必须创建独立页面，
  // 不能复用 context.pages()[0] 后再等待长 userscript 注入。
  if (background) return createIsolatedPage();
  return context.pages()[0] || createIsolatedPage();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const artifact = path.resolve(args.artifact);
  const artifactsDir = path.resolve(args.artifactsDir);
  if (!fs.existsSync(artifact)) throw new Error(`userscript 产物不存在：${artifact}`);
  if (!fs.existsSync(args.browserPath)) throw new Error(`Edge 不存在：${args.browserPath}`);
  fs.mkdirSync(artifactsDir, {recursive: true});

  const {chromium} = loadPlaywright(args.playwrightRoot);
  const fixture = await startFixtureServer();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-userscript-edge-'));
  assertDedicatedProfile(profileDir);
  let context;
  let closeBrowser = async () => { if (context) await context.close().catch(() => undefined); };
  let createIsolatedPage = () => context.newPage();
  let launchMode = args.background ? null : 'playwright-headed';
  let focusPolicy = args.background ? null : 'foreground-authorized';
  let windowPlacement = args.background
    ? null
    : {mode: 'headed-explicit-foreground', windowState: 'normal', viewport: {width: 1280, height: 900}};
  try {
    const browserArgs = [
        '--no-first-run',
        '--no-default-browser-check',
    ];
    if (args.background) {
      const focusSafe = loadFocusSafeBrowser(args.focusSafeHelper);
      const browserSession = await focusSafe.launchFocusSafePersistentContext({
        chromium,
        profileDir,
        browserPath: args.browserPath,
        headless: false,
        background: true,
        browserArgs,
        viewport: {width: 1280, height: 900},
        timeout: args.timeout,
      });
      context = browserSession.context;
      closeBrowser = browserSession.close;
      createIsolatedPage = () => focusSafe.newPageWithoutForeground(context, args.timeout);
      launchMode = browserSession.launchMode;
      focusPolicy = browserSession.focusPolicy;
      windowPlacement = browserSession.windowPlacement;
    } else {
      context = await chromium.launchPersistentContext(profileDir, {
        executablePath: args.browserPath,
        headless: false,
        viewport: {width: 1280, height: 900},
        args: browserArgs,
      });
    }
    await context.addInitScript(() => {
      const store = new Map();
      store.set('local:config', JSON.stringify({
        on: true,
        autoTranslate: false,
        from: 'auto',
        to: 'zh-Hans',
        service: 'freeTranslation',
        disableFloatingBall: false,
        selectionAreaEnabled: true,
        disableImageTranslator: false,
        videoTranslationEnabled: true,
      }));
      Object.defineProperty(window, '__fluentReadSmokeStore', {value: store});
      Object.defineProperty(window, '__fluentReadOriginalAttachShadow', {value: Element.prototype.attachShadow});
      Object.defineProperty(window, '__fluentReadSmokeBridgeEvents', {value: {shadow: 0, route: 0}});
      document.addEventListener('fluentread-open-shadow-root', () => { window.__fluentReadSmokeBridgeEvents.shadow += 1; });
      document.addEventListener('fluentread-route-change', () => { window.__fluentReadSmokeBridgeEvents.route += 1; });
      window.GM_getValue = (key, fallback) => store.has(key) ? store.get(key) : fallback;
      window.GM_setValue = (key, value) => { store.set(key, value); };
      window.GM_deleteValue = (key) => { store.delete(key); };
      window.GM_listValues = () => [...store.keys()];
      window.GM_registerMenuCommand = () => 1;
      window.GM_addStyle = (css) => {
        const style = document.createElement('style');
        style.textContent = css;
        document.documentElement.appendChild(style);
        return style;
      };
      window.GM_xmlhttpRequest = (details) => {
        let aborted = false;
        const timer = setTimeout(() => {
          if (aborted) return;
          try {
            const body = JSON.parse(String(details.data || '[]'));
            const responseText = JSON.stringify(body.map((text) => ({
              translations: [{text: `译文：${String(text).replace(/<[^>]+>/g, '')}`}],
            })));
            details.onload?.({
              status: 200,
              statusText: 'OK',
              responseText,
              responseHeaders: 'content-type: application/json; charset=utf-8',
              finalUrl: details.url,
            });
          } catch (error) {
            details.onerror?.({status: 500, statusText: String(error), responseText: ''});
          }
        }, 12);
        return {abort() { aborted = true; clearTimeout(timer); details.onabort?.({status: 0, statusText: 'aborted'}); }};
      };
    });

    const page = await selectUserscriptTestPage(args.background, context, createIsolatedPage);
    const consoleErrors = [];
    page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(`console: ${message.text()}`);
    });
    await page.goto(fixture.url, {waitUntil: 'domcontentloaded', timeout: args.timeout});
    await page.evaluate(() => {
      Object.defineProperty(window, '__fluentReadBrowserBeforeInjection', {value: window.browser});
      Object.defineProperty(window, '__fluentReadChromeBeforeInjection', {value: window.chrome});
    });
    try {
      await page.addScriptTag({path: artifact});
      await page.waitForSelector('#fluent-read-page-styles', {state: 'attached', timeout: args.timeout});
    } catch (error) {
      const bootstrapState = page.isClosed()
        ? {pageClosed: true}
        : await page.evaluate(() => ({
          pageClosed: false,
          bootstrapped: window.__fluentReadUserscriptBootstrapped,
          readyState: document.readyState,
          stylePresent: Boolean(document.querySelector('#fluent-read-page-styles')),
          bodyText: document.body?.innerText?.slice(0, 200) || '',
        })).catch((cause) => ({diagnosticError: String(cause)}));
      throw new Error(`${error.message}\nuserscript 启动诊断：${JSON.stringify({bootstrapState, consoleErrors})}`);
    }
    await page.waitForSelector('#fluent-read-floating-ball-container', {state: 'attached', timeout: args.timeout});
    const pageGlobalsPreserved = await page.evaluate(() => ({
      browser: window.browser === window.__fluentReadBrowserBeforeInjection,
      chrome: window.chrome === window.__fluentReadChromeBeforeInjection,
    }));
    if (!pageGlobalsPreserved.browser || !pageGlobalsPreserved.chrome) {
      throw new Error(`页面 browser/chrome 全局被 userscript 覆盖：${JSON.stringify(pageGlobalsPreserved)}`);
    }

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('fluentread-userscript-open-settings')));
    const settingsHost = page.locator('#fluent-read-userscript-settings-container');
    await settingsHost.waitFor({state: 'attached', timeout: args.timeout});
    const settingsSecurity = await settingsHost.evaluate((host) => ({
      closedShadow: host.shadowRoot === null,
      lightDomText: host.textContent || '',
    }));
    if (!settingsSecurity.closedShadow || settingsSecurity.lightDomText.trim()) {
      throw new Error(`设置面板 Shadow DOM 隔离失败：${JSON.stringify(settingsSecurity)}`);
    }
    await page.screenshot({path: path.join(artifactsDir, 'userscript-settings.png'), fullPage: false});
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('fluentread-userscript-close-settings')));
    await settingsHost.waitFor({state: 'detached', timeout: args.timeout});

    await page.locator('#unsupported-image').hover();
    const unsupportedHosts = await page.evaluate(() => ({
      area: Boolean(document.querySelector('#fluent-read-area-translator-container')),
      image: Boolean(document.querySelector('#fluent-read-image-translation-root')),
      video: Boolean(document.querySelector('#fluent-read-video-subtitle-style')),
    }));
    if (unsupportedHosts.area || unsupportedHosts.image || unsupportedHosts.video) {
      throw new Error(`扩展专属能力不应在 userscript 挂载：${JSON.stringify(unsupportedHosts)}`);
    }

    const hoverCounts = [];
    await hoverToggle(page, 1, args.timeout); hoverCounts.push((await readState(page)).target);
    const hoverFirst = await readState(page);
    if (hoverFirst.adjacent !== 0 || !/[\u3400-\u9fff]/u.test(hoverFirst.targetTranslation)) {
      throw new Error(`hover 翻译断言失败：${JSON.stringify(hoverFirst)}`);
    }
    await hoverToggle(page, 0, args.timeout); hoverCounts.push((await readState(page)).target);
    await hoverToggle(page, 1, args.timeout); hoverCounts.push((await readState(page)).target);
    await hoverToggle(page, 0, args.timeout);

    const fullPageCounts = [];
    await fullPageToggle(page, 1, 1, args.timeout); fullPageCounts.push([1, 1]);
    await page.evaluate(() => {
      const paragraph = document.createElement('p');
      paragraph.id = 'dynamic-paragraph';
      paragraph.textContent = 'Dynamic content should join the active translation session.';
      document.querySelector('#dynamic-root').appendChild(paragraph);

      const host = document.createElement('div');
      host.id = 'dynamic-shadow-host';
      document.querySelector('main').appendChild(host);
      const shadow = host.attachShadow({mode: 'open'});
      shadow.innerHTML = '<p id="dynamic-shadow-paragraph">A shadow root created after injection should be translated.</p>';

      history.pushState({fixture: true}, '', `${location.pathname}?route=userscript-smoke`);
      history.replaceState({fixture: true}, '', location.pathname);
    });
    await Promise.all([
      waitForCount(page, '#dynamic-paragraph', 1, args.timeout),
      waitForShadowCount(page, '#dynamic-shadow-host', '#dynamic-shadow-paragraph', 1, args.timeout),
    ]);
    const bridgeEvents = await page.evaluate(() => ({...window.__fluentReadSmokeBridgeEvents}));
    if (bridgeEvents.shadow < 1 || bridgeEvents.route < 2) {
      throw new Error(`Shadow/SPA bridge 事件断言失败：${JSON.stringify(bridgeEvents)}`);
    }
    const fullFirst = await readState(page);
    if (fullFirst.heading !== 1 || fullFirst.nav !== 0 || fullFirst.shadow !== 1
      || fullFirst.dynamic !== 1 || fullFirst.dynamicShadow !== 1) {
      throw new Error(`全文翻译覆盖断言失败：${JSON.stringify(fullFirst)}`);
    }
    await fullPageToggle(page, 0, 0, args.timeout); fullPageCounts.push([0, 0]);
    const restored = await readState(page);
    if (restored.heading || restored.shadow || restored.dynamic || restored.dynamicShadow) {
      throw new Error(`全文恢复有残留：${JSON.stringify(restored)}`);
    }
    await fullPageToggle(page, 1, 1, args.timeout); fullPageCounts.push([1, 1]);
    const finalState = await readState(page);
    if (finalState.url !== fixture.url || finalState.target !== 1 || finalState.adjacent !== 1) {
      throw new Error(`最终状态断言失败：${JSON.stringify(finalState)}`);
    }
    await page.screenshot({path: path.join(artifactsDir, 'userscript-translated.png'), fullPage: true});

    await fullPageToggle(page, 0, 0, args.timeout);
    await page.evaluate(() => {
      const store = window.__fluentReadSmokeStore;
      const nextConfig = JSON.parse(String(store.get('local:config')));
      nextConfig.service = 'openai';
      nextConfig.token = {...nextConfig.token, openai: ''};
      store.set('local:config', JSON.stringify(nextConfig));
      window.dispatchEvent(new Event('focus'));
    });
    await page.waitForTimeout(80);
    await hoverToggle(page, 0, args.timeout);
    const message = page.locator('body > .el-message.fluent-read-message').last();
    let messageStyle;
    if (await message.count() > 0 && await message.isVisible().catch(() => false)) {
      messageStyle = await message.evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return {
          kind: 'light-dom-message',
          lightDom: element.getRootNode() === document,
          position: style.position,
          display: style.display,
          zIndex: style.zIndex,
          top: rect.top,
          width: rect.width,
        };
      });
      if (!messageStyle.lightDom || messageStyle.position !== 'fixed' || messageStyle.display !== 'flex'
        || Number(messageStyle.zIndex) < 2_147_483_000 || messageStyle.top < 0 || messageStyle.width < 100) {
        throw new Error(`light-DOM 错误提示样式断言失败：${JSON.stringify(messageStyle)}`);
      }
    } else {
      const retry = page.locator('#target .fluent-read-retry-wrapper').last();
      await retry.waitFor({state: 'visible', timeout: args.timeout});
      messageStyle = await retry.evaluate((element) => ({
        kind: 'inline-retry-wrapper',
        lightDom: element.getRootNode() === document,
        text: element.textContent?.trim() || '',
      }));
      if (!messageStyle.lightDom || !messageStyle.text) {
        throw new Error(`inline 错误提示断言失败：${JSON.stringify(messageStyle)}`);
      }
    }

    const bridgeCleanup = await page.evaluate(async () => {
      const host = document.createElement('div');
      host.id = 'post-dispose-shadow-host';
      document.querySelector('main').appendChild(host);
      const before = {...window.__fluentReadSmokeBridgeEvents};
      document.dispatchEvent(new CustomEvent('fluentread-shadow-bridge-dispose'));
      const prototypeRestored = Element.prototype.attachShadow === window.__fluentReadOriginalAttachShadow;
      host.attachShadow({mode: 'open'}).innerHTML = '<p>Created after bridge cleanup.</p>';
      history.pushState({disposed: true}, '', `${location.pathname}?after-dispose=1`);
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        before,
        after: {...window.__fluentReadSmokeBridgeEvents},
        prototypeRestored,
      };
    });
    if (!bridgeCleanup.prototypeRestored
      || bridgeCleanup.after.shadow !== bridgeCleanup.before.shadow
      || bridgeCleanup.after.route !== bridgeCleanup.before.route) {
      throw new Error(`Shadow/SPA bridge 清理断言失败：${JSON.stringify(bridgeCleanup)}`);
    }

    await page.screenshot({path: path.join(artifactsDir, 'userscript-final.png'), fullPage: true});
    const evidence = {
      browser: path.basename(args.browserPath),
      isolatedProfile: profileDir,
      artifact,
      fixtureUrl: fixture.url,
      transport: 'GM_xmlhttpRequest deterministic browser shim',
      hoverCounts,
      fullPageCounts,
      finalState,
      pageGlobalsPreserved,
      settingsSecurity,
      unsupportedHosts,
      bridgeEvents,
      messageStyle,
      bridgeCleanup,
      consoleErrors,
      launchMode,
      focusPolicy,
      windowPlacement,
    };
    fs.writeFileSync(path.join(artifactsDir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
    if (consoleErrors.length) throw new Error(`浏览器控制台出现错误：${JSON.stringify(consoleErrors)}`);
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await closeBrowser();
    await fixture.close().catch(() => undefined);
    fs.rmSync(profileDir, {recursive: true, force: true});
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}

module.exports = {parseArgs, selectUserscriptTestPage};
