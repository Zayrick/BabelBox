#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');

const DOCUMENT_EXAMPLES = [
  {name: 'sample.pdf', badge: 'PDF', mimeType: 'application/pdf', source: 'Document Translation Example'},
  {name: 'sample.epub', badge: 'EPUB', mimeType: 'application/epub+zip', source: 'BabelBox reading'},
  {name: 'sample.docx', badge: 'DOCX', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', source: 'REFERENCE GUIDE'},
  {name: 'sample.html', badge: 'HTML', mimeType: 'text/html', source: 'Document translation example'},
  {name: 'sample.txt', badge: 'TXT', mimeType: 'text/plain', source: 'Document translation example'},
  {name: 'sample.md', badge: 'MARKDOWN', mimeType: 'text/markdown', source: 'Document translation example'},
  {name: 'sample.srt', badge: 'SRT', mimeType: 'text/plain', source: 'Hello subtitle'},
  {name: 'sample.vtt', badge: 'VTT', mimeType: 'text/vtt', source: 'Hello VTT subtitle'},
  {name: 'sample.ass', badge: 'ASS', mimeType: 'text/plain', source: 'Hello ASS subtitle'},
  {name: 'sample.ssa', badge: 'ASS', mimeType: 'text/plain', source: 'Hello SSA subtitle'},
  {name: 'sample.lrc', badge: 'LRC', mimeType: 'text/plain', source: 'Hello LRC lyric'},
  {name: 'sample.json', badge: 'JSON', mimeType: 'application/json', source: 'Document translation example'},
];

const BINARY_EXAMPLES = new Set(['sample.pdf', 'sample.epub', 'sample.docx']);

function fail(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const args = {
    browserPath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    timeout: 60000,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) fail(`无法识别的参数：${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`参数缺少值：${token}`);
    args[key] = value;
    index += 1;
  }
  args.timeout = Number(args.timeout);
  if (!Number.isFinite(args.timeout) || args.timeout <= 0) fail('--timeout 必须是正数');
  return args;
}

function loadPlaywright(playwrightRoot) {
  try {
    return require('playwright');
  } catch (error) {
    if (!playwrightRoot) fail(`无法加载 Playwright：${error.message}`);
    const root = path.resolve(playwrightRoot);
    const requireFromRuntime = createRequire(path.join(root, '__babelbox_document_test__.cjs'));
    return requireFromRuntime('playwright');
  }
}

function loadFocusSafeBrowser(helperPath) {
  if (!helperPath) fail('必须传入 --focus-safe-helper，确保真实浏览器在后台隔离运行');
  const resolved = path.resolve(helperPath);
  if (!fs.existsSync(resolved)) fail(`找不到后台浏览器辅助脚本：${resolved}`);
  const helper = require(resolved);
  if (typeof helper.launchFocusSafePersistentContext !== 'function' || typeof helper.newPageWithoutForeground !== 'function') {
    fail('后台浏览器辅助脚本缺少所需接口');
  }
  return helper;
}

function captureErrors(target, label, errors) {
  target.on('console', (message) => {
    if (message.type() === 'error') errors.push({label, type: 'console', message: message.text()});
  });
  target.on('pageerror', (error) => errors.push({label, type: 'pageerror', message: error.message}));
}

async function verifyBinaryDownload(exampleName, downloadPath) {
  const bytes = fs.readFileSync(downloadPath);
  if (exampleName === 'sample.pdf') {
    if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') fail('PDF 双语下载文件签名无效');
    const {PDFDocument} = require('pdf-lib');
    const pdf = await PDFDocument.load(bytes);
    if (pdf.getPageCount() !== 2) fail(`PDF 双语下载应保持两页并排页面，实际为 ${pdf.getPageCount()} 页`);
    const firstPage = pdf.getPage(0).getSize();
    if (firstPage.width <= firstPage.height) fail('PDF 双语下载没有生成横向原页/译页对照版式');
    return {bytes: bytes.length, signature: '%PDF-', pages: pdf.getPageCount(), layout: 'side-by-side'};
  }

  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(bytes);
  if (exampleName === 'sample.epub') {
    const mimetype = await zip.file('mimetype')?.async('string');
    if (mimetype !== 'application/epub+zip') fail('ePub 双语下载缺少有效 mimetype');
    if (!zip.file('OEBPS/chapter-1.xhtml')) fail('ePub 双语下载缺少原章节');
    return {bytes: bytes.length, signature: 'EPUB'};
  }
  if (!zip.file('[Content_Types].xml') || !zip.file('word/document.xml')) {
    fail('DOCX 双语下载缺少 OOXML 必需文件');
  }
  return {bytes: bytes.length, signature: 'OOXML'};
}

function isExpectedShutdownNoise(error) {
  return error.type === 'console' && /browser is shutting down/u.test(error.message);
}

async function waitForServiceWorker(context, timeout) {
  if (context.serviceWorkers().length > 0) return context.serviceWorkers()[0];
  return context.waitForEvent('serviceworker', {timeout});
}

async function openElementSelect(page, ariaLabel, timeout) {
  const combobox = page.getByRole('combobox', {name: ariaLabel, exact: true});
  await combobox.waitFor({state: 'visible', timeout});
  await combobox.click();
  const listbox = page.locator('[role="listbox"]:visible').last();
  await listbox.waitFor({state: 'visible', timeout});
  return {combobox, listbox};
}

async function selectElementOption(page, ariaLabel, optionLabel, timeout) {
  const {combobox, listbox} = await openElementSelect(page, ariaLabel, timeout);
  const option = listbox.getByRole('option', {name: optionLabel, exact: true});
  await option.waitFor({state: 'visible', timeout});
  await option.click();
  return combobox;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.extensionDir) fail('必须传入 --extension-dir');
  const extensionDir = path.resolve(args.extensionDir);
  const manifestPath = path.join(extensionDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) fail(`找不到扩展清单：${manifestPath}`);
  if (!fs.existsSync(path.join(extensionDir, 'document.html'))) fail('生产产物缺少 document.html');
  if (!fs.existsSync(args.browserPath)) fail(`找不到浏览器：${args.browserPath}`);
  const exampleDir = path.resolve(args.exampleDir || path.join(process.cwd(), 'examples/document-translation'));
  if (!fs.existsSync(exampleDir)) fail(`找不到文档示例目录：${exampleDir}`);
  for (const example of DOCUMENT_EXAMPLES) {
    const examplePath = path.join(exampleDir, example.name);
    if (!fs.existsSync(examplePath)) fail(`缺少文档示例：${examplePath}`);
  }

  const {chromium} = loadPlaywright(args.playwrightRoot);
  const {launchFocusSafePersistentContext, newPageWithoutForeground} = loadFocusSafeBrowser(args.focusSafeHelper);
  const artifactsDir = path.resolve(args.artifactsDir || path.join(os.tmpdir(), 'babelbox-document-evidence'));
  fs.mkdirSync(artifactsDir, {recursive: true});
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'babelbox-document-edge-profile-'));
  const errors = [];
  const result = {
    ok: false,
    extensionDir,
    exampleDir,
    profileDir,
    artifactsDir,
    windowMode: 'background-screen-off',
    assertions: {},
    screenshots: [],
    downloads: [],
    errors,
  };

  let context;
  let browserHandle;
  try {
    browserHandle = await launchFocusSafePersistentContext({
      chromium,
      profileDir,
      browserPath: args.browserPath,
      headless: false,
      background: true,
      browserArgs: [
        `--disable-extensions-except=${extensionDir}`,
        `--load-extension=${extensionDir}`,
        '--no-first-run',
        '--no-default-browser-check',
      ],
      viewport: {width: 1440, height: 960},
      timeout: args.timeout,
    });
    context = browserHandle.context;
    result.launchMode = browserHandle.launchMode;
    result.focusPolicy = browserHandle.focusPolicy;
    result.windowPlacement = browserHandle.windowPlacement;

    const worker = await waitForServiceWorker(context, Math.min(args.timeout, 30000));
    captureErrors(worker, 'service-worker', errors);
    const extensionId = worker.url().match(/^chrome-extension:\/\/([^/]+)/)?.[1];
    if (!extensionId) fail(`无法从 Service Worker URL 获取扩展 ID：${worker.url()}`);
    result.extensionId = extensionId;
    const documentUrl = `chrome-extension://${extensionId}/document.html`;
    const popupUrl = `chrome-extension://${extensionId}/popup.html`;
    const optionsUrl = `chrome-extension://${extensionId}/options.html`;

    const page = await newPageWithoutForeground(context, args.timeout);
    captureErrors(page, 'document', errors);
    await page.goto(documentUrl, {waitUntil: 'domcontentloaded', timeout: args.timeout});
    await page.locator('.file-drop-zone').waitFor({state: 'visible', timeout: args.timeout});
    const formatCards = await page.locator('.format-card').count();
    if (formatCards !== 8) fail(`文档页格式卡片应为 8 个，实际为 ${formatCards}`);
    result.assertions.formatCards = formatCards;
    await page.screenshot({path: path.join(artifactsDir, 'document-empty.png'), fullPage: true});
    result.screenshots.push(path.join(artifactsDir, 'document-empty.png'));

    const exampleLoads = {};
    for (const [index, example] of DOCUMENT_EXAMPLES.entries()) {
      if (index > 0) {
        await page.getByRole('button', {name: '打开新文件'}).click();
        await page.locator('.file-drop-zone').waitFor({state: 'visible', timeout: args.timeout});
      }

      await page.locator('input[type=file]').setInputFiles({
        name: example.name,
        mimeType: example.mimeType,
        buffer: fs.readFileSync(path.join(exampleDir, example.name)),
      });
      await page.locator('.workspace-section').waitFor({state: 'visible', timeout: args.timeout});
      if ((await page.locator('.workspace-heading h1').textContent())?.trim() !== example.name) {
        fail(`${example.name} 加载后文件名不正确`);
      }
      if ((await page.locator('.file-type-badge').textContent())?.trim() !== example.badge) {
        fail(`${example.name} 文件格式徽标不正确`);
      }
      const isPdf = example.name === 'sample.pdf';
      let pdfScroll;
      let pdfZoomState;
      let pdfPageRows = 0;
      if (isPdf) {
        await page.locator('.pdf-layout-viewer').waitFor({state: 'visible', timeout: args.timeout});
        await page.locator('.pdf-page-row').nth(0).locator('.pdf-page-column:not(.translated) img').waitFor({state: 'visible', timeout: args.timeout});
        pdfPageRows = await page.locator('.pdf-page-row').count();
        const pdfPageCount = Number((await page.locator('.pdf-page-summary strong').textContent())?.match(/\d+/u)?.[0] || 0);
        if (await page.locator('.pdf-page-navigation').count() !== 0) {
          fail('PDF 阅读器不应再提供左右翻页控件');
        }
        if (pdfPageRows !== pdfPageCount || pdfPageRows < 2) {
          fail(`PDF 阅读器必须一次渲染全部页面并纵向排列：页面行 ${pdfPageRows}，页数 ${pdfPageCount}`);
        }
        pdfScroll = await page.locator('[data-pdf-scroll]').evaluate((element) => ({
          rows: element.querySelectorAll('.pdf-page-row').length,
          documentVerticalOverflow: document.documentElement.scrollHeight > document.documentElement.clientHeight,
          horizontalOverflow: element.scrollWidth > element.clientWidth,
        }));
        if (pdfScroll.rows !== pdfPageRows || !pdfScroll.documentVerticalOverflow || pdfScroll.horizontalOverflow) {
          fail(`PDF 连续阅读滚动容器异常：${JSON.stringify(pdfScroll)}`);
        }
        await selectElementOption(page, 'PDF 预览缩放', '125%', args.timeout);
        pdfZoomState = await page.locator('.pdf-page-stage').first().evaluate((element) => ({
          selectedLabel: document.querySelector('.document-zoom-select .el-select__selected-item:not(.el-select__input-wrapper)')?.textContent?.trim() || '',
          minWidth: element.style.getPropertyValue('--pdf-page-min-width'),
          maxWidth: element.style.getPropertyValue('--pdf-page-max-width'),
        }));
        if (pdfZoomState.selectedLabel !== '125%' || pdfZoomState.minWidth !== '500px' || pdfZoomState.maxWidth !== '900px') {
          fail(`PDF 缩放选择没有保留数值类型：${JSON.stringify(pdfZoomState)}`);
        }
      }
      const nativeReader = page.locator('[data-document-reader]').first();
      await nativeReader.waitFor({state: 'visible', timeout: args.timeout});
      const previewCount = Number(await nativeReader.getAttribute('data-segment-count'));
      if (previewCount < 1) fail(`${example.name} 加载后没有阅读片段`);
      const firstSource = await page.locator('.document-source').first().textContent();
      if (!firstSource?.includes(example.source)) {
        fail(`${example.name} 首个可翻译片段不正确`);
      }
      if (await page.getByRole('button', {name: '开始翻译'}).count() !== 1) {
        fail(`${example.name} 缺少开始翻译按钮`);
      }
      exampleLoads[example.name] = {
        badge: example.badge,
        previewCount,
        ...(pdfScroll ? {continuousScroll: pdfScroll} : {}),
        ...(pdfZoomState ? {zoomSelection: pdfZoomState} : {}),
      };

      const editableTranslations = page.locator('.document-translation');
      const editableCount = await editableTranslations.count();
      if (editableCount < 1) fail(`${example.name} 缺少可校对译文输入框`);
      const fillCount = isPdf ? Math.min(editableCount, 12) : 1;
      await editableTranslations.evaluateAll((elements, payload) => {
        elements.slice(0, payload.fillCount).forEach((element, index) => {
          element.removeAttribute('disabled');
          element.value = `浏览器回归译文 ${index + 1}：${payload.name}。这是用于验证中文翻译后的自动换行、版面保留、多栏阅读和相邻文本区域不会互相覆盖的回归内容。`;
          element.dispatchEvent(new Event('input', {bubbles: true}));
        });
      }, {name: example.name, fillCount});

      if (['sample.html', 'sample.txt', 'sample.md', 'sample.epub'].includes(example.name)) {
        const frame = page.locator('.rich-preview-frame');
        await frame.waitFor({state: 'visible', timeout: args.timeout});
        const frameBody = frame.contentFrame().locator('body');
        await frameBody.waitFor({state: 'visible', timeout: args.timeout});
        await frameBody.getByText(/浏览器回归译文/u).first().waitFor({state: 'visible', timeout: args.timeout});
        exampleLoads[example.name].previewLayout = example.name === 'sample.epub' ? 'chapter-reader' : 'formatted-article';
      }
      if (example.name === 'sample.docx') {
        if (await page.locator('.docx-page').count() !== 1) fail('DOCX 没有使用页面化文档预览');
        exampleLoads[example.name].previewLayout = 'word-page';
      }
      if (['sample.srt', 'sample.vtt', 'sample.ass', 'sample.ssa', 'sample.lrc'].includes(example.name)) {
        if (await page.locator('.subtitle-document-reader table').count() !== 1) fail(`${example.name} 没有使用字幕时间轴表格`);
        exampleLoads[example.name].previewLayout = 'subtitle-timeline';
      }
      if (example.name === 'sample.json') {
        const firstPath = await page.locator('.json-table-row code').first().textContent();
        if (!firstPath?.startsWith('$.')) fail('JSON 没有显示字符串值路径');
        exampleLoads[example.name].previewLayout = 'json-path-table';
      }

      if (BINARY_EXAMPLES.has(example.name)) {
        const downloadButton = page.getByRole('button', {name: '下载双语文件'});
        await downloadButton.waitFor({state: 'visible', timeout: args.timeout});
        const [download] = await Promise.all([
          page.waitForEvent('download', {timeout: args.timeout}),
          downloadButton.click(),
        ]);
        const downloadPath = path.join(artifactsDir, download.suggestedFilename());
        await download.saveAs(downloadPath);
        exampleLoads[example.name].download = await verifyBinaryDownload(example.name, downloadPath);
        result.downloads.push(downloadPath);
        if (isPdf) {
          await page.locator('.pdf-page-row').nth(pdfPageRows - 1).locator('.pdf-page-column.translated img').waitFor({state: 'visible', timeout: args.timeout});
          const previewDimensions = await page.locator('.pdf-page-column img').evaluateAll(images => images.map(image => ({
            width: image.naturalWidth,
            height: image.naturalHeight,
          })));
          if (previewDimensions.length !== pdfPageRows * 2 || previewDimensions.some(size => size.width <= 0 || size.height <= 0)) {
            fail(`PDF 原页/译页预览没有完整渲染：${previewDimensions.length}/${pdfPageRows * 2}`);
          }
          exampleLoads[example.name].previewLayout = 'continuous-vertical-side-by-side';
        }
      }

      if (example.name === 'sample.pdf') {
        result.assertions.pdfLoadAndExport = 'passed';
        await page.screenshot({path: path.join(artifactsDir, 'document-pdf-reader.png'), fullPage: true});
        result.screenshots.push(path.join(artifactsDir, 'document-pdf-reader.png'));
      }
      if (example.name === 'sample.epub') {
        result.assertions.epubLoadAndExport = 'passed';
        await page.screenshot({path: path.join(artifactsDir, 'document-epub-reader.png'), fullPage: true});
        result.screenshots.push(path.join(artifactsDir, 'document-epub-reader.png'));
      }
      if (example.name === 'sample.docx') {
        result.assertions.docxLoadAndExport = 'passed';
        await page.screenshot({path: path.join(artifactsDir, 'document-docx-reader.png'), fullPage: true});
        result.screenshots.push(path.join(artifactsDir, 'document-docx-reader.png'));
      }

      if (example.name === 'sample.html') {
        result.assertions.htmlLoad = 'passed';
        await page.screenshot({path: path.join(artifactsDir, 'document-html-loaded.png'), fullPage: true});
        result.screenshots.push(path.join(artifactsDir, 'document-html-loaded.png'));
      }
      if (example.name === 'sample.srt') {
        result.assertions.subtitleLoad = 'passed';
        await page.screenshot({path: path.join(artifactsDir, 'document-srt-loaded.png'), fullPage: true});
        result.screenshots.push(path.join(artifactsDir, 'document-srt-loaded.png'));
      }
      if (example.name === 'sample.md') {
        if (await page.locator('.preview-table').count() !== 0) fail('Markdown 文档不应使用表格作为主阅读界面');
        result.assertions.markdownReader = 'passed';
        await page.screenshot({path: path.join(artifactsDir, 'document-markdown-reader.png'), fullPage: true});
        result.screenshots.push(path.join(artifactsDir, 'document-markdown-reader.png'));
      }
    }
    result.assertions.exampleLoads = exampleLoads;

    await selectElementOption(page, '文档翻译服务', 'OpenAI', args.timeout);
    const {listbox: documentModelListbox} = await openElementSelect(page, '文档翻译模型', args.timeout);
    const modelOptions = await documentModelListbox.getByRole('option').count();
    if (modelOptions < 2) fail(`文档翻译模型选项过少：${modelOptions}`);
    await documentModelListbox.getByRole('option', {name: 'gpt-5.4-mini', exact: true}).click();
    const selectedDocumentModel = page.locator('.model-control .el-select__selected-item:not(.el-select__input-wrapper)').filter({hasText: 'gpt-5.4-mini'});
    await selectedDocumentModel.waitFor({state: 'visible', timeout: args.timeout});
    if ((await selectedDocumentModel.textContent())?.trim() !== 'gpt-5.4-mini') fail('文档翻译模型没有保存当前选择');
    result.assertions.documentModelSelection = 'passed';
    await page.screenshot({path: path.join(artifactsDir, 'document-model-selection.png'), fullPage: true});
    result.screenshots.push(path.join(artifactsDir, 'document-model-selection.png'));

    const popup = await newPageWithoutForeground(context, args.timeout);
    captureErrors(popup, 'popup', errors);
    await popup.setViewportSize({width: 400, height: 600});
    await popup.goto(popupUrl, {waitUntil: 'domcontentloaded', timeout: args.timeout});
    await popup.locator('.popup-shell').waitFor({state: 'visible', timeout: args.timeout});
    const popupMetrics = await popup.evaluate(() => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    if (popupMetrics.width > 400 || popupMetrics.height > 600 || popupMetrics.horizontalOverflow) {
      fail(`Popup 布局超出边界：${JSON.stringify(popupMetrics)}`);
    }
    result.assertions.popupMetrics = popupMetrics;
    await popup.screenshot({path: path.join(artifactsDir, 'popup-document-beta.png'), fullPage: true});
    result.screenshots.push(path.join(artifactsDir, 'popup-document-beta.png'));
    const featureOrder = await popup.locator('.feature-card').evaluateAll((cards) => cards.map((card) => ({
      feature: card.getAttribute('data-feature') || card.textContent?.trim() || '',
      text: card.textContent?.trim() || '',
    })));
    const videoIndex = featureOrder.findIndex((item) => item.text.includes('视频字幕'));
    const documentIndex = featureOrder.findIndex((item) => item.feature === 'document-translation');
    if (featureOrder.length !== 6) fail(`Popup 快捷功能卡应为 6 个，实际为 ${featureOrder.length}`);
    if (featureOrder.some((item) => item.text.includes('全文悬浮球'))) fail('Popup 不应显示全文翻译悬浮球设置入口');
    if (await popup.getByRole('switch', {name: '启用或关闭全文翻译悬浮球'}).count() !== 0) {
      fail('Popup 不应保留全文翻译悬浮球设置抽屉');
    }
    if (videoIndex < 0 || documentIndex !== videoIndex + 1) fail('文档翻译卡片必须紧跟在视频字幕卡片下面');
    if (!featureOrder[documentIndex].text.includes('Beta 测试')) fail('文档翻译卡片必须标注 Beta 测试');
    result.assertions.popupFeatures = {
      count: featureOrder.length,
      floatingBallSettingsHidden: true,
      documentBetaAfterVideo: true,
    };

    const optionsPage = await newPageWithoutForeground(context, args.timeout);
    captureErrors(optionsPage, 'options', errors);
    await optionsPage.goto(`${optionsUrl}#settings-advanced`, {waitUntil: 'domcontentloaded', timeout: args.timeout});
    const floatingBallRow = optionsPage.locator('.settings-control-row').filter({hasText: '全文翻译悬浮球'});
    await floatingBallRow.waitFor({state: 'visible', timeout: args.timeout});
    const floatingBallControlCount = await floatingBallRow.getByRole('switch').count();
    if (floatingBallControlCount < 1) {
      fail('完整设置页缺少全文翻译悬浮球开关');
    }
    await optionsPage.screenshot({path: path.join(artifactsDir, 'options-floating-ball-switch.png'), fullPage: true});
    result.screenshots.push(path.join(artifactsDir, 'options-floating-ball-switch.png'));
    await optionsPage.getByRole('button', {name: /交互与快捷键/u}).click();
    const fullPageHotkeyRow = optionsPage.locator('.settings-control-row').filter({hasText: '全文翻译快捷键'});
    await fullPageHotkeyRow.waitFor({state: 'visible', timeout: args.timeout});
    const fullPageHotkeyControlCount = await fullPageHotkeyRow.getByRole('combobox').count();
    if (fullPageHotkeyControlCount < 1) {
      fail('完整设置页缺少全文翻译快捷键控件');
    }
    result.assertions.optionsFloatingBallSettings = {
      switchControls: floatingBallControlCount,
      hotkeyControls: fullPageHotkeyControlCount,
    };
    await optionsPage.screenshot({path: path.join(artifactsDir, 'options-floating-ball-hotkey.png'), fullPage: true});
    result.screenshots.push(path.join(artifactsDir, 'options-floating-ball-hotkey.png'));
    await optionsPage.close();
    const openedPagePromise = context.waitForEvent('page', {timeout: args.timeout});
    await popup.getByRole('button', {name: '打开文档翻译'}).click();
    const openedPage = await openedPagePromise;
    captureErrors(openedPage, 'document-from-popup', errors);
    await openedPage.waitForURL(documentUrl, {timeout: args.timeout});
    await openedPage.locator('.file-drop-zone').waitFor({state: 'visible', timeout: args.timeout});
    result.assertions.popupEntry = 'passed';
    await openedPage.close();
    await popup.close();
    await page.close();

    result.ok = true;
  } finally {
    if (browserHandle) await browserHandle.close().catch(() => undefined);
    else if (context) await context.close().catch(() => undefined);
    fs.rmSync(profileDir, {recursive: true, force: true});
  }

  const runtimeErrors = errors.filter((error) => !isExpectedShutdownNoise(error));
  result.errors = runtimeErrors;
  result.assertions.consoleErrors = runtimeErrors.length;
  if (runtimeErrors.length > 0) {
    result.ok = false;
    fail(`文档页隔离浏览器出现控制台错误：${JSON.stringify(runtimeErrors)}`);
  }

  result.reportPath = path.join(artifactsDir, 'report.json');
  fs.writeFileSync(result.reportPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});
