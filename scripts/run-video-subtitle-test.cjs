#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

function loadPlaywright(root) {
  try { return require('playwright'); } catch {
    const runtimeRequire = createRequire(path.join(path.resolve(root), '__fluentread_video_test__.cjs'));
    return runtimeRequire('playwright');
  }
}

function readArg(argv, name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
}

function parseArgs(argv, env = process.env) {
  const args = {
    extensionDir: readArg(argv, 'extension-dir', '.output/chrome-mv3-dev'),
    playwrightRoot: readArg(argv, 'playwright-root', env.PLAYWRIGHT_ROOT),
    url: readArg(argv, 'url', 'https://www.youtube.com/watch?v=drSMZgnmJjk'),
    artifactsDir: readArg(argv, 'artifacts-dir', path.join(os.tmpdir(), 'fluentread-video-subtitle-evidence')),
    browserPath: readArg(argv, 'browser-path', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
    focusSafeHelper: readArg(argv, 'focus-safe-helper', env.FLUENTREAD_FOCUS_SAFE_HELPER || ''),
    background: !argv.includes('--headed'),
  };
  if (!args.playwrightRoot) throw new Error('必须传入 --playwright-root 或设置 PLAYWRIGHT_ROOT');
  if (args.background && !args.focusSafeHelper) {
    throw new Error('后台模式必须传入 --focus-safe-helper 或设置 FLUENTREAD_FOCUS_SAFE_HELPER');
  }
  args.extensionDir = path.resolve(args.extensionDir);
  args.artifactsDir = path.resolve(args.artifactsDir);
  if (args.focusSafeHelper) args.focusSafeHelper = path.resolve(args.focusSafeHelper);
  return args;
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

function assertDedicatedTemporaryProfile(profileDir) {
  const resolved = path.resolve(profileDir);
  const temporaryRoot = path.resolve(os.tmpdir());
  const relative = path.relative(temporaryRoot, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`拒绝使用非临时浏览器 profile：${resolved}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const {extensionDir, playwrightRoot, url, artifactsDir, browserPath} = args;
  if (!fs.existsSync(path.join(extensionDir, 'manifest.json'))) throw new Error(`找不到扩展构建：${extensionDir}`);
  if (!fs.existsSync(browserPath)) throw new Error(`找不到浏览器：${browserPath}`);
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fluentread-edge-video-profile-'));
  assertDedicatedTemporaryProfile(profileDir);
  fs.mkdirSync(artifactsDir, { recursive: true });

  const { chromium } = loadPlaywright(playwrightRoot);
  const browserArgs = [
      `--disable-extensions-except=${extensionDir}`,
      `--load-extension=${extensionDir}`,
      '--no-first-run', '--no-default-browser-check',
  ];
  let context;
  let closeBrowser = async () => { if (context) await context.close().catch(() => undefined); };
  let createIsolatedPage;
  let activateTestPage = async () => undefined;
  let launchMode;
  let focusPolicy;
  let windowPlacement;
  try {
    if (args.background) {
      const focusSafe = loadFocusSafeBrowser(args.focusSafeHelper);
      const browserSession = await focusSafe.launchFocusSafePersistentContext({
        chromium,
        profileDir,
        browserPath,
        headless: false,
        background: true,
        browserArgs,
        viewport: { width: 1280, height: 900 },
      });
      context = browserSession.context;
      closeBrowser = browserSession.close;
      createIsolatedPage = () => focusSafe.newPageWithoutForeground(context);
      activateTestPage = page => focusSafe.activateExtensionTabWithoutForeground(context, page);
      launchMode = browserSession.launchMode;
      focusPolicy = browserSession.focusPolicy;
      windowPlacement = browserSession.windowPlacement;
    } else {
      context = await chromium.launchPersistentContext(profileDir, {
        executablePath: browserPath,
        headless: false,
        args: browserArgs,
        viewport: { width: 1280, height: 900 },
      });
      closeBrowser = () => context.close();
      createIsolatedPage = () => context.newPage();
      launchMode = 'playwright-headed';
      focusPolicy = 'foreground-authorized';
      windowPlacement = { mode: 'headed-explicit-foreground', windowState: 'normal', viewport: { width: 1280, height: 900 } };
    }

    const workers = context.serviceWorkers();
    const worker = workers[0] || await context.waitForEvent('serviceworker', { timeout: 30000 });
    const extensionId = worker.url().match(/^chrome-extension:\/\/([^/]+)/)?.[1];
    if (!extensionId) throw new Error('无法取得扩展 ID');

    const popup = await createIsolatedPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`, { waitUntil: 'domcontentloaded' });
    await activateTestPage(popup);
    await popup.waitForSelector('[data-feature="video-subtitle"]', { timeout: 15000 });
    await popup.waitForFunction(() => document.querySelectorAll('.feature-card').length === 6, null, { timeout: 10000 });
    await worker.evaluate(async () => {
      const stored = await chrome.storage.local.get('config');
      const config = stored.config || {};
      await chrome.storage.local.set({ config: {
        ...config,
        on: true,
        display: 1,
        from: 'auto',
        to: 'zh-Hans',
        service: 'deeplx',
        videoTranslationEnabled: true,
        useCache: false,
      }});
    });
    const popupState = await popup.evaluate(async () => {
      const stored = await chrome.storage.local.get('config');
      return {
        featurePresent: Boolean(document.querySelector('[data-feature="video-subtitle"]')),
        featureCount: document.querySelectorAll('.feature-card').length,
        imageFeaturePresent: [...document.querySelectorAll('.feature-card')].some((node) => node.textContent?.includes('图片翻译')),
        floatingFeaturePresent: [...document.querySelectorAll('.feature-card')].some((node) => node.textContent?.includes('全文悬浮球')),
        videoBetaLabel: document.querySelector('[data-feature="video-subtitle"] .beta-badge')?.textContent?.trim(),
        popupHeight: document.body.scrollHeight,
        config: stored.config,
      };
    });
    if (popupState.featureCount !== 6 || !popupState.imageFeaturePresent || popupState.floatingFeaturePresent || popupState.videoBetaLabel !== 'Beta 测试' || popupState.config.videoService !== 'microsoft') {
      throw new Error(`Popup 快捷功能卡校验失败：数量=${popupState.featureCount}，图片翻译=${popupState.imageFeaturePresent}`);
    }
    await popup.locator('[data-feature="video-subtitle"]').click();
    await popup.getByText('YouTube 字幕翻译').waitFor({ state: 'visible', timeout: 10000 });
    const videoServiceCombobox = popup.getByRole('combobox', { name: '视频翻译服务' });
    await videoServiceCombobox.click();
    const videoServiceOptions = popup.getByRole('option');
    await videoServiceOptions.first().waitFor({ state: 'visible', timeout: 10000 });
    const providerCount = await videoServiceOptions.count();
    await popup.keyboard.press('Escape');
    const drawerVisible = await popup.evaluate(() => Boolean(
      [...document.querySelectorAll('.drawer-content')].find((node) => node.textContent?.includes('视频翻译服务')),
    ));
    const videoDrawerState = { drawerVisible, providerCount };
    await popup.screenshot({ path: path.join(artifactsDir, 'popup-video-beta-drawer.png'), fullPage: true });
    await popup.screenshot({ path: path.join(artifactsDir, 'popup-video-beta.png'), fullPage: true });
    await popup.close();

    const options = await createIsolatedPage();
    await options.goto(`chrome-extension://${extensionId}/options.html#settings-video`, { waitUntil: 'domcontentloaded' });
    await activateTestPage(options);
    await options.getByRole('heading', { name: '边看边译视频字幕' }).waitFor({ timeout: 15000 });
    const optionsState = await options.evaluate(() => ({
      activeNav: document.querySelector('.sidebar button.active')?.textContent?.replace(/\s+/g, ' ').trim(),
      videoSection: Boolean(document.querySelector('#settings-video')),
      providerControl: Boolean(document.querySelector('[aria-label="视频字幕翻译服务"]')),
    }));
    if (!optionsState.activeNav?.includes('视频字幕 Beta 测试') || !optionsState.videoSection || !optionsState.providerControl) {
      throw new Error(`视频字幕设置导航校验失败：${JSON.stringify(optionsState)}`);
    }
    await options.screenshot({ path: path.join(artifactsDir, 'options-video-subtitle.png'), fullPage: true });
    await options.close();

    const page = await createIsolatedPage();
    const extensionPageErrors = [];
    page.on('pageerror', (error) => {
      const message = error.stack || error.message || String(error);
      if (message.includes('chrome-extension://')) extensionPageErrors.push(message);
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await activateTestPage(page);
    await page.waitForTimeout(6000);

    await page.waitForFunction(() => {
      const button = document.querySelector('#fluent-read-video-subtitle-button');
      return Boolean(button?.closest('.ytp-right-controls'));
    }, null, { timeout: 20000 });
    const playerUiState = await page.evaluate(() => {
      const button = document.querySelector('#fluent-read-video-subtitle-button');
      return {
        buttonPresent: Boolean(button),
        buttonInRightControls: Boolean(button?.closest('.ytp-right-controls')),
        buttonEnabled: button?.getAttribute('aria-pressed') === 'true',
        buttonLabel: button?.getAttribute('aria-label'),
      };
    });
    if (!playerUiState.buttonPresent || !playerUiState.buttonInRightControls || !playerUiState.buttonEnabled) {
      throw new Error(`播放器字幕翻译入口校验失败：${JSON.stringify(playerUiState)}`);
    }

    const clickVideoTranslationButton = () => page.evaluate(() => {
      const button = document.querySelector('#fluent-read-video-subtitle-button');
      if (!(button instanceof HTMLElement)) throw new Error('找不到播放器字幕翻译入口');
      button.click();
    });

    await clickVideoTranslationButton();
    await page.locator('#fluent-read-video-subtitle-menu').waitFor({ state: 'visible', timeout: 10000 });
    const playerMenuState = await page.evaluate(() => ({
      title: document.querySelector('#fluent-read-video-subtitle-menu .fluent-read-video-menu-title')?.textContent?.replace(/\s+/g, ' ').trim(),
      modeCount: document.querySelectorAll('#fluent-read-video-subtitle-menu [data-mode]').length,
      downloadPresent: Boolean(document.querySelector('#fluent-read-video-subtitle-menu [data-action="download-subtitles"]')),
      bilingualSelected: document.querySelector('#fluent-read-video-subtitle-menu [data-mode="bilingual"]')?.getAttribute('aria-checked') === 'true',
      service: document.querySelector('#fluent-read-video-subtitle-menu [data-service-label]')?.textContent,
      brand: document.querySelector('#fluent-read-video-subtitle-menu .fluent-read-video-menu-brand')?.textContent,
      beta: document.querySelector('#fluent-read-video-subtitle-menu .fluent-read-video-menu-beta')?.textContent,
    }));
    if (playerMenuState.modeCount !== 3 || !playerMenuState.downloadPresent || !playerMenuState.bilingualSelected || playerMenuState.service !== '微软翻译' || playerMenuState.brand !== 'FluentRead' || playerMenuState.beta !== 'Beta 测试') {
      throw new Error(`播放器字幕翻译菜单校验失败：${JSON.stringify(playerMenuState)}`);
    }
    await page.screenshot({ path: path.join(artifactsDir, 'youtube-video-subtitle-menu.png'), fullPage: false });
    const playerSettingsPagePromise = context.waitForEvent('page', { timeout: 10000 });
    await page.locator('#fluent-read-video-subtitle-menu [data-action="open-settings"]').click({ force: true });
    const playerSettingsPage = await playerSettingsPagePromise;
    await playerSettingsPage.waitForLoadState('domcontentloaded');
    const playerSettingsState = {
      opened: true,
      videoHash: playerSettingsPage.url().endsWith('#settings-video'),
    };
    await playerSettingsPage.close();

    const subtitleButton = page.locator('button.ytp-subtitles-button').first();
    if (await subtitleButton.count()) {
      if (await subtitleButton.getAttribute('aria-pressed') !== 'true') await subtitleButton.click();
      await page.waitForTimeout(2500);
    }

    const playButton = page.locator('button.ytp-play-button').first();
    if (await playButton.count() && (await playButton.getAttribute('aria-label') || '').toLowerCase().includes('play')) {
      await playButton.click().catch(() => undefined);
      await page.waitForTimeout(5000);
    }
    const nativeSubtitle = await page.locator('.ytp-caption-segment').first().count();
    await clickVideoTranslationButton();
    await page.locator('#fluent-read-video-subtitle-menu').waitFor({ state: 'visible', timeout: 10000 });
    await page.evaluate(() => {
      window.postMessage({
        source: 'fluent-read',
        type: 'fluent-read-youtube-timedtext',
        url: 'https://www.youtube.com/api/timedtext?v=dqONk48l5vY&lang=en',
        responseText: JSON.stringify({ events: [
          { tStartMs: 0, dDurationMs: 1200, segs: [{ utf8: 'Download test subtitle.' }] },
          { tStartMs: 1500, dDurationMs: 1200, segs: [{ utf8: 'The SRT export works.' }] },
        ] }),
      }, window.location.origin);
    });
    const downloadPromise = page.waitForEvent('download', { timeout: 10000 });
    await page.locator('#fluent-read-video-subtitle-menu [data-action="download-subtitles"]').click({ force: true });
    const download = await downloadPromise;
    const downloadPath = await download.path();
    const downloadedText = downloadPath ? fs.readFileSync(downloadPath, 'utf8') : '';
    const downloadState = {
      suggestedFilename: download.suggestedFilename(),
      hasTimestamp: downloadedText.includes('00:00:00,000 --> 00:00:01,200'),
      hasSubtitle: downloadedText.includes('Download test subtitle.'),
    };
    if (!downloadState.hasTimestamp || !downloadState.hasSubtitle) {
      throw new Error(`字幕 SRT 下载内容校验失败：${JSON.stringify(downloadState)}`);
    }
    const injected = await page.evaluate(() => {
      let container = document.querySelector('#ytp-caption-window-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'ytp-caption-window-container';
        document.body.appendChild(container);
      }
      container.replaceChildren();
      const segment = document.createElement('span');
      segment.className = 'ytp-caption-segment';
      segment.textContent = 'This is a FluentRead video subtitle test.';
      container.appendChild(segment);
      return Boolean(container);
    });
    await page.waitForFunction(() => {
      const overlay = document.querySelector('#fluent-read-video-subtitle');
      return Boolean(overlay?.textContent?.match(/[\u3400-\u9fff]/));
    }, { timeout: 45000 });
    const first = await page.locator('#fluent-read-video-subtitle').textContent();

    await page.evaluate(() => {
      document.querySelector('#ytp-caption-window-container, .ytp-caption-window-container')?.replaceChildren();
    });
    await page.waitForTimeout(180);
    const duringCaptionRedraw = await page.evaluate(() => ({
      nativeCaptionEmpty: !(document.querySelector('#ytp-caption-window-container, .ytp-caption-window-container')?.textContent || '').trim(),
      overlay: document.querySelector('#fluent-read-video-subtitle')?.textContent || '',
    }));
    if (!duringCaptionRedraw.nativeCaptionEmpty || !duringCaptionRedraw.overlay.trim()) {
      throw new Error(`字幕节点短暂重绘时译文被清除：${JSON.stringify(duringCaptionRedraw)}`);
    }
    await page.evaluate(() => {
      const container = document.querySelector('#ytp-caption-window-container, .ytp-caption-window-container');
      if (!container) return;
      const segment = document.createElement('span');
      segment.className = 'ytp-caption-segment';
      segment.textContent = 'This is a FluentRead video subtitle test.';
      container.appendChild(segment);
    });
    await page.waitForTimeout(600);
    const afterCaptionRedraw = await page.locator('#fluent-read-video-subtitle').textContent();
    if (!afterCaptionRedraw?.trim()) {
      throw new Error('字幕节点重建后译文没有恢复');
    }

    await page.evaluate(() => {
      const segment = document.querySelector('#ytp-caption-window-container .ytp-caption-segment');
      if (segment) segment.textContent = 'The second subtitle updates correctly.';
    });
    await page.waitForFunction((oldText) => {
      const overlay = document.querySelector('#fluent-read-video-subtitle');
      return Boolean(overlay?.textContent?.trim() && overlay.textContent !== oldText);
    }, first, { timeout: 45000 });
    const second = await page.locator('#fluent-read-video-subtitle').textContent();
    const overlayCount = await page.locator('#fluent-read-video-subtitle').count();

    await page.waitForFunction(() => !document.querySelector('#fluent-read-video-subtitle-menu [data-action="download-subtitles"]')?.hasAttribute('disabled'), null, { timeout: 10000 });
    await clickVideoTranslationButton();
    await page.locator('#fluent-read-video-subtitle-menu').waitFor({ state: 'visible', timeout: 10000 });
    await page.locator('#fluent-read-video-subtitle-menu [data-mode="translation-only"]').click({ force: true });
    await page.waitForFunction(() => document.querySelector('#ytp-caption-window-container')?.classList.contains('fluent-read-video-display-translation-only'), null, { timeout: 10000 });
    const translationOnly = await page.evaluate(() => document.querySelector('#ytp-caption-window-container')?.getAttribute('data-fluent-read-video-display-mode'));

    await page.locator('#fluent-read-video-subtitle-menu [data-mode="bilingual"]').click({ force: true });
    await page.waitForFunction(() => document.querySelector('#ytp-caption-window-container')?.getAttribute('data-fluent-read-video-display-mode') === 'bilingual', null, { timeout: 10000 });

    await page.locator('#fluent-read-video-subtitle-menu [data-action="toggle-visible"]').click({ force: true });
    await page.waitForFunction(() => document.querySelector('#ytp-caption-window-container')?.classList.contains('fluent-read-video-display-hidden')
      && !document.querySelector('#fluent-read-video-subtitle')?.textContent?.trim(), null, { timeout: 10000 });
    const subtitlesHiddenFromPlayer = await page.evaluate(() => ({
      menuState: document.querySelector('#fluent-read-video-subtitle-menu [data-action="toggle-visible"]')?.getAttribute('aria-checked'),
      hiddenClass: document.querySelector('#ytp-caption-window-container')?.classList.contains('fluent-read-video-display-hidden'),
    }));
    await page.locator('#fluent-read-video-subtitle-menu [data-action="toggle-visible"]').click({ force: true });
    await page.waitForFunction(() => !document.querySelector('#ytp-caption-window-container')?.classList.contains('fluent-read-video-display-hidden')
      && Boolean(document.querySelector('#fluent-read-video-subtitle')?.textContent?.match(/[\u3400-\u9fff]/)), null, { timeout: 45000 });
    const subtitlesShownFromPlayer = await page.evaluate(() => ({
      menuState: document.querySelector('#fluent-read-video-subtitle-menu [data-action="toggle-visible"]')?.getAttribute('aria-checked'),
      hiddenClass: document.querySelector('#ytp-caption-window-container')?.classList.contains('fluent-read-video-display-hidden'),
    }));

    await page.locator('#fluent-read-video-subtitle-menu [data-action="toggle-translation"]').click({ force: true });
    await page.waitForFunction(() => {
      const button = document.querySelector('#fluent-read-video-subtitle-button');
      return button?.getAttribute('aria-pressed') === 'false'
        && !document.querySelector('#fluent-read-video-subtitle')?.textContent?.trim();
    }, null, { timeout: 10000 });
    const disabledFromPlayer = await page.evaluate(() => ({
      buttonPressed: document.querySelector('#fluent-read-video-subtitle-button')?.getAttribute('aria-pressed'),
      menuState: document.querySelector('#fluent-read-video-subtitle-menu [data-action="toggle-translation"]')?.getAttribute('aria-checked'),
      overlayText: document.querySelector('#fluent-read-video-subtitle')?.textContent || '',
    }));

    await page.locator('#fluent-read-video-subtitle-menu [data-action="toggle-translation"]').click({ force: true });
    await page.waitForFunction(() => document.querySelector('#fluent-read-video-subtitle-button')?.getAttribute('aria-pressed') === 'true', null, { timeout: 10000 });
    await page.evaluate(() => {
      let container = document.querySelector('#ytp-caption-window-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'ytp-caption-window-container';
        document.body.appendChild(container);
      }
      container.replaceChildren();
      const segment = document.createElement('span');
      segment.className = 'ytp-caption-segment';
      segment.textContent = 'The subtitle returns after the player toggle.';
      container.appendChild(segment);
    });
    await page.waitForFunction(() => {
      const overlay = document.querySelector('#fluent-read-video-subtitle');
      return Boolean(overlay?.textContent?.match(/[\u3400-\u9fff]/));
    }, null, { timeout: 45000 });
    const reenabledFromPlayer = await page.evaluate(() => ({
      buttonPressed: document.querySelector('#fluent-read-video-subtitle-button')?.getAttribute('aria-pressed'),
      overlayText: document.querySelector('#fluent-read-video-subtitle')?.textContent || '',
    }));

    if (extensionPageErrors.length > 0) {
      throw new Error(`播放器页面出现扩展脚本异常：${extensionPageErrors.join('\n')}`);
    }

    await clickVideoTranslationButton();
    await page.screenshot({ path: path.join(artifactsDir, 'youtube-video-subtitle-final.png'), fullPage: false });

    console.log(JSON.stringify({
      ok: true,
      url: page.url(),
      popupState: {
        featurePresent: popupState.featurePresent,
        featureCount: popupState.featureCount,
        imageFeaturePresent: popupState.imageFeaturePresent,
        popupHeight: popupState.popupHeight,
        textService: popupState.config.service,
        videoService: popupState.config.videoService,
        videoTranslationEnabled: popupState.config.videoTranslationEnabled,
      },
      videoDrawerState,
      optionsState,
      playerUiState,
      playerMenuState,
      playerSettingsState,
      downloadState,
      nativeSubtitle,
      injected,
      firstTranslation: first,
      duringCaptionRedraw,
      afterCaptionRedraw,
      secondTranslation: second,
      overlayCount,
      translationOnly,
      subtitlesHiddenFromPlayer,
      subtitlesShownFromPlayer,
      disabledFromPlayer,
      reenabledFromPlayer,
      extensionPageErrors,
      disabledClearedOverlay: disabledFromPlayer.buttonPressed === 'false' && disabledFromPlayer.overlayText === '',
      artifactsDir,
      launchMode,
      focusPolicy,
      windowPlacement,
    }, null, 2));
  } finally {
    await closeBrowser();
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
  });
}

module.exports = {parseArgs};
