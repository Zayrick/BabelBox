import {services, servicesType} from '@/src/core/config/catalog'

export type ServiceConfigurationMode = 'configurable' | 'ready' | 'unavailable'

export interface ServiceConfigurationFieldVisibility {
  name: boolean
  model: boolean
  endpoint: boolean
  token: boolean
  youdaoCredentials: boolean
  tencentCredentials: boolean
  robotId: boolean
  minimaxRegion: boolean
  mimoRegion: boolean
  deepseekApiType: boolean
  deepseekThinkingMode: boolean
  prompts: boolean
  customBody: boolean
  concurrency: boolean
}

export interface ServiceConfigurationPresentation {
  mode: ServiceConfigurationMode
  showConnectionConfiguration: boolean
  showReadyState: boolean
  showUnavailableState: boolean
  showConnectionTest: boolean
  fields: ServiceConfigurationFieldVisibility
  readyState: {
    title: string
    description: string
  }
  unavailableState: {
    title: string
    description: string
  }
}

export interface ServiceConfigurationPresentationOptions {
  builtin?: boolean
  deepseekApiType?: string
  available?: boolean
  unavailableMessage?: string
}

/**
 * Derives which instance fields the settings page shows for a provider.
 * Built-in services have nothing to configure; external services expose the
 * fields their adapter reads.
 */
export function createServiceConfigurationPresentation(
  provider: string,
  options: ServiceConfigurationPresentationOptions = {},
): ServiceConfigurationPresentation {
  const isKnownService = Object.values(services).includes(provider)
  const canConfigure = isKnownService && options.available !== false
  const external = !options.builtin
  const isAI = servicesType.isAI(provider)

  const fields: ServiceConfigurationFieldVisibility = {
    name: external,
    model: external && servicesType.isUseModel(provider),
    endpoint: external && servicesType.isCustomEndpoint(provider),
    token: external && servicesType.isUseToken(provider),
    youdaoCredentials: external && servicesType.isYoudao(provider),
    tencentCredentials: external && servicesType.isTencent(provider),
    robotId: external && servicesType.isCoze(provider),
    minimaxRegion: external && provider === services.minimax,
    mimoRegion: external && provider === services.mimo,
    deepseekApiType: external && provider === services.deepseek,
    deepseekThinkingMode: external && provider === services.deepseek && options.deepseekApiType !== 'responses',
    prompts: external && isAI && servicesType.isUseAIContext(provider),
    customBody: external && servicesType.isUseCustomBody(provider),
    concurrency: external && isAI,
  }

  const showConnectionConfiguration = canConfigure && Object.values(fields).some(Boolean)
  const mode: ServiceConfigurationMode = !canConfigure
    ? 'unavailable'
    : showConnectionConfiguration ? 'configurable' : 'ready'

  return {
    mode,
    showConnectionConfiguration,
    showReadyState: mode === 'ready',
    showUnavailableState: mode === 'unavailable',
    showConnectionTest: canConfigure,
    fields,
    readyState: {
      title: '无需额外配置',
      description: '内置翻译服务开箱即用，选择后即可直接使用。',
    },
    unavailableState: {
      title: '此服务当前不可用',
      description: options.unavailableMessage || '请从左侧列表选择当前环境支持的翻译服务。',
    },
  }
}
