import { defineConfig } from 'vitepress'
import { ViteImageOptimizer } from 'vite-plugin-image-optimizer'

export default defineConfig({
  title: 'BabelBox · 翻译机',
  description: '让双语阅读自然发生的开源浏览器扩展。',
  lang: 'zh-CN',
  lastUpdated: true,
  base: '/',

  head: [
    ['meta', { name: 'theme-color', content: '#e94872' }],
  ],

  vite: {
    plugins: [
      ViteImageOptimizer({
        png: { quality: 90 },
        jpeg: { quality: 80 },
        jpg: { quality: 80 },
        svg: {
          multipass: true,
          plugins: [{
            name: 'preset-default',
            params: {
              overrides: {
                removeViewBox: false,
                removeEmptyAttrs: false,
              },
            },
          }],
        },
      }),
    ],
  },

  themeConfig: {
    siteTitle: 'BabelBox',
    outline: 'deep',
    search: { provider: 'local' },
    nav: [
      { text: '首页', link: '/' },
      { text: '快速开始', link: '/guide/getting-started' },
      { text: '使用指南', link: '/guide/' },
      { text: '配置', link: '/config/' },
      { text: '架构', link: '/architecture' },
      { text: '测试', link: '/testing' },
      { text: '下载', link: '/guide/getting-started#安装扩展' },
    ],

    sidebar: {
      '/guide/': [
        {
          text: '开始使用',
          items: [
            { text: '认识 BabelBox', link: '/guide/' },
            { text: '安装与第一次翻译', link: '/guide/getting-started' },
            { text: '功能总览', link: '/guide/features' },
            { text: 'Userscript 构建', link: '/guide/userscript' },
            { text: '单词本 Beta', link: '/guide/vocabulary-book' },
            { text: '图片翻译', link: '/guide/image-translation' },
            { text: '数据与隐私', link: '/guide/privacy' },
          ],
        },
        {
          text: '个性化使用',
          items: [
            { text: '自定义快捷键', link: '/guide/custom-hotkey' },
            { text: '常见问题', link: '/guide/faq' },
          ],
        },
      ],
      '/config/': [
        {
          text: '配置 BabelBox',
          items: [
            { text: '设置总览', link: '/config/' },
            { text: '翻译服务', link: '/config/translation-engines' },
          ],
        },
      ],
    },

    socialLinks: [{ icon: 'github', link: 'https://github.com/Zayrick/BabelBox' }],
    footer: {
      message: 'Open source under the GPL-3.0 License.',
      copyright: 'Copyright © 2025-present BabelBox contributors',
    },
  },
})
