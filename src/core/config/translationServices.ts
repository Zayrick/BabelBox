import {
  customModelString,
  defaultModels,
  defaultOption,
  options,
  resolveConfiguredModel,
  services,
  servicesType,
} from './catalog'

export type TranslationServiceKind = 'machine' | 'ai'

/**
 * A user-selectable service is an instance, not a provider. Provider IDs remain
 * static adapter keys; instance IDs are stable configuration and selection keys.
 */
export interface TranslationServiceInstance {
  id: string
  provider: string
  name: string
  enabled: boolean
  kind: TranslationServiceKind
  modelId: string
  endpoint: string
  proxy: string
  customBody: string
  systemRole: string
  userRole: string
  robotId: string
  requireApiKey: boolean
  deepseekApiType: 'auto' | 'responses' | 'chat'
  deepseekThinkingMode: 'enabled' | 'disabled'
  minimaxBillingPlan: 'payg' | 'token-plan'
  minimaxRegion: 'cn' | 'global'
  mimoBillingPlan: 'payg' | 'token-plan'
  mimoRegion: 'cn' | 'sgp' | 'ams'
}

export interface TranslationServiceOption {
  value: string
  label: string
  provider: string
  kind: TranslationServiceKind
  enabled: boolean
  modelId: string
  description?: string
}

export interface TranslationServiceConfigLike {
  translationServices?: readonly TranslationServiceInstance[]
  service?: string
  documentService?: string
  videoService?: string
  translationCenterServices?: readonly string[]
  model?: Record<string, string | undefined>
  documentModel?: Record<string, string | undefined>
  customModel?: Record<string, string | undefined>
  documentCustomModel?: Record<string, string | undefined>
  token?: Record<string, string | undefined>
  serviceCredentials?: Record<string, {
    apiKey: string
    appKey: string
    appSecret: string
    secretId: string
    secretKey: string
  } | undefined>
  proxy?: Record<string, string | undefined>
  robot_id?: Record<string, string | undefined>
  customBody?: Record<string, string | undefined>
  system_role?: Record<string, string | undefined>
  user_role?: Record<string, string | undefined>
  requireApiKey?: Record<string, boolean | undefined>
  youdaoAppKey?: string
  youdaoAppSecret?: string
  tencentSecretId?: string
  tencentSecretKey?: string
  custom?: string
  deeplx?: string
  newApiUrl?: string
  azureOpenaiEndpoint?: string
  deepseekApiType?: string
  deepseekThinkingMode?: string
  minimaxBillingPlan?: string
  minimaxRegion?: string
  mimoBillingPlan?: string
  mimoRegion?: string
}

const providerOptions = options.services.filter((item) => !item.disabled)

export const machineTranslationProviders = Object.freeze(
  providerOptions
    .filter((item) => servicesType.isMachine(item.value))
    .map((item) => item.value),
)

export const aiTranslationProviders = Object.freeze(
  providerOptions
    .filter((item) => servicesType.isAI(item.value))
    .map((item) => item.value),
)

const knownProviders = new Set([...machineTranslationProviders, ...aiTranslationProviders])
const reservedProviderServiceIds = new Set(knownProviders)
const LEGACY_DEFAULT_NEW_API_URL = 'http://localhost:3000'

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function boundedName(value: unknown): string {
  return stringValue(value).slice(0, 80)
}

export function getTranslationProviderLabel(provider: string): string {
  return providerOptions.find((item) => item.value === provider)?.label || provider
}

export function getTranslationProviderDescription(provider: string): string {
  const option = providerOptions.find((item) => item.value === provider)
  return option && 'description' in option && typeof option.description === 'string'
    ? option.description
    : ''
}

function configuredModel(
  provider: string,
  model?: Record<string, string | undefined>,
  customModel?: Record<string, string | undefined>,
): string {
  return resolveConfiguredModel(model?.[provider], customModel?.[provider])
    || defaultModels.get(provider)
    || ''
}

export function getDefaultTranslationServiceName(provider: string, modelId = ''): string {
  const providerLabel = getTranslationProviderLabel(provider)
  return modelId ? `${modelId} - ${providerLabel}` : providerLabel
}

function baseInstance(
  id: string,
  provider: string,
  kind: TranslationServiceKind,
  modelId = '',
): TranslationServiceInstance {
  return {
    id,
    provider,
    name: kind === 'ai'
      ? getDefaultTranslationServiceName(provider, modelId)
      : getTranslationProviderLabel(provider),
    enabled: true,
    kind,
    modelId,
    endpoint: '',
    proxy: '',
    customBody: '',
    systemRole: '',
    userRole: '',
    robotId: '',
    requireApiKey: true,
    deepseekApiType: 'auto',
    deepseekThinkingMode: 'disabled',
    minimaxBillingPlan: 'payg',
    minimaxRegion: 'cn',
    mimoBillingPlan: 'payg',
    mimoRegion: 'cn',
  }
}

export function createDefaultTranslationServices(): TranslationServiceInstance[] {
  return machineTranslationProviders.map((provider) => baseInstance(
    provider,
    provider,
    'machine',
  ))
}

export function createTranslationServiceId(
  provider: string,
  existingServices: readonly Pick<TranslationServiceInstance, 'id'>[] = [],
): string {
  const existing = new Set(existingServices.map((item) => item.id))
  const normalizedProvider = provider.replace(/[^a-z0-9_-]+/giu, '-').replace(/^-+|-+$/gu, '') || 'provider'
  let candidate = ''
  do {
    const uuid = globalThis.crypto?.randomUUID?.()
    const suffix = uuid
      ? uuid.replaceAll('-', '').slice(0, 12)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    candidate = `service:${normalizedProvider}:${suffix}`
  } while (existing.has(candidate))
  return candidate
}

export function createAITranslationService(
  provider: string,
  input: Partial<Omit<TranslationServiceInstance, 'provider' | 'kind'>> = {},
): TranslationServiceInstance {
  if (!servicesType.isAI(provider)) throw new Error(`未知 AI 翻译供应商: ${provider}`)
  const modelId = Object.hasOwn(input, 'modelId')
    ? stringValue(input.modelId)
    : defaultModels.get(provider) || ''
  const instance = baseInstance(
    stringValue(input.id) || createTranslationServiceId(provider),
    provider,
    'ai',
    modelId,
  )
  const normalized = normalizeTranslationServiceInstance({...instance, ...input, provider, kind: 'ai'})
  if (!normalized) throw new Error('无效的 AI 翻译服务实例')
  return normalized
}

function normalizeTranslationServiceInstance(value: unknown): TranslationServiceInstance | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Partial<TranslationServiceInstance>
  const id = stringValue(source.id)
  const provider = stringValue(source.provider)
  if (!id || !knownProviders.has(provider)) return null

  const kind: TranslationServiceKind = servicesType.isMachine(provider) ? 'machine' : 'ai'
  if (kind === 'machine' && id !== provider) return null
  if (reservedProviderServiceIds.has(id) && id !== provider) return null
  const modelId = kind === 'ai'
    ? typeof source.modelId === 'string'
      ? stringValue(source.modelId)
      : defaultModels.get(provider) || ''
    : ''
  const defaults = baseInstance(id, provider, kind, modelId)
  const deepseekApiType = source.deepseekApiType === 'responses' || source.deepseekApiType === 'chat'
    ? source.deepseekApiType
    : 'auto'
  const deepseekThinkingMode = source.deepseekThinkingMode === 'enabled' ? 'enabled' : 'disabled'
  const minimaxBillingPlan = source.minimaxBillingPlan === 'token-plan' ? 'token-plan' : 'payg'
  const minimaxRegion = source.minimaxRegion === 'global' ? 'global' : 'cn'
  const mimoBillingPlan = source.mimoBillingPlan === 'token-plan' ? 'token-plan' : 'payg'
  const mimoRegion = source.mimoRegion === 'sgp' || source.mimoRegion === 'ams'
    ? source.mimoRegion
    : 'cn'

  return {
    ...defaults,
    name: boundedName(source.name) || defaults.name,
    enabled: source.enabled !== false,
    modelId,
    endpoint: stringValue(source.endpoint),
    proxy: stringValue(source.proxy),
    customBody: stringValue(source.customBody),
    systemRole: typeof source.systemRole === 'string' ? source.systemRole : '',
    userRole: typeof source.userRole === 'string' ? source.userRole : '',
    robotId: stringValue(source.robotId),
    requireApiKey: source.requireApiKey !== false,
    deepseekApiType,
    deepseekThinkingMode,
    minimaxBillingPlan,
    minimaxRegion,
    mimoBillingPlan,
    mimoRegion,
  }
}

function isNonDefaultMappingValue(
  mapping: Record<string, string | undefined> | undefined,
  provider: string,
  defaultValue = '',
): boolean {
  const value = mapping?.[provider]
  return typeof value === 'string' && value.trim() !== '' && value !== defaultValue
}

function legacyProviderHasConfiguration(config: TranslationServiceConfigLike, provider: string): boolean {
  const references = [config.service, config.documentService, config.videoService]
  if (references.includes(provider)
    || (Array.isArray(config.translationCenterServices) && config.translationCenterServices.includes(provider))) return true
  if (isNonDefaultMappingValue(config.token, provider)) return true
  if (isNonDefaultMappingValue(config.proxy, provider)) return true
  if (isNonDefaultMappingValue(config.robot_id, provider)) return true
  if (isNonDefaultMappingValue(config.customBody, provider)) return true
  if (isNonDefaultMappingValue(config.customModel, provider)) return true
  if (provider === services.custom
    && stringValue(config.custom)
    && stringValue(config.custom) !== defaultOption.custom) return true
  if (provider === services.newapi
    && stringValue(config.newApiUrl)
    && stringValue(config.newApiUrl) !== LEGACY_DEFAULT_NEW_API_URL) return true
  if (provider === services.azureOpenai && stringValue(config.azureOpenaiEndpoint)) return true
  return Object.keys(config.requireApiKey || {}).some((key) => key.startsWith(`${provider}:`))
}

function createLegacyAIInstance(config: TranslationServiceConfigLike, provider: string): TranslationServiceInstance {
  const modelId = configuredModel(provider, config.model, config.customModel)
  const instance = baseInstance(provider, provider, 'ai', modelId)
  instance.endpoint = provider === 'custom'
    ? stringValue(config.custom)
    : provider === 'newapi'
      ? stringValue(config.newApiUrl)
      : provider === 'azureOpenai'
        ? stringValue(config.azureOpenaiEndpoint)
        : ''
  instance.proxy = stringValue(config.proxy?.[provider])
  instance.customBody = stringValue(config.customBody?.[provider])
  instance.systemRole = config.system_role?.[provider] === defaultOption.system_role
    ? ''
    : config.system_role?.[provider] || ''
  instance.userRole = config.user_role?.[provider] === defaultOption.user_role
    ? ''
    : config.user_role?.[provider] || ''
  instance.robotId = stringValue(config.robot_id?.[provider])
  const requirementKey = `${provider}:${modelId}`
  instance.requireApiKey = config.requireApiKey?.[requirementKey] !== false
  instance.deepseekApiType = config.deepseekApiType === 'responses' || config.deepseekApiType === 'chat'
    ? config.deepseekApiType
    : 'auto'
  instance.deepseekThinkingMode = config.deepseekThinkingMode === 'enabled' ? 'enabled' : 'disabled'
  instance.minimaxBillingPlan = config.minimaxBillingPlan === 'token-plan' ? 'token-plan' : 'payg'
  instance.minimaxRegion = config.minimaxRegion === 'global' ? 'global' : 'cn'
  instance.mimoBillingPlan = config.mimoBillingPlan === 'token-plan' ? 'token-plan' : 'payg'
  instance.mimoRegion = config.mimoRegion === 'sgp' || config.mimoRegion === 'ams'
    ? config.mimoRegion
    : 'cn'
  return instance
}

function createLegacyDocumentAIInstance(
  config: TranslationServiceConfigLike,
  primary: TranslationServiceInstance,
  modelId: string,
): TranslationServiceInstance {
  const id = `service:${primary.provider}:document`
  const instance = {
    ...primary,
    id,
    name: getDefaultTranslationServiceName(primary.provider, modelId),
    modelId,
    requireApiKey: config.requireApiKey?.[`${primary.provider}:${modelId}`] !== false,
  }
  const providerCredential = config.serviceCredentials?.[primary.provider]
  const usesYoudaoCredentials = servicesType.isYoudao(primary.provider)
  const usesTencentCredentials = servicesType.isTencent(primary.provider)
  const credential = {
    apiKey: servicesType.isUseToken(primary.provider)
      ? (providerCredential?.apiKey || stringValue(config.token?.[primary.provider]))
      : '',
    appKey: usesYoudaoCredentials
      ? (providerCredential?.appKey || stringValue(config.youdaoAppKey))
      : '',
    appSecret: usesYoudaoCredentials
      ? (providerCredential?.appSecret || stringValue(config.youdaoAppSecret))
      : '',
    secretId: usesTencentCredentials
      ? (providerCredential?.secretId || stringValue(config.tencentSecretId))
      : '',
    secretKey: usesTencentCredentials
      ? (providerCredential?.secretKey || stringValue(config.tencentSecretKey))
      : '',
  }
  if (Object.values(credential).some(Boolean)) {
    config.serviceCredentials ||= {}
    config.serviceCredentials[id] = credential
  }
  return instance
}

/**
 * Normalizes the installed service list. Machine engines are built in and stay
 * manageable; AI providers only become instances when explicitly stored or
 * when a legacy configuration proves that the provider was in use.
 */
export function normalizeTranslationServices(
  value: unknown,
  legacyConfig: TranslationServiceConfigLike = {},
): TranslationServiceInstance[] {
  const candidates = Array.isArray(value)
    ? value.map(normalizeTranslationServiceInstance).filter((item): item is TranslationServiceInstance => Boolean(item))
    : []
  const seenIds = new Set<string>()
  const stored = candidates.filter((item) => {
    if (seenIds.has(item.id)) return false
    seenIds.add(item.id)
    return true
  })
  const byId = new Map(stored.map((item) => [item.id, item]))
  const result = createDefaultTranslationServices().map((item) => byId.get(item.id) || item)

  if (Array.isArray(value)) {
    for (const item of stored) {
      if (item.kind === 'ai' && !result.some((existing) => existing.id === item.id)) result.push(item)
    }
    ensureOneEnabledService(result)
    return result
  }

  for (const provider of aiTranslationProviders) {
    if (legacyProviderHasConfiguration(legacyConfig, provider)) {
      const primary = createLegacyAIInstance(legacyConfig, provider)
      const documentModelId = configuredModel(
        provider,
        legacyConfig.documentModel,
        legacyConfig.documentCustomModel,
      )
      const documentUsesProvider = legacyConfig.documentService === provider
      const providerUsedOutsideDocument = legacyConfig.service === provider
        || legacyConfig.videoService === provider
        || (Array.isArray(legacyConfig.translationCenterServices)
          && legacyConfig.translationCenterServices.includes(provider))
      if (documentUsesProvider && documentModelId && documentModelId !== primary.modelId) {
        if (providerUsedOutsideDocument) {
          const documentInstance = createLegacyDocumentAIInstance(
            legacyConfig,
            primary,
            documentModelId,
          )
          result.push(primary, documentInstance)
          legacyConfig.documentService = documentInstance.id
          continue
        }
        primary.modelId = documentModelId
        primary.name = getDefaultTranslationServiceName(provider, documentModelId)
        primary.requireApiKey = legacyConfig.requireApiKey?.[`${provider}:${documentModelId}`] !== false
      }
      result.push(primary)
    }
  }
  ensureOneEnabledService(result)
  return result
}

function ensureOneEnabledService(services: TranslationServiceInstance[]): void {
  if (services.some((item) => item.enabled)) return
  const fallback = services.find((item) => item.id === defaultOption.service) || services[0]
  if (fallback) fallback.enabled = true
}

export function getTranslationServiceInstance(
  config: TranslationServiceConfigLike,
  serviceId: string,
): TranslationServiceInstance | undefined {
  return config.translationServices?.find((item) => item.id === serviceId)
}

export function getTranslationServiceProvider(
  config: TranslationServiceConfigLike,
  serviceId: string,
): string {
  return getTranslationServiceInstance(config, serviceId)?.provider || serviceId
}

export function getTranslationServiceModel(
  config: TranslationServiceConfigLike,
  serviceId: string,
): string {
  const instance = getTranslationServiceInstance(config, serviceId)
  if (instance?.kind === 'ai') return instance.modelId
  const provider = instance?.provider || serviceId
  return configuredModel(provider, config.model, config.customModel)
}

export function getTranslationServiceLabel(
  config: TranslationServiceConfigLike,
  serviceId: string,
): string {
  const instance = getTranslationServiceInstance(config, serviceId)
  return instance?.name || getTranslationProviderLabel(serviceId)
}

function configuredInstanceValue(
  config: TranslationServiceConfigLike,
  serviceId: string,
  provider: string,
  mapping: Record<string, string | undefined> | undefined,
): string {
  return stringValue(mapping?.[serviceId])
    || (serviceId === provider ? stringValue(mapping?.[provider]) : '')
}

/** Identity for page-local caches that must expire when an instance request changes. */
export function getTranslationServiceConfigurationKey(
  config: TranslationServiceConfigLike,
  serviceId: string,
): string {
  const instance = getTranslationServiceInstance(config, serviceId)
  const provider = instance?.provider || serviceId
  const endpoint = instance?.proxy
    || instance?.endpoint
    || configuredInstanceValue(config, serviceId, provider, config.proxy)
    || (provider === services.custom ? stringValue(config.custom) : '')
    || (provider === services.newapi ? stringValue(config.newApiUrl) : '')
    || (provider === services.azureOpenai ? stringValue(config.azureOpenaiEndpoint) : '')
    || (provider === services.deeplx ? stringValue(config.deeplx) : '')
  return JSON.stringify({
    id: serviceId,
    provider,
    model: getTranslationServiceModel(config, serviceId),
    endpoint,
    customBody: instance?.customBody
      || configuredInstanceValue(config, serviceId, provider, config.customBody),
    systemRole: instance?.systemRole
      || configuredInstanceValue(config, serviceId, provider, config.system_role),
    userRole: instance?.userRole
      || configuredInstanceValue(config, serviceId, provider, config.user_role),
    robotId: instance?.robotId
      || configuredInstanceValue(config, serviceId, provider, config.robot_id),
    deepseekApiType: instance?.deepseekApiType || config.deepseekApiType || '',
    deepseekThinkingMode: instance?.deepseekThinkingMode || config.deepseekThinkingMode || '',
    minimaxBillingPlan: instance?.minimaxBillingPlan || config.minimaxBillingPlan || '',
    minimaxRegion: instance?.minimaxRegion || config.minimaxRegion || '',
    mimoBillingPlan: instance?.mimoBillingPlan || config.mimoBillingPlan || '',
    mimoRegion: instance?.mimoRegion || config.mimoRegion || '',
  })
}

export function isTranslationServiceEnabled(
  config: TranslationServiceConfigLike,
  serviceId: string,
): boolean {
  return getTranslationServiceInstance(config, serviceId)?.enabled === true
}

export function getTranslationServiceOptions(
  config: TranslationServiceConfigLike,
  enabledOnly = false,
): TranslationServiceOption[] {
  return (config.translationServices || [])
    .filter((item) => !enabledOnly || item.enabled)
    .map((item) => ({
      value: item.id,
      label: item.name,
      provider: item.provider,
      kind: item.kind,
      enabled: item.enabled,
      modelId: item.modelId,
      description: getTranslationProviderDescription(item.provider) || undefined,
    }))
}

export function getFirstEnabledTranslationServiceId(
  config: TranslationServiceConfigLike,
  excludedId = '',
): string | null {
  const enabled = (config.translationServices || []).filter((item) => item.enabled && item.id !== excludedId)
  return enabled.find((item) => item.id === defaultOption.service)?.id
    || enabled.find((item) => item.kind === 'machine')?.id
    || enabled[0]?.id
    || null
}

export function reconcileTranslationServiceReferences<T extends TranslationServiceConfigLike>(config: T): T {
  const enabledIds = new Set((config.translationServices || []).filter((item) => item.enabled).map((item) => item.id))
  const fallback = getFirstEnabledTranslationServiceId(config)
  for (const key of ['service', 'documentService', 'videoService'] as const) {
    const selected = config[key]
    if (selected && enabledIds.has(selected)) continue
    if (fallback) (config as Record<string, unknown>)[key] = fallback
  }
  if (Array.isArray(config.translationCenterServices)) {
    config.translationCenterServices = config.translationCenterServices.filter((id) => enabledIds.has(id))
  }
  return config
}

/** Clear provider-keyed compatibility fields after deleting a migrated AI instance. */
export function clearLegacyTranslationServiceConfiguration(
  config: TranslationServiceConfigLike,
  instance: Pick<TranslationServiceInstance, 'id' | 'provider' | 'kind'>,
): void {
  if (instance.kind !== 'ai' || instance.id !== instance.provider) return
  const provider = instance.provider
  for (const mapping of [
    config.model,
    config.documentModel,
    config.customModel,
    config.documentCustomModel,
    config.proxy,
    config.robot_id,
    config.customBody,
    config.system_role,
    config.user_role,
  ]) {
    if (mapping) delete mapping[provider]
  }
  if (config.requireApiKey) {
    for (const key of Object.keys(config.requireApiKey)) {
      if (key.startsWith(`${provider}:`)) delete config.requireApiKey[key]
    }
  }
  if (provider === services.custom) config.custom = defaultOption.custom
  if (provider === services.newapi) config.newApiUrl = LEGACY_DEFAULT_NEW_API_URL
  if (provider === services.azureOpenai) config.azureOpenaiEndpoint = ''
  if (provider === services.deepseek) {
    config.deepseekApiType = 'auto'
    config.deepseekThinkingMode = 'disabled'
  }
  if (provider === services.minimax) {
    config.minimaxBillingPlan = 'payg'
    config.minimaxRegion = 'cn'
  }
  if (provider === services.mimo) {
    config.mimoBillingPlan = 'payg'
    config.mimoRegion = 'cn'
  }
}

export function isCustomModelValue(value: string): boolean {
  return value === customModelString
}
