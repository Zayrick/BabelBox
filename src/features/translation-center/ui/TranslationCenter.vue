<template>
  <section class="translation-center" aria-label="翻译中心">
    <p v-if="hiddenUnavailableServices.length" class="translation-capability-warning" role="status">当前浏览器暂不支持 Chrome 内置翻译；该对比项已暂时隐藏，原配置会保留。</p>
    <div class="translation-center-toolbar">
      <div class="language-picker-group">
        <label for="translation-center-source">源语言</label>
        <el-select
          id="translation-center-source"
          v-model="sourceLanguage"
          class="language-picker"
          aria-label="翻译中心源语言"
          @change="persistTranslationCenterConfig"
        >
          <el-option v-for="item in sourceLanguageOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </div>

      <button
        class="language-swap-button"
        type="button"
        aria-label="交换源语言和目标语言"
        title="交换源语言和目标语言"
        :disabled="sourceLanguage === 'auto'"
        @click="swapLanguages"
      >
        <ArrowLeftRight aria-hidden="true" />
      </button>

      <div class="language-picker-group">
        <label for="translation-center-target">目标语言</label>
        <el-select
          id="translation-center-target"
          v-model="targetLanguage"
          class="language-picker"
          aria-label="翻译中心目标语言"
          @change="persistTranslationCenterConfig"
        >
          <el-option v-for="item in targetLanguageOptions" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </div>

      <div class="translation-center-toolbar-actions">
        <div ref="servicePicker" class="translation-center-service-picker">
          <button
            class="add-service-button"
            type="button"
            :aria-expanded="servicePickerOpen"
            aria-haspopup="dialog"
            @click.stop="servicePickerOpen = !servicePickerOpen"
          >
            <Plus class="add-service-icon" aria-hidden="true" />
            更多服务
            <b>{{ cards.length }}</b>
            <ChevronDown class="add-service-chevron" aria-hidden="true" />
          </button>
          <div v-if="servicePickerOpen" class="service-picker-popover" role="dialog" aria-label="添加更多翻译服务">
            <header class="service-picker-header">
              <div>
                <strong>添加更多服务</strong>
              </div>
              <button type="button" class="service-picker-close" aria-label="关闭更多服务" @click="servicePickerOpen = false">
                <X aria-hidden="true" />
              </button>
            </header>
            <label class="service-picker-search">
              <Search class="service-picker-search-icon" aria-hidden="true" />
              <input v-model.trim="serviceSearchQuery" type="search" placeholder="搜索服务名称" aria-label="搜索翻译服务" />
            </label>
            <div class="service-picker-groups">
              <section v-for="group in filteredServiceGroups" :key="group.key" class="service-picker-group">
                <div class="service-picker-group-heading">
                  <strong>{{ group.label }}</strong>
                  <span>{{ group.items.length }}</span>
                </div>
                <button
                  v-for="item in group.items"
                  :key="item.value"
                  type="button"
                  class="service-picker-option"
                  @click="addService(item.value)"
                >
                  <ServiceIcon :service="item.provider" :label="item.label" size="small" />
                  <span class="service-picker-option-copy">
                    <strong>{{ item.label }}</strong>
                    <small>{{ serviceDescription(item.value) }}</small>
                  </span>
                  <span class="service-picker-option-add" aria-hidden="true"><Plus /></span>
                </button>
              </section>
              <p v-if="filteredServiceGroups.length === 0">没有找到可添加的翻译服务</p>
            </div>
          </div>
        </div>
        <div class="translation-center-run-status" :class="{ active: isRunning }" aria-live="polite">
          <i />
          <span>{{ isRunning ? '正在翻译' : runCount ? `已翻译 ${runCount} 次` : '等待输入' }}</span>
        </div>
      </div>
    </div>

    <div class="translation-center-layout">
      <section class="translation-input-panel" aria-labelledby="translation-input-title">
        <div class="translation-panel-heading">
          <div>
            <h3 id="translation-input-title">待翻译文本</h3>
          </div>
          <span class="language-pair-label">{{ languageLabel(sourceLanguage) }} → {{ languageLabel(targetLanguage) }}</span>
        </div>

        <textarea
          v-model="sourceText"
          maxlength="5000"
          placeholder="输入要翻译的句子…"
          aria-label="待翻译文本"
          @keydown.ctrl.enter.prevent="runTranslation"
          @keydown.meta.enter.prevent="runTranslation"
        />

        <div class="translation-input-footer">
          <span>{{ sourceText.length }}/5000</span>
          <button
            class="translate-primary-button"
            type="button"
            :disabled="!sourceText.trim() || !cards.length || isRunning"
            @click="runTranslation"
          >
            <span>{{ isRunning ? '翻译中…' : runCount ? '再次翻译' : '开始翻译' }}</span>
            <small>⌘↵</small>
          </button>
        </div>
      </section>

      <section class="translation-results-panel" aria-labelledby="translation-results-title">
        <div class="translation-panel-heading results-heading">
          <div>
            <h3 id="translation-results-title">{{ cards.length }} 个翻译服务</h3>
          </div>
          <div class="results-heading-actions">
            <span class="results-order-hint"><GripVertical aria-hidden="true" />拖动卡片可排序</span>
            <button
              class="copy-all-button"
              type="button"
              :disabled="successfulCards.length === 0"
              @click="copyAllResults"
            >
              <Copy aria-hidden="true" />
              {{ copiedService === 'all' ? '已复制' : '复制全部' }}
            </button>
          </div>
        </div>

        <div class="translation-result-list">
          <article
            v-for="card in cards"
            :key="card.service"
            class="translation-result-card"
            :data-service="card.service"
            :data-status="card.status"
            :class="{ 'is-dragging': draggingService === card.service, 'is-drag-over': dragOverService === card.service }"
          >
            <header class="translation-result-card-header">
              <div class="translation-result-service-name">
                <button
                  class="drag-handle"
                  type="button"
                  :aria-label="`拖动${serviceLabel(card.service)}调整顺序`"
                  title="拖动调整顺序，也可用 Alt+↑/↓"
                  tabindex="0"
                  @pointerdown.prevent.stop="startPointerDrag(card.service, $event)"
                  @keydown.alt.arrow-up.prevent="moveCard(card.service, -1)"
                  @keydown.alt.arrow-down.prevent="moveCard(card.service, 1)"
                >
                  <GripVertical aria-hidden="true" />
                </button>
                <ServiceIcon :service="serviceProvider(card.service)" :label="serviceLabel(card.service)" size="medium" />
                <div>
                  <strong>{{ serviceLabel(card.service) }}</strong>
                </div>
              </div>
              <div class="translation-result-card-actions">
                <span v-if="card.status === 'success'" class="result-state success">完成</span>
                <span v-else-if="card.status === 'loading'" class="result-state loading">翻译中</span>
                <span v-else-if="card.status === 'error'" class="result-state error">失败</span>
                <button
                  class="remove-service-button"
                  type="button"
                  :aria-label="`移除${serviceLabel(card.service)}`"
                  :disabled="cards.length <= 1"
                  @click="removeService(card.service)"
                >
                  <X aria-hidden="true" />
                </button>
              </div>
            </header>

            <div v-if="card.status === 'idle'" class="translation-result-placeholder">
              点击“开始翻译”，在这里查看结果
            </div>
            <div v-else-if="card.status === 'loading'" class="translation-result-placeholder loading-placeholder">
              <span class="loading-bars"><i /><i /><i /></span>
              正在请求 {{ serviceLabel(card.service) }}…
            </div>
            <div v-else-if="card.status === 'success'" class="translation-result-content">
              <p>{{ card.result }}</p>
              <footer>
                <span>{{ card.duration }} ms · 第 {{ card.run }} 次</span>
                <button type="button" @click="copyResult(card)">
                  <Copy aria-hidden="true" />
                  {{ copiedService === card.service ? '已复制' : '复制译文' }}
                </button>
              </footer>
            </div>
            <div v-else class="translation-result-error">
              <p>{{ card.error }}</p>
              <button type="button" :disabled="!sourceText.trim() || isRunning" @click="retryService(card.service)">
                <RefreshCw aria-hidden="true" />
                重试
              </button>
            </div>
          </article>
        </div>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  ArrowLeftRight,
  ChevronDown,
  Copy,
  GripVertical,
  Plus,
  RefreshCw,
  Search,
  X,
} from '@lucide/vue'
import {browser} from 'wxt/browser'
import ServiceIcon from '@/src/ui/components/ServiceIcon.vue'
import {
  getSelectableTranslationServices,
  isTranslationServiceAvailable,
} from '@/src/services/translation/capabilities'
import { options } from '@/src/core/config/catalog'
import {
  getTranslationServiceOptions,
  type TranslationServiceOption,
} from '@/src/core/config/translationServices'
import { config, configReady, requestConfigSave, subscribeConfig } from '@/src/services/config/store'
import { translateText } from '@/src/services/translation/client'

type TranslationCardStatus = 'idle' | 'loading' | 'success' | 'error'

type TranslationCard = {
  service: string
  status: TranslationCardStatus
  result: string
  error: string
  duration: number
  run: number
}

const DEFAULT_MACHINE_COMPARISON_SERVICES = ['freeTranslation', 'google', 'deeplx']
const MAX_TEXT_LENGTH = 5000

const sourceText = ref('')
const sourceLanguage = ref('auto')
const targetLanguage = ref('zh-Hans')
const runCount = ref(0)
const isRunning = ref(false)
const servicePickerOpen = ref(false)
const serviceSearchQuery = ref('')
const copiedService = ref('')
const servicePicker = ref<HTMLElement | null>(null)
const cards = ref<TranslationCard[]>([])
const draggingService = ref('')
const dragOverService = ref('')
const configVersion = ref(0)
let activeController: AbortController | null = null
let activeRunId = 0
let copiedTimer: ReturnType<typeof setTimeout> | undefined
let unsubscribeConfig: (() => void) | undefined
let configHydrated = false
let pendingConfigHydration = false
let pointerDrag: { service: string; pointerId: number } | null = null

const enabledServiceOptions = computed(() => {
  void configVersion.value
  return getTranslationServiceOptions(config, true)
})
const serviceOptions = computed(() => {
  void configVersion.value
  return getSelectableTranslationServices(config)
})
const enabledServiceOptionById = computed(() => new Map(enabledServiceOptions.value.map(item => [item.value, item])))
const hiddenUnavailableServices = computed(() => Array.isArray(config.translationCenterServices)
  ? config.translationCenterServices.filter(service => {
      const option = enabledServiceOptionById.value.get(service)
      return option && !isTranslationServiceAvailable(option.value, undefined, option.provider)
    })
  : [])
const selectedServiceValues = computed(() => new Set(cards.value.map(card => card.service)))
const availableServiceOptions = computed(() => serviceOptions.value.filter(item => !selectedServiceValues.value.has(item.value)))
const successfulCards = computed(() => cards.value.filter(card => card.status === 'success' && card.result))
const sourceLanguageOptions = computed(() => [
  { value: 'auto', label: '自动检测' },
  ...options.to,
])
const targetLanguageOptions = computed(() => options.to)
const filteredServiceGroups = computed(() => {
  const keyword = serviceSearchQuery.value.toLocaleLowerCase()
  const filterItems = (items: TranslationServiceOption[]) => items.filter(item => {
    if (!keyword) return true
    return `${item.label}${item.description || ''}`.toLocaleLowerCase().includes(keyword)
  })
  return [
    {
      key: 'machine',
      label: '机器翻译',
      items: filterItems(availableServiceOptions.value.filter(item => item.kind === 'machine')),
    },
    {
      key: 'ai',
      label: 'AI 翻译',
      items: filterItems(availableServiceOptions.value.filter(item => item.kind === 'ai')),
    },
  ].filter(group => group.items.length > 0)
})

function createCard(service: string): TranslationCard {
  return { service, status: 'idle', result: '', error: '', duration: 0, run: 0 }
}

function serviceLabel(service: string): string {
  return enabledServiceOptionById.value.get(service)?.label || service
}

function serviceProvider(service: string): string {
  return enabledServiceOptionById.value.get(service)?.provider || service
}

function serviceDescription(service: string): string {
  const option = enabledServiceOptionById.value.get(service)
  if (option?.description) return option.description.split('；')[0]
  return service === 'freeTranslation' ? '无需密钥，自动尝试多个免费接口' : '使用设置中已保存的连接配置'
}

function languageLabel(value: string): string {
  if (value === 'auto') return '自动检测'
  return targetLanguageOptions.value.find(item => item.value === value)?.label || value
}

function getValidServiceOrder(value: unknown): string[] {
  const availableValues = new Set(serviceOptions.value.map(item => item.value))
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && availableValues.has(item)))]
}

function getDefaultServiceOrder(): string[] {
  const machineOptions = serviceOptions.value.filter(item => item.kind === 'machine')
  const configured = DEFAULT_MACHINE_COMPARISON_SERVICES.filter(service => machineOptions.some(item => item.value === service))
  return configured.length ? configured : [machineOptions[0]?.value || serviceOptions.value[0]?.value].filter(Boolean) as string[]
}

function getCurrentServiceOrder(): string[] {
  return cards.value.map(card => card.service)
}

function applyServiceOrder(order: string[]): void {
  cards.value = order.map(createCard)
}

function hasSameOrder(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((service, index) => service === right[index])
}

function persistTranslationCenterConfig(): void {
  if (!configHydrated) return
  const available = [...getCurrentServiceOrder()]
  const stored = Array.isArray(config.translationCenterServices) ? config.translationCenterServices : []
  const unavailable = new Set(hiddenUnavailableServices.value)
  config.translationCenterServices = stored.flatMap(service => {
    if (unavailable.has(service)) return [service]
    const replacement = available.shift()
    return replacement ? [replacement] : []
  }).concat(available).filter((service, index, services) => services.indexOf(service) === index)
  config.translationCenterSourceLanguage = sourceLanguage.value
  config.translationCenterTargetLanguage = targetLanguage.value
  void requestConfigSave(config, browser.runtime.sendMessage.bind(browser.runtime)).catch(error => {
    console.warn('[FluentRead] 翻译中心配置保存失败', error)
  })
}

function hydrateTranslationCenterConfig(nextConfig = config): void {
  const storedOrder = getValidServiceOrder(nextConfig.translationCenterServices)
  const nextOrder = storedOrder.length ? storedOrder : getDefaultServiceOrder()
  if (!hasSameOrder(getCurrentServiceOrder(), nextOrder)) {
    activeController?.abort()
    activeController = null
    activeRunId += 1
    isRunning.value = false
    applyServiceOrder(nextOrder)
  }
  const storedSource = nextConfig.translationCenterSourceLanguage || nextConfig.from || 'auto'
  const storedTarget = nextConfig.translationCenterTargetLanguage || nextConfig.to || 'zh-Hans'
  const nextSource = sourceLanguageOptions.value.some(item => item.value === storedSource) ? storedSource : 'auto'
  const nextTarget = targetLanguageOptions.value.some(item => item.value === storedTarget) ? storedTarget : 'zh-Hans'
  if (sourceLanguage.value !== nextSource) sourceLanguage.value = nextSource
  if (targetLanguage.value !== nextTarget) targetLanguage.value = nextTarget
}

function addService(service: string): void {
  if (selectedServiceValues.value.has(service)) return
  cards.value.push(createCard(service))
  persistTranslationCenterConfig()
  serviceSearchQuery.value = ''
  servicePickerOpen.value = false
}

function removeService(service: string): void {
  if (cards.value.length <= 1) return
  cards.value = cards.value.filter(card => card.service !== service)
  persistTranslationCenterConfig()
}

function swapLanguages(): void {
  if (sourceLanguage.value === 'auto') return
  const nextSource = sourceLanguage.value
  sourceLanguage.value = targetLanguage.value
  targetLanguage.value = nextSource
  persistTranslationCenterConfig()
}

function reorderCards(fromService: string, targetService: string): void {
  const fromIndex = cards.value.findIndex(card => card.service === fromService)
  const targetIndex = cards.value.findIndex(card => card.service === targetService)
  if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return

  const nextCards = [...cards.value]
  const [movedCard] = nextCards.splice(fromIndex, 1)
  nextCards.splice(targetIndex, 0, movedCard)
  cards.value = nextCards
  persistTranslationCenterConfig()
}

function startPointerDrag(service: string, event: PointerEvent): void {
  if (event.button !== 0) return
  pointerDrag = { service, pointerId: event.pointerId }
  draggingService.value = service
  dragOverService.value = ''
  document.body.style.userSelect = 'none'
  document.addEventListener('pointermove', handlePointerMove)
  document.addEventListener('pointerup', finishPointerDrag)
  document.addEventListener('pointercancel', finishPointerDrag)
}

function handlePointerMove(event: PointerEvent): void {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('.translation-result-card')
  const service = target?.dataset.service || ''
  dragOverService.value = service && service !== pointerDrag.service ? service : ''
}

function finishPointerDrag(event: PointerEvent): void {
  if (!pointerDrag || event.pointerId !== pointerDrag.pointerId) return
  const targetService = dragOverService.value
  if (targetService) reorderCards(pointerDrag.service, targetService)
  endCardDrag()
}

function moveCard(service: string, offset: number): void {
  const fromIndex = cards.value.findIndex(card => card.service === service)
  const targetIndex = fromIndex + offset
  if (fromIndex < 0 || targetIndex < 0 || targetIndex >= cards.value.length) return
  const nextCards = [...cards.value]
  const [movedCard] = nextCards.splice(fromIndex, 1)
  nextCards.splice(targetIndex, 0, movedCard)
  cards.value = nextCards
  persistTranslationCenterConfig()
}

function endCardDrag(): void {
  pointerDrag = null
  document.removeEventListener('pointermove', handlePointerMove)
  document.removeEventListener('pointerup', finishPointerDrag)
  document.removeEventListener('pointercancel', finishPointerDrag)
  document.body.style.userSelect = ''
  draggingService.value = ''
  dragOverService.value = ''
  if (pendingConfigHydration) {
    pendingConfigHydration = false
    hydrateTranslationCenterConfig()
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.name === 'AbortError') return '本轮请求已取消'
  const message = error instanceof Error ? error.message : String(error)
  return message || '翻译服务未返回结果，请稍后重试。'
}

function resetCopiedState(value: string): void {
  copiedService.value = value
  if (copiedTimer) clearTimeout(copiedTimer)
  copiedTimer = setTimeout(() => {
    copiedService.value = ''
  }, 1600)
}

async function copyText(text: string, copiedKey: string): Promise<void> {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    resetCopiedState(copiedKey)
  } catch (error) {
    console.warn('[FluentRead] 翻译中心复制失败', error)
  }
}

function copyResult(card: TranslationCard): void {
  void copyText(card.result, card.service)
}

function copyAllResults(): void {
  const text = successfulCards.value
    .map(card => `${serviceLabel(card.service)}\n${card.result}`)
    .join('\n\n')
  void copyText(text, 'all')
}

async function translateCard(card: TranslationCard, text: string, runId: number, controller: AbortController, run: number): Promise<void> {
  const startedAt = performance.now()
  card.status = 'loading'
  card.error = ''
  card.result = ''
  card.run = run

  try {
    const result = await translateText(text, 'FluentRead 翻译中心', {
      maxRetries: 0,
      timeout: 30_000,
      useCache: false,
      serviceOverride: card.service,
      sourceLanguage: sourceLanguage.value,
      targetLanguage: targetLanguage.value,
      signal: controller.signal,
    })
    if (runId !== activeRunId) return
    card.status = 'success'
    card.result = result.trim() || '服务返回了空译文。'
    card.duration = Math.max(1, Math.round(performance.now() - startedAt))
  } catch (error) {
    if (runId !== activeRunId) return
    if (controller.signal.aborted) return
    card.status = 'error'
    card.error = formatError(error)
    card.duration = Math.max(1, Math.round(performance.now() - startedAt))
  }
}

async function runTranslation(): Promise<void> {
  const text = sourceText.value.trim()
  if (!text || !cards.value.length || isRunning.value) return
  if (text.length > MAX_TEXT_LENGTH) return

  activeController?.abort()
  const controller = new AbortController()
  activeController = controller
  const runId = ++activeRunId
  const run = ++runCount.value
  isRunning.value = true

  await Promise.all(cards.value.map(card => translateCard(card, text, runId, controller, run)))
  if (runId === activeRunId) {
    isRunning.value = false
    activeController = null
  }
}

async function retryService(service: string): Promise<void> {
  const text = sourceText.value.trim()
  const card = cards.value.find(item => item.service === service)
  if (!text || !card || isRunning.value) return

  activeController?.abort()
  const controller = new AbortController()
  activeController = controller
  const runId = ++activeRunId
  const run = ++runCount.value
  isRunning.value = true
  await translateCard(card, text, runId, controller, run)
  if (runId === activeRunId) {
    isRunning.value = false
    activeController = null
  }
}

function closeServicePicker(event: Event): void {
  if (servicePicker.value?.contains(event.target as Node)) return
  servicePickerOpen.value = false
  serviceSearchQuery.value = ''
}

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') servicePickerOpen.value = false
}

onMounted(async () => {
  await configReady
  configVersion.value += 1
  hydrateTranslationCenterConfig()
  configHydrated = true
  unsubscribeConfig = subscribeConfig(nextConfig => {
    if (!configHydrated) return
    configVersion.value += 1
    if (draggingService.value) {
      pendingConfigHydration = true
      return
    }
    hydrateTranslationCenterConfig(nextConfig)
  })
  document.addEventListener('pointerdown', closeServicePicker)
  document.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  activeController?.abort()
  endCardDrag()
  unsubscribeConfig?.()
  document.removeEventListener('pointerdown', closeServicePicker)
  document.removeEventListener('keydown', handleKeydown)
  if (copiedTimer) clearTimeout(copiedTimer)
})
</script>

<style scoped>
.translation-capability-warning { margin: 0; padding: 9px 12px; border: 1px dashed #d8dce6; border-radius: 10px; color: var(--muted); background: var(--surface-soft); font-size: 10px; }
.translation-center {
  display: grid;
  gap: 12px;
  height: 100%;
  min-height: 0;
  padding: 16px 18px;
  color: var(--ink);
  background: transparent;
  grid-template-rows: auto minmax(0, 1fr);
  overflow: hidden;
}

.translation-center-toolbar,
.translation-input-panel,
.translation-results-panel {
  border: 1px solid var(--line);
  background: var(--surface);
}

.translation-center-run-status {
  display: inline-flex;
  align-items: center;
  flex: none;
  gap: 6px;
  padding: 0;
  border: 0;
  color: var(--muted);
  background: transparent;
  font-size: 10px;
  font-weight: 700;
}

.translation-center-run-status i { width: 7px; height: 7px; border-radius: 50%; background: #b8becb; }
.translation-center-run-status.active { color: var(--brand-strong); }
.translation-center-run-status.active i { background: var(--brand); }

.translation-center-toolbar {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  padding: 0 0 12px;
  border: 0;
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  background: transparent;
}

.translation-center-toolbar-actions { display: flex; align-items: center; gap: 10px; margin-left: auto; }

.language-picker-group { display: grid; gap: 4px; min-width: 142px; }
.language-picker-group label { color: var(--muted); font-size: 10px; font-weight: 750; }
.language-picker {
  width: 100%;
  min-width: 142px;
}
.language-picker-group :deep(.el-select__wrapper) {
  min-height: 36px;
  padding: 0 11px;
  border: 1px solid #e1e5ee;
  border-radius: 8px;
  background: var(--surface-soft);
  box-shadow: none;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
.language-picker-group :deep(.el-select__wrapper:hover) { border-color: #ef9ab1; }
.language-picker-group :deep(.el-select__wrapper.is-focused) {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px rgba(239, 71, 118, .1);
}
.language-picker-group :deep(.el-select__selected-item) {
  color: var(--ink);
  font-size: 13px;
}
.language-picker-group :deep(.el-select__caret) { color: var(--muted); }

.language-swap-button {
  display: grid;
  width: 38px;
  height: 36px;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 8px;
  color: var(--brand-strong);
  background: var(--brand-soft);
  cursor: pointer;
}
.language-swap-button svg { width: 17px; height: 17px; }
.language-swap-button:hover:not(:disabled) { border-color: #f1b2c5; }
.language-swap-button:disabled { cursor: not-allowed; opacity: .45; }

.translation-center-service-picker { position: relative; margin-left: auto; }
.add-service-button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid #e1e5ee;
  border-radius: 8px;
  color: var(--ink);
  background: var(--surface);
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
}
.add-service-button:hover { border-color: #ef9ab1; color: var(--brand-strong); background: var(--brand-soft); }
.add-service-icon { width: 16px; height: 16px; flex: none; color: var(--brand); }
.add-service-button b { display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; color: #fff; background: var(--ink); font-size: 10px; }
.add-service-chevron { width: 15px; height: 15px; flex: none; color: var(--muted); }
.service-picker-popover {
  position: absolute;
  z-index: 8;
  top: calc(100% + 8px);
  right: 0;
  display: flex;
  width: min(370px, calc(100vw - 32px));
  max-height: min(480px, calc(100vh - 150px));
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--surface);
  box-shadow: 0 12px 30px rgba(31, 40, 61, .14);
}
.service-picker-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid var(--line); }
.service-picker-header > div { min-width: 0; }
.service-picker-header strong { color: var(--ink); font-size: 15px; }
.service-picker-close { display: grid; place-items: center; width: 26px; height: 26px; flex: none; border: 0; border-radius: 8px; color: var(--muted); background: transparent; cursor: pointer; }
.service-picker-close svg { width: 16px; height: 16px; }
.service-picker-close:hover { color: var(--brand-strong); background: var(--brand-soft); }
.service-picker-search { display: flex; align-items: center; gap: 8px; margin: 10px 12px 7px; padding: 0 10px; height: 36px; border: 1px solid #e1e5ee; border-radius: 8px; color: var(--muted); background: var(--surface-soft); }
.service-picker-search:focus-within { border-color: var(--brand); box-shadow: 0 0 0 3px rgba(239, 71, 118, .1); }
.service-picker-search-icon { width: 16px; height: 16px; flex: none; }
.service-picker-search input { width: 100%; min-width: 0; border: 0; outline: 0; color: var(--ink); background: transparent; font: inherit; font-size: 12px; }
.service-picker-search input::placeholder { color: #a2a8b5; }
.service-picker-groups { min-height: 0; flex: 1 1 auto; overflow-y: auto; padding: 0 7px 8px; }
.service-picker-group + .service-picker-group { margin-top: 8px; }
.service-picker-group-heading { display: flex; align-items: center; justify-content: space-between; padding: 7px 7px 5px; color: var(--muted); font-size: 10px; }
.service-picker-group-heading strong { color: var(--ink); font-size: 10px; }
.service-picker-group-heading span { display: inline-grid; min-width: 18px; height: 18px; place-items: center; border-radius: 999px; background: var(--surface-soft); font-size: 9px; }
.service-picker-option { display: flex; align-items: center; width: 100%; min-height: 45px; gap: 9px; padding: 6px; border: 0; border-radius: 7px; color: var(--ink); background: transparent; cursor: pointer; text-align: left; }
.service-picker-option:hover { background: var(--surface-soft); }
.service-picker-option-copy { display: grid; min-width: 0; flex: 1; gap: 3px; }
.service-picker-option-copy strong { overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.service-picker-option-copy small { overflow: hidden; color: var(--muted); font-size: 9px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.service-picker-option-add { display: grid; place-items: center; width: 23px; height: 23px; flex: none; border-radius: 7px; color: var(--brand-strong); background: var(--brand-soft); }
.service-picker-option-add svg { width: 14px; height: 14px; }
.service-picker-groups > p { margin: 28px 8px; color: var(--muted); font-size: 11px; text-align: center; }
.translation-center-layout { display: grid; grid-template-columns: minmax(300px, .88fr) minmax(420px, 1.12fr); gap: 10px; height: auto; min-height: 0; }
.translation-input-panel,
.translation-results-panel { min-width: 0; border-radius: 10px; }
.translation-input-panel { display: flex; min-height: 320px; flex-direction: column; padding: 14px; }
.translation-results-panel { display: flex; min-height: 320px; flex-direction: column; padding: 14px; }
.translation-panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
.translation-panel-heading h3 { margin: 0; color: var(--ink); font-size: 17px; letter-spacing: -.02em; }
.language-pair-label { padding: 3px 0; color: var(--muted); background: transparent; font-size: 10px; white-space: nowrap; }

.translation-input-panel textarea {
  display: block;
  width: 100%;
  min-height: 270px;
  flex: 1 1 auto;
  padding: 4px 2px;
  resize: vertical;
  border: 0;
  color: var(--ink);
  background: transparent;
  font: inherit;
  font-size: 20px;
  line-height: 1.65;
  outline: none;
}
.translation-input-panel textarea::placeholder { color: #a2a8b5; }
.translation-input-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-top: 12px; border-top: 1px solid var(--line); color: var(--muted); font-size: 10px; }
.translate-primary-button { display: inline-flex; align-items: center; gap: 9px; min-height: 38px; padding: 0 13px; border: 0; border-radius: 8px; color: #fff; background: var(--brand); cursor: pointer; font-size: 12px; font-weight: 800; }
.translate-primary-button:hover:not(:disabled) { background: var(--brand-strong); }
.translate-primary-button:disabled { cursor: not-allowed; opacity: .48; box-shadow: none; }
.translate-primary-button small { padding-left: 10px; border-left: 1px solid rgba(255,255,255,.35); font-size: 10px; font-weight: 600; }

.results-heading { margin-bottom: 10px; }
.results-heading-actions { display: flex; align-items: center; gap: 9px; }
.results-order-hint { display: inline-flex; align-items: center; gap: 4px; color: var(--muted); font-size: 9px; white-space: nowrap; }
.results-order-hint svg { width: 13px; height: 13px; }
.copy-all-button { display: inline-flex; min-height: 30px; align-items: center; gap: 5px; padding: 0 10px; border: 1px solid var(--line); border-radius: 9px; color: var(--brand-strong); background: var(--surface); cursor: pointer; font-size: 10px; font-weight: 700; }
.copy-all-button svg { width: 13px; height: 13px; }
.copy-all-button:hover:not(:disabled) { border-color: #ef9ab1; background: var(--brand-soft); }
.copy-all-button:disabled { cursor: not-allowed; color: #b4bac5; }
.translation-result-list { display: grid; gap: 0; min-height: 0; overflow-y: auto; padding: 0 3px 0 0; }
.translation-result-card { padding: 12px 0; border-bottom: 1px solid var(--line); background: transparent; cursor: grab; transition: border-color .16s ease, opacity .16s ease, transform .16s ease; }
.translation-result-card:active { cursor: grabbing; }
.translation-result-card.is-dragging { opacity: .5; transform: scale(.985); }
.translation-result-card.is-drag-over { border-color: #ef9ab1; box-shadow: 0 -4px 0 -2px var(--brand); }
.translation-result-card[data-status='success'] { border-color: #ecd8df; }
.translation-result-card-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.translation-result-service-name { display: flex; align-items: center; min-width: 0; gap: 10px; }
.drag-handle { display: grid; place-items: center; width: 18px; height: 28px; flex: none; padding: 0; border: 0; border-radius: 6px; color: #a6adba; background: transparent; cursor: grab; }
.drag-handle svg { width: 16px; height: 16px; }
.drag-handle:hover, .drag-handle:focus-visible { color: var(--brand-strong); background: var(--brand-soft); outline: none; }
.drag-handle:active { cursor: grabbing; }
.translation-result-service-name > div { min-width: 0; }
.translation-result-service-name strong { overflow: hidden; color: var(--ink); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.translation-result-card-actions { display: flex; align-items: center; flex: none; gap: 7px; }
.result-state { padding: 3px 6px; border-radius: 6px; font-size: 9px; font-weight: 800; }
.result-state.success { color: #16825f; background: #e9f8f1; }
.result-state.loading { color: #91611c; background: #fff5df; }
.result-state.error { color: #b1435e; background: #fff0f3; }
.remove-service-button { display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: 7px; color: #8b93a1; background: transparent; cursor: pointer; }
.remove-service-button svg { width: 15px; height: 15px; }
.remove-service-button:hover:not(:disabled) { color: #b1435e; background: #fff0f3; }
.remove-service-button:disabled { cursor: not-allowed; opacity: .35; }
.translation-result-placeholder { display: flex; align-items: center; min-height: 46px; margin-top: 8px; padding: 8px 0; color: #9aa2b0; background: transparent; font-size: 11px; }
.loading-placeholder { gap: 9px; color: #9a6d2a; }
.loading-bars { display: inline-flex; align-items: center; gap: 3px; }
.loading-bars i { width: 4px; height: 14px; border-radius: 999px; background: #e8aa55; animation: translation-center-pulse .8s ease-in-out infinite alternate; }
.loading-bars i:nth-child(2) { animation-delay: .18s; }
.loading-bars i:nth-child(3) { animation-delay: .36s; }
@keyframes translation-center-pulse { from { opacity: .35; transform: scaleY(.6); } to { opacity: 1; transform: scaleY(1); } }
.translation-result-content { margin-top: 8px; padding: 9px 0 0; border-top: 1px solid #f3e2e7; color: var(--ink); background: transparent; }
.translation-result-content p { min-height: 24px; margin: 0; font-size: 14px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
.translation-result-content footer { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; color: var(--muted); font-size: 9px; }
.translation-result-content footer button { display: inline-flex; align-items: center; gap: 5px; padding: 0; border: 0; color: var(--brand-strong); background: transparent; cursor: pointer; font-size: 10px; font-weight: 700; }
.translation-result-content footer button svg { width: 13px; height: 13px; }
.translation-result-error { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; margin-top: 11px; padding: 10px 12px; border-radius: 10px; color: #9f3d57; background: #fff3f5; }
.translation-result-error p { flex: 1; margin: 0; font-size: 11px; line-height: 1.6; word-break: break-word; }
.translation-result-error button { display: inline-flex; flex: none; align-items: center; gap: 5px; padding: 4px 7px; border: 1px solid #efb1c1; border-radius: 7px; color: #a43755; background: transparent; cursor: pointer; font-size: 10px; font-weight: 700; }
.translation-result-error button svg { width: 13px; height: 13px; }
.translation-result-error button:disabled { cursor: not-allowed; opacity: .45; }

@media (max-width: 1050px) {
  .translation-center { padding: 14px 16px; }
  .translation-center-layout { grid-template-columns: minmax(270px, .8fr) minmax(360px, 1.2fr); }
}

@media (max-width: 900px) {
  .translation-center { height: auto; max-height: 100%; padding: 12px 8px; grid-template-rows: none; overflow-y: auto; }
  .translation-center-layout { grid-template-columns: 1fr; height: auto; }
  .translation-input-panel { min-height: 300px; }
  .translation-results-panel { min-height: 320px; }
  .translation-center-toolbar { align-items: stretch; flex-wrap: wrap; }
  .language-picker-group { flex: 1 1 140px; }
  .language-picker { min-width: 0; width: 100%; }
  .language-swap-button { align-self: flex-end; }
  .translation-center-toolbar-actions { width: 100%; margin-left: 0; }
  .translation-center-service-picker { width: auto; margin-left: 0; flex: 1 1 auto; }
  .add-service-button { width: 100%; justify-content: center; }
  .service-picker-popover { left: 0; right: 0; width: auto; }
}

@media (max-width: 480px) {
  .translation-input-panel,
  .translation-results-panel { padding: 15px; }
  .translation-input-panel textarea { min-height: 220px; font-size: 17px; }
  .translation-result-card-actions .result-state { display: none; }
  .results-order-hint { display: none; }
}
</style>
