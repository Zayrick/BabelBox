<template>
  <el-dialog
    v-model="open"
    title="添加 AI 翻译服务"
    width="min(920px, calc(100vw - 32px))"
    class="add-translation-service-dialog"
    destroy-on-close
    append-to-body
    @closed="resetDraft"
  >
    <div class="add-service-layout">
      <aside class="provider-picker" aria-label="AI 翻译供应商">
        <label class="provider-search">
          <Search :size="16" aria-hidden="true" />
          <input v-model.trim="providerQuery" type="search" placeholder="搜索供应商" />
        </label>
        <div class="provider-list">
          <button
            v-for="provider in filteredProviders"
            :key="provider.value"
            type="button"
            :class="{ active: draft.provider === provider.value }"
            @click="selectProvider(provider.value)"
          >
            <ServiceIcon :service="provider.value" :label="provider.label" size="small" />
            <span>{{ provider.label }}</span>
            <Check v-if="draft.provider === provider.value" :size="15" aria-hidden="true" />
          </button>
        </div>
      </aside>

      <section v-if="selectedProvider" class="add-service-form" aria-label="新翻译服务配置">
        <header>
          <ServiceIcon :service="selectedProvider.value" :label="selectedProvider.label" size="large" />
          <div>
            <strong>{{ selectedProvider.label }}</strong>
            <small>每次添加都会创建一项独立服务，可为同一供应商添加多个模型。</small>
          </div>
        </header>

        <label class="form-field">
          <span>服务名称</span>
          <el-input
            :model-value="draft.name"
            maxlength="80"
            placeholder="用于服务列表和下拉菜单"
            @update:model-value="setCustomName"
          />
          <small>默认使用“模型 ID - 服务商”，也可以自定义。</small>
        </label>

        <label v-if="usesModel" class="form-field">
          <span>模型 ID</span>
          <el-select
            v-model="draft.modelId"
            filterable
            allow-create
            default-first-option
            placeholder="输入供应商支持的模型 ID"
          >
            <el-option v-for="model in modelSuggestions" :key="model" :label="model" :value="model" />
          </el-select>
        </label>

        <label v-if="usesToken" class="form-field">
          <span>API Key / 访问令牌（可选）</span>
          <el-input v-model="draft.credential.apiKey" type="password" show-password autocomplete="off" placeholder="留空时不发送鉴权信息" />
        </label>

        <template v-if="usesTencentCredentials">
          <label class="form-field">
            <span>Secret ID</span>
            <el-input v-model="draft.credential.secretId" :class="{ 'input-error': !draft.credential.secretId.trim() }" autocomplete="off" />
            <small v-if="!draft.credential.secretId.trim()" class="error-text">Secret ID 为必填项</small>
          </label>
          <label class="form-field">
            <span>Secret Key</span>
            <el-input v-model="draft.credential.secretKey" :class="{ 'input-error': !draft.credential.secretKey.trim() }" type="password" show-password autocomplete="off" />
            <small v-if="!draft.credential.secretKey.trim()" class="error-text">Secret Key 为必填项</small>
          </label>
        </template>

        <label v-if="showEndpoint" class="form-field">
          <span>请求地址{{ endpointRequired ? '' : '（可选）' }}</span>
          <el-input v-model.trim="draft.endpoint" inputmode="url" :placeholder="endpointPlaceholder" />
          <small v-if="!endpointRequired">留空时使用供应商默认地址。</small>
        </label>

        <label v-if="usesRobotId" class="form-field">
          <span>机器人 ID</span>
          <el-input v-model.trim="draft.robotId" autocomplete="off" placeholder="输入 Coze Bot ID" />
        </label>

        <AdvancedRequestParameters v-model="draft.customBody" />
      </section>

      <div v-else class="provider-empty">
        <Plus :size="28" aria-hidden="true" />
        <strong>选择一个供应商</strong>
        <span>然后填写模型 ID 和请求信息。</span>
      </div>
    </div>

    <template #footer>
      <el-button @click="open = false">取消</el-button>
      <el-button type="primary" :disabled="!canSubmit" @click="submit">添加到服务列表</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import {computed, reactive, ref, watch} from 'vue'
import {Check, Plus, Search} from '@lucide/vue'
import ServiceIcon from '@/src/ui/components/ServiceIcon.vue'
import AdvancedRequestParameters from './AdvancedRequestParameters.vue'
import {
  customModelString,
  defaultModels,
  defaultOption,
  models,
  options,
  services,
  servicesType,
} from '@/src/core/config/catalog'
import {
  createAITranslationService,
  createTranslationServiceId,
  getDefaultTranslationServiceName,
  type TranslationServiceInstance,
} from '@/src/core/config/translationServices'
import type {TranslationServiceCredential} from '@/src/core/config/model'
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

const emptyCredential = (): TranslationServiceCredential => ({
  apiKey: '',
  appKey: '',
  appSecret: '',
  secretId: '',
  secretKey: '',
})

const draft = reactive({
  provider: '',
  modelId: '',
  name: '',
  nameCustomized: false,
  endpoint: '',
  customBody: '',
  robotId: '',
  credential: emptyCredential(),
})
const providerQuery = ref('')
const providerOptions = options.services.filter((item) => !item.disabled && servicesType.isAI(item.value))
const filteredProviders = computed(() => {
  const query = providerQuery.value.toLocaleLowerCase()
  return providerOptions.filter((provider) => !query
    || `${provider.label}${provider.value}`.toLocaleLowerCase().includes(query))
})
const selectedProvider = computed(() => providerOptions.find((item) => item.value === draft.provider))
const modelSuggestions = computed(() => (models.get(draft.provider) || []).filter((model) => model !== customModelString))
const usesModel = computed(() => servicesType.isUseModel(draft.provider))
const usesToken = computed(() => servicesType.isUseToken(draft.provider))
const usesTencentCredentials = computed(() => servicesType.isTencent(draft.provider))
const usesRobotId = computed(() => servicesType.isCoze(draft.provider))
const endpointRequired = computed(() => [services.custom, services.newapi, services.azureOpenai].includes(draft.provider))
const showEndpoint = computed(() => endpointRequired.value || servicesType.isUseProxy(draft.provider))
const endpointPlaceholder = computed(() => draft.provider === services.custom
  ? defaultOption.custom
  : draft.provider === services.newapi
    ? 'http://localhost:3000'
    : draft.provider === services.azureOpenai
      ? 'https://…/chat/completions?api-version=…'
      : '留空使用供应商默认地址')
const canSubmit = computed(() => Boolean(
  draft.provider
  && (!usesModel.value || draft.modelId.trim())
  && draft.name.trim()
  && (!endpointRequired.value || draft.endpoint.trim())
  && (!usesRobotId.value || draft.robotId.trim())
))

function resetDraft(): void {
  draft.provider = ''
  draft.modelId = ''
  draft.name = ''
  draft.nameCustomized = false
  draft.endpoint = ''
  draft.customBody = ''
  draft.robotId = ''
  Object.assign(draft.credential, emptyCredential())
  providerQuery.value = ''
}

function selectProvider(provider: string): void {
  draft.provider = provider
  draft.modelId = defaultModels.get(provider) || ''
  draft.nameCustomized = false
  draft.name = getDefaultTranslationServiceName(provider, draft.modelId)
  draft.endpoint = provider === services.custom ? defaultOption.custom : ''
  draft.customBody = ''
  draft.robotId = ''
  Object.assign(draft.credential, emptyCredential())
}

function setCustomName(value: string): void {
  draft.name = value
  draft.nameCustomized = true
}

watch(() => draft.modelId, (modelId) => {
  if (!draft.provider || draft.nameCustomized) return
  draft.name = getDefaultTranslationServiceName(draft.provider, modelId.trim())
})

function submit(): void {
  if (!canSubmit.value) return
  const id = createTranslationServiceId(draft.provider, props.existingServices)
  const instance = createAITranslationService(draft.provider, {
    id,
    name: draft.name.trim(),
    modelId: draft.modelId.trim(),
    endpoint: draft.endpoint.trim(),
    customBody: draft.customBody,
    robotId: draft.robotId.trim(),
    requireApiKey: false,
  })
  emit('add', {instance, credential: {...draft.credential}})
  open.value = false
}
</script>

<style scoped>
.add-service-layout { display: grid; height: 480px; min-height: 0; grid-template-columns: 260px minmax(0, 1fr); border: 1px solid #e5e8ef; border-radius: 12px; overflow: hidden; }
.provider-picker { display: flex; min-height: 0; padding: 12px; border-right: 1px solid #e5e8ef; background: #fafbfc; flex-direction: column; overflow: hidden; }
.provider-search { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 10px; border: 1px solid #dfe3eb; border-radius: 8px; background: #fff; }
.provider-search svg { color: #8991a2; }
.provider-search input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; }
.provider-list { display: grid; min-height: 0; margin-top: 10px; gap: 3px; overflow-y: auto; align-content: start; flex: 1; }
.provider-list button { display: grid; min-width: 0; grid-template-columns: 28px minmax(0, 1fr) 16px; align-items: center; gap: 9px; padding: 7px; border: 1px solid transparent; border-radius: 8px; color: #263044; background: transparent; text-align: left; cursor: pointer; }
.provider-list button:hover { border-color: #e0e4ec; background: #fff; }
.provider-list button.active { border-color: #efb2c3; color: #bd2c55; background: #fff2f6; }
.provider-list button span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.add-service-form { display: flex; min-width: 0; min-height: 0; padding: 20px 22px; gap: 14px; flex-direction: column; overflow-y: auto; }
.add-service-form header { display: flex; align-items: center; gap: 12px; padding-bottom: 14px; border-bottom: 1px solid #eceef3; }
.add-service-form header > div { display: flex; min-width: 0; flex-direction: column; }
.add-service-form header strong { color: #172033; font-size: 18px; }
.add-service-form header small, .form-field small { margin-top: 3px; color: #8891a2; font-size: 11px; line-height: 1.5; }
.form-field { display: grid; gap: 6px; color: #4d586d; font-size: 12px; font-weight: 650; }
.input-error :deep(.el-input__wrapper) { box-shadow: 0 0 0 1px var(--el-color-danger) inset; }
.form-field .error-text { margin-top: 0; color: var(--el-color-danger); }
.provider-empty { display: grid; color: #9199a9; place-content: center; justify-items: center; gap: 7px; }
.provider-empty strong { color: #536075; font-size: 15px; }
.provider-empty span { font-size: 11px; }
@media (max-width: 700px) {
  .add-service-layout { grid-template-columns: 1fr; }
  .provider-picker { border-right: 0; border-bottom: 1px solid #e5e8ef; }
  .provider-list { max-height: 180px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
