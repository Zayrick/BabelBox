# FluentRead Feature 目录

FluentRead 的功能模块按“能力边界”组织，而不是按入口脚本堆放：

- `content/`：只保存该 feature 的网页运行时，例如划词、悬浮、圈选或字幕挂载。
- `background/`：只保存该 feature 的后台 handler；消息协议放在 `protocol.ts`。
- `ui/`：保存该 feature 自己的 Vue 组件、composable 和 CSS。
- `services/`：保存该 feature 的消息客户端、远程资源读取或本地处理服务。
- `domain/`：保存不依赖 WXT、Vue 和 browser API 的纯模型与算法。

每个 feature 应优先暴露这些契约：

- `isEnabled()`：只判断配置或运行时条件，不产生副作用。
- `mount(runtime)`：挂载 DOM、监听器、观察器或消息循环。
- `unmount()`：释放本 feature 拥有的资源。
- `isMounted()`：可选，用于异步 UI 挂载的幂等检查。

content 入口通过 `src/app/content/featureRegistry.ts` 提供运行时和生命周期，再由 `src/app/content/features.ts` 暴露给 WXT entrypoint。feature 不直接持有全局入口状态；Vue content overlay 统一使用 `src/platform/shadow-ui` 挂载，组件与 CSS 保留在所属 feature。完整边界见 [架构设计](../../docs/architecture.md)。
