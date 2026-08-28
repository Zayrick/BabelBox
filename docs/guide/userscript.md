# Userscript（油猴脚本）构建

FluentRead 可以从当前 Vue / TypeScript 源码生成一个自包含的 userscript，目标是让 Via、Tampermonkey 和 Violentmonkey 用户获得与浏览器扩展接近的核心网页翻译体验。该方案对应 [Issue #220](https://github.com/FluentRead/FluentRead/issues/220)，目前仍属于实验性构建目标。

## 本地生成

```bash
pnpm install
pnpm build:userscript
```

产物位于：

```text
.output/userscript/fluent-read.user.js
```

这是一个经典 IIFE 单文件，metadata 位于文件开头，不使用 CDN `@require`，CSS、图标、Vue 运行时和 FluentRead 翻译核心均已打包。把该文件导入支持 userscript 的脚本管理器即可。不同 Via / Android WebView 版本的导入入口可能不同，请以当前 Via 版本提供的脚本管理界面为准。

FluentRead 产品版本与 userscript 更新版本是两个不同概念：设置面板会同时显示当前 `package.json` 产品版本（例如 `0.0.31`）和 userscript 版本；metadata 的 `@version` 使用独立 userscript 版本线，首个新版构建为 `2.0.0`。不能直接把 `@version` 改成 `0.0.31`，否则脚本管理器会把它视为低于旧版 `1.31`。发布 userscript 新版本时应单独递增 `userscriptVersion`，产品版本则继续由 `version` 提供。

新版保留旧脚本的 `@name` 与 `@namespace`。当脚本管理器将新旧版本识别为同一脚本并保留原 GM 存储时，首次运行会尽量迁移 2024 版配置，包括语言、悬浮快捷键、服务、模型、普通 Token、自定义 OpenAI / Ollama 地址和提示词。旧根目录 `userscripts.js` 只作为历史实现参考，不再是新版构建源。

## 为什么不是 WXT 直接转换

FluentRead 锁定的 WXT 0.21.4 没有 userscript 入口类型；官方源码只定义了 background、content script、popup、options、sidepanel 等扩展入口。因此 userscript 使用独立 Vite 配置生成 IIFE，但复用当前业务模块，而不是拼接 WXT 的扩展产物。参见 [WXT 0.21.4 类型定义](https://github.com/wxt-dev/wxt/blob/wxt-v0.21.4/packages/wxt/src/types.ts) 与 [WXT Entrypoints](https://wxt.dev/guide/essentials/entrypoints)。

共享与适配边界如下：

| 层 | 浏览器扩展 | Userscript |
| --- | --- | --- |
| DOM 候选、翻译状态、恢复、动态节点 | 共享 `src/core/translation/` 与全文 feature runtime | 同一份代码 |
| 翻译服务与请求模板 | 共享 `src/providers/translation/` | 同一份代码 |
| HTTP | 原生 `fetch` + 扩展 host permissions | `GM_xmlhttpRequest` 的 fetch 兼容层 |
| 配置 | WXT storage | legacy `GM_getValue` / `GM_setValue` |
| 翻译调度与缓存 | 扩展 background | 当前页面内调用共享 broker |
| UI | popup / options / WXT Shadow UI | 页内 Shadow DOM 设置面板与悬浮球 |

Via 官方列出的脚本 API 包含 legacy GM 存储、跨域请求和菜单命令；当前实现以这些 API 作为最低兼容面，不依赖 `GM.*` Promise API。参见 [Via 官方资源中的脚本 API 列表](https://github.com/tuyafeng/Via/blob/master/app/src/main/res/values-zh-rCN/strings.xml#L547-L584)。

## 功能范围

当前 userscript 复用或提供：

- 全文翻译、恢复原文、再次翻译、双语 / 仅译文模式，以及“按阅读进度 / 立即翻译到网页底部”两种范围。
- 动态 DOM、已打开以及脚本启动后动态创建的 open Shadow Root 翻译。
- 鼠标悬浮、双击、长按、中键和触摸手势翻译。
- 划词翻译、复制和浏览器语音回退。
- 输入框翻译。
- 全文悬浮球、翻译进度面板、`Alt + T` / `Option + T` 快捷键和 GM 菜单命令。
- 机器翻译服务目录，以及从供应商列表直接添加的 AI 服务实例；新增实例的模型初始为空，再在服务详情中配置。同一供应商可保存多个模型，并可独立启停或删除。每个实例分别保存名称、模型、Token、自定义端点、代理、提示词和自定义请求体；供应商提供模型列表 API 时会动态加载可输入的模型下拉菜单。
- GM 配置存储和页面内 IndexedDB 翻译缓存。

以下能力只能降级：

- TTS 使用 Web Speech / 页面音频回退，不使用扩展 Offscreen 音频。
- Userscript 在 page-world 执行时会复用扩展的 `attachShadow` / SPA route bridge；若脚本晚于页面脚本注入，已经创建的 closed Shadow Root 仍无法补获。不同脚本管理器的隔离 sandbox 不一定与页面共享 DOM 原型，必须通过对应管理器的真实安装测试确认动态 Shadow Root bridge，而不能只依据桌面 smoke 推断。
- 缓存位于当前网站的 IndexedDB，不能像扩展 background 那样跨所有网站共享；配置和 API Key 仍位于脚本管理器的 GM 存储。
- Android 上的可用 JavaScript / DOM 能力由系统 WebView 决定；当前代码为没有 `WeakRef` 的旧 WebView 提供有界强引用回退。

以下能力依赖浏览器扩展权限，当前 userscript 不提供，设置面板也不会开放入口：

- 浏览器级右键菜单、跨标签页广播和后台 alarms。
- `captureVisibleTab`、Offscreen Document、圈选截图 OCR 与图片翻译。
- Chrome 内置 Translation API。
- YouTube main-world timedtext 桥与视频字幕下载。
- iframe 内单独注入（metadata 使用 `@noframes`，避免每个子框架重复挂载界面）。

因此对外应描述为“核心网页翻译体验接近一致”，不能宣称与扩展所有能力 100% 相同。

## 权限与隐私

metadata 包含 `@connect *`，因为 FluentRead 支持用户自定义 API / 代理地址，构建时无法穷举目标域名。翻译请求只会发送到用户当前选择的服务；API Key 保存在脚本管理器的 GM 存储中，设置面板使用 closed ShadowRoot，常规页面脚本无法通过宿主元素的 `shadowRoot` 直接读取凭据输入框。真实管理器的 sandbox 隔离强度仍需分别验证。

若运行环境没有提供 GM 存储，当前页面会使用只存在于内存中的临时配置，不会回退到网站 `localStorage`，避免污染网站数据。没有 `GM_xmlhttpRequest` 时只能使用原生 fetch，跨域翻译可能被 CORS 阻止。

## 验证

构建与静态验证：

```bash
pnpm test:userscript
node --check .output/userscript/fluent-read.user.js
```

隔离 Edge 烟雾测试使用临时 profile、屏幕外窗口和 deterministic legacy `GM_xmlhttpRequest` 浏览器 shim：

```bash
node scripts/run-userscript-smoke-test.cjs \
  --artifact .output/userscript/fluent-read.user.js \
  --playwright-root <playwright-node_modules> \
  --focus-safe-helper <fluentread-browser-translation-test>/scripts/focus-safe-browser.cjs \
  --artifacts-dir /private/tmp/fluentread-userscript-evidence \
  --background
```

后台模式必须显式传入 `--focus-safe-helper`，或设置 `FLUENTREAD_FOCUS_SAFE_HELPER`。脚本会创建临时 profile，以 LaunchServices 隐藏 CDP 模式启动正常尺寸、屏幕外的 Edge 窗口；不使用最小化窗口、用户日常 profile 或 `bringToFront()`。成功证据会记录 `launchMode`、`focusPolicy` 和 `windowPlacement`。只有在已明确授权前台观察时才使用 `--headed`。

一键回归在确定性 `build:userscript` 与静态验证完成后，会在显式的 `--browser` 门禁下自动运行同一个 smoke：

```bash
pnpm test:regression:all -- --browser \
  --playwright-root <playwright-node_modules> \
  --browser-path "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  --focus-safe-helper <fluentread-browser-translation-test>/scripts/focus-safe-browser.cjs
```

该测试覆盖 closed-Shadow 设置、light-DOM 错误提示样式、悬浮 `[1, 0, 1]`、全文“翻译—恢复—再翻译”、动态 DOM、脚本启动后创建的 open Shadow Root、`pushState` 路由事件、bridge 清理、扩展专属能力禁用、禁止翻译区域和重复译文。测试通过 `page.addScriptTag` 在 page-world 执行产物，只证明生成产物与 legacy GM API 协议能在真实 Edge page-world 中运行，不能代替 Via Android、Tampermonkey 和 Violentmonkey 各自的真实安装与 sandbox 测试。

## 发布前门槛

正式托管 `.user.js` 或添加自动更新地址前，至少分别在以下环境安装验证：

1. Via Android：默认免费服务、GM 配置跨站保留、菜单、全文与悬浮翻译。
2. Tampermonkey：首次安装、从旧 `1.31` 升级、跨域服务、自定义端点。
3. Violentmonkey：IIFE 单文件加载、Shadow UI、配置和跨域请求。

发布和设置 `downloadURL` / `updateURL` 是独立操作；本地构建不会自动上传或覆盖旧 GreasyFork 脚本。
