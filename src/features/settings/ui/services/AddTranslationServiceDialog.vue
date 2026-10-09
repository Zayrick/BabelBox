<template>
  <el-dialog
    v-model="open"
    title="添加 AI 翻译服务"
    width="min(720px, calc(100vw - 32px))"
    class="add-translation-service-dialog"
    destroy-on-close
    append-to-body
    @closed="providerQuery = ''"
  >
    <p class="dialog-intro">添加后可在服务详情中配置模型和密钥。</p>

    <label class="provider-search">
      <Search :size="16" aria-hidden="true" />
      <input v-model.trim="providerQuery" type="search" placeholder="搜索供应商" />
    </label>

    <el-scrollbar
      v-if="filteredProviders.length"
      class="provider-list"
      max-height="min(520px, 60vh)"
      aria-label="可添加的 AI 翻译供应商"
    >
      <div class="provider-grid">
        <button
          v-for="provider in filteredProviders"
          :key="provider.value"
          type="button"
          class="provider-card"
          @click="addProvider(provider.value)"
        >
          <ServiceIcon :service="provider.value" :label="provider.label" size="large" />
          <span class="provider-copy">
            <strong>{{ provider.label }}</strong>
            <small v-if="providerDescription(provider.value)">{{ providerDescription(provider.value) }}</small>
          </span>
          <Plus :size="17" aria-hidden="true" />
        </button>
      </div>
    </el-scrollbar>
    <div v-else class="provider-empty">没有匹配的供应商</div>

    <template #footer>
      <el-button @click="open = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue'
import {ElScrollbar} from 'element-plus'
import {Plus, Search} from '@lucide/vue'
import ServiceIcon from '@/src/ui/components/ServiceIcon.vue'
import {options, servicesType} from '@/src/core/config/catalog'
import {
  createAITranslationService,
  createTranslationServiceId,
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
const providerOptions = options.services.filter((item) => !item.disabled && servicesType.isAI(item.value))
const filteredProviders = computed(() => {
  const query = providerQuery.value.toLocaleLowerCase()
  return providerOptions.filter((provider) => !query
    || `${provider.label}${provider.value}`.toLocaleLowerCase().includes(query))
})

function providerDescription(provider: string): string {
  return getTranslationProviderDescription(provider)
}

function addProvider(provider: string): void {
  const instance = createAITranslationService(provider, {
    id: createTranslationServiceId(provider, props.existingServices),
    modelId: '',
  })
  emit('add', {instance})
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
.provider-grid { display: grid; padding-right: 8px; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 16px; }
.provider-card { display: grid; min-width: 0; grid-template-columns: 40px minmax(0, 1fr) 16px; align-items: center; gap: 12px; padding: 10px 8px; border: 0; border-radius: var(--radius-control); color: var(--ink); background: transparent; text-align: left; cursor: pointer; transition: background 120ms ease; }
.provider-card:hover { background: var(--surface-soft); }
.provider-card > svg { width: 16px; height: 16px; color: var(--muted); opacity: 0; transition: opacity 120ms ease; }
.provider-card:hover > svg, .provider-card:focus-visible > svg { opacity: 1; }
.provider-copy { display: flex; min-width: 0; flex-direction: column; }
.provider-copy strong, .provider-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.provider-copy strong { font-size: var(--font-body); font-weight: var(--weight-medium); }
.provider-copy small { margin-top: 1px; color: var(--muted); font-size: var(--font-caption); }
.provider-empty { display: grid; min-height: 180px; color: var(--muted); place-items: center; font-size: var(--font-small); }
@media (max-width: 620px) {
  .provider-grid { grid-template-columns: 1fr; }
}
</style>
