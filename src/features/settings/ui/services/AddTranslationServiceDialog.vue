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
    <p class="dialog-intro">选择供应商后会直接添加一项默认服务。模型、凭据和请求参数请在服务详情中配置。</p>

    <label class="provider-search">
      <Search :size="16" aria-hidden="true" />
      <input v-model.trim="providerQuery" type="search" placeholder="搜索供应商" />
    </label>

    <div v-if="filteredProviders.length" class="provider-grid" aria-label="可添加的 AI 翻译供应商">
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
          <small>{{ providerDescription(provider.value) || '添加后配置模型和连接参数' }}</small>
        </span>
        <Plus :size="17" aria-hidden="true" />
      </button>
    </div>
    <div v-else class="provider-empty">没有匹配的 AI 翻译供应商</div>

    <template #footer>
      <el-button @click="open = false">关闭</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import {computed, ref} from 'vue'
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
.dialog-intro { margin: 0 0 14px; color: #687286; font-size: 12px; line-height: 1.6; }
.provider-search { display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 11px; border: 1px solid #dfe3eb; border-radius: 9px; background: #fafbfc; }
.provider-search svg { color: #8991a2; }
.provider-search input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: #263044; }
.provider-grid { display: grid; max-height: min(520px, 60vh); margin-top: 14px; overflow-y: auto; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 9px; }
.provider-card { display: grid; min-width: 0; grid-template-columns: 38px minmax(0, 1fr) 18px; align-items: center; gap: 11px; padding: 12px; border: 1px solid #e1e5ec; border-radius: 11px; color: #263044; background: #fff; text-align: left; cursor: pointer; }
.provider-card:hover { border-color: #ef9db5; background: #fff6f8; }
.provider-card > svg { color: #bd2c55; }
.provider-copy { display: flex; min-width: 0; flex-direction: column; }
.provider-copy strong, .provider-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.provider-copy strong { font-size: 13px; }
.provider-copy small { margin-top: 3px; color: #8991a2; font-size: 10px; }
.provider-empty { display: grid; min-height: 180px; color: #8991a2; place-items: center; font-size: 12px; }
@media (max-width: 620px) {
  .provider-grid { grid-template-columns: 1fr; }
}
</style>
