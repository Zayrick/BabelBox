import type {TranslationServiceOption} from '@/src/core/config/translationServices'

export interface ServiceGroup {
  id: string
  label: string
  items: TranslationServiceOption[]
}

export function buildServiceGroups(options: TranslationServiceOption[]): ServiceGroup[] {
  return [
    {id: 'machine', label: '机器翻译', kind: 'machine' as const},
    {id: 'ai', label: 'AI 翻译', kind: 'ai' as const},
  ].map(({id, label, kind}) => ({
    id,
    label,
    items: options.filter((option) => option.kind === kind),
  })).filter((group) => group.items.length > 0)
}

export function filterServiceGroups(groups: ServiceGroup[], query: string) {
  const keyword = query.trim().toLocaleLowerCase()
  if (!keyword) return groups

  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        [
          item.label,
          item.value,
          item.provider,
          item.modelId,
          item.description || '',
        ].join('').toLocaleLowerCase().includes(keyword),
      ),
    }))
    .filter((group) => group.items.length > 0)
}
