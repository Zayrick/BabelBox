<template>
  <el-dialog
    v-model="open"
    title="添加翻译服务"
    width="min(720px, calc(100vw - 32px))"
    class="add-translation-service-dialog"
    destroy-on-close
    append-to-body
    @closed="providerQuery = ''"
  >
    <p class="dialog-intro">选择要接入的外部翻译服务，添加后在服务详情中配置密钥、地址或模型。</p>

    <label class="provider-search">
      <Search :size="16" aria-hidden="true" />
      <input v-model.trim="providerQuery" type="search" placeholder="搜索翻译服务" />
    </label>

    <el-scrollbar
      v-if="filteredSections.length"
      class="provider-list"
      max-height="min(520px, 60vh)"
      aria-label="可添加的翻译服务"
    >
      <section v-for="section in filteredSections" :key="section.id" class="provider-section">
        <h5 class="provider-section-title">{{ section.label }}</h5>
        <div class="provider-grid">
          <button
            v-for="provider in section.providers"
            :key="provider.value"
            type="button"
            class="provider-tile"
            :title="providerDescription(provider.value) || provider.label"
            :aria-label="`添加${provider.label}`"
            @click="addProvider(provider.value)"
          >
            <ServiceIcon :service="provider.value" :label="provider.label" size="large" />
            <span class="provider-name">{{ provider.label }}</span>
          </button>
        </div>
      </section>
    </el-scrollbar>
    <div v-else class="provider-empty">没有可添加的翻译服务</div>

    <template #footer>
      <el-button @click="open = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue'
import {ElScrollbar} from 'element-plus'
import {Search} from '@lucide/vue'
import ServiceIcon from '@/src/ui/components/ServiceIcon.vue'
import {options, servicesType} from '@/src/core/config/catalog'
import {
  createExternalTranslationService,
  externalMachineTranslationProviders,
  getTranslationProviderDescription,
  type TranslationServiceInstance,
} from '@/src/core/config/translationServices'
import type {AddTranslationServicePayload} from '@/src/features/settings/model/addTranslationService'

const props = defineProps<{
  modelValue: boolean
  existingServices: readonly TranslationServiceInstance[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  add: [payload: AddTranslationServicePayload]
}>()

const open = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit('update:modelValue', value),
})

const providerQuery = ref('')
const providerOptions = options.services.filter((item) => !item.disabled)
const machineProviderOptions = providerOptions
  .filter((item) => externalMachineTranslationProviders.includes(item.value))
const aiProviderOptions = providerOptions.filter((item) => servicesType.isAI(item.value))

const filteredSections = computed(() => {
  const query = providerQuery.value.toLocaleLowerCase()
  const matches = (provider: {value: string, label: string}) => !query
    || `${provider.label}${provider.value}${providerDescription(provider.value)}`.toLocaleLowerCase().includes(query)
  // 机器翻译每个供应商只有一个实例，已添加的不再出现。
  const installed = new Set(props.existingServices.map((item) => item.provider))
  return [
    {
      id: 'machine',
      label: '机器翻译',
      providers: machineProviderOptions.filter((item) => !installed.has(item.value) && matches(item)),
    },
    {
      id: 'ai',
      label: 'AI 翻译',
      providers: aiProviderOptions.filter(matches),
    },
  ].filter((section) => section.providers.length > 0)
})

function providerDescription(provider: string): string {
  return getTranslationProviderDescription(provider)
}

function addProvider(provider: string): void {
  emit('add', {instance: createExternalTranslationService(provider, props.existingServices)})
  open.value = false
}
</script>

<style scoped>
.dialog-intro { margin: 0 0 14px; color: var(--muted); font-size: var(--font-small); line-height: var(--line-height-body); }
.provider-search { display: flex; align-items: center; gap: 8px; height: var(--control-height); padding: 0 12px; border-radius: var(--radius-control); background: var(--surface-soft); transition: box-shadow 140ms ease; }
.provider-search:focus-within { box-shadow: var(--focus-ring); }
.provider-search svg { color: var(--muted); }
.provider-search input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: var(--ink); font: inherit; font-size: var(--font-body); }
.provider-list { height: auto; margin-top: 14px; }
.provider-section + .provider-section { margin-top: 14px; padding-top: 14px; border-top: 1px solid var(--line); }
.provider-section-title { margin: 0 0 6px; padding: 0 8px; color: var(--muted); font-size: var(--font-caption); font-weight: var(--weight-medium); letter-spacing: .02em; }
.provider-grid { display: grid; padding-right: 8px; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 4px; }
.provider-tile { display: flex; min-width: 0; align-items: center; gap: 8px; padding: 12px 6px 10px; border: 0; border-radius: var(--radius-control); color: var(--ink); background: transparent; flex-direction: column; text-align: center; cursor: pointer; transition: background 120ms ease; }
.provider-tile:hover { background: var(--surface-soft); }
.provider-tile:focus-visible { outline: 2px solid var(--brand); outline-offset: 1px; }
.provider-name { display: -webkit-box; width: 100%; overflow: hidden; font-size: var(--font-small); font-weight: var(--weight-medium); line-height: var(--line-height-tight); -webkit-box-orient: vertical; -webkit-line-clamp: 2; word-break: break-word; }
.provider-empty { display: grid; min-height: 180px; color: var(--muted); place-items: center; font-size: var(--font-small); }
</style>
