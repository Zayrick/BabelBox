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

/** 导出完整配置（含 API 凭据），只去掉本机统计。 */
export function sanitizeConfigForExport(value: unknown): ConfigRecord {
  if (!isRecord(value)) throw new Error('配置必须是 JSON 对象')

  const exported = {...normalizeConfig(value)} as ConfigRecord
  delete exported.count
  return exported
}

/** 导入的配置整体替换当前配置，只保留本机翻译计数。 */
export function prepareConfigForImport(value: unknown, current: unknown): Config {
  return normalizeConfig({
    ...(isRecord(value) ? value : {}),
    count: normalizeConfig(current).count,
  })
}
