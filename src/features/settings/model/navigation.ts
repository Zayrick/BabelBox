export type NavigationItem = {
  id: string
  icon: string
  label: string
  description: string
  group: string
  heading: string
  summary: string
  kicker: string
  title: string
  detail: string
  searchDescription: string
}

export type NavigationGroup = {
  label: string
  items: NavigationItem[]
}

export const navigationGroups: NavigationGroup[] = [
  {
    label: '基础设置',
    items: [
      {
        id: 'settings-general', icon: '⌂', label: '通用设置', description: '状态与显示', group: '基础设置',
        heading: '调整你的阅读体验', summary: '管理插件状态、翻译模式和译文的基础显示方式。',
        kicker: '阅读偏好', title: '通用设置', detail: '常用开关集中在这里，修改后会自动保存。',
        searchDescription: '插件启停、双语模式、译文样式与主题',
      },
      {
        id: 'settings-services', icon: '译', label: '翻译服务', description: '服务与模型', group: '基础设置',
        heading: '配置翻译服务与模型', summary: '按机器翻译和 AI 翻译分类，配置之后网页翻译默认使用的服务、模型及连接参数。',
        kicker: '翻译能力', title: '翻译服务与模型', detail: '配置网页翻译默认使用的服务、模型和连接参数。',
        searchDescription: '微软翻译、OpenAI、DeepSeek、Gemini、模型与令牌',
      },
    ],
  },
  {
    label: '翻译工具',
    items: [
      {
        id: 'settings-translation-center', icon: '译', label: '翻译中心', description: '多服务对比', group: '翻译工具',
        heading: '比较不同翻译服务', summary: '输入一句话，同时查看多个翻译服务的结果，并支持重复翻译。',
        kicker: '翻译工具', title: '翻译中心', detail: '用同一句话比较不同服务的译文表现。',
        searchDescription: '多服务翻译、翻译对比、重复翻译、句子翻译',
      },
    ],
  },
  {
    label: '学习工具',
    items: [
      {
        id: 'settings-vocabulary', icon: '★', label: '单词本 Beta', description: '收藏与复习', group: '学习工具',
        heading: '把阅读中遇到的词真正学会', summary: '收藏划词卡中的英文单词，用轻量复习跟踪从新词到掌握的过程。',
        kicker: '本地学习 Beta', title: '单词本', detail: '词条、上下文与复习记录只保存在当前浏览器中，可独立导出和迁移。',
        searchDescription: '单词本、收藏、复习、掌握程度、学习记录、Anki、导入导出',
      },
    ],
  },
  {
    label: '阅读工具',
    items: [
      {
        id: 'settings-shortcuts', icon: '⌘', label: '交互与快捷键', description: '悬停、划词、全文', group: '阅读工具',
        heading: '让翻译顺手发生', summary: '统一设置鼠标悬停、划词和全文翻译的触发习惯。',
        kicker: '操作方式', title: '交互与快捷键', detail: '为高频动作选择容易记忆且不冲突的触发方式。',
        searchDescription: '鼠标悬停、划词翻译、划词显示延迟、全文翻译范围、翻译到网页底部、右键全文翻译与自定义按键',
      },
      {
        id: 'settings-sites', icon: '站', label: '网站规则', description: '自动翻译与禁用名单', group: '阅读工具',
        heading: '管理网站规则', summary: '按网站主域名设置始终翻译或禁用扩展，也可选择让所有网站自动开始翻译。',
        kicker: '网站规则', title: '网站规则', detail: '名单按主域名保存，并自动应用到同一网站的所有子域。',
        searchDescription: '网站、域名、网址、主域名、自动翻译、始终翻译、禁用扩展与子域',
      },
      {
        id: 'settings-image-translation', icon: '图', label: '图片翻译', description: 'OCR 与语言包', group: '阅读工具',
        heading: '管理图片翻译语言', summary: '图片翻译使用本地 OCR。首次识别前，请下载对应的语言包。',
        kicker: 'Beta 测试', title: '图片翻译', detail: '按需下载 OCR 语言包；推荐先下载简体中文和 English。',
        searchDescription: '图片翻译、OCR、语言包、中文、英文、日文、下载',
      },
      {
        id: 'settings-video', icon: 'CC', label: '视频字幕 Beta 测试', description: 'YouTube 边看边译', group: '阅读工具',
        heading: '边看边译视频字幕', summary: '在 YouTube 原生字幕下方显示译文，并独立选择视频翻译服务。',
        kicker: 'FluentRead 视频翻译 Beta 测试', title: 'FluentRead YouTube 视频字幕', detail: '只处理播放器已经提供的字幕文本，不上传音频或视频内容。',
        searchDescription: 'YouTube、视频字幕、视频翻译服务、DeepLX、微软翻译',
      },
    ],
  },
  {
    label: '系统与数据',
    items: [
      {
        id: 'settings-advanced', icon: '◇', label: '高级选项', description: '性能与模板', group: '系统与数据',
        heading: '精细控制运行方式', summary: '管理缓存、动画、并发、悬浮工具、代理和 AI 提示词。',
        kicker: '运行策略', title: '高级选项', detail: '这些设置更偏向性能、兼容性和高级翻译行为。',
        searchDescription: '缓存、动画、并发、显示翻译进度面板、悬浮球、输入框、代理与提示词',
      },
      {
        id: 'settings-data', icon: '⇅', label: '配置管理', description: '导入与导出', group: '系统与数据',
        heading: '备份与迁移配置', summary: '导出当前设置，或从已有配置恢复你的使用习惯。',
        kicker: '数据工具', title: '配置管理', detail: '通过 JSON 完成配置备份、迁移与恢复。',
        searchDescription: '备份、迁移、导出与导入 JSON 配置',
      },
    ],
  },
  {
    label: '关于',
    items: [
      {
        id: 'settings-about', icon: 'i', label: '关于流畅阅读', description: '版本与项目', group: '关于',
        heading: '关于流畅阅读', summary: '了解插件版本、核心体验与项目入口。',
        kicker: '关于项目', title: '关于流畅阅读', detail: '一个让双语阅读更自然的开源浏览器翻译插件。',
        searchDescription: '版本、开源项目、使用文档与问题反馈',
      },
    ],
  },
]

export const navigationItems = navigationGroups.flatMap((group) => group.items)

export const DEFAULT_NAVIGATION_SECTION = navigationItems[0].id

/** 根据 section id 返回有效导航项，无效值稳定回落到通用设置。 */
export function resolveNavigationItem(sectionId: string): NavigationItem {
  return navigationItems.find((item) => item.id === sectionId) ?? navigationItems[0]
}

/** 统一解析 URL hash，避免入口组件重复维护导航校验。 */
export function resolveRequestedSection(hash: string): string {
  const requestedSection = hash.startsWith('#') ? hash.slice(1) : hash
  return navigationItems.some((item) => item.id === requestedSection)
    ? requestedSection
    : DEFAULT_NAVIGATION_SECTION
}

/** 搜索设置标题、分组说明和帮助文案；空查询不展示结果面板。 */
export function filterNavigationItems(query: string): NavigationItem[] {
  const keyword = query.trim().toLocaleLowerCase()
  if (!keyword) return []

  return navigationItems.filter((item) =>
    `${item.label}${item.description}${item.heading}${item.summary}${item.searchDescription}`
      .toLocaleLowerCase()
      .includes(keyword),
  )
}
