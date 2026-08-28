import {describe, expect, it} from 'vitest'
import type {TranslationServiceOption} from '@/src/core/config/translationServices'
import {buildServiceGroups, filterServiceGroups} from '@/src/ui/view-model/serviceCatalog'

const services: TranslationServiceOption[] = [
  {
    value: 'microsoft',
    label: '微软翻译',
    provider: 'microsoft',
    kind: 'machine',
    enabled: true,
    modelId: '',
  },
  {
    value: 'service:openai:article',
    label: '文章 GPT',
    provider: 'openai',
    kind: 'ai',
    enabled: true,
    modelId: 'gpt-5-mini',
    description: '文章翻译',
  },
]

describe('service catalog helpers', () => {
  it('按当前服务实例类型分组', () => {
    expect(buildServiceGroups(services)).toEqual([
      {id: 'machine', label: '机器翻译', items: [services[0]]},
      {id: 'ai', label: 'AI 翻译', items: [services[1]]},
    ])
  })

  it('在名称、provider、模型和描述中搜索，并保留分组', () => {
    const groups = buildServiceGroups(services)
    expect(filterServiceGroups(groups, '   ')).toBe(groups)
    for (const query of ['文章 GPT', 'OPENAI', 'gpt-5', '文章翻译']) {
      expect(filterServiceGroups(groups, query)).toEqual([
        {id: 'ai', label: 'AI 翻译', items: [services[1]]},
      ])
    }
  })
})
