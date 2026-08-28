import { customModelString, resolveConfiguredModel, servicesType } from '@/src/core/config/catalog'
import type {
  TranslationServiceKind,
  TranslationServiceOption,
} from '@/src/core/config/translationServices'

export type ServiceKind = TranslationServiceKind
export type ServiceOption = TranslationServiceOption

/**
 * Transitional input accepted while callers move from the provider catalog to
 * configured service instances. `disabled` marks the old group dividers, not
 * a service's enabled state.
 */
export interface LegacyServiceOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

export type ServiceCatalogOption = ServiceOption | LegacyServiceOption

export interface ServiceGroup {
  id: string
  label: string
  items: ServiceCatalogOption[]
}

export function cleanServiceLabel(label: string) {
  return label.replace(/[⭐️★]+/gu, '').trim()
}

export function isServiceInstanceOption(option: ServiceCatalogOption): option is ServiceOption {
  return 'provider' in option
    && typeof option.provider === 'string'
    && (option.kind === 'machine' || option.kind === 'ai')
    && typeof option.enabled === 'boolean'
}

function cleanOption<T extends ServiceCatalogOption>(option: T): T {
  return {...option, label: cleanServiceLabel(option.label)}
}

function buildInstanceGroups(options: ServiceOption[]): ServiceGroup[] {
  return [
    {id: 'machine', label: '机器翻译', kind: 'machine' as const},
    {id: 'ai', label: 'AI 翻译', kind: 'ai' as const},
  ].map(({id, label, kind}) => ({
    id,
    label,
    items: options.filter((option) => option.kind === kind).map(cleanOption),
  })).filter((group) => group.items.length > 0)
}

function buildLegacyGroups(options: LegacyServiceOption[]): ServiceGroup[] {
  const groups: ServiceGroup[] = []
  let current: ServiceGroup = { id: 'other', label: '其他服务', items: [] }

  for (const option of options) {
    if (option.disabled) {
      if (current.items.length) groups.push(current)
      current = {
        id: option.value,
        label: cleanServiceLabel(option.label),
        items: [],
      }
      continue
    }
    current.items.push(cleanOption(option))
  }

  if (current.items.length) groups.push(current)
  return groups
}

export function buildServiceGroups(options: ServiceCatalogOption[]): ServiceGroup[] {
  if (options.every(isServiceInstanceOption)) return buildInstanceGroups(options)
  return buildLegacyGroups(options as LegacyServiceOption[])
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
          isServiceInstanceOption(item) ? item.provider : '',
          isServiceInstanceOption(item) ? item.modelId : '',
          item.description || '',
        ].join('').toLocaleLowerCase().includes(keyword),
      ),
    }))
    .filter((group) => group.items.length > 0)
}

export function filterModels(modelOptions: string[], query: string) {
  const keyword = query.trim().toLocaleLowerCase()
  if (!keyword) return modelOptions
  return modelOptions.filter((model) => model.toLocaleLowerCase().includes(keyword))
}

export function getSelectedModelLabel(
  service: string,
  selectedModels: Record<string, string>,
  customModels: Record<string, string>,
) {
  if (!servicesType.isUseModel(service)) return ''

  const selectedModel = selectedModels[service]
  const configuredModel = resolveConfiguredModel(selectedModel, customModels[service])
  return configuredModel || (selectedModel === customModelString ? customModelString : '未选择模型')
}

export function splitModelOptions(modelOptions: string[], selectedModel = '', visibleCount = 4) {
  // 自定义模型是一个输入入口，不应因为当前选中而被提到常用模型区。
  // 即使调用方传入的列表顺序不稳定，也要保证它在完整列表的最后。
  const regularModels = modelOptions.filter((model) => model !== customModelString)
  const customModels = modelOptions.filter((model) => model === customModelString)
  const orderedModels = [...regularModels, ...customModels]
  const common = orderedModels.slice(0, visibleCount)

  if (
    selectedModel
    && selectedModel !== customModelString
    && orderedModels.includes(selectedModel)
    && !common.includes(selectedModel)
  ) {
    common.splice(Math.max(visibleCount - 1, 0), 1, selectedModel)
  }

  return {
    common,
    more: orderedModels.filter((model) => !common.includes(model)),
  }
}
