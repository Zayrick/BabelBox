<div align="center">

# BabelBox · 翻译机

### 让每个网页都自然地读起来。

一款开源浏览器翻译插件，提供网页双语阅读、即时划词翻译和灵活的翻译服务配置。

**[安装](#安装)** · **[功能](#你可以用它做什么)** · **[项目文档](../docs/index.md)** · **[English](../README.md)**

</div>

翻译机把翻译放回阅读流程：可以保留原文与译文对照，只翻译当前需要的句子，也可以不离开当前页面完成全文翻译。你可以选择传统翻译服务、AI 服务或内置的免费回退服务，并按照自己的阅读习惯调整样式与快捷键。

## 你可以用它做什么

| 读得自然 | 控制得细致 |
| --- | --- |
| **网页双语阅读**：原文与译文同时保留，适合学习、研究和技术阅读。 | **多种翻译服务**：支持微软、谷歌、DeepL、DeepLX、Chrome 内置翻译，以及 OpenAI、DeepSeek、Gemini、Claude、Kimi、Ollama 兼容接口等 AI 服务。 |
| **全文翻译**：通过悬浮球、右键菜单或自定义快捷键翻译和恢复网页，并可选择按阅读进度或立即翻译当前已加载内容到网页底部；不会自动滚动，后续新增内容仍会继续翻译。 | **自定义模型与接口**：在设置页配置兼容 API、模型、提示词、请求体、代理和密钥。 |
| **划词翻译**：选中文本后打开聚焦的翻译卡片，支持复制和朗读。 | **隐私控制**：设置和缓存位于扩展私有存储；API 凭据默认仅保留当前会话，云端翻译会把文本发送给所选服务。 |
| **悬浮与手势触发**：支持鼠标悬停、双击、长按、中键和触屏手势。 | **阅读体验可调**：可以调整译文样式、主题、动画、缓存、并发，以及全文和划词翻译的独立快捷键。 |

### 还包括

- **免费翻译服务**：内置微软 → DeepLX → 谷歌的回退链；仅在服务报错或返回空结果时进入下一项。
- **图片翻译（Beta）**：使用本地 OCR 识别图片文字，按需下载语言包，并用可恢复的覆盖层显示译文。
- **翻译缓存**：按服务、模型、语言对和请求配置复用近期结果。
- **数据说明**：查看[数据与隐私](../docs/guide/privacy.md)，了解各功能发送和保存哪些数据。
- **跨浏览器支持**：基于 WXT 和 Manifest V3 构建 Chromium 浏览器与 Firefox 版本。

## 界面结构

弹窗集中放置启用或暂停翻译、语言与服务选择、当前页面翻译或恢复，以及各功能的快捷入口。完整设置页按阅读偏好、翻译服务与模型、快捷键、网站规则、图片翻译、单词本、高级行为和配置历史分区。

## 安装

从 [GitHub Releases](https://github.com/Zayrick/BabelBox/releases) 下载适合目标浏览器的 BabelBox 构建产物，或从源码本地构建。

如果需要本地构建，请使用 pnpm 安装依赖，然后把生成的 `./.output/chrome-mv3` 目录作为“已解压的扩展程序”加载。详细配置请查看[安装文档](../docs/guide/getting-started.md)。

## 项目入口

- [项目文档](../docs/index.md)：功能、安装、翻译服务、快捷键和常见问题。
- [GitHub Issues](https://github.com/Zayrick/BabelBox/issues)：反馈问题或提出建议。
- [UNICEF](https://www.unicef.org/)：为联合国儿童基金会作贡献。

## 开发

```bash
pnpm install
pnpm dev
pnpm test
pnpm test:architecture
pnpm compile
pnpm build
```

`pnpm test:regression:all` 会执行类型检查、一次完整测试、Chrome/Firefox/userscript 构建和文档构建。覆盖率可单独使用 `pnpm test:coverage` 查看；隔离真实浏览器与真实网络矩阵使用显式安全门禁。贡献功能前请阅读[架构设计](../docs/architecture.md)和[测试说明](../docs/testing.md)。

翻译机使用 Vue 3、TypeScript、Element Plus 和 WXT，面向 Chromium Manifest V3 与 Firefox Manifest V2 构建，项目遵循 [GPL-3.0](../LICENSE) 开源许可证。

## 上游致谢

BabelBox 基于上游 [FluentRead](https://github.com/FluentRead/FluentRead) 继续开发。感谢原项目维护者与所有贡献者，归属说明见 [UPSTREAM.md](../UPSTREAM.md)。
