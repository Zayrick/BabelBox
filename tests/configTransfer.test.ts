import { describe, expect, it } from 'vitest'
import {services} from '@/src/core/config/catalog'
import {
  isConfigImportValid,
  prepareConfigForImport,
  sanitizeConfigForExport,
} from '@/src/core/config/transfer'
import {Config, normalizeConfig} from '@/src/core/config/model'
import {serviceInstance} from './fixtures/translationService'

const validConfig = {
  service: services.microsoft,
  display: 1,
  from: 'auto',
  to: 'zh-Hans',
}

function credential(apiKey: string) {
  return {apiKey, appKey: '', appSecret: '', secretId: '', secretKey: ''}
}

describe('configuration transfer helpers', () => {
  it('accepts the minimum import shape and rejects malformed values', () => {
    expect(isConfigImportValid(validConfig)).toBe(true)
    expect(isConfigImportValid({ ...validConfig, service: 42 })).toBe(false)
    expect(isConfigImportValid({ ...validConfig, to: undefined })).toBe(false)
    expect(isConfigImportValid({ ...validConfig, service: 'not-a-real-service' })).toBe(false)
    expect(isConfigImportValid({ service: services.microsoft })).toBe(false)
    expect(isConfigImportValid(null)).toBe(false)
  })

  it('导出包含 API 凭据，导入时整体采用文件中的配置并保留本机计数', () => {
    const instance = serviceInstance(services.openai)
    const current = new Config()
    current.count = 9
    current.translationServices.push(instance)
    current.serviceCredentials = {[instance.id]: credential('current-secret')}

    const exported = sanitizeConfigForExport({
      ...current,
      serviceCredentials: {[instance.id]: credential('exported-secret')},
    })
    expect(exported.serviceCredentials[instance.id].apiKey).toBe('exported-secret')
    expect(exported).not.toHaveProperty('count')

    const prepared = prepareConfigForImport({...exported, to: 'ja'}, current)
    expect(prepared.to).toBe('ja')
    expect(prepared.count).toBe(9)
    expect(prepared.serviceCredentials[instance.id]?.apiKey).toBe('exported-secret')
  })

  it('preserves always-translate site rules through export and normalized import', () => {
    const exported = sanitizeConfigForExport({
      ...validConfig,
      alwaysTranslateDomains: ['https://docs.example.com/guide', 'EXAMPLE.COM', 'news.bbc.co.uk'],
      disabledExtensionDomains: ['https://app.example.net/settings', 'EXAMPLE.NET'],
    })

    expect(exported.alwaysTranslateDomains).toEqual(['example.com', 'bbc.co.uk'])
    expect(isConfigImportValid(exported)).toBe(true)
    expect(normalizeConfig(exported).alwaysTranslateDomains).toEqual(['example.com', 'bbc.co.uk'])
    expect(normalizeConfig(exported).disabledExtensionDomains).toEqual(['example.net'])
  })
})
