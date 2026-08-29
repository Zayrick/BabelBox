import { describe, expect, it } from 'vitest'
import {defaultOption, services} from '@/src/core/config/catalog'
import {
  isConfigImportValid,
  prepareConfigForImport,
  sanitizeConfigForExport,
} from '@/src/core/config/transfer'
import {normalizeConfig} from '@/src/core/config/model'

const validConfig = {
  on: true,
  service: 'openai',
  display: 1,
  from: 'auto',
  to: 'zh-Hans',
}

describe('configuration transfer helpers', () => {
  it('accepts the minimum import shape and rejects malformed values', () => {
    expect(isConfigImportValid(validConfig)).toBe(true)
    expect(isConfigImportValid({ ...validConfig, service: 42 })).toBe(false)
    expect(isConfigImportValid({ ...validConfig, customBody: { openai: '{}' } })).toBe(true)
    expect(isConfigImportValid({ ...validConfig, customBody: { openai: null } })).toBe(false)
    expect(isConfigImportValid({ ...validConfig, to: undefined })).toBe(false)
    expect(isConfigImportValid({ ...validConfig, service: 'not-a-real-service' })).toBe(false)
    expect(isConfigImportValid({ service: 'openai' })).toBe(false)
    expect(isConfigImportValid(null)).toBe(false)
  })

  it('removes default-only fields without mutating the source', () => {
    const source = {
      ...validConfig,
      system_role: {
        openai: defaultOption.system_role,
        deepseek: 'Translate with a concise tone.',
      },
      user_role: {
        openai: defaultOption.user_role,
      },
      customBody: {
        openai: '   ',
        deepseek: '{"thinking":{"type":"disabled"}}',
      },
    }

    const sanitized = sanitizeConfigForExport(source)

    expect(sanitized).toEqual({
      ...validConfig,
      system_role: { deepseek: 'Translate with a concise tone.' },
      customBody: { deepseek: '{"thinking":{"type":"disabled"}}' },
    })
    expect(source.system_role).toHaveProperty('openai')
    expect(source.user_role).toHaveProperty('openai')
    expect(source.customBody).toHaveProperty('openai')
  })

  it('removes empty maps after cleaning their entries', () => {
    const sanitized = sanitizeConfigForExport({
      ...validConfig,
      system_role: { openai: defaultOption.system_role },
      user_role: { openai: defaultOption.user_role },
      customBody: { openai: '' },
    })

    expect(sanitized).toEqual(validConfig)
  })

  it('导出时移除所有凭据字段和内部 revision', () => {
    const secret = 'export-secret-sentinel'
    const sanitized = sanitizeConfigForExport({
      ...validConfig,
      token: {openai: secret},
      ak: secret,
      sk: secret,
      appid: secret,
      key: secret,
      youdaoAppKey: secret,
      youdaoAppSecret: secret,
      tencentSecretId: secret,
      tencentSecretKey: secret,
      extra: {jwt: secret},
      __babelboxConfigRevision: 42,
    })

    expect(JSON.stringify(sanitized)).not.toContain(secret)
    for (const field of [
      'token', 'ak', 'sk', 'appid', 'key', 'youdaoAppKey', 'youdaoAppSecret',
      'tencentSecretId', 'tencentSecretKey', 'extra', '__babelboxConfigRevision',
    ]) {
      expect(sanitized).not.toHaveProperty(field)
    }
  })

  it('导入新版公开配置时保留当前 session 凭据和持久化选择', () => {
    const currentSecret = 'current-session-secret'
    const prepared = prepareConfigForImport(
      {...validConfig, to: 'ja', persistCredentials: true},
      {...validConfig, token: {openai: currentSecret}, persistCredentials: false},
    )

    expect(prepared.to).toBe('ja')
    expect(prepared.token.openai).toBe(currentSecret)
    expect(prepared.persistCredentials).toBe(false)
  })

  it('导入旧文件时迁移其中凭据，但不能由文件静默开启本地持久化', () => {
    const legacySecret = 'legacy-import-secret'
    const prepared = prepareConfigForImport(
      {...validConfig, token: {openai: legacySecret}, extra: {jwt: legacySecret}, persistCredentials: true},
      {...validConfig, token: {openai: 'current-secret'}, persistCredentials: false},
    )

    expect(prepared.token.openai).toBe(legacySecret)
    expect(prepared.extra).toEqual({jwt: legacySecret})
    expect(prepared.persistCredentials).toBe(false)
  })

  it('导入带凭据的旧双模型配置时保留新文档实例的凭据', () => {
    const importedSecret = 'legacy-document-import-secret'
    const prepared = prepareConfigForImport(
      {
        ...validConfig,
        service: services.openai,
        documentService: services.openai,
        model: {[services.openai]: 'web-model'},
        documentModel: {[services.openai]: 'document-model'},
        token: {[services.openai]: importedSecret},
      },
      {
        ...validConfig,
        token: {[services.openai]: 'current-session-secret'},
        persistCredentials: false,
      },
    )

    expect(prepared.documentService).toBe('service:openai:document')
    expect(prepared.token[services.openai]).toBe(importedSecret)
    expect(prepared.serviceCredentials[prepared.documentService]?.apiKey).toBe(importedSecret)
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
