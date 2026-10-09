import {describe, expect, it} from 'vitest'
import type {TranslationServiceOption} from '@/src/core/config/translationServices'
import {buildServiceGroups, filterServiceGroups} from '@/src/ui/view-model/serviceCatalog'

const services: TranslationServiceOption[] = [
  {
    value: 'service:openai:article',
    label: '文章 GPT',
    provider: 'openai',
    kind: 'ai',
    enabled: true,
    modelId: 'gpt-5-mini',
    builtin: false,
    description: '文章翻译',
  },
  {
    value: 'deepL',
    label: 'DeepL',
    provider: 'deepL',
    kind: 'machine',
    enabled: true,
    modelId: '',
    builtin: false,
  },
  {
    value: 'microsoft',
    label: '微软翻译',
    provider: 'microsoft',
    kind: 'machine',
    enabled: true,
    modelId: '',
    builtin: true,
  },
]

describe('service catalog helpers', () => {
  it('分为内置与外部翻译，外部翻译中机器翻译排在 AI 翻译之前', () => {
    expect(buildServiceGroups(services)).toEqual([
      {id: 'builtin', label: '内置翻译', items: [services[2]]},
      {id: 'external', label: '外部翻译', items: [services[1], services[0]]},
    ])
  })

  it('在名称、provider、模型和描述中搜索，并保留分组', () => {
    const groups = buildServiceGroups(services)
    expect(filterServiceGroups(groups, '   ')).toBe(groups)
    for (const query of ['文章 GPT', 'OPENAI', 'gpt-5', '文章翻译']) {
      expect(filterServiceGroups(groups, query)).toEqual([
        {id: 'external', label: '外部翻译', items: [services[0]]},
      ])
    }
  })
})
