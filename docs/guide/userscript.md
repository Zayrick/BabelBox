# Userscript（油猴脚本）构建

BabelBox 可以从当前 Vue / TypeScript 源码生成一个自包含的 userscript，为 Via、Tampermonkey 和 Violentmonkey 提供核心网页翻译体验。userscript 是实验性构建目标。

## 本地生成

```bash
pnpm install
pnpm build:userscript
```

产物位于：

```text
.output/userscript/babelbox.user.js
```

这是一个经典 IIFE 单文件，metadata 位于文件开头，不使用 CDN `@require`，CSS、图标、Vue 运行时和 BabelBox 翻译核心均已打包。把该文件导入支持 userscript 的脚本管理器即可。不同 Via / Android WebView 版本的导入入口可能不同，请以当前 Via 版本提供的脚本管理界面为准。

BabelBox 产品版本与 userscript 更新版本分开管理。设置面板同时显示 `package.json` 中的 `version` 和 `userscriptVersion`，metadata 的 `@version` 使用 `userscriptVersion`。发布 userscript 时单独递增该字段。

脚本的 `@name` 与 `@namespace` 保持稳定。如果脚本管理器保留了同一脚本的 GM 存储，首次运行会导入可识别的语言、快捷键、服务、模型、Token、自定义地址和提示词配置。

## 构建结构

BabelBox 锁定的 WXT 0.21.4 没有 userscript 入口类型。userscript 使用独立 Vite 配置生成 IIFE，并直接复用 `src/` 中的业务模块。参见 [WXT 0.21.4 类型定义](https://github.com/wxt-dev/wxt/blob/wxt-v0.21.4/packages/wxt/src/types.ts) 与 [WXT Entrypoints](https://wxt.dev/guide/essentials/entrypoints)。

共享与适配边界如下：

| 层 | 浏览器扩展 | Userscript |
| --- | --- | --- |
| DOM 候选、翻译状态、恢复、动态节点 | 共享 `src/core/translation/` 与全文 feature runtime | 同一份代码 |
| 翻译服务与请求模板 | 共享 `src/providers/translation/` | 同一份代码 |
| HTTP | 原生 `fetch` + 扩展 host permissions | `GM_xmlhttpRequest` 的 fetch 兼容层 |
| 配置 | WXT storage | `GM_getValue` / `GM_setValue` |
| 翻译调度与缓存 | 扩展 background | 当前页面内调用共享 broker |
| UI | popup / options / WXT Shadow UI | 页内 Shadow DOM 设置面板与悬浮球 |

Via 官方列出的脚本 API 包含 GM 存储、跨域请求和菜单命令；当前实现以这些 API 作为最低兼容面，不依赖 `GM.*` Promise API。参见 [Via 官方资源中的脚本 API 列表](https://github.com/tuyafeng/Via/blob/master/app/src/main/res/values-zh-rCN/strings.xml#L547-L584)。

## 功能范围

当前 userscript 复用或提供：

- 全文翻译、恢复原文、再次翻译、双语 / 仅译文模式，以及“按阅读进度 / 立即翻译到网页底部”两种范围。
- 动态 DOM、已打开以及脚本启动后动态创建的 open Shadow Root 翻译。
- 鼠标悬浮、双击、长按、中键和触摸手势翻译。
- 划词翻译、复制和浏览器语音回退。
- 输入框翻译。
- 可编辑的全局内容过滤与当前网站覆盖规则，包括隐藏/可编辑内容开关和 CSS 选择器。
- 全文悬浮球、翻译进度面板、`Alt + T` / `Option + T` 快捷键和 GM 菜单命令。
- 机器翻译服务目录，以及从供应商列表直接添加的 AI 服务实例；新增实例的模型初始为空，再在服务详情中配置。同一供应商可保存多个模型，并可独立启停或删除。每个实例分别保存名称、模型、Token、自定义端点、代理、提示词和自定义请求体；供应商提供模型列表 API 时会动态加载可输入的模型下拉菜单。
- GM 配置存储和页面内 IndexedDB 翻译缓存。

以下能力只能降级：

- TTS 使用 Web Speech / 页面音频回退，不使用扩展 Offscreen 音频。
- Userscript 在 page-world 执行时会复用扩展的 `attachShadow` / SPA route bridge；若脚本晚于页面脚本注入，已经创建的 closed Shadow Root 仍无法补获。不同脚本管理器的隔离 sandbox 不一定与页面共享 DOM 原型，必须通过对应管理器的真实安装测试确认动态 Shadow Root bridge，而不能只依据桌面 smoke 推断。
- 缓存位于当前网站的 IndexedDB，不能像扩展 background 那样跨所有网站共享；配置和 API Key 仍位于脚本管理器的 GM 存储。
- Android 上的 JavaScript / DOM 能力由系统 WebView 决定；运行环境需提供当前源码使用的标准 Web API，包括 `WeakRef`。

以下能力依赖浏览器扩展权限，当前 userscript 不提供，设置面板也不会开放入口：

- 浏览器级右键菜单、跨标签页广播和后台 alarms。
- `captureVisibleTab`、Offscreen Document、圈选截图 OCR 与图片翻译。
- Chrome 内置 Translation API。
- YouTube main-world timedtext 桥与视频字幕下载。
- iframe 内单独注入（metadata 使用 `@noframes`，避免每个子框架重复挂载界面）。

因此对外应描述为“核心网页翻译体验接近一致”，不能宣称与扩展所有能力 100% 相同。

## 权限与隐私

metadata 包含 `@connect *`，因为 BabelBox 支持用户自定义 API / 代理地址，构建时无法穷举目标域名。翻译请求只会发送到用户当前选择的服务；API Key 保存在脚本管理器的 GM 存储中，设置面板使用 closed ShadowRoot，常规页面脚本无法通过宿主元素的 `shadowRoot` 直接读取凭据输入框。真实管理器的 sandbox 隔离强度仍需分别验证。

若运行环境没有提供 GM 存储，当前页面会使用只存在于内存中的临时配置，不会回退到网站 `localStorage`，避免污染网站数据。没有 `GM_xmlhttpRequest` 时只能使用原生 fetch，跨域翻译可能被 CORS 阻止。

## 验证

构建与静态验证：

```bash
pnpm test:userscript
node --check .output/userscript/babelbox.user.js
```

隔离 Edge 烟雾测试使用临时 profile、屏幕外窗口和确定性 `GM_xmlhttpRequest` 浏览器 shim：

```bash
node scripts/run-userscript-smoke-test.cjs \
  --artifact .output/userscript/babelbox.user.js \
  --playwright-root <playwright-node_modules> \
  --focus-safe-helper <babelbox-browser-translation-test>/scripts/focus-safe-browser.cjs \
  --artifacts-dir /private/tmp/babelbox-userscript-evidence \
  --background
```

后台模式必须显式传入 `--focus-safe-helper`，或设置 `BABELBOX_FOCUS_SAFE_HELPER`。脚本会创建临时 profile，以 LaunchServices 隐藏 CDP 模式启动正常尺寸、屏幕外的 Edge 窗口；不使用最小化窗口、用户日常 profile 或 `bringToFront()`。成功证据会记录 `launchMode`、`focusPolicy` 和 `windowPlacement`。只有在已明确授权前台观察时才使用 `--headed`。

一键回归在确定性 `build:userscript` 与静态验证完成后，会在显式的 `--browser` 门禁下自动运行同一个 smoke：

```bash
pnpm test:regression:all -- --browser \
  --playwright-root <playwright-node_modules> \
  --browser-path "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  --focus-safe-helper <babelbox-browser-translation-test>/scripts/focus-safe-browser.cjs
```

测试通过 `page.addScriptTag` 在 Edge page-world 执行生成产物，验证主要翻译、恢复、动态 DOM、Shadow DOM 和清理路径。它不能代替 Via Android、Tampermonkey 和 Violentmonkey 各自的真实安装与 sandbox 测试。

## 发布前门槛

正式托管 `.user.js` 或添加自动更新地址前，至少分别在以下环境安装验证：

1. Via Android：默认免费服务、GM 配置跨站保留、菜单、全文与悬浮翻译。
2. Tampermonkey：首次安装、更新现有安装、跨域服务、自定义端点。
3. Violentmonkey：IIFE 单文件加载、Shadow UI、配置和跨域请求。

发布和设置 `downloadURL` / `updateURL` 是独立操作；本地构建不会自动上传。
