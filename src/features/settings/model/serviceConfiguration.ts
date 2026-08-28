import {
  customModelString,
  services,
  servicesType,
} from '@/src/core/config/catalog'

export type ServiceConfigurationMode =
  | 'model-and-connection'
  | 'model-only'
  | 'connection-only'
  | 'ready'
  | 'unavailable'

export interface ServiceConfigurationFieldVisibility {
  apiKeyPolicy: boolean
  token: boolean
  minimaxRegion: boolean
  mimoRegion: boolean
  azureOpenaiEndpoint: boolean
  deepLxEndpoint: boolean
  akSkCredentials: boolean
  youdaoCredentials: boolean
  tencentCredentials: boolean
  robotId: boolean
  customService: boolean
  newApiEndpoint: boolean
  customModel: boolean
  deepseekApiType: boolean
  deepseekThinkingMode: boolean
  customBody: boolean
}

export interface ServiceConfigurationPresentation {
  mode: ServiceConfigurationMode
  showModelConfiguration: boolean
  showConnectionConfiguration: boolean
  showCredentialNotice: boolean
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
  selectedModel?: string
  deepseekApiType?: string
  available?: boolean
  unavailableMessage?: string
}

/**
 * Derives the settings-page presentation from the fields the selected provider
 * can actually edit. Model selection and provider parameters are independent:
 * fixed-engine services such as DeepL can still require credentials.
 */
export function createServiceConfigurationPresentation(
  service: string,
  options: ServiceConfigurationPresentationOptions = {},
): ServiceConfigurationPresentation {
  const isKnownService = Object.values(services).includes(service)
  const canConfigure = isKnownService && options.available !== false
  const showModelConfiguration = canConfigure && servicesType.isUseModel(service)
  const showToken = servicesType.isUseToken(service)
  const isAI = servicesType.isAI(service)

  const fields: ServiceConfigurationFieldVisibility = {
    apiKeyPolicy: isAI && showToken,
    token: showToken,
    minimaxRegion: service === services.minimax,
    mimoRegion: service === services.mimo,
    azureOpenaiEndpoint: servicesType.isAzureOpenai(service),
    deepLxEndpoint: service === services.deeplx,
    akSkCredentials: servicesType.isUseAkSk(service),
    youdaoCredentials: servicesType.isYoudao(service),
    tencentCredentials: servicesType.isTencent(service),
    robotId: servicesType.isCoze(service),
    customService: servicesType.isCustom(service),
    newApiEndpoint: servicesType.isNewApi(service),
    customModel: isAI && options.selectedModel === customModelString,
    deepseekApiType: service === services.deepseek,
    deepseekThinkingMode:
      service === services.deepseek && options.deepseekApiType !== 'responses',
    customBody: servicesType.isUseCustomBody(service),
  }

  const showConnectionConfiguration = canConfigure && Object.values(fields).some(Boolean)
  const showCredentialNotice = canConfigure && (fields.token
    || fields.akSkCredentials
    || fields.youdaoCredentials
    || fields.tencentCredentials)

  const mode: ServiceConfigurationMode = !canConfigure
    ? 'unavailable'
    : showModelConfiguration
      ? showConnectionConfiguration ? 'model-and-connection' : 'model-only'
      : showConnectionConfiguration ? 'connection-only' : 'ready'

  return {
    mode,
    showModelConfiguration,
    showConnectionConfiguration,
    showCredentialNotice,
    showReadyState: mode === 'ready',
    showUnavailableState: mode === 'unavailable',
    // Every service currently exposed by the catalog has a registered adapter.
    // Keep availability testing separate from whether the service has fields.
    showConnectionTest: canConfigure,
    fields,
    readyState: {
      title: '无需额外配置',
      description: '此服务不需要填写凭据或选择模型，选择后即可直接使用。',
    },
    unavailableState: {
      title: '此服务当前不可用',
      description: options.unavailableMessage || '请从左侧列表选择当前环境支持的翻译服务。',
    },
  }
}
