# 测试与回归

BabelBox 按风险选择验证范围。测试保护用户行为、公开契约、真实缺陷和安全边界，不以测试数量或覆盖率数字作为完成标准。

## 常用命令

```bash
pnpm test                    # 全部 Vitest 测试
pnpm test:architecture       # 模块依赖边界
pnpm test:coverage           # 覆盖率报告，用于发现盲区
pnpm test:document           # 文档解析、翻译与导出
pnpm test:translation-core   # 全文翻译核心与队列
pnpm compile                 # TypeScript/Vue 类型检查
pnpm build                   # Chrome/Edge 扩展构建
pnpm build:firefox           # Firefox 扩展构建
pnpm test:userscript         # Userscript 构建与产物校验
pnpm docs:build              # 文档构建
```

改动局部纯函数时先运行对应测试文件；涉及公共消息、配置、翻译服务或内容脚本生命周期时运行 `pnpm test`。入口、manifest 或共享浏览器代码还要运行双浏览器构建；共享翻译代码同时验证 userscript。

## 测试取舍

- 一条测试覆盖一个可说明的行为，不按实现中的每个条件分支拆测试。
- 回归测试保留能让旧缺陷重现的最小场景；同一场景已由更高层测试覆盖时不再复制。
- 网络、浏览器、存储、时间等外部边界可以替换；模块内部协作优先使用真实实现。
- 配置导入、网页消息、文档文件和 provider 响应属于不可信输入，需要验证；内部类型已经保证的状态不重复防御。
- 不用源码字符串、注释格式、文件行数或旧实现是否消失来代替行为断言。架构测试只检查会影响依赖方向的规则。

覆盖率报告不设全仓百分比门槛。低覆盖可以提示风险，但是否补测试取决于代码的重要性、变化频率和失败影响；不能为了命中行或分支而增加无产品意义的输入、回退或测试。

## 一键回归

```bash
pnpm test:regression:all
```

默认流水线依次执行 WXT prepare、类型检查、一次完整 Vitest、Chrome/Firefox/userscript 构建与校验，以及文档构建。它不会重复执行同一套测试，也不会默认启动浏览器或访问真实网络。

真实浏览器层必须显式开启，并使用临时 profile、屏幕外正常尺寸窗口和 focus-safe helper：

```bash
pnpm test:regression:all -- --browser \
  --playwright-root <path> \
  --browser-path <path> \
  --focus-safe-helper <path>
```

真实站点矩阵还需要 `--network --allow-network`。报告应分别说明确定性回归、隔离浏览器回归和真实网络矩阵是否执行，不能把未运行的层写成已通过。
