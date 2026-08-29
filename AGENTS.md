# BabelBox 开发规则

## 项目定位

- BabelBox 是主要开发目标：一款提供全文双语翻译、划词翻译和多翻译服务支持的浏览器扩展。
- 上级工作区仅用于参考。需求未指名其他项目时，一律在本项目实现。

## 技术基线

- 保持现有技术栈：WXT 0.21、Vue 3、TypeScript、Element Plus 和 pnpm 12。当前锁文件使用 WXT 0.21.4，本地与 CI 使用 Node.js `^22.13 || >=24`；未经明确升级任务，不按新版文档擅自使用仅在更高版本存在的 API。
- 遵循 [架构设计](docs/architecture.md) 的单向模块边界：
  - `entrypoints/`：WXT 文件式入口，只绑定生命周期并组装 `src/app`。
  - `src/app/`：background/content/popup/options/document/offscreen 的静态 composition root；`userscript/` 是独立发布出口。
  - `src/features/`：全文、悬浮、划词、输入框、词书、图片、区域、文档和视频等纵向业务。
  - `src/core/`：翻译候选、快捷键、OCR 等无浏览器副作用的纯算法。
  - `src/services/`：翻译、缓存、配置等跨 feature 编排。
  - `src/providers/` 与 `src/platform/`：供应商适配和浏览器/存储/HTTP/offscreen 边界。
  - `src/shared/` 与 `src/ui/`：无业务语义的小型工具和复用 UI/token。
- `entrypoints/` 只保留 WXT 入口；内部模块统一从 `src` 的实际归属路径导入，不保留项目内部旧路径兼容壳。
- 新功能应复用现有配置、消息、翻译服务和挂载机制，避免另建一套并行状态或通信体系。
- 内容脚本运行在任意网页中。新增 DOM、样式和事件时使用 BabelBox 专属命名，避免污染宿主页面；卸载、关闭或页面离开时清理监听器、计时器、观察器、挂载节点和未完成请求。
- 浏览器 API 统一从 WXT 的 `wxt/browser` 导入 `browser`，并同时考虑 Chrome、Edge 和 Firefox 的行为差异。
- API 密钥、令牌和用户配置只能按现有本地存储方案处理，不写入日志、源码、测试夹具或提交内容。

## WXT 官方依据

- WXT 是 BabelBox 的浏览器扩展开发框架。涉及入口、manifest、构建、浏览器目标、内容脚本、后台脚本、扩展 UI、存储、消息通信或 WXT 配置时，优先查阅官方资料：
  - 官网与文档：<https://wxt.dev/>
  - WXT API 参考：<https://wxt.dev/api/reference/wxt/>
  - 官方示例：<https://wxt.dev/examples.html>
  - 安装与入门指南：<https://wxt.dev/guide/installation.html>
  - 官方源码：<https://github.com/wxt-dev/wxt>
- 官方文档和源码是 WXT 行为的权威依据；参考项目、博客、搜索结果和既有印象只能作为补充。
- 使用官方文档前先核对 BabelBox 锁定的 WXT 版本。若当前文档描述的是更高版本，应查对应版本的源码、类型定义或变更记录，不能假设 API 向下兼容。
- 遵循 WXT 的文件式入口和构建约定，优先使用 WXT 提供的 `defineBackground`、`defineContentScript`、配置、manifest 与跨浏览器构建能力，不重复搭建框架已经提供的基础设施。
- 新增入口或浏览器能力时，同时检查生成的 manifest、所需权限、Chrome/Edge/Firefox 差异，以及 MV2/MV3 生命周期差异。

## 实现原则

- 只实现需求直接需要的行为。相邻问题没有明确证据或不影响本次目标时，不顺手扩功能、增加抽象或建立平行机制。
- 修复问题时处理根因，并验证与根因直接相关的用户路径；不为假想输入、不可达状态或没有恢复价值的失败层层增加回退。
- 引入新的翻译服务时放入 `src/providers/translation/`，通过 provider registry 与 `src/services/translation` 接入；补齐配置可见性、错误处理和调用路径，不在 UI 组件中直接散落网络请求。
- 从参考项目借鉴功能时，将概念适配为 Vue/TypeScript 实现；不要引入 React 专用依赖或跨仓库运行时耦合。
- 控制改动范围，不顺手重写无关代码；除非任务需要，不升级依赖或改变构建工具。
- 用户可见行为变化同步更新相关文档；版本号和发布产物仅在用户明确要求发布时修改。
- 注释解释代码本身无法表达的约束、原因或所有权，不复述文件名、类型和语句。文档只描述当前产品与当前约束；被否决的方案、迁移过程和“没有做什么”不留在正式文档中，除非它仍是公开兼容或安全边界的一部分。

## 验证

- 测试分组、覆盖率定义和一键回归以 [测试与回归](docs/testing.md) 为准。
- 按改动选择最小相关 Vitest 文件或 `pnpm test`；架构边界使用 `pnpm test:architecture`。
- 测试优先覆盖用户可见行为、公开契约、真实回归和安全边界。不要按每个分支、守卫或回退各写一条测试，也不要用源码字符串、注释格式、行数或已删除实现的缺席代替行为断言。
- `pnpm test:coverage` 用于发现风险盲区，不以追求 100% 或满足指标为由增加无行为价值的测试和分支。
- 使用 `pnpm compile` 做 TypeScript/Vue 类型检查。
- 涉及扩展构建或入口行为时同时运行 `pnpm build` 与 `pnpm build:firefox`；共享翻译或平台代码还要运行 `pnpm build:userscript` 和 userscript verifier。
- 涉及文档时运行 `pnpm docs:build`。
- `pnpm test:regression:all` 执行确定性的一键回归。真实浏览器层必须显式开启，使用临时 profile、屏幕外正常尺寸窗口和 focus-safe helper；不得连接用户日常 profile、最小化窗口或调用 `bringToFront()`。
- 自动化按键名称使用标准 `Control`，不要使用 `CTRL`；浏览器报告必须说明 launch mode、focus policy、window placement、执行范围与证据目录。
- 不把参考项目自身的测试通过视为 BabelBox 的验证结果。
