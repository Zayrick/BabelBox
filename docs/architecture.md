# BabelBox 架构设计

BabelBox 使用 WXT 0.21、Vue 3 和 TypeScript。目录按运行时入口、业务能力和外部边界划分。

## 目录职责

```text
entrypoints/                 WXT 文件式入口，只声明元数据并启动 app
src/
  app/                       各运行上下文的静态组装根
  features/                  用户可感知的纵向业务
  core/                      无浏览器副作用的纯规则和算法
  services/                  跨 feature 的翻译与配置编排
  providers/                 翻译供应商协议适配
  platform/                  浏览器、存储、HTTP、offscreen 和 Shadow UI 边界
  shared/                    无业务语义的小型工具
  ui/                        跨 feature 复用的组件、样式和 view-model
userscript/                  独立发布出口，复用 core、services 与 providers
```

复杂 feature 可以按需使用 `background/`、`content/`、`core/`、`services/` 和 `ui/` 子目录；简单能力保持单文件或扁平目录。

## 依赖边界

- `entrypoints/` 中的产品代码只进入 `src/app/`。
- `src/` 不反向依赖 `entrypoints/`。
- `core`、`shared` 和 `platform` 不依赖 app、feature、service、provider 或 UI 业务层。
- `services` 不依赖 app、feature 或 UI；`providers` 不依赖 app、feature 或 UI。
- feature 之间只通过 `public.ts` 或 `protocol.ts` 协作，不读取另一个 feature 的内部文件。
- app 负责静态注册和依赖注入，不承载可复用业务规则。
- 禁止跨文件循环依赖。

这些边界由 `tests/architecture/moduleBoundaries.test.ts` 检查。

## WXT 入口与运行上下文

WXT 会把 `entrypoints/` 下零层或一层的入口作为构建输入，并在构建阶段于 Node 环境导入 TypeScript 入口。因此：

- background/content 的浏览器副作用放在 `main()` 或其调用链中，模块顶层保持可导入。
- background、content、popup/options、document 和 offscreen 分别拥有静态组装根，不使用运行时目录扫描或万能 barrel。
- MV3 background 允许随时重启；需要跨重启的数据进入 storage 或 IndexedDB。
- offscreen 由 background 管理，content 和 UI 通过类型化消息请求能力。
- content 生命周期使用 WXT `ContentScriptContext` 与 `AbortSignal`；卸载时释放 DOM、事件、计时器、观察器和未完成请求。
- manifest 或入口变化同时核对 Chrome/Edge MV3 与 Firefox MV2 的权限和产物。

参考：[WXT Entrypoints](https://wxt.dev/guide/essentials/entrypoints)、[Content Scripts](https://wxt.dev/guide/essentials/content-scripts)、[Project Structure](https://wxt.dev/guide/essentials/project-structure)。项目锁定 WXT 0.21.4，使用新 API 前先核对对应版本的类型或源码。

## Feature 生命周期

content feature 使用最小静态契约：

```ts
interface ContentFeatureDefinition {
  id: string
  isEnabled(): boolean
  mount(runtime: ContentFeatureRuntime): void | Promise<void>
  unmount?(): void
  isMounted?(): boolean
}
```

运行时按注册顺序挂载启用的 feature，并在激活失效时反向卸载。异步挂载和翻译结果必须验证当前请求或当前 activation 的所有权，避免旧页面请求写回新页面。单个可选 feature 的失败可以隔离。

background handler 通过 `src/platform/browser/messageRouter.ts` 的通用契约注册。业务协议由各 feature 或 service 自己定义，app/background 只负责组装、分发和统一错误响应。

## 翻译链路

```text
feature
  -> services/translation/client
  -> background message handler
  -> translation broker
  -> provider registry
  -> provider adapter
  -> HTTP/offscreen platform
```

翻译缓存身份包含会改变结果的服务、模型、端点、语言、prompt/context 与 transport profile。缓存失败降级为未命中；provider 错误不得写入缓存。background 与 userscript 复用同一 broker 和 provider 规则。

供应商网络实现位于 `src/providers/translation/`。新增服务通过 registry 接入，并同步提供配置可见性、凭据错误和连接测试；UI 不直接发起供应商请求。

## 配置与消息

- `src/core/config`：类型、默认值和纯 normalize/validate 规则。
- `src/services/config`：持久化、历史、保存顺序与凭据协调。
- `src/platform/storage`：受信任上下文和浏览器存储边界。

网页消息和导入文件是不可信输入，在最靠近边界的位置解析一次；模块内部使用已经验证的类型。API 密钥和令牌只进入现有凭据存储，不写入日志、源码、测试夹具或普通配置导出。

## UI 与样式

- extension page 的共享视觉 token 位于 `src/ui/styles/`。
- 设置页和 popup 每个视图只保留一个主标题；同一组设置只使用一层 surface，组内通过分隔线表达关系，不重复套卡片。
- 装饰性渐变不用于页面背景、普通按钮或设置容器；阴影仅用于需要脱离页面层级的弹窗、抽屉和浮层。译文效果等用户主动选择的内容预览不受此限制。
- 页面间距优先使用 4、8、12、16、24、32px，普通控件圆角使用 8px，分组容器使用 12px，避免为单个页面引入新的视觉尺度。
- content overlay 使用 BabelBox 专属命名，并通过 Shadow DOM 或 WXT UI 隔离宿主页面。
- 复用组件进入 `src/ui/components`；只服务一个 feature 的组件留在该 feature 的 `ui/`。
- Vue 页面负责组合和交互，翻译、存储与消息规则放在对应 service、feature 或 platform 模块。

测试策略见[测试与回归](./testing.md)。
