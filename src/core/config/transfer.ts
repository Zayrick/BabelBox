import {
  extractConfigCredentials,
  filterConfigCredentialsForDestination,
  mergeConfigCredentials,
  sanitizeConfigCredentials,
} from './credentials'
import { normalizeConfig, type Config } from './model'
import { getTranslationServiceInstance } from './translationServices'

type ConfigRecord = Record<string, any>

const requiredConfigFields = ['service', 'display', 'from', 'to'] as const

function isRecord(value: unknown): value is ConfigRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function isConfigImportValid(value: unknown): value is ConfigRecord {
  if (!isRecord(value)) return false
  if (!requiredConfigFields.every((field) => field in value)) return false
  if (value.display !== 0 && value.display !== 1) return false
  if (typeof value.from !== 'string' || !value.from.trim()) return false
  if (typeof value.to !== 'string' || !value.to.trim()) return false
  if (typeof value.service !== 'string' || !value.service.trim()) return false
  return Boolean(getTranslationServiceInstance(normalizeConfig(value), value.service))
}

export function sanitizeConfigForExport(value: unknown): ConfigRecord {
  if (!isRecord(value)) throw new Error('配置必须是 JSON 对象')

  const sanitized = sanitizeConfigCredentials(
    JSON.parse(JSON.stringify(value)),
  ) as ConfigRecord
  delete sanitized.__babelboxConfigRevision
  delete sanitized.count
  return sanitized
}

/** 导入公开配置时只保留目的地未变化的当前凭据。 */
export function prepareConfigForImport(value: unknown, current: unknown): Config {
  const currentConfig = normalizeConfig(current)
  const importedConfig = normalizeConfig(sanitizeConfigCredentials(value))
  const credentials = filterConfigCredentialsForDestination(
    extractConfigCredentials(currentConfig),
    currentConfig,
    importedConfig,
  )

  return normalizeConfig(mergeConfigCredentials({
    ...importedConfig,
    count: currentConfig.count,
  }, credentials))
}
