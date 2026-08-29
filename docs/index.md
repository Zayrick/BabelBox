---
layout: home

hero:
  name: BabelBox
  text: 让双语阅读自然发生
  tagline: 一个开源、可定制、以阅读体验为中心的浏览器翻译扩展。保留原文结构，在你真正需要的地方呈现译文。
  actions:
    - theme: brand
      text: 立即开始
      link: /guide/getting-started
    - theme: alt
      text: 查看功能
      link: /guide/features
    - theme: alt
      text: GitHub
      link: https://github.com/Zayrick/BabelBox

features:
  - title: 页面翻译
    details: 按段落生成双语内容，阅读长文、文档和新闻时不打断原页面结构。
  - title: 选中即译
    details: 只翻译你关心的句子或术语，不必等待整页处理完成。
  - title: 多种翻译服务
    details: 支持免费服务、Microsoft、DeepL、Google、AI 服务和本地 Ollama。
  - title: 图片文字识别
    details: 对图片中的文字进行识别和翻译，适合截图、漫画和扫描资料。
  - title: 可恢复、可重译
    details: 随时恢复原文，也可以更换服务或目标语言后重新翻译。
  - title: 隐私优先
    details: 不内置账号体系；云端和免费翻译会把待翻译文本发送给对应第三方服务，本地模式可减少出站。
---

<div class="home-section">

## 核心工作流

1. 打开普通网页或受支持的本地文档。
2. 在弹窗中选择源语言、目标语言和翻译服务。
3. 执行全文、划词、悬浮、图片、圈选、文档或视频字幕翻译。
4. 在原内容附近阅读译文，随时恢复原文或更换配置后重译。

BabelBox 不要求跳转到独立翻译网站。全文译文会放回原段落附近，局部功能则只处理当前选择的内容。

## 界面与配置

弹窗负责当前页面的高频操作；完整设置页负责阅读偏好、翻译服务与模型、快捷键、网站规则、图片翻译、单词本、高级行为和配置历史。服务凭据按实例隔离，默认保存在本机加密保险库中；共享设备上也可切换为仅本次会话。

## 从这里开始

<div class="link-grid">
  <a class="link-card" href="/guide/getting-started">
    <strong>第一次使用</strong>
    <span>从安装到完成第一次翻译，只需要几分钟。</span>
  </a>
  <a class="link-card" href="/config/translation-engines">
    <strong>选择翻译服务</strong>
    <span>了解免费服务、云端 API、AI 和本地模型的差异。</span>
  </a>
  <a class="link-card" href="/guide/faq">
    <strong>遇到问题</strong>
    <span>从“点击后没反应”到 Ollama 配置，按现象快速排查。</span>
  </a>
</div>

## 开源项目

BabelBox 使用 GPL-3.0 许可证发布。欢迎通过 GitHub 提交问题、改进建议或代码贡献。

BabelBox 基于上游 [FluentRead](https://github.com/FluentRead/FluentRead) 继续开发，感谢原项目及所有贡献者。

如希望支持公益，可前往 [UNICEF](https://www.unicef.org/) 为联合国儿童基金会作贡献。

</div>
