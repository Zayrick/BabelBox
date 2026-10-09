import {describe, expect, it} from 'vitest'

import {services} from '@/src/core/config/catalog'
import {Config, normalizeConfig, type TranslationServiceCredential} from '@/src/core/config/model'
import {
  builtinTranslationProviders,
  createDefaultTranslationServices,
  createExternalTranslationService,
  externalMachineTranslationProviders,
  getFirstEnabledTranslationServiceId,
  getTranslationServiceConfigurationKey,
  getTranslationServiceOptions,
  normalizeTranslationServices,
  reconcileTranslationServiceReferences,
} from '@/src/core/config/translationServices'
import {createBaselineConfigHistory} from '@/src/services/config/history'

function serviceCredential(secret: string): TranslationServiceCredential {
  return {apiKey: secret, appKey: secret, appSecret: secret, secretId: secret, secretKey: secret}
}

describe('translation service instances', () => {
  it('seeds a new configuration with the built-in services only', () => {
    const config = new Config()

    expect(config.translationServices.map((item) => item.id)).toEqual([
      services.microsoft,
      services.google,
      services.chromeTranslator,
    ])
    expect(getTranslationServiceOptions(config).every((item) => item.builtin)).toBe(true)
    expect(config.service).toBe(services.microsoft)
  })

  it('creates removable services for every non-built-in provider, but not for built-ins', () => {
    for (const provider of externalMachineTranslationProviders) {
      expect(createExternalTranslationService(provider)).toMatchObject({provider, kind: 'machine'})
    }
    expect(createExternalTranslationService(services.openai)).toMatchObject({
      provider: services.openai,
      kind: 'ai',
      modelId: '',
      name: 'OpenAI',
    })
    for (const provider of builtinTranslationProviders) {
      expect(() => createExternalTranslationService(provider)).toThrow('无法添加翻译服务')
    }
    expect(() => createExternalTranslationService('unknown')).toThrow('无法添加翻译服务')
  })

  it('always keeps built-in services first, then external machine services, then AI services', () => {
    const ai = {...createExternalTranslationService(services.openai), modelId: 'gpt'}
    const deepL = createExternalTranslationService(services.deepL)
    const storedBuiltins = createDefaultTranslationServices().slice(1).map((item) => ({...item, enabled: false}))

    const normalized = normalizeTranslationServices([ai, ...storedBuiltins, deepL])

    expect(normalized.map((item) => item.id)).toEqual([...builtinTranslationProviders, deepL.id, ai.id])
    expect(normalized.find((item) => item.id === services.google)?.enabled).toBe(false)
    expect(normalized.find((item) => item.id === ai.id)?.modelId).toBe('gpt')
  })

  it('keeps a removed external service removed after normalization', () => {
    const deepL = createExternalTranslationService(services.deepL)
    const withDeepL = normalizeTranslationServices([...createDefaultTranslationServices(), deepL])
    const removed = normalizeTranslationServices(withDeepL.filter((item) => item.id !== deepL.id))

    expect(removed.map((item) => item.id)).toEqual(builtinTranslationProviders)
  })

  it('allows several AI instances of one provider but only one instance per external machine provider', () => {
    const first = {...createExternalTranslationService(services.openai), modelId: 'model-a'}
    const second = {...createExternalTranslationService(services.openai, [first]), modelId: 'model-b'}
    const deepL = createExternalTranslationService(services.deepL)
    const duplicateDeepL = createExternalTranslationService(services.deepL, [deepL])

    const normalized = normalizeTranslationServices([first, second, deepL, duplicateDeepL, {...first}])

    expect(normalized.filter((item) => item.provider === services.openai).map((item) => item.modelId))
      .toEqual(['model-a', 'model-b'])
    expect(normalized.filter((item) => item.provider === services.deepL).map((item) => item.id))
      .toEqual([deepL.id])
  })

  it('keeps a per-service concurrency limit only for AI services', () => {
    const limited = {...createExternalTranslationService(services.openai), maxConcurrentRequests: 2.7}
    const invalid = {...createExternalTranslationService(services.openai, [limited]), maxConcurrentRequests: -1}
    const machine = {...createExternalTranslationService(services.deepL), maxConcurrentRequests: 3}

    const normalized = normalizeTranslationServices([limited, invalid, machine])
    const limitOf = (id: string) => normalized.find((item) => item.id === id)?.maxConcurrentRequests

    expect([limitOf(limited.id), limitOf(invalid.id), limitOf(machine.id)]).toEqual([2, 0, 0])
  })

  it('drops services that do not follow the instance ID rules', () => {
    const normalized = normalizeTranslationServices([
      {...createExternalTranslationService(services.openai), id: services.openai},
      {...createExternalTranslationService(services.deepL), id: services.deepL},
      {...createDefaultTranslationServices()[0], id: 'service:microsoft:copy'},
      {...createExternalTranslationService(services.openai), provider: 'unknown'},
      null,
      'not-a-service',
    ])

    expect(normalized.map((item) => item.id)).toEqual(builtinTranslationProviders)
  })

  it('re-enables Microsoft when every service is disabled', () => {
    const disabled = createDefaultTranslationServices().map((item) => ({...item, enabled: false}))
    const enabled = normalizeTranslationServices(disabled).filter((item) => item.enabled)

    expect(enabled.map((item) => item.id)).toEqual([services.microsoft])
  })

  it('changes page-local cache identity only when request-shaping settings change', () => {
    const instance = createExternalTranslationService(services.openai)
    const config = {translationServices: [instance]}
    const firstKey = getTranslationServiceConfigurationKey(config, instance.id)

    instance.modelId = 'model-b'
    const modelKey = getTranslationServiceConfigurationKey(config, instance.id)
    instance.endpoint = 'https://b.example.test/v1'
    const endpointKey = getTranslationServiceConfigurationKey(config, instance.id)
    instance.name = 'Renamed'

    expect(modelKey).not.toBe(firstKey)
    expect(endpointKey).not.toBe(modelKey)
    expect(getTranslationServiceConfigurationKey(config, instance.id)).toBe(endpointKey)
  })

  it('filters enabled options and reconciles disabled or missing references', () => {
    const servicesList = createDefaultTranslationServices().map((item) => ({
      ...item,
      enabled: item.id === services.microsoft,
    }))
    const config = {
      translationServices: servicesList,
      serviceCredentials: {
        [services.microsoft]: serviceCredential('kept'),
        'service:openai:deleted': serviceCredential('dangling'),
      },
      service: services.google,
      documentService: 'missing-service',
      videoService: 'service:deepl:deleted',
      translationCenterServices: [services.google, services.microsoft, 'service:deepl:deleted'],
    }

    expect(getTranslationServiceOptions(config, true).map((item) => item.value)).toEqual([services.microsoft])
    expect(getFirstEnabledTranslationServiceId(config)).toBe(services.microsoft)

    reconcileTranslationServiceReferences(config)

    expect(config).toMatchObject({
      service: services.microsoft,
      documentService: services.microsoft,
      videoService: services.microsoft,
      translationCenterServices: [services.microsoft],
    })
    expect(Object.keys(config.serviceCredentials)).toEqual([services.microsoft])
  })

  it('discards provider-keyed settings and credentials from earlier versions', () => {
    const normalized = normalizeConfig({
      service: services.openai,
      token: {[services.openai]: 'legacy-secret'},
      model: {[services.openai]: 'legacy-model'},
      proxy: {[services.deepL]: 'https://legacy.example'},
      youdaoAppKey: 'legacy-youdao',
      deeplx: 'https://legacy-deeplx.example',
      translationServices: [
        {id: services.deepL, provider: services.deepL, kind: 'machine', name: 'DeepL', enabled: true},
      ],
    }) as unknown as Record<string, unknown>

    expect((normalized.translationServices as Array<{id: string}>).map((item) => item.id))
      .toEqual(builtinTranslationProviders)
    expect(normalized.service).toBe(services.microsoft)
    for (const field of ['token', 'model', 'proxy', 'youdaoAppKey', 'deeplx']) {
      expect(normalized).not.toHaveProperty(field)
    }
  })

  it('tolerates malformed translation-center values', () => {
    expect(() => normalizeConfig({translationCenterServices: {includes: true}})).not.toThrow()
  })

  it('keeps per-instance credentials out of config history', () => {
    const secret = 'translation-service-instance-secret-sentinel'
    const config = normalizeConfig({
      serviceCredentials: {[services.microsoft]: serviceCredential(secret)},
    })

    expect(JSON.stringify(createBaselineConfigHistory(config, 'fixed-time'))).not.toContain(secret)
  })

})
