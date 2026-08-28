import {describe, expect, it} from 'vitest'
import {services} from '@/src/core/config/catalog'
import {
  resolveServiceBrandIcon,
  resolveServiceFallbackIconKey,
  serviceBrandIcons,
  serviceFallbackIconKeys,
} from '@/src/ui/icons/serviceBrandIcons'

describe('translation service brand icons', () => {
  it('makes an explicit icon decision for every public translation service', () => {
    const brandServices = Object.keys(serviceBrandIcons)
    const fallbackServices = Object.keys(serviceFallbackIconKeys)

    expect(brandServices.filter((service) => fallbackServices.includes(service))).toEqual([])
    expect([...brandServices, ...fallbackServices].sort()).toEqual(Object.values(services).sort())
  })

  it('uses product-specific TheSVG assets for representative services', () => {
    expect(resolveServiceBrandIcon(services.microsoft)?.slug).toBe('azure-translator-text')
    expect(resolveServiceBrandIcon(services.google)?.slug).toBe('google-translate')
    expect(resolveServiceBrandIcon(services.chromeTranslator)?.slug).toBe('chrome')
    expect(resolveServiceBrandIcon(services.azureOpenai)?.slug).toBe('azure-azure-openai')
    expect(resolveServiceBrandIcon(services.gemini)?.slug).toBe('gemini')
    expect(resolveServiceBrandIcon(services.moonshot)?.slug).toBe('kimi')
    expect(resolveServiceBrandIcon(services.mimo)?.slug).toBe('xiaomi-mimo')
    expect(resolveServiceBrandIcon(services.siliconCloud)?.slug).toBe('siliconcloud-siliconflow')
    expect(resolveServiceBrandIcon(services.newapi)?.slug).toBe('new-api')
  })

  it('keeps imported SVGs self-contained and isolated as image sources', () => {
    for (const icon of Object.values(serviceBrandIcons)) {
      expect(icon.src).toMatch(/^data:image\/svg\+xml;charset=utf-8,/u)

      const svg = decodeURIComponent(icon.src.slice(icon.src.indexOf(',') + 1))
      expect(svg).toMatch(/^<svg\b/u)
      expect(svg).not.toContain('currentColor')
      expect(svg).not.toMatch(/<(?:script|image)\b/iu)
      expect(svg).not.toMatch(/\s(?:href|xlink:href|on\w+)\s*=/iu)

      const ids = new Set(Array.from(svg.matchAll(/\bid="([^"]+)"/gu), (match) => match[1]))
      const unresolvedIds = Array.from(svg.matchAll(/url\(#([^)]+)\)/gu), (match) => match[1])
        .filter((id) => !ids.has(id))
      expect(unresolvedIds, `${icon.slug} 引用了未定义的 SVG id`).toEqual([])
    }
  })

  it('uses semantic Lucide fallbacks only when TheSVG has no exact service asset', () => {
    expect(resolveServiceBrandIcon(services.deeplx)).toBeUndefined()
    expect(resolveServiceFallbackIconKey(services.freeTranslation)).toBe('languages')
    expect(resolveServiceFallbackIconKey(services.deeplx)).toBe('server')
    expect(resolveServiceFallbackIconKey(services.xiaoniu)).toBe('languages')
    expect(resolveServiceFallbackIconKey(services.youdao)).toBe('languages')
    expect(resolveServiceFallbackIconKey(services.custom)).toBe('custom')
    expect(resolveServiceFallbackIconKey('future-service')).toBe('unknown')
  })
})
