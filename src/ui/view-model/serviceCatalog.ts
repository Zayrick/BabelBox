import type {TranslationServiceOption} from '@/src/core/config/translationServices'

export interface ServiceGroup {
  id: string
  label: string
  items: TranslationServiceOption[]
}

export function buildServiceGroups(options: TranslationServiceOption[]): ServiceGroup[] {
  const external = options.filter((option) => !option.builtin)
  return [
    {id: 'builtin', label: '内置翻译', items: options.filter((option) => option.builtin)},
    {
      id: 'external',
      label: '外部翻译',
      items: [
        ...external.filter((option) => option.kind === 'machine'),
        ...external.filter((option) => option.kind === 'ai'),
      ],
    },
  ].filter((group) => group.items.length > 0)
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
