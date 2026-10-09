<template>
  <Teleport v-if="presentation.showConnectionTest" defer to=".detail-hero-actions">
    <button
      type="button"
      class="connection-test-button"
      :class="`is-${connectionTestState}`"
      data-connection-test-button
      :disabled="connectionTestBusy"
      :title="connectionTestMessage || undefined"
      aria-live="polite"
      @click="testConnection"
    >
      <LoaderCircle v-if="connectionTestState === 'testing'" class="button-icon is-spinning" aria-hidden="true" />
      <CircleCheck v-else-if="connectionTestState === 'success'" class="button-icon" aria-hidden="true" />
      <CircleX v-else-if="connectionTestState === 'error'" class="button-icon" aria-hidden="true" />
      <PlugZap v-else class="button-icon" aria-hidden="true" />
      <span>{{ connectionTestLabel }}</span>
    </button>
  </Teleport>

  <section
    v-if="presentation.showConnectionConfiguration"
    class="settings-section service-connection-section"
    :data-service-configuration-service="instance.id"
  >
    <el-row v-if="fields.name" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <SettingsHelpLabel content="显示在服务列表和下拉菜单中">服务名称</SettingsHelpLabel>
      </el-col>
      <el-col :span="12"><el-input v-model="instanceName" maxlength="80" placeholder="请输入服务名称" /></el-col>
    </el-row>

    <el-row v-if="fields.model" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <SettingsHelpLabel content="同一供应商可以添加多个服务，分别使用不同模型">模型 ID</SettingsHelpLabel>
      </el-col>
      <el-col :span="12">
        <div v-if="modelCatalogSupported" class="model-catalog-control">
          <el-select
            v-model="instanceModelId"
            filterable
            allow-create
            default-first-option
            fit-input-width
            popper-class="babelbox-model-catalog-popper"
            :loading="modelCatalogLoading"
            placeholder="输入或选择模型 ID"
            @visible-change="onModelCatalogVisible"
          >
            <el-option
              v-if="modelCatalogError"
              :label="modelCatalogFailureLabel"
              :value="MODEL_CATALOG_FAILURE_VALUE"
              disabled
            >
              <span class="model-catalog-option">{{ modelCatalogFailureLabel }}</span>
            </el-option>
            <el-option v-for="model in modelCatalogModels" :key="model" :label="model" :value="model">
              <span class="model-catalog-option">{{ model }}</span>
            </el-option>
          </el-select>
          <el-button
            :loading="modelCatalogLoading"
            aria-label="重新获取模型列表"
            title="重新获取模型列表"
            @click="refreshModelCatalog"
          >
            <RefreshCw v-if="!modelCatalogLoading" :size="16" aria-hidden="true" />
          </el-button>
        </div>
        <el-input v-else v-model="instanceModelId" placeholder="请输入模型 ID" />
      </el-col>
    </el-row>

    <el-row v-if="fields.endpoint" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <SettingsHelpLabel :content="endpointCopy.help">请求地址</SettingsHelpLabel>
      </el-col>
      <el-col :span="12">
        <el-input
          v-model="instanceEndpoint"
          inputmode="url"
          :placeholder="endpointCopy.placeholder"
          :class="{ 'input-error': endpointError }"
          @change="refreshModelCatalogIfSupported"
        />
        <div v-if="endpointError" class="error-text">{{ endpointError }}</div>
      </el-col>
    </el-row>

    <el-row v-if="fields.token" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <SettingsHelpLabel content="加密保存在此设备，可在“配置管理”中改为仅本次会话">访问令牌</SettingsHelpLabel>
      </el-col>
      <el-col :span="12"><el-input v-model="apiKey" type="password" show-password placeholder="选填" @change="refreshModelCatalogIfSupported" /></el-col>
    </el-row>
    <p v-if="fields.minimaxRegion && minimaxKeyMismatch" class="minimax-key-note is-warning">
      {{ minimaxKeyMismatch }}
    </p>

    <el-row v-if="fields.minimaxRegion" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <SettingsHelpLabel content="与控制台中 Key 的类型一致">MiniMax 计费方式</SettingsHelpLabel>
      </el-col>
      <el-col :span="12">
        <el-select v-model="instance.minimaxBillingPlan" aria-label="MiniMax 计费方式" placeholder="请选择 MiniMax 计费方式" @change="refreshModelCatalogIfSupported">
          <el-option class="select-left" v-for="item in options.minimaxBillingPlan" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </el-col>
    </el-row>

    <el-row v-if="fields.minimaxRegion" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <SettingsHelpLabel content="与 Key 所属区域一致">MiniMax 区域</SettingsHelpLabel>
      </el-col>
      <el-col :span="12">
        <el-select v-model="instance.minimaxRegion" aria-label="MiniMax API 区域" placeholder="请选择 MiniMax API 区域" @change="refreshModelCatalogIfSupported">
          <el-option class="select-left" v-for="item in options.minimaxRegion" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </el-col>
    </el-row>

    <el-row v-if="fields.minimaxRegion" class="margin-bottom margin-left-2em" data-minimax-endpoint>
      <el-col :span="12" class="lightblue rounded-corner">
        <SettingsHelpLabel content="根据计费方式和区域自动确定">API 地址</SettingsHelpLabel>
      </el-col>
      <el-col :span="12"><code class="derived-endpoint" :title="minimaxEndpoint">{{ minimaxEndpoint }}</code></el-col>
    </el-row>

    <p v-if="fields.mimoRegion && mimoKeyMismatch" class="mimo-key-note is-warning">
      {{ mimoKeyMismatch }}
    </p>

    <el-row v-if="fields.mimoRegion" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <SettingsHelpLabel content="与控制台中 Key 的类型一致">小米 MiMo 计费方式</SettingsHelpLabel>
      </el-col>
      <el-col :span="12">
        <el-select v-model="instance.mimoBillingPlan" aria-label="小米 MiMo 计费方式" placeholder="请选择小米 MiMo 计费方式" @change="refreshModelCatalogIfSupported">
          <el-option class="select-left" v-for="item in options.mimoBillingPlan" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </el-col>
    </el-row>

    <el-row v-if="fields.mimoRegion" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <SettingsHelpLabel content="Token Plan 需选择购买时的集群，各集群的 Key 不通用；按量付费统一使用 api.xiaomimimo.com">MiMo API 集群</SettingsHelpLabel>
      </el-col>
      <el-col :span="12">
        <el-select v-model="instance.mimoRegion" aria-label="小米 MiMo API 集群" placeholder="请选择小米 MiMo API 集群" @change="refreshModelCatalogIfSupported">
          <el-option class="select-left" v-for="item in options.mimoRegion" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </el-col>
    </el-row>

    <el-row v-if="fields.mimoRegion" class="margin-bottom margin-left-2em" data-mimo-endpoint>
      <el-col :span="12" class="lightblue rounded-corner">
        <SettingsHelpLabel content="根据计费方式和集群自动确定">API 地址</SettingsHelpLabel>
      </el-col>
      <el-col :span="12"><code class="derived-endpoint" :title="mimoEndpoint">{{ mimoEndpoint }}</code></el-col>
    </el-row>

    <el-row v-if="fields.youdaoCredentials" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><span class="popup-text popup-vertical-left">App Key</span></el-col>
      <el-col :span="12">
        <el-input v-model="appKey" :class="{ 'input-error': !appKey.trim() }" placeholder="有道 App Key" />
        <div v-if="!appKey.trim()" class="error-text">请填写 App Key</div>
      </el-col>
    </el-row>
    <el-row v-if="fields.youdaoCredentials" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><span class="popup-text popup-vertical-left">App Secret</span></el-col>
      <el-col :span="12">
        <el-input v-model="appSecret" :class="{ 'input-error': !appSecret.trim() }" type="password" show-password placeholder="有道 App Secret" />
        <div v-if="!appSecret.trim()" class="error-text">请填写 App Secret</div>
      </el-col>
    </el-row>

    <el-row v-if="fields.tencentCredentials" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><span class="popup-text popup-vertical-left">Secret ID</span></el-col>
      <el-col :span="12">
        <el-input v-model="secretId" :class="{ 'input-error': !secretId.trim() }" placeholder="腾讯云 SecretId" />
        <div v-if="!secretId.trim()" class="error-text">请填写 Secret ID</div>
      </el-col>
    </el-row>
    <el-row v-if="fields.tencentCredentials" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><span class="popup-text popup-vertical-left">Secret Key</span></el-col>
      <el-col :span="12">
        <el-input v-model="secretKey" :class="{ 'input-error': !secretKey.trim() }" type="password" show-password placeholder="腾讯云 SecretKey" />
        <div v-if="!secretKey.trim()" class="error-text">请填写 Secret Key</div>
      </el-col>
    </el-row>

    <el-row v-if="fields.robotId" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><span class="popup-text popup-vertical-left">机器人 ID</span></el-col>
      <el-col :span="12"><el-input v-model.trim="instance.robotId" placeholder="Coze 机器人 ID" /></el-col>
    </el-row>

    <el-row v-if="fields.deepseekApiType" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><span class="popup-text popup-vertical-left">API 格式</span></el-col>
      <el-col :span="12"><el-select v-model="instance.deepseekApiType" placeholder="请选择 API 格式"><el-option class="select-left" v-for="item in options.deepseekApiType" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-col>
    </el-row>
    <el-row v-if="fields.deepseekThinkingMode" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><span class="popup-text popup-vertical-left">思考模式</span></el-col>
      <el-col :span="12"><el-select v-model="instance.deepseekThinkingMode" placeholder="请选择思考模式"><el-option class="select-left" v-for="item in options.deepseekThinkingMode" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-col>
    </el-row>

    <template v-if="fields.prompts">
      <div class="custom-template-heading">
        <div>
          <strong>提示词</strong>
          <small>留空使用默认提示词</small>
        </div>
        <el-button type="primary" link size="small" @click="resetPrompts"><el-icon><RotateCcw /></el-icon>恢复默认</el-button>
      </div>

      <el-row class="settings-control-row">
        <el-col :span="8" class="settings-control-label lightblue rounded-corner">
          <span class="popup-text popup-vertical-left">system</span>
        </el-col>
        <el-col :span="16" class="settings-control-field">
          <el-input v-model="instance.systemRole" type="textarea" :autosize="{ minRows: 3 }" maxlength="8192" :placeholder="defaultOption.system_role" />
        </el-col>
      </el-row>

      <el-row class="settings-control-row">
        <el-col :span="8" class="settings-control-label lightblue rounded-corner">
          <SettingsHelpLabel content="{{to}} 为目标语言，{{origin}} 为原文" :show-after="300">user</SettingsHelpLabel>
        </el-col>
        <el-col :span="16" class="settings-control-field">
          <el-input v-model="instance.userRole" type="textarea" :autosize="{ minRows: 3 }" maxlength="8192" :placeholder="defaultOption.user_role" />
        </el-col>
      </el-row>
    </template>

    <AdvancedRequestParameters
      v-if="fields.customBody"
      v-model="instance.customBody"
      :invalid="!isValidCustomBody(instance.customBody)"
      invalid-message="不是有效的 JSON 对象，此项不会生效"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRef, watch } from 'vue'
import {
  CircleCheck,
  CircleX,
  LoaderCircle,
  PlugZap,
  RefreshCw,
  RotateCcw,
} from '@lucide/vue'
import type { Config } from '@/src/core/config/model'
import {
  getTranslationServiceCredential,
  type TranslationServiceCredential,
  type TranslationServiceInstance,
} from '@/src/core/config/translationServices'
import { defaultOption, options as optionConfig, services } from '@/src/core/config/catalog'
import { isValidCustomBody } from '@/src/core/config/customBody'
import type {ServiceConfigurationPresentation} from '@/src/features/settings/model/serviceConfiguration'
import {browser} from 'wxt/browser'
import { requestConfigSave } from '@/src/services/config/store'
import { CONNECTION_TEST_MESSAGE, getMimoEndpoint, MINIMAX_ENDPOINTS } from '@/src/core/config/constants'
import {
  hasDynamicTranslationModelCatalog,
  TRANSLATION_MODEL_CATALOG_MESSAGE,
  type TranslationModelCatalogResponse,
} from '@/src/services/translation/modelCatalog'
import { ElMessage, ElMessageBox } from 'element-plus'
import SettingsHelpLabel from '../SettingsHelpLabel.vue'
import AdvancedRequestParameters from './AdvancedRequestParameters.vue'

const props = defineProps<{
  config: Config
  instance: TranslationServiceInstance
  presentation: ServiceConfigurationPresentation
  options: typeof optionConfig
}>()

const config = toRef(props, 'config')
const instance = toRef(props, 'instance')
const presentation = toRef(props, 'presentation')
const fields = computed(() => presentation.value.fields)
const modelCatalogSupported = computed(() => fields.value.model
  && hasDynamicTranslationModelCatalog(instance.value.provider))

const ENDPOINT_COPY: Record<string, {placeholder: string, help: string}> = {
  [services.custom]: {
    placeholder: 'http://localhost:11434/v1/chat/completions',
    help: '必填，兼容 OpenAI Chat Completions 的完整接口地址',
  },
  [services.newapi]: {
    placeholder: 'http://localhost:3000',
    help: '必填，New API 部署地址，会自动补全 /v1/chat/completions',
  },
  [services.azureOpenai]: {
    placeholder: 'https://your-resource.openai.azure.com/openai/deployments/your-model/chat/completions?api-version=2024-02-15-preview',
    help: '必填，需包含完整的部署路径',
  },
  [services.deeplx]: {
    placeholder: '留空使用公共地址',
    help: '多个地址用逗号或换行分隔，依次重试；可用 {{apiKey}} 引用访问令牌',
  },
}
const endpointCopy = computed(() => ENDPOINT_COPY[instance.value.provider] || {
  placeholder: '留空使用官方地址',
  help: '无法直接访问官方接口时，填写代理或兼容网关的完整地址',
})
const endpointError = computed(() => {
  const endpoint = instance.value.endpoint
  if (instance.value.provider === services.azureOpenai && endpoint
    && (!endpoint.includes('openai.azure.com') || !endpoint.includes('/chat/completions'))) {
    return '端点格式不正确，需包含 openai.azure.com 和 /chat/completions'
  }
  return ''
})

const MODEL_CATALOG_FAILURE_VALUE = '__babelbox_model_catalog_failure__'
const modelCatalogModels = ref<string[]>([])
const modelCatalogLoading = ref(false)
const modelCatalogError = ref('')
const modelCatalogFailureLabel = computed(() => `获取模型列表失败：${modelCatalogError.value}`)
let modelCatalogRequestVersion = 0
let modelCatalogMounted = true

async function refreshModelCatalog(): Promise<void> {
  if (!modelCatalogSupported.value) return
  const requestVersion = ++modelCatalogRequestVersion
  modelCatalogLoading.value = true
  modelCatalogError.value = ''

  try {
    await requestConfigSave(config.value, browser.runtime.sendMessage.bind(browser.runtime))
    const response = await browser.runtime.sendMessage({
      type: TRANSLATION_MODEL_CATALOG_MESSAGE,
      service: instance.value.id,
    }) as TranslationModelCatalogResponse | undefined
    if (!response?.success) throw new Error(response?.error || '请求模型列表失败')
    if (!modelCatalogMounted || requestVersion !== modelCatalogRequestVersion) return
    modelCatalogModels.value = response.models
  } catch (error) {
    if (!modelCatalogMounted || requestVersion !== modelCatalogRequestVersion) return
    modelCatalogModels.value = []
    modelCatalogError.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (modelCatalogMounted && requestVersion === modelCatalogRequestVersion) {
      modelCatalogLoading.value = false
    }
  }
}

function refreshModelCatalogIfSupported(): void {
  if (modelCatalogSupported.value) void refreshModelCatalog()
}

function onModelCatalogVisible(visible: boolean): void {
  if (visible) void refreshModelCatalog()
}

function credentialField(key: keyof TranslationServiceCredential) {
  return computed({
    get: () => getTranslationServiceCredential(config.value, instance.value.id)[key],
    set: (value: string) => {
      const id = instance.value.id
      config.value.serviceCredentials[id] = {
        ...getTranslationServiceCredential(config.value, id),
        [key]: value,
      }
    },
  })
}

const apiKey = credentialField('apiKey')
const appKey = credentialField('appKey')
const appSecret = credentialField('appSecret')
const secretId = credentialField('secretId')
const secretKey = credentialField('secretKey')

const instanceName = computed({
  get: () => instance.value.name,
  set: (value: string) => {
    instance.value.name = value.trimStart().slice(0, 80)
  },
})
const instanceModelId = computed({
  get: () => instance.value.modelId,
  set: (value: string) => {
    instance.value.modelId = value.trim()
  },
})
const instanceEndpoint = computed({
  get: () => instance.value.endpoint,
  set: (value: string) => {
    instance.value.endpoint = value.trim()
  },
})

const minimaxKeyMismatch = computed(() => {
  const token = apiKey.value.trim()
  if (!token) return ''
  const isTokenPlanKey = token.startsWith('sk-cp-')
  if (instance.value.minimaxBillingPlan === 'token-plan' && !isTokenPlanKey) {
    return 'Token Plan 的 Key 应以 sk-cp- 开头，请检查 Key 或计费方式。'
  }
  if (instance.value.minimaxBillingPlan === 'payg' && isTokenPlanKey) {
    return '这是 Token Plan 的 Key（sk-cp-），不能用于按量付费，请切换计费方式或更换 Key。'
  }
  return instance.value.minimaxBillingPlan === 'token-plan'
    ? '请确保 Token Plan 订阅仍有效。'
    : ''
})

const minimaxEndpoint = computed(() => MINIMAX_ENDPOINTS[instance.value.minimaxBillingPlan][instance.value.minimaxRegion])

const mimoKeyMismatch = computed(() => {
  const token = apiKey.value.trim()
  if (!token) return ''
  const kind = token.startsWith('tp-') ? 'token-plan' : token.startsWith('sk-') ? 'payg' : 'other'
  if (instance.value.mimoBillingPlan === 'token-plan' && kind !== 'token-plan') {
    return 'Token Plan 的 Key 应以 tp- 开头，请检查 Key 或计费方式。'
  }
  if (instance.value.mimoBillingPlan === 'payg' && kind === 'token-plan') {
    return '这是 Token Plan 的 Key（tp-），不能用于按量付费，请切换计费方式或更换 Key。'
  }
  if (instance.value.mimoBillingPlan === 'payg' && kind === 'other') {
    return '按量付费的 Key 通常以 sk- 开头，请确认是从 API Keys 页面获取的。'
  }
  return instance.value.mimoBillingPlan === 'token-plan'
    ? '请确保 Token Plan 订阅仍有效。'
    : ''
})

const mimoEndpoint = computed(() => getMimoEndpoint(instance.value.mimoBillingPlan, instance.value.mimoRegion))

type ConnectionTestState = 'idle' | 'testing' | 'success' | 'error'

const connectionTestBusy = ref(false)
const connectionTestState = ref<ConnectionTestState>('idle')
const connectionTestMessage = ref('')
let connectionTestResetTimer: ReturnType<typeof setTimeout> | undefined
let connectionTestMounted = true
const connectionTestLabel = computed(() => ({
  idle: '检查连接',
  testing: '检查中',
  success: '连接正常',
  error: '连接失败',
})[connectionTestState.value])

function clearConnectionTestResetTimer(): void {
  if (connectionTestResetTimer === undefined) return
  clearTimeout(connectionTestResetTimer)
  connectionTestResetTimer = undefined
}

function resetConnectionTest(): void {
  clearConnectionTestResetTimer()
  connectionTestState.value = 'idle'
  connectionTestMessage.value = ''
}

function scheduleConnectionTestReset(): void {
  clearConnectionTestResetTimer()
  if (!connectionTestMounted) return

  connectionTestResetTimer = setTimeout(() => {
    connectionTestResetTimer = undefined
    connectionTestState.value = 'idle'
    connectionTestMessage.value = ''
  }, 2000)
}

async function testConnection(): Promise<void> {
  if (connectionTestBusy.value) return

  clearConnectionTestResetTimer()
  connectionTestBusy.value = true
  connectionTestState.value = 'testing'
  connectionTestMessage.value = '正在发送测试请求…'

  try {
    await requestConfigSave(config.value, browser.runtime.sendMessage.bind(browser.runtime))
    const response = await browser.runtime.sendMessage({
      type: CONNECTION_TEST_MESSAGE,
      service: instance.value.id,
    }) as {success?: boolean; durationMs?: number; error?: string} | undefined

    if (!response?.success) {
      throw new Error(response?.error || '连接测试失败')
    }

    connectionTestState.value = 'success'
    connectionTestMessage.value = `翻译成功${typeof response.durationMs === 'number' ? `，耗时 ${response.durationMs} ms` : ''}`
  } catch (error) {
    connectionTestState.value = 'error'
    connectionTestMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    connectionTestBusy.value = false
    scheduleConnectionTestReset()
  }
}

function resetPrompts(): void {
  void ElMessageBox.confirm(
    '当前的 system 和 user 提示词会被清空，改用默认提示词。',
    '恢复默认提示词',
    {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    },
  ).then(() => {
    instance.value.systemRole = ''
    instance.value.userRole = ''
    ElMessage.success('已恢复默认提示词')
  }).catch(() => {
    // 用户取消操作，不做任何处理。
  })
}

const instanceId = computed(() => instance.value.id)
watch(instanceId, resetConnectionTest)
watch([instanceId, modelCatalogSupported], ([, supported]) => {
  modelCatalogRequestVersion += 1
  modelCatalogModels.value = []
  modelCatalogError.value = ''
  modelCatalogLoading.value = false
  if (supported) void refreshModelCatalog()
}, {immediate: true})
onBeforeUnmount(() => {
  connectionTestMounted = false
  modelCatalogMounted = false
  modelCatalogRequestVersion += 1
  clearConnectionTestResetTimer()
})
</script>

<style scoped>
.input-error :deep(.el-input__wrapper) {
  box-shadow: 0 0 0 1px var(--el-color-danger) inset;
}

.error-text {
  margin-top: 4px;
  color: var(--danger);
  font-size: var(--font-small);
  line-height: var(--line-height-tight);
}

.model-catalog-control {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 7px;
}

.model-catalog-control :deep(.el-select) {
  width: 0;
  min-width: 0;
  flex: 1;
}

.model-catalog-control :deep(.el-select__wrapper) {
  height: var(--control-height);
  min-height: var(--control-height);
  box-sizing: border-box;
  border-radius: var(--radius-control);
}

.model-catalog-control :deep(.el-button) {
  width: var(--control-height);
  height: var(--control-height);
  padding: 0;
  aspect-ratio: 1;
  flex: 0 0 var(--control-height);
  border-radius: var(--radius-control);
}

.model-catalog-option {
  display: block;
  width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
  white-space: normal;
}

:global(.babelbox-model-catalog-popper .el-select-dropdown__item) {
  height: auto;
  min-width: 0;
  min-height: var(--control-height-small);
  padding-top: 8px;
  padding-bottom: 8px;
  overflow: hidden;
  line-height: 1.35;
  white-space: normal;
}

.button-icon {
  width: 16px;
  height: 16px;
  flex: 0 0 auto;
  stroke-width: 2;
}

.is-spinning {
  animation: babelbox-icon-spin 900ms linear infinite;
}

@keyframes babelbox-icon-spin {
  to { transform: rotate(360deg); }
}

.custom-template-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin: 4px 0 8px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.custom-template-heading > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.custom-template-heading strong {
  color: var(--ink);
  font-size: var(--font-small);
}

.custom-template-heading small {
  color: var(--muted);
  font-size: var(--font-small);
  line-height: var(--line-height-body);
}

.connection-test-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 94px;
  min-height: 34px;
  flex: 0 0 auto;
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius-control);
  color: var(--ink);
  background: var(--surface-soft);
  font-size: var(--font-small);
  font-weight: var(--weight-medium);
  cursor: pointer;
  transition: background 160ms ease, color 160ms ease;
}

.connection-test-button:hover:not(:disabled) { background: var(--line); }
.connection-test-button:disabled { cursor: wait; opacity: .65; }
.connection-test-button.is-success { color: var(--success); background: var(--success-soft); }
.connection-test-button.is-error { color: var(--danger); background: var(--danger-soft); }

.minimax-key-note {
  margin: -6px 0 10px;
  color: var(--muted);
  font-size: var(--font-small);
  line-height: var(--line-height-body);
}

.mimo-key-note {
  margin: -6px 0 10px;
  color: var(--muted);
  font-size: var(--font-small);
  line-height: var(--line-height-body);
}

.minimax-key-note.is-warning {
  color: var(--danger);
}

.mimo-key-note.is-warning {
  color: var(--danger);
}

/* 只读地址与输入框同尺寸，但去掉填充底色，避免被误认为可编辑。 */
.derived-endpoint {
  display: flex;
  min-height: var(--control-height);
  align-items: center;
  padding: 0 12px;
  overflow: hidden;
  border: 1px dashed var(--line);
  border-radius: var(--radius-control);
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: all;
}

@media (max-width: 700px) {
  .connection-test-button {
    width: 100%;
    margin-left: 0;
  }

  .custom-template-heading {
    align-items: stretch;
    flex-direction: column;
  }
}

</style>
