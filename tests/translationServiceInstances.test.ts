import {describe, expect, it} from 'vitest'

import {currentModelIds, defaultModels, defaultOption, services} from '@/src/core/config/catalog'
import {
  Config,
  normalizeConfig,
  type TranslationServiceCredential,
} from '@/src/core/config/model'
import {
  aiTranslationProviders,
  clearLegacyTranslationServiceConfiguration,
  createAITranslationService,
  createDefaultTranslationServices,
  getFirstEnabledTranslationServiceId,
  getTranslationServiceConfigurationKey,
  getTranslationServiceOptions,
  machineTranslationProviders,
  normalizeTranslationServices,
  reconcileTranslationServiceReferences,
} from '@/src/core/config/translationServices'
import {
  clearTranslationServiceCredentials,
  sanitizeConfigCredentials,
} from '@/src/core/config/credentials'
import {prepareConfigForImport, sanitizeConfigForExport} from '@/src/core/config/transfer'
import {createBaselineConfigHistory, toPublicConfig} from '@/src/services/config/history'

function serviceCredential(secret: string): TranslationServiceCredential {
  return {
    apiKey: secret,
    appKey: secret,
    appSecret: secret,
    secretId: secret,
    secretKey: secret,
  }
}

describe('translation service instances', () => {
  it('seeds a new configuration with machine services only', () => {
    const config = new Config()

    expect(config.translationServices.map((item) => item.provider)).toEqual(machineTranslationProviders)
    expect(config.translationServices.every((item) => item.kind === 'machine')).toBe(true)
    expect(config.translationServices.every((item) => item.enabled)).toBe(true)
    expect(config.translationServices.some((item) => aiTranslationProviders.includes(item.provider))).toBe(false)
    expect(config.service).toBe(defaultOption.service)
  })

  it('allows two independently named and modeled instances of the same provider', () => {
    const primary = createAITranslationService(services.openai, {
      id: 'service:openai:primary',
      modelId: 'gpt-5.6-luna',
    })
    const secondary = createAITranslationService(services.openai, {
      id: 'service:openai:secondary',
      modelId: 'gpt-5.6-sol',
    })
    const normalized = normalizeTranslationServices([
      ...createDefaultTranslationServices(),
      primary,
      secondary,
    ])
    const openAIInstances = normalized.filter((item) => item.provider === services.openai)

    expect(openAIInstances).toHaveLength(2)
    expect(openAIInstances.map((item) => item.id)).toEqual([
      'service:openai:primary',
      'service:openai:secondary',
    ])
    expect(openAIInstances.map((item) => item.modelId)).toEqual([
      'gpt-5.6-luna',
      'gpt-5.6-sol',
    ])
    expect(openAIInstances.map((item) => item.name)).toEqual([
      'gpt-5.6-luna - OpenAI',
      'gpt-5.6-sol - OpenAI',
    ])
  })

  it('changes page-local cache identity when an instance model or endpoint changes', () => {
    const instance = createAITranslationService(services.openai, {
      id: 'service:openai:cache-version',
      modelId: 'model-a',
      endpoint: 'https://a.example.test/v1',
    })
    const config = {translationServices: [instance]}
    const firstKey = getTranslationServiceConfigurationKey(config, instance.id)

    instance.modelId = 'model-b'
    const modelKey = getTranslationServiceConfigurationKey(config, instance.id)
    instance.endpoint = 'https://b.example.test/v1'
    const endpointKey = getTranslationServiceConfigurationKey(config, instance.id)

    expect(modelKey).not.toBe(firstKey)
    expect(endpointKey).not.toBe(modelKey)
  })

  it('preserves disabled instances and re-enables only one fallback when all are disabled', () => {
    const disabled = createDefaultTranslationServices().map((item) => ({
      ...item,
      enabled: false,
    }))
    disabled.push(createAITranslationService(services.deepseek, {
      id: 'service:deepseek:disabled',
      modelId: 'deepseek-v4-flash',
      enabled: false,
    }))

    const normalized = normalizeTranslationServices(disabled)
    const enabled = normalized.filter((item) => item.enabled)

    expect(enabled.map((item) => item.id)).toEqual([defaultOption.service])
    expect(normalized.find((item) => item.id === services.microsoft)?.enabled).toBe(false)
    expect(normalized.find((item) => item.id === 'service:deepseek:disabled')?.enabled).toBe(false)
  })

  it('migrates only referenced or materially configured legacy AI providers', () => {
    const defaultModelMap = Object.fromEntries(defaultModels)
    const referenced = normalizeConfig({
      service: services.openai,
      model: defaultModelMap,
    })
    const configured = normalizeConfig({
      model: defaultModelMap,
      proxy: {[services.deepseek]: 'https://gateway.example.test/v1/chat/completions'},
    })

    expect(referenced.translationServices.filter((item) => item.kind === 'ai').map((item) => item.provider))
      .toEqual([services.openai])
    expect(configured.translationServices.filter((item) => item.kind === 'ai').map((item) => item.provider))
      .toEqual([services.deepseek])
    expect(configured.translationServices.find((item) => item.provider === services.deepseek)?.proxy)
      .toBe('https://gateway.example.test/v1/chat/completions')
  })

  it('does not treat the legacy default model map as a list of added AI services', () => {
    const normalized = normalizeConfig({
      model: Object.fromEntries(defaultModels),
      documentModel: Object.fromEntries(defaultModels),
    })

    expect(normalized.translationServices.map((item) => item.provider)).toEqual(machineTranslationProviders)
    expect(normalized.translationServices.some((item) => item.kind === 'ai')).toBe(false)
  })

  it('does not treat historical provider-wide model choices alone as added services', () => {
    const normalized = normalizeConfig({
      model: Object.fromEntries(aiTranslationProviders.map((provider) => [
        provider,
        `historical-default-${provider}`,
      ])),
      system_role: Object.fromEntries(aiTranslationProviders.map((provider) => [
        provider,
        `historical-system-default-${provider}`,
      ])),
      user_role: Object.fromEntries(aiTranslationProviders.map((provider) => [
        provider,
        `historical-user-default-${provider}`,
      ])),
    })

    expect(normalized.translationServices.some((item) => item.kind === 'ai')).toBe(false)
  })

  it('migrates legacy model identifiers before deciding whether an AI provider was added', () => {
    const defaultsWithLegacyAliases = Object.fromEntries(defaultModels)
    defaultsWithLegacyAliases[services.openai] = 'gpt5'
    defaultsWithLegacyAliases[services.deepseek] = 'deepseek-chat'

    const unused = normalizeConfig({model: defaultsWithLegacyAliases})
    const referencedOpenAI = normalizeConfig({
      service: services.openai,
      model: {[services.openai]: 'gpt5'},
    })
    const referencedDeepSeek = normalizeConfig({
      service: services.deepseek,
      model: {[services.deepseek]: 'deepseek-reasoner'},
    })

    expect(unused.translationServices.some((item) => item.kind === 'ai')).toBe(false)
    expect(referencedOpenAI.translationServices.find((item) => item.provider === services.openai)?.modelId)
      .toBe(currentModelIds.openai)
    expect(referencedDeepSeek.translationServices.find((item) => item.provider === services.deepseek))
      .toMatchObject({modelId: currentModelIds.deepseek, deepseekThinkingMode: 'enabled'})
  })

  it('migrates model identifiers already stored on explicit instances', () => {
    const legacy = createAITranslationService(services.openai, {
      id: 'service:openai:legacy-model',
      modelId: 'gpt5',
    })
    const normalized = normalizeConfig({
      translationServices: [...createDefaultTranslationServices(), legacy],
    })

    expect(normalized.translationServices.find((item) => item.id === legacy.id)?.modelId)
      .toBe(currentModelIds.openai)
  })

  it('preserves independent legacy webpage and document models as separate instances', () => {
    const normalized = normalizeConfig({
      service: services.openai,
      documentService: services.openai,
      model: {[services.openai]: 'web-model'},
      documentModel: {[services.openai]: 'document-model'},
      token: {[services.openai]: 'shared-legacy-token'},
    })

    expect(normalized.translationServices.find((item) => item.id === services.openai))
      .toMatchObject({provider: services.openai, modelId: 'web-model'})
    expect(normalized.documentService).toBe('service:openai:document')
    expect(normalized.translationServices.find((item) => item.id === normalized.documentService))
      .toMatchObject({
        provider: services.openai,
        modelId: 'document-model',
        name: 'document-model - OpenAI',
      })
    expect(normalized.serviceCredentials[normalized.documentService]?.apiKey)
      .toBe('shared-legacy-token')
  })

  it('uses the legacy document model on the primary instance when it has no other consumer', () => {
    const normalized = normalizeConfig({
      service: services.microsoft,
      documentService: services.deepseek,
      model: {[services.deepseek]: 'deepseek-chat'},
      documentModel: {[services.deepseek]: 'deepseek-reasoner'},
      token: {[services.deepseek]: 'deepseek-token'},
    })

    expect(normalized.documentService).toBe(services.deepseek)
    expect(normalized.translationServices.find((item) => item.id === services.deepseek))
      .toMatchObject({
        modelId: currentModelIds.deepseek,
        name: `${currentModelIds.deepseek} - DeepSeek`,
        deepseekThinkingMode: 'enabled',
      })
    expect(normalized.translationServices.filter((item) => item.provider === services.deepseek))
      .toHaveLength(1)
  })

  it('preserves legacy AI services configured only by a non-default endpoint', () => {
    const custom = normalizeConfig({custom: 'https://ollama.example.test/v1/chat/completions'})
    const newApi = normalizeConfig({newApiUrl: 'https://new-api.example.test'})
    const azure = normalizeConfig({azureOpenaiEndpoint: 'https://resource.openai.azure.com/chat/completions'})
    const untouchedDefaults = normalizeConfig({
      custom: defaultOption.custom,
      newApiUrl: 'http://localhost:3000',
    })

    expect(custom.translationServices.find((item) => item.provider === services.custom)?.endpoint)
      .toBe('https://ollama.example.test/v1/chat/completions')
    expect(newApi.translationServices.find((item) => item.provider === services.newapi)?.endpoint)
      .toBe('https://new-api.example.test')
    expect(azure.translationServices.find((item) => item.provider === services.azureOpenai)?.endpoint)
      .toBe('https://resource.openai.azure.com/chat/completions')
    expect(untouchedDefaults.translationServices.some((item) => item.kind === 'ai')).toBe(false)
  })

  it('rejects reserved machine IDs for AI instances and de-duplicates imported IDs', () => {
    expect(() => createAITranslationService(services.openai, {id: services.google}))
      .toThrow('无效的 AI 翻译服务实例')
    expect(() => createAITranslationService(services.openai, {id: services.deepseek}))
      .toThrow('无效的 AI 翻译服务实例')

    const openAI = createAITranslationService(services.openai, {
      id: 'service:duplicate',
      modelId: 'first-model',
    })
    const deepseek = createAITranslationService(services.deepseek, {
      id: 'service:duplicate',
      modelId: 'second-model',
    })
    const collision = {...openAI, id: services.google}
    const normalized = normalizeTranslationServices([
      ...createDefaultTranslationServices(),
      collision,
      openAI,
      deepseek,
    ])

    expect(normalized.find((item) => item.id === services.google)?.provider).toBe(services.google)
    expect(normalized.filter((item) => item.id === 'service:duplicate')).toEqual([
      expect.objectContaining({provider: services.openai, modelId: 'first-model'}),
    ])
  })

  it('tolerates malformed legacy translation-center values', () => {
    expect(() => normalizeConfig({translationCenterServices: {includes: true}})).not.toThrow()
  })

  it('filters enabled options and reconciles disabled or missing references', () => {
    const servicesList = createDefaultTranslationServices().map((item) => ({
      ...item,
      enabled: item.id === services.microsoft,
    }))
    const config = {
      translationServices: servicesList,
      service: services.google,
      documentService: 'missing-service',
      videoService: services.deeplx,
      translationCenterServices: [services.google, services.microsoft, services.deeplx],
    }

    expect(getTranslationServiceOptions(config, true).map((item) => item.value)).toEqual([
      services.microsoft,
    ])
    expect(getFirstEnabledTranslationServiceId(config)).toBe(services.microsoft)

    reconcileTranslationServiceReferences(config)

    expect(config).toMatchObject({
      service: services.microsoft,
      documentService: services.microsoft,
      videoService: services.microsoft,
      translationCenterServices: [services.microsoft],
    })
  })

  it('keeps per-instance credentials out of public config, exports, and history', () => {
    const secret = 'translation-service-instance-secret-sentinel'
    const config = normalizeConfig({
      serviceCredentials: {
        [services.microsoft]: serviceCredential(secret),
      },
    })

    const sanitized = sanitizeConfigCredentials(config)
    const exported = sanitizeConfigForExport(config)
    const publicConfig = toPublicConfig(config)
    const history = createBaselineConfigHistory(config, 1, 'fixed-time')

    for (const value of [sanitized, exported, publicConfig, history]) {
      expect(JSON.stringify(value)).not.toContain(secret)
    }
    expect(sanitized).not.toHaveProperty('serviceCredentials')
    expect(exported).not.toHaveProperty('serviceCredentials')
    expect(publicConfig).not.toHaveProperty('serviceCredentials')
    expect(history.entries[0]?.config).not.toHaveProperty('serviceCredentials')
  })

  it('clears only the deleted instance credentials, including its legacy provider token', () => {
    const deletedId = services.openai
    const siblingId = 'service:openai:sibling'
    const config = normalizeConfig({
      service: deletedId,
      token: {
        [deletedId]: 'legacy-token',
        [siblingId]: 'sibling-token',
      },
      serviceCredentials: {
        [deletedId]: serviceCredential('legacy-instance-secret'),
        [siblingId]: serviceCredential('sibling-secret'),
      },
      translationServices: [
        ...createDefaultTranslationServices(),
        createAITranslationService(services.openai, {id: deletedId, modelId: 'legacy-model'}),
        createAITranslationService(services.openai, {id: siblingId}),
      ],
      model: {[deletedId]: 'legacy-model'},
      customModel: {[deletedId]: 'legacy-custom-model'},
      proxy: {[deletedId]: 'https://legacy.example.test/v1'},
      customBody: {[deletedId]: '{"temperature":0}'},
      system_role: {[deletedId]: 'legacy-system'},
      user_role: {[deletedId]: 'legacy-user'},
      robot_id: {[deletedId]: 'legacy-robot'},
      requireApiKey: {[`${deletedId}:legacy-model`]: false},
    })

    const deleted = config.translationServices.find((item) => item.id === deletedId)!
    clearLegacyTranslationServiceConfiguration(config, deleted)
    clearTranslationServiceCredentials(config, deletedId)

    expect(config.token[deletedId]).toBeUndefined()
    expect(config.serviceCredentials[deletedId]).toBeUndefined()
    expect(config.token[siblingId]).toBe('sibling-token')
    expect(config.serviceCredentials[siblingId]?.apiKey).toBe('sibling-secret')
    expect(config.model[deletedId]).toBeUndefined()
    expect(config.customModel[deletedId]).toBeUndefined()
    expect(config.proxy[deletedId]).toBeUndefined()
    expect(config.customBody[deletedId]).toBeUndefined()
    expect(config.system_role[deletedId]).toBeUndefined()
    expect(config.user_role[deletedId]).toBeUndefined()
    expect(config.robot_id[deletedId]).toBeUndefined()
    expect(config.requireApiKey[`${deletedId}:legacy-model`]).toBeUndefined()
  })

  it('resets legacy provider endpoints when their migrated AI instances are deleted', () => {
    const cases = [
      [services.custom, {custom: 'https://custom.example.test/v1'}],
      [services.newapi, {newApiUrl: 'https://new-api.example.test'}],
      [services.azureOpenai, {azureOpenaiEndpoint: 'https://azure.example.test/chat/completions'}],
    ] as const

    for (const [provider, legacyConfig] of cases) {
      const config = normalizeConfig({service: provider, ...legacyConfig})
      const instance = config.translationServices.find((item) => item.id === provider)!
      clearLegacyTranslationServiceConfiguration(config, instance)
      if (provider === services.custom) expect(config.custom).toBe(defaultOption.custom)
      if (provider === services.newapi) expect(config.newApiUrl).toBe('http://localhost:3000')
      if (provider === services.azureOpenai) expect(config.azureOpenaiEndpoint).toBe('')
    }
  })

  it('preserves session credentials on import only for the same instance destination', () => {
    const id = 'service:openai:import-safety'
    const instance = createAITranslationService(services.openai, {
      id,
      modelId: 'gpt-5-mini',
      endpoint: 'https://safe.example.test/v1',
    })
    const current = normalizeConfig({
      translationServices: [...createDefaultTranslationServices(), instance],
      serviceCredentials: {[id]: serviceCredential('kept-secret')},
    })
    const matchingExport = sanitizeConfigForExport(current)
    const matchingImport = prepareConfigForImport(matchingExport, current)

    expect(matchingImport.serviceCredentials[id]?.apiKey).toBe('kept-secret')

    const changedDestination = structuredClone(matchingExport)
    const importedInstance = changedDestination.translationServices
      .find((item: {id: string}) => item.id === id)
    importedInstance.endpoint = 'https://different.example.test/v1'
    const changedImport = prepareConfigForImport(changedDestination, current)

    expect(changedImport.serviceCredentials[id]).toBeUndefined()
  })
})
