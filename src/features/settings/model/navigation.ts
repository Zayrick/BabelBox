export type NavigationIconKey =
  | 'general'
  | 'services'
  | 'translation-center'
  | 'vocabulary'
  | 'shortcuts'
  | 'sites'
  | 'image-translation'
  | 'video'
  | 'advanced'
  | 'data'
  | 'about'

export type NavigationItem = {
  id: string
  icon: NavigationIconKey
  label: string
  badge?: 'Beta'
  group: string
  title: string
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
        id: 'settings-general', icon: 'general', label: '通用设置', group: '基础设置', title: '通用设置',
        searchDescription: '插件启停、双语模式、译文样式与主题',
      },
      {
        id: 'settings-services', icon: 'services', label: '翻译服务', group: '基础设置', title: '翻译服务与模型',
        searchDescription: '微软翻译、OpenAI、DeepSeek、Gemini、模型与令牌',
      },
    ],
  },
  {
    label: '翻译工具',
    items: [
      {
        id: 'settings-translation-center', icon: 'translation-center', label: '翻译中心', group: '翻译工具', title: '翻译中心',
        searchDescription: '多服务翻译、翻译对比、重复翻译、句子翻译',
      },
    ],
  },
  {
    label: '学习工具',
    items: [
      {
        id: 'settings-vocabulary', icon: 'vocabulary', label: '单词本', badge: 'Beta', group: '学习工具', title: '单词本',
        searchDescription: '单词本、收藏、复习、掌握程度、学习记录、Anki、导入导出',
      },
    ],
  },
  {
    label: '阅读工具',
    items: [
      {
        id: 'settings-shortcuts', icon: 'shortcuts', label: '交互与快捷键', group: '阅读工具', title: '交互与快捷键',
        searchDescription: '鼠标悬停、划词翻译、划词显示延迟、全文翻译范围、翻译到网页底部、右键全文翻译与自定义按键',
      },
      {
        id: 'settings-sites', icon: 'sites', label: '网站规则', group: '阅读工具', title: '网站规则',
        searchDescription: '网站、域名、网址、主域名、自动翻译、始终翻译、禁用扩展与子域',
      },
      {
        id: 'settings-image-translation', icon: 'image-translation', label: '图片翻译', group: '阅读工具', title: '图片翻译',
        searchDescription: '图片翻译、OCR、语言包、中文、英文、日文、下载',
      },
      {
        id: 'settings-video', icon: 'video', label: '视频字幕', badge: 'Beta', group: '阅读工具', title: '边看边译视频字幕',
        searchDescription: 'YouTube、视频字幕、视频翻译服务、DeepLX、微软翻译',
      },
    ],
  },
  {
    label: '系统与数据',
    items: [
      {
        id: 'settings-advanced', icon: 'advanced', label: '高级选项', group: '系统与数据', title: '高级选项',
        searchDescription: '缓存、动画、并发、显示翻译进度面板、悬浮球、输入框、代理与提示词',
      },
      {
        id: 'settings-data', icon: 'data', label: '配置管理', group: '系统与数据', title: '配置管理',
        searchDescription: '备份、迁移、导出与导入 JSON 配置',
      },
    ],
  },
  {
    label: '关于',
    items: [
      {
        id: 'settings-about', icon: 'about', label: '关于流畅阅读', group: '关于', title: '关于',
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
    `${item.label}${item.badge ?? ''}${item.group}${item.title}${item.searchDescription}`
      .toLocaleLowerCase()
      .includes(keyword),
  )
}
