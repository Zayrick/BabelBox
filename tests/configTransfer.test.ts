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

  it('导出时移除凭据、旧版明文凭据字段和内部 revision', () => {
    const secret = 'export-secret-sentinel'
    const sanitized = sanitizeConfigForExport({
      ...validConfig,
      serviceCredentials: {any: credential(secret)},
      token: {openai: secret},
      youdaoAppKey: secret,
      tencentSecretKey: secret,
      extra: {jwt: secret},
      __babelboxConfigRevision: 42,
    })

    expect(JSON.stringify(sanitized)).not.toContain(secret)
    for (const field of ['serviceCredentials', 'token', 'youdaoAppKey', 'tencentSecretKey', 'extra', '__babelboxConfigRevision']) {
      expect(sanitized).not.toHaveProperty(field)
    }
  })

  it('导入公开配置时只保留目的地未变化的当前凭据', () => {
    const kept = serviceInstance(services.openai, {endpoint: 'https://same.example/v1'})
    const moved = serviceInstance(services.openai, {endpoint: 'https://before.example/v1'})
    const current = new Config()
    current.translationServices.push(kept, moved)
    current.serviceCredentials = {[kept.id]: credential('kept-secret'), [moved.id]: credential('moved-secret')}

    const imported = {
      ...validConfig,
      to: 'ja',
      translationServices: [...current.translationServices.slice(0, 3), kept, {...moved, endpoint: 'https://after.example/v1'}],
      serviceCredentials: {[kept.id]: credential('imported-secret')},
    }
    const prepared = prepareConfigForImport(imported, current)

    expect(prepared.to).toBe('ja')
    expect(prepared.serviceCredentials[kept.id]?.apiKey).toBe('kept-secret')
    expect(prepared.serviceCredentials[moved.id]).toBeUndefined()
  })

  it('preserves always-translate site rules through export and normalized import', () => {
    const exported = sanitizeConfigForExport({
      ...validConfig,
      alwaysTranslateDomains: ['https://docs.example.com/guide', 'EXAMPLE.COM', 'news.bbc.co.uk'],
      disabledExtensionDomains: ['https://app.example.net/settings', 'EXAMPLE.NET'],
    })

    expect(exported.alwaysTranslateDomains).toEqual([
      'https://docs.example.com/guide',
      'EXAMPLE.COM',
      'news.bbc.co.uk',
    ])
    expect(isConfigImportValid(exported)).toBe(true)
    expect(normalizeConfig(exported).alwaysTranslateDomains).toEqual(['example.com', 'bbc.co.uk'])
    expect(normalizeConfig(exported).disabledExtensionDomains).toEqual(['example.net'])
  })
})
