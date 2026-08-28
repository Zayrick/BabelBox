import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NAVIGATION_SECTION,
  filterNavigationItems,
  navigationGroups,
  navigationItems,
  resolveNavigationItem,
  resolveRequestedSection,
} from '@/src/features/settings/model/navigation'

describe('options navigation view-model', () => {
  it('keeps every section unique and grouped exactly once', () => {
    const groupedItems = navigationGroups.flatMap((group) => group.items)
    expect(groupedItems).toEqual(navigationItems)
    expect(new Set(navigationItems.map((item) => item.id)).size).toBe(navigationItems.length)
    expect(DEFAULT_NAVIGATION_SECTION).toBe('settings-general')
  })

  it('marks only vocabulary and video navigation items as Beta', () => {
    expect(navigationItems.filter((item) => item.badge === 'Beta').map((item) => item.id)).toEqual([
      'settings-vocabulary',
      'settings-video',
    ])
    expect(resolveNavigationItem('settings-vocabulary').label).toBe('单词本')
    expect(resolveNavigationItem('settings-video').label).toBe('视频字幕')
  })

  it('resolves valid sections and falls back for malformed hashes', () => {
    expect(resolveNavigationItem('settings-services').title).toBe('翻译服务与模型')
    expect(resolveNavigationItem('missing').id).toBe(DEFAULT_NAVIGATION_SECTION)
    expect(resolveRequestedSection('#settings-video')).toBe('settings-video')
    expect(resolveRequestedSection('settings-sites')).toBe('settings-sites')
    expect(resolveRequestedSection('#missing')).toBe(DEFAULT_NAVIGATION_SECTION)
  })

  it('searches all user-facing metadata case-insensitively and trims input', () => {
    expect(filterNavigationItems(' OPENAI ')).toEqual([
      expect.objectContaining({ id: 'settings-services' }),
    ])
    expect(filterNavigationItems('主域名')).toEqual([
      expect.objectContaining({ id: 'settings-sites' }),
    ])
    expect(filterNavigationItems('')).toEqual([])
    expect(filterNavigationItems('不存在的设置项')).toEqual([])
  })
})
