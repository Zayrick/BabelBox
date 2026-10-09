import {describe, expect, it} from 'vitest'
import {services} from '@/src/core/config/catalog'
import {builtinTranslationProviders} from '@/src/core/config/translationServices'
import {createServiceConfigurationPresentation} from '@/src/features/settings/model/serviceConfiguration'

describe('service configuration presentation', () => {
  it('shows built-in services as ready to use without editable fields', () => {
    for (const provider of builtinTranslationProviders) {
      const presentation = createServiceConfigurationPresentation(provider, {builtin: true})
      expect(presentation.mode).toBe('ready')
      expect(presentation.showConnectionConfiguration).toBe(false)
      expect(presentation.showConnectionTest).toBe(true)
      expect(Object.values(presentation.fields).some(Boolean)).toBe(false)
    }
  })

  it.each([
    [services.deepL, ['name', 'endpoint', 'token']],
    [services.deeplx, ['name', 'endpoint', 'token']],
    [services.youdao, ['name', 'endpoint', 'youdaoCredentials']],
    [services.cozecom, ['name', 'endpoint', 'token', 'robotId', 'prompts', 'customBody', 'concurrency']],
    [services.openai, ['name', 'model', 'endpoint', 'token', 'prompts', 'customBody', 'concurrency']],
    [services.huanYuanTranslation, ['name', 'model', 'endpoint', 'tencentCredentials', 'customBody', 'concurrency']],
    [services.minimax, ['name', 'model', 'token', 'minimaxRegion', 'prompts', 'customBody', 'concurrency']],
  ] as const)('shows exactly the fields %s reads', (provider, visible) => {
    const presentation = createServiceConfigurationPresentation(provider)
    const shown = Object.entries(presentation.fields).filter(([, value]) => value).map(([key]) => key)

    expect(presentation.mode).toBe('configurable')
    expect(shown.sort()).toEqual([...visible].sort())
  })

  it('hides the DeepSeek thinking mode for the Responses API', () => {
    expect(createServiceConfigurationPresentation(services.deepseek).fields.deepseekThinkingMode).toBe(true)
    expect(createServiceConfigurationPresentation(services.deepseek, {deepseekApiType: 'responses'})
      .fields.deepseekThinkingMode).toBe(false)
  })

  it('does not present an unavailable or unknown service as ready to use', () => {
    const unavailable = createServiceConfigurationPresentation(services.chromeTranslator, {
      builtin: true,
      available: false,
      unavailableMessage: '当前浏览器不支持此服务。',
    })

    expect(unavailable.mode).toBe('unavailable')
    expect(unavailable.showReadyState).toBe(false)
    expect(unavailable.showUnavailableState).toBe(true)
    expect(unavailable.showConnectionTest).toBe(false)
    expect(unavailable.unavailableState.description).toBe('当前浏览器不支持此服务。')

    expect(createServiceConfigurationPresentation('retired-service').mode).toBe('unavailable')
  })
})
