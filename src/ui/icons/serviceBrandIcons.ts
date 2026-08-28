import {hex as microsoftHex, svg as microsoftSvg} from 'thesvg/microsoft'
import {hex as googleHex, svg as googleSvg} from 'thesvg/google-translate'
import {hex as deepLHex, svg as deepLSvg} from 'thesvg/deepl'
import {hex as tencentHex, svg as tencentSvg} from 'thesvg/tencentcloud'
import {hex as chromeHex, svg as chromeSvg} from 'thesvg/chrome'
import {hex as openaiHex, variants as openaiVariants} from 'thesvg/openai'
import {hex as azureOpenaiHex, svg as azureOpenaiSvg} from 'thesvg/azure-azure-openai'
import {hex as geminiHex, svg as geminiSvg} from 'thesvg/gemini'
import {hex as yiyanHex, svg as yiyanSvg} from 'thesvg/wenxin'
import {hex as tongyiHex, variants as tongyiVariants} from 'thesvg/qwen'
import {hex as zhipuHex, svg as zhipuSvg} from 'thesvg/zhipu'
import {hex as moonshotHex, svg as moonshotSvg} from 'thesvg/kimi'
import {hex as claudeHex, svg as claudeSvg} from 'thesvg/claude'
import {hex as infiniHex, svg as infiniSvg} from 'thesvg/infinigence'
import {hex as baichuanHex, svg as baichuanSvg} from 'thesvg/baichuan'
import {hex as lingyiHex, svg as lingyiSvg} from 'thesvg/01dotai'
import {hex as deepseekHex, svg as deepseekSvg} from 'thesvg/deepseek'
import {hex as minimaxHex, svg as minimaxSvg} from 'thesvg/minimax'
import {hex as mimoHex, svg as mimoSvg} from 'thesvg/xiaomi-mimo'
import {hex as jieyueHex, svg as jieyueSvg} from 'thesvg/stepfun'
import {hex as groqHex, svg as groqSvg} from 'thesvg/groq'
import {hex as cozeHex, svg as cozeSvg} from 'thesvg/coze'
import {hex as huanYuanHex, svg as huanYuanSvg} from 'thesvg/hunyuan'
import {hex as doubaoHex, svg as doubaoSvg} from 'thesvg/doubao'
import {hex as siliconCloudHex, svg as siliconCloudSvg} from 'thesvg/siliconcloud-siliconflow'
import {hex as openrouterHex, variants as openrouterVariants} from 'thesvg/openrouter'
import {hex as grokHex, svg as grokSvg} from 'thesvg/grok-xai'
import {hex as newapiHex, svg as newapiSvg} from 'thesvg/new-api'

export interface ServiceBrandIcon {
  color: string
  slug: string
  src: string
}

function normalizeHex(hex: string): string {
  const value = hex.replace(/^#/u, '')
  return /^[\da-f]{3,8}$/iu.test(value) ? `#${value}` : '#374151'
}

function resolveVariant(variants: Record<string, string>, name: string, slug: string): string {
  const svg = variants[name]
  if (!svg) throw new Error(`TheSVG 图标 ${slug} 缺少 ${name} variant`)
  return svg
}

function createBrandIcon(slug: string, svg: string, hex: string): ServiceBrandIcon {
  const color = normalizeHex(hex)
  const resolvedSvg = svg.replaceAll('currentColor', color)
  return Object.freeze({
    color,
    slug,
    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(resolvedSvg)}`,
  })
}

const deepLBrandIcon = createBrandIcon('deepl', deepLSvg, deepLHex)

export const serviceBrandIcons: Readonly<Record<string, ServiceBrandIcon>> = Object.freeze({
  microsoft: createBrandIcon('microsoft', microsoftSvg, microsoftHex),
  google: createBrandIcon('google-translate', googleSvg, googleHex),
  deepL: deepLBrandIcon,
  deeplx: deepLBrandIcon,
  tencent: createBrandIcon('tencentcloud', tencentSvg, tencentHex),
  chromeTranslator: createBrandIcon('chrome', chromeSvg, chromeHex),
  openai: createBrandIcon('openai', resolveVariant(openaiVariants, 'light', 'openai'), openaiHex),
  azureOpenai: createBrandIcon('azure-azure-openai', azureOpenaiSvg, azureOpenaiHex),
  gemini: createBrandIcon('gemini', geminiSvg, geminiHex),
  yiyan: createBrandIcon('wenxin', yiyanSvg, yiyanHex),
  tongyi: createBrandIcon('qwen', resolveVariant(tongyiVariants, 'light', 'qwen'), tongyiHex),
  zhipu: createBrandIcon('zhipu', zhipuSvg, zhipuHex),
  moonshot: createBrandIcon('kimi', moonshotSvg, moonshotHex),
  claude: createBrandIcon('claude', claudeSvg, claudeHex),
  infini: createBrandIcon('infinigence', infiniSvg, infiniHex),
  baichuan: createBrandIcon('baichuan', baichuanSvg, baichuanHex),
  lingyi: createBrandIcon('01dotai', lingyiSvg, lingyiHex),
  deepseek: createBrandIcon('deepseek', deepseekSvg, deepseekHex),
  minimax: createBrandIcon('minimax', minimaxSvg, minimaxHex),
  mimo: createBrandIcon('xiaomi-mimo', mimoSvg, mimoHex),
  jieyue: createBrandIcon('stepfun', jieyueSvg, jieyueHex),
  groq: createBrandIcon('groq', groqSvg, groqHex),
  cozecom: createBrandIcon('coze', cozeSvg, cozeHex),
  cozecn: createBrandIcon('coze', cozeSvg, cozeHex),
  huanYuan: createBrandIcon('hunyuan', huanYuanSvg, huanYuanHex),
  huanYuanTranslation: createBrandIcon('hunyuan', huanYuanSvg, huanYuanHex),
  doubao: createBrandIcon('doubao', doubaoSvg, doubaoHex),
  siliconCloud: createBrandIcon('siliconcloud-siliconflow', siliconCloudSvg, siliconCloudHex),
  openrouter: createBrandIcon(
    'openrouter',
    resolveVariant(openrouterVariants, 'light', 'openrouter'),
    openrouterHex,
  ),
  grok: createBrandIcon('grok-xai', grokSvg, grokHex),
  newapi: createBrandIcon('new-api', newapiSvg, newapiHex),
})

export type ServiceFallbackIconKey = 'languages' | 'server' | 'custom' | 'unknown'

/** TheSVG 3.3.1 中没有准确品牌资源的服务使用语义图标。 */
export const serviceFallbackIconKeys: Readonly<Record<string, ServiceFallbackIconKey>> = Object.freeze({
  freeTranslation: 'languages',
  xiaoniu: 'languages',
  youdao: 'languages',
  custom: 'custom',
})

export function resolveServiceBrandIcon(service: string): ServiceBrandIcon | undefined {
  return serviceBrandIcons[service]
}

export function resolveServiceFallbackIconKey(service: string): ServiceFallbackIconKey {
  return serviceFallbackIconKeys[service] ?? 'unknown'
}
