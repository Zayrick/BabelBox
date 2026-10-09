import {
  options,
  services,
  servicesType,
  type MiMoBillingPlan,
  type MiMoRegion,
  type MiniMaxBillingPlan,
  type MiniMaxRegion,
} from './catalog'

export type TranslationServiceKind = 'machine' | 'ai'
export type DeepSeekApiType = 'auto' | 'responses' | 'chat'
export type DeepSeekThinkingMode = 'enabled' | 'disabled'

export interface TranslationServiceCredential {
  apiKey: string
  appKey: string
  appSecret: string
  secretId: string
  secretKey: string
}

/**
 * A user-selectable service. Every request parameter lives on the instance;
 * secrets live in `serviceCredentials[id]` so they can be stored separately.
 */
export interface TranslationServiceInstance {
  id: string
  provider: string
  name: string
  enabled: boolean
  kind: TranslationServiceKind
  modelId: string
  /** Request URL override; empty means the provider default. */
  endpoint: string
  customBody: string
  systemRole: string
  userRole: string
  robotId: string
  deepseekApiType: DeepSeekApiType
  deepseekThinkingMode: DeepSeekThinkingMode
  minimaxBillingPlan: MiniMaxBillingPlan
  minimaxRegion: MiniMaxRegion
  mimoBillingPlan: MiMoBillingPlan
  mimoRegion: MiMoRegion
}

export interface TranslationServiceOption {
  value: string
  label: string
  provider: string
  kind: TranslationServiceKind
  enabled: boolean
  modelId: string
  builtin: boolean
  description?: string
}

export interface TranslationServiceConfigLike {
  translationServices?: readonly TranslationServiceInstance[]
  serviceCredentials?: Readonly<Record<string, TranslationServiceCredential | undefined>>
  service?: string
  documentService?: string
  videoService?: string
  translationCenterServices?: readonly string[]
}

const providerOptions = options.services.filter((item) => !item.disabled)

export const machineTranslationProviders: readonly string[] = Object.freeze(
  providerOptions.filter((item) => servicesType.isMachine(item.value)).map((item) => item.value),
)

export const aiTranslationProviders: readonly string[] = Object.freeze(
  providerOptions.filter((item) => servicesType.isAI(item.value)).map((item) => item.value),
)

/** Built-in services ship with every configuration, use their provider as ID and cannot be removed. */
export const builtinTranslationProviders: readonly string[] = Object.freeze([
  services.microsoft,
  services.google,
  services.chromeTranslator,
])

/** Machine engines users add explicitly; each provider has at most one instance. */
export const externalMachineTranslationProviders: readonly string[] = Object.freeze(
  machineTranslationProviders.filter((provider) => !builtinTranslationProviders.includes(provider)),
)

const EXTERNAL_SERVICE_ID_PREFIX = 'service:'

export const EMPTY_TRANSLATION_SERVICE_CREDENTIAL: Readonly<TranslationServiceCredential> = Object.freeze({
  apiKey: '',
  appKey: '',
  appSecret: '',
  secretId: '',
  secretKey: '',
})

export function isBuiltinTranslationService(instance: Pick<TranslationServiceInstance, 'id'>): boolean {
  return builtinTranslationProviders.includes(instance.id)
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

function createInstance(id: string, provider: string): TranslationServiceInstance {
  return {
    id,
    provider,
    name: getTranslationProviderLabel(provider),
    enabled: true,
    kind: servicesType.isMachine(provider) ? 'machine' : 'ai',
    modelId: '',
    endpoint: '',
    customBody: '',
    systemRole: '',
    userRole: '',
    robotId: '',
    deepseekApiType: 'auto',
    deepseekThinkingMode: 'disabled',
    minimaxBillingPlan: 'payg',
    minimaxRegion: 'cn',
    mimoBillingPlan: 'payg',
    mimoRegion: 'cn',
  }
}

export function createDefaultTranslationServices(): TranslationServiceInstance[] {
  return builtinTranslationProviders.map((provider) => createInstance(provider, provider))
}

function createExternalServiceId(provider: string, existingIds: ReadonlySet<string>): string {
  let candidate = ''
  do {
    const suffix = globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 12)
      || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    candidate = `${EXTERNAL_SERVICE_ID_PREFIX}${provider}:${suffix}`
  } while (existingIds.has(candidate))
  return candidate
}

/** Creates a removable service for any non-built-in provider. */
export function createExternalTranslationService(
  provider: string,
  existingServices: readonly Pick<TranslationServiceInstance, 'id'>[] = [],
): TranslationServiceInstance {
  if (builtinTranslationProviders.includes(provider)
    || (!servicesType.isMachine(provider) && !servicesType.isAI(provider))) {
    throw new Error(`无法添加翻译服务: ${provider}`)
  }
  const id = createExternalServiceId(provider, new Set(existingServices.map((item) => item.id)))
  return createInstance(id, provider)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback
}

function isExternalServiceId(id: string, provider: string): boolean {
  return id.startsWith(`${EXTERNAL_SERVICE_ID_PREFIX}${provider}:`)
}

function normalizeInstance(value: unknown): TranslationServiceInstance | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const source = value as Record<string, unknown>
  const id = text(source.id).trim()
  const provider = text(source.provider).trim()
  if (!servicesType.isMachine(provider) && !servicesType.isAI(provider)) return null
  const builtin = builtinTranslationProviders.includes(provider)
  if (builtin ? id !== provider : !isExternalServiceId(id, provider)) return null

  const instance = createInstance(id, provider)
  return {
    ...instance,
    name: text(source.name).trim().slice(0, 80) || instance.name,
    enabled: source.enabled !== false,
    modelId: instance.kind === 'ai' ? text(source.modelId).trim() : '',
    endpoint: text(source.endpoint).trim(),
    customBody: text(source.customBody),
    systemRole: text(source.systemRole),
    userRole: text(source.userRole),
    robotId: text(source.robotId).trim(),
    deepseekApiType: oneOf(source.deepseekApiType, ['auto', 'responses', 'chat'], 'auto'),
    deepseekThinkingMode: oneOf(source.deepseekThinkingMode, ['enabled', 'disabled'], 'disabled'),
    minimaxBillingPlan: oneOf(source.minimaxBillingPlan, ['payg', 'token-plan'], 'payg'),
    minimaxRegion: oneOf(source.minimaxRegion, ['cn', 'global'], 'cn'),
    mimoBillingPlan: oneOf(source.mimoBillingPlan, ['payg', 'token-plan'], 'payg'),
    mimoRegion: oneOf(source.mimoRegion, ['cn', 'sgp', 'ams'], 'cn'),
  }
}

/**
 * Built-in services come first and always exist; external services follow with
 * machine engines before AI services. Invalid, duplicate or second instances of
 * an external machine provider are dropped.
 */
export function normalizeTranslationServices(value: unknown): TranslationServiceInstance[] {
  const stored = Array.isArray(value)
    ? value.map(normalizeInstance).filter((item): item is TranslationServiceInstance => Boolean(item))
    : []
  const seenIds = new Set<string>()
  const seenMachineProviders = new Set<string>()
  const unique = stored.filter((item) => {
    if (seenIds.has(item.id)) return false
    seenIds.add(item.id)
    if (item.kind === 'machine') {
      if (seenMachineProviders.has(item.provider)) return false
      seenMachineProviders.add(item.provider)
    }
    return true
  })

  const byId = new Map(unique.map((item) => [item.id, item]))
  const external = unique.filter((item) => !isBuiltinTranslationService(item))
  const result = [
    ...createDefaultTranslationServices().map((item) => byId.get(item.id) || item),
    ...external.filter((item) => item.kind === 'machine'),
    ...external.filter((item) => item.kind === 'ai'),
  ]
  if (!result.some((item) => item.enabled)) result[0].enabled = true
  return result
}

export function getTranslationServiceInstance(
  config: TranslationServiceConfigLike,
  serviceId: string,
): TranslationServiceInstance | undefined {
  return config.translationServices?.find((item) => item.id === serviceId)
}

export function getTranslationServiceProvider(config: TranslationServiceConfigLike, serviceId: string): string {
  return getTranslationServiceInstance(config, serviceId)?.provider || ''
}

export function getTranslationServiceModel(config: TranslationServiceConfigLike, serviceId: string): string {
  return getTranslationServiceInstance(config, serviceId)?.modelId || ''
}

export function getTranslationServiceLabel(config: TranslationServiceConfigLike, serviceId: string): string {
  return getTranslationServiceInstance(config, serviceId)?.name || serviceId
}

export function getTranslationServiceCredential(
  config: TranslationServiceConfigLike,
  serviceId: string,
): Readonly<TranslationServiceCredential> {
  return config.serviceCredentials?.[serviceId] || EMPTY_TRANSLATION_SERVICE_CREDENTIAL
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
      builtin: isBuiltinTranslationService(item),
      description: getTranslationProviderDescription(item.provider) || undefined,
    }))
}

export function getFirstEnabledTranslationServiceId(
  config: TranslationServiceConfigLike,
  excludedId = '',
): string | null {
  const enabled = (config.translationServices || []).filter((item) => item.enabled && item.id !== excludedId)
  return enabled.find((item) => item.id === services.microsoft)?.id
    || enabled[0]?.id
    || null
}

/** Points every service selection at an enabled instance and drops dangling credentials. */
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
  if (config.serviceCredentials) {
    const installedIds = new Set((config.translationServices || []).map((item) => item.id))
    config.serviceCredentials = Object.fromEntries(Object.entries(config.serviceCredentials)
      .filter(([id]) => installedIds.has(id)))
  }
  return config
}

/** Identity for page-local caches that must expire when an instance request changes. */
export function getTranslationServiceConfigurationKey(
  config: TranslationServiceConfigLike,
  serviceId: string,
): string {
  const instance = getTranslationServiceInstance(config, serviceId)
  return JSON.stringify(instance ? {...instance, name: undefined, enabled: undefined} : {id: serviceId})
}
