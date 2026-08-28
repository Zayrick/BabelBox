import {describe, expect, it} from 'vitest'
import {options, services} from '@/src/core/config/catalog'
import {createServiceConfigurationPresentation} from '@/src/features/settings/model/serviceConfiguration'

describe('service configuration presentation', () => {
  it.each([
    [services.deepL, 'token'],
    [services.deeplx, 'deepLxEndpoint'],
    [services.cozecom, 'robotId'],
    [services.cozecn, 'robotId'],
  ] as const)('shows %s parameters without a misleading ready state', (service, field) => {
    const presentation = createServiceConfigurationPresentation(service)

    expect(presentation.mode).toBe('connection-only')
    expect(presentation.showModelConfiguration).toBe(false)
    expect(presentation.showConnectionConfiguration).toBe(true)
    expect(presentation.showReadyState).toBe(false)
    expect(presentation.fields[field]).toBe(true)
  })

  it('uses the ready state only for services without editable settings', () => {
    const readyServices = options.services
      .filter((service) => !service.disabled)
      .filter((service) => createServiceConfigurationPresentation(service.value).showReadyState)
      .map((service) => service.value)

    expect(readyServices).toEqual([
      services.freeTranslation,
      services.microsoft,
      services.google,
      services.chromeTranslator,
    ])

    const microsoft = createServiceConfigurationPresentation(services.microsoft)
    expect(microsoft.mode).toBe('ready')
    expect(microsoft.showConnectionConfiguration).toBe(false)
    expect(microsoft.showCredentialNotice).toBe(false)
    expect(microsoft.showConnectionTest).toBe(true)
    expect(microsoft.readyState.title).toBe('无需额外配置')
  })

  it('keeps model selection and provider parameters visible together', () => {
    const openai = createServiceConfigurationPresentation(services.openai)
    const hunyuanTranslation = createServiceConfigurationPresentation(services.huanYuanTranslation)

    expect(openai.mode).toBe('model-and-connection')
    expect(openai.showModelConfiguration).toBe(true)
    expect(openai.fields.token).toBe(true)
    expect(hunyuanTranslation.mode).toBe('model-and-connection')
    expect(hunyuanTranslation.fields.tencentCredentials).toBe(true)
  })

  it('does not present an unavailable browser service as ready to use', () => {
    const unavailable = createServiceConfigurationPresentation(
      services.chromeTranslator,
      {
        available: false,
        unavailableMessage: '当前浏览器不支持此服务。',
      },
    )

    expect(unavailable.mode).toBe('unavailable')
    expect(unavailable.showReadyState).toBe(false)
    expect(unavailable.showUnavailableState).toBe(true)
    expect(unavailable.showConnectionTest).toBe(false)
    expect(unavailable.unavailableState.description).toBe('当前浏览器不支持此服务。')

    const retiredService = createServiceConfigurationPresentation('retired-service')
    expect(retiredService.mode).toBe('unavailable')
    expect(retiredService.showConnectionTest).toBe(false)
  })
})
