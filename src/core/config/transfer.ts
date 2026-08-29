import { isCustomBodyMapping } from './customBody'
import {
  extractConfigCredentials,
  filterConfigCredentialsForDestination,
  hasCredentialFields,
  mergeConfigCredentials,
  sanitizeConfigCredentials,
} from './credentials'
import { normalizeConfig, type Config } from './model'
import { defaultOption } from './catalog'
import { getTranslationServiceInstance } from './translationServices'

type ConfigRecord = Record<string, any>

const requiredConfigFields = ['on', 'service', 'display', 'from', 'to'] as const

function isRecord(value: unknown): value is ConfigRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isConfigImportValid(value: unknown): value is ConfigRecord {
  if (!isRecord(value)) return false
  if (!requiredConfigFields.every((field) => field in value)) return false
  if (typeof value.on !== 'boolean') return false
  if (value.display !== 0 && value.display !== 1) return false
  if (typeof value.from !== 'string' || !value.from.trim()) return false
  if (typeof value.to !== 'string' || !value.to.trim()) return false
  if (typeof value.service !== 'string' || !value.service.trim()) return false
  if (!getTranslationServiceInstance(normalizeConfig(value), value.service)) return false
  return !('customBody' in value) || isCustomBodyMapping(value.customBody)
}

function removeDefaultEntries(target: ConfigRecord, key: 'system_role' | 'user_role', defaultValue: string) {
  const entries = target[key]
  if (!isRecord(entries)) return

  for (const [service, value] of Object.entries(entries)) {
    if (value === defaultValue) delete entries[service]
  }

  if (Object.keys(entries).length === 0) delete target[key]
}

function removeEmptyCustomBodies(target: ConfigRecord) {
  const entries = target.customBody
  if (!isRecord(entries)) return

  for (const [service, value] of Object.entries(entries)) {
    if (typeof value !== 'string' || !value.trim()) delete entries[service]
  }

  if (Object.keys(entries).length === 0) delete target.customBody
}

export function sanitizeConfigForExport(value: unknown): ConfigRecord {
  if (!isRecord(value)) throw new Error('配置必须是 JSON 对象')

  const sanitized = sanitizeConfigCredentials(
    JSON.parse(JSON.stringify(value)),
  ) as ConfigRecord
  delete sanitized.__babelboxConfigRevision
  delete sanitized.count
  delete sanitized.persistCredentials
  removeDefaultEntries(sanitized, 'system_role', defaultOption.system_role)
  removeDefaultEntries(sanitized, 'user_role', defaultOption.user_role)
  removeEmptyCustomBodies(sanitized)
  return sanitized
}

/**
 * 新版导出不含凭据，因此导入时保留当前 session 凭据；旧版导出若含凭据，
 * 则显式迁移该凭据。持久化开关始终保留当前值，不能由导入文件静默开启。
 */
export function prepareConfigForImport(value: unknown, current: unknown): Config {
  const currentConfig = normalizeConfig(current)
  const importedConfig = normalizeConfig(value)
  const credentials = hasCredentialFields(value)
    ? extractConfigCredentials(importedConfig)
    : filterConfigCredentialsForDestination(
      extractConfigCredentials(currentConfig),
      currentConfig,
      importedConfig,
    )

  return normalizeConfig(mergeConfigCredentials({
    ...sanitizeConfigCredentials(importedConfig),
    count: currentConfig.count,
    persistCredentials: currentConfig.persistCredentials,
    videoServiceDefaultMigrated: currentConfig.videoServiceDefaultMigrated,
  }, credentials))
}
