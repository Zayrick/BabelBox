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
    :data-service-configuration-service="instanceId"
    :data-custom-service-configuration="presentation.fields.customService ? 'true' : 'false'"
  >
    <div class="subsection-heading">
      <strong>连接参数</strong>
    </div>

    <template v-if="isAIInstance">
      <el-row class="margin-bottom margin-left-2em">
        <el-col :span="12" class="lightblue rounded-corner">
          <SettingsHelpLabel content="显示在服务列表、下拉菜单和翻译中心中的名称。">服务名称</SettingsHelpLabel>
        </el-col>
        <el-col :span="12"><el-input v-model="instanceName" maxlength="80" placeholder="请输入服务名称" /></el-col>
      </el-row>
      <el-row v-if="servicesType.isUseModel(service)" class="margin-bottom margin-left-2em">
        <el-col :span="12" class="lightblue rounded-corner">
          <SettingsHelpLabel content="当前服务实例实际请求的模型标识；同一供应商可以添加多个不同模型。">模型 ID</SettingsHelpLabel>
        </el-col>
        <el-col :span="12">
          <div v-if="modelCatalogSupported" class="model-catalog-control">
            <el-select
              v-model="instanceModelId"
              filterable
              allow-create
              default-first-option
              fit-input-width
              popper-class="fluentread-model-catalog-popper"
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
      <el-row v-if="showInstanceEndpoint" class="margin-bottom margin-left-2em">
        <el-col :span="12" class="lightblue rounded-corner">
          <SettingsHelpLabel content="可选。留空时使用供应商默认请求地址；自定义、New API 和 Azure OpenAI 服务必须填写。">请求地址</SettingsHelpLabel>
        </el-col>
        <el-col :span="12"><el-input v-model="instanceEndpoint" inputmode="url" placeholder="留空使用供应商默认地址" @change="refreshModelCatalogIfSupported" /></el-col>
      </el-row>
    </template>

    <el-row v-if="presentation.fields.token" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <SettingsHelpLabel content="可选。留空时不发送鉴权信息；填写后默认仅保存在当前浏览器会话。只有在配置管理中明确开启后，才会以明文写入扩展本地存储并跨重启保留。">访问令牌</SettingsHelpLabel>
      </el-col>
      <el-col :span="12"><el-input v-model="apiKey" type="password" show-password placeholder="可选；留空时不发送鉴权信息" @change="refreshModelCatalogIfSupported" /></el-col>
    </el-row>
    <p v-if="presentation.fields.minimaxRegion && minimaxKeyMismatch" class="minimax-key-note is-warning">
      {{ minimaxKeyMismatch }}
    </p>

    <el-row v-if="presentation.fields.minimaxRegion" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <SettingsHelpLabel content="按量付费和 Token Plan 使用不同的账户权益；请按控制台中 Key 的来源选择。">MiniMax 计费方式</SettingsHelpLabel>
      </el-col>
      <el-col :span="12">
        <el-select v-model="minimaxBillingPlan" aria-label="MiniMax 计费方式" placeholder="请选择 MiniMax 计费方式" @change="refreshModelCatalogIfSupported">
          <el-option class="select-left" v-for="item in options.minimaxBillingPlan" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </el-col>
    </el-row>

    <el-row v-if="presentation.fields.minimaxRegion" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <SettingsHelpLabel content="选择与 MiniMax Key 来源一致的 API 区域。Token Plan Key（sk-cp-）和按量付费 Key 不能互换。">MiniMax 区域</SettingsHelpLabel>
      </el-col>
      <el-col :span="12">
        <el-select v-model="minimaxRegion" aria-label="MiniMax API 区域" placeholder="请选择 MiniMax API 区域" @change="refreshModelCatalogIfSupported">
          <el-option class="select-left" v-for="item in options.minimaxRegion" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </el-col>
    </el-row>

    <div v-if="presentation.fields.minimaxRegion" class="minimax-endpoint" data-minimax-endpoint>
      <span>当前 API 地址</span>
      <code>{{ minimaxEndpoint }}</code>
    </div>

    <p v-if="presentation.fields.mimoRegion && mimoKeyMismatch" class="mimo-key-note is-warning">
      {{ mimoKeyMismatch }}
    </p>

    <el-row v-if="presentation.fields.mimoRegion" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <SettingsHelpLabel content="按量付费和 Token Plan 使用不同的账户权益；请按小米 MiMo 控制台中 Key 的来源选择。">小米 MiMo 计费方式</SettingsHelpLabel>
      </el-col>
      <el-col :span="12">
        <el-select v-model="mimoBillingPlan" aria-label="小米 MiMo 计费方式" placeholder="请选择小米 MiMo 计费方式" @change="refreshModelCatalogIfSupported">
          <el-option class="select-left" v-for="item in options.mimoBillingPlan" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </el-col>
    </el-row>

    <el-row v-if="presentation.fields.mimoRegion" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <SettingsHelpLabel content="Token Plan 必须使用购买页面提供的集群地址；中国、新加坡和欧洲集群的 tp- Key 不能混用。按量付费统一使用 api.xiaomimimo.com。">MiMo API 集群</SettingsHelpLabel>
      </el-col>
      <el-col :span="12">
        <el-select v-model="mimoRegion" aria-label="小米 MiMo API 集群" placeholder="请选择小米 MiMo API 集群" @change="refreshModelCatalogIfSupported">
          <el-option class="select-left" v-for="item in options.mimoRegion" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </el-col>
    </el-row>

    <div v-if="presentation.fields.mimoRegion" class="mimo-endpoint" data-mimo-endpoint>
      <span>当前 API 地址</span>
      <code>{{ mimoEndpoint }}</code>
    </div>

    <el-row v-if="presentation.fields.azureOpenaiEndpoint && !isAIInstance" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <SettingsHelpLabel content="Azure OpenAI 服务端点地址，必须包含完整的部署信息。">Azure 端点</SettingsHelpLabel>
      </el-col>
      <el-col :span="12">
        <el-input v-model="config.azureOpenaiEndpoint" placeholder="https://your-resource.openai.azure.com/openai/deployments/your-model/chat/completions?api-version=2024-02-15-preview" :class="{ 'input-error': config.azureOpenaiEndpoint && !isValidAzureEndpoint(config.azureOpenaiEndpoint) }" />
        <div v-if="config.azureOpenaiEndpoint && !isValidAzureEndpoint(config.azureOpenaiEndpoint)" class="error-text">端点地址格式不正确，请确保包含 openai.azure.com 域名和 /chat/completions 路径</div>
      </el-col>
    </el-row>

    <el-row v-if="presentation.fields.deepLxEndpoint" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <el-tooltip class="box-item" effect="dark" content="DeepLX API 服务地址，默认为本地地址。如果使用远程 DeepLX 服务，请修改为对应的服务地址" placement="top-start" :show-after="500"><span class="popup-text popup-vertical-left">服务地址</span></el-tooltip>
      </el-col>
      <el-col :span="12"><el-input v-model="config.deeplx" placeholder="http://localhost:1188/translate" /></el-col>
    </el-row>

    <el-row v-if="presentation.fields.youdaoCredentials" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><SettingsHelpLabel content="有道翻译服务提供的 App Key。" :show-after="300">App Key</SettingsHelpLabel></el-col>
      <el-col :span="12">
        <el-input v-model="appKey" :class="{ 'input-error': !appKey.trim() }" placeholder="有道 App Key" />
        <div v-if="!appKey.trim()" class="error-text">App Key 为必填项</div>
      </el-col>
    </el-row>
    <el-row v-if="presentation.fields.youdaoCredentials" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><SettingsHelpLabel content="有道翻译服务提供的 App Secret。" :show-after="300">App Secret</SettingsHelpLabel></el-col>
      <el-col :span="12">
        <el-input v-model="appSecret" :class="{ 'input-error': !appSecret.trim() }" type="password" show-password placeholder="有道 App Secret" />
        <div v-if="!appSecret.trim()" class="error-text">App Secret 为必填项</div>
      </el-col>
    </el-row>

    <el-row v-if="presentation.fields.tencentCredentials" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><SettingsHelpLabel content="腾讯云翻译服务提供的 SecretId。" :show-after="300">Secret ID</SettingsHelpLabel></el-col>
      <el-col :span="12">
        <el-input v-model="secretId" :class="{ 'input-error': !secretId.trim() }" placeholder="腾讯云 SecretId" />
        <div v-if="!secretId.trim()" class="error-text">Secret ID 为必填项</div>
      </el-col>
    </el-row>
    <el-row v-if="presentation.fields.tencentCredentials" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><SettingsHelpLabel content="腾讯云翻译服务提供的 SecretKey。" :show-after="300">Secret Key</SettingsHelpLabel></el-col>
      <el-col :span="12">
        <el-input v-model="secretKey" :class="{ 'input-error': !secretKey.trim() }" type="password" show-password placeholder="腾讯云 SecretKey" />
        <div v-if="!secretKey.trim()" class="error-text">Secret Key 为必填项</div>
      </el-col>
    </el-row>

    <el-row v-if="presentation.fields.robotId" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><SettingsHelpLabel content="填写对应 Coze 机器人的 ID。" :show-after="300">机器人ID</SettingsHelpLabel></el-col>
      <el-col :span="12"><el-input v-model="robotId" placeholder="请输入Coze机器人ID" /></el-col>
    </el-row>

    <el-row v-if="presentation.fields.customService && !isAIInstance" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><SettingsHelpLabel content="填写兼容翻译请求的自定义接口地址。" :show-after="300">自定义接口</SettingsHelpLabel></el-col>
      <el-col :span="12"><el-input v-model="config.custom" placeholder="请输入自定义接口地址" /></el-col>
    </el-row>

    <el-row v-if="presentation.fields.customService" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><SettingsHelpLabel content="可选的代理地址；填写后，自定义接口请求会优先发送到这里。" :show-after="300">代理地址</SettingsHelpLabel></el-col>
      <el-col :span="12"><el-input v-model="proxy" placeholder="默认直连自定义接口" /></el-col>
    </el-row>
    <el-row v-if="presentation.fields.newApiEndpoint && !isAIInstance" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><SettingsHelpLabel content="填写 New API 服务的接口地址。" :show-after="300">NewAPI接口</SettingsHelpLabel></el-col>
      <el-col :span="12"><el-input v-model="config.newApiUrl" placeholder="请输入您的New API接口地址" /></el-col>
    </el-row>

    <el-row v-if="presentation.fields.customModel && !isAIInstance" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><SettingsHelpLabel content="填写服务商支持的模型标识；选择自定义模型后，网页翻译会使用这里的值。" :show-after="300">{{ service === 'doubao' ? '接入点' : '自定义模型' }}</SettingsHelpLabel></el-col>
      <el-col :span="12"><el-input v-model="config.customModel[service]" placeholder="例如：gemma:7b" /></el-col>
    </el-row>

    <template v-if="presentation.fields.customService">
      <div class="custom-template-heading">
        <div>
          <strong>请求模板</strong>
          <small>按 OpenAI Chat Completions 格式发送。</small>
        </div>
        <el-button type="primary" link size="small" @click="resetCustomTemplate"><el-icon><RotateCcw /></el-icon>恢复默认模板</el-button>
      </div>

      <el-row class="settings-control-row">
        <el-col :span="8" class="settings-control-label lightblue rounded-corner">
          <SettingsHelpLabel content="以 system 身份发送的对话内容。" :show-after="300">system</SettingsHelpLabel>
        </el-col>
        <el-col :span="16" class="settings-control-field">
          <el-input v-model="systemRole" type="textarea" maxlength="8192" placeholder="system message" />
        </el-col>
      </el-row>

      <el-row class="settings-control-row">
        <el-col :span="8" class="settings-control-label lightblue rounded-corner">
          <SettingsHelpLabel content="以 user 身份发送的对话模板；{{to}} 表示目标语言，{{origin}} 表示待翻译文本。" :show-after="300">user</SettingsHelpLabel>
        </el-col>
        <el-col :span="16" class="settings-control-field">
          <el-input v-model="userRole" type="textarea" maxlength="8192" placeholder="user message template" />
        </el-col>
      </el-row>
    </template>

    <el-row v-if="presentation.fields.deepseekApiType" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><SettingsHelpLabel content="选择 DeepSeek 接口使用的 API 格式。" :show-after="300">API 格式</SettingsHelpLabel></el-col>
      <el-col :span="12"><el-select v-model="deepseekApiType" placeholder="请选择 API 格式"><el-option class="select-left" v-for="item in options.deepseekApiType" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-col>
    </el-row>
    <el-row v-if="presentation.fields.deepseekThinkingMode" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><SettingsHelpLabel content="控制 DeepSeek 是否启用思考过程。" :show-after="300">思考模式</SettingsHelpLabel></el-col>
      <el-col :span="12"><el-select v-model="deepseekThinkingMode" placeholder="请选择思考模式"><el-option class="select-left" v-for="item in options.deepseekThinkingMode" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-col>
    </el-row>

    <AdvancedRequestParameters
      v-if="presentation.fields.customBody"
      v-model="customBody"
      :invalid="!isValidCustomBody(customBody)"
      invalid-message="请输入合法的 JSON 对象，否则该配置将被忽略"
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
import type { Config, TranslationServiceCredential } from '@/src/core/config/model'
import type { TranslationServiceInstance } from '@/src/core/config/translationServices'
import { defaultOption, options as optionConfig, servicesType } from '@/src/core/config/catalog'
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
  service: string
  instance?: TranslationServiceInstance
  presentation: ServiceConfigurationPresentation
  options: typeof optionConfig
  isValidAzureEndpoint: (endpoint: string) => boolean
}>()

const config = toRef(props, 'config')
const instance = computed(() => props.instance)
const instanceId = computed(() => instance.value?.id || props.service)
const service = computed(() => instance.value?.provider || props.service)
const isAIInstance = computed(() => instance.value?.kind === 'ai')
const modelCatalogSupported = computed(() => isAIInstance.value
  && hasDynamicTranslationModelCatalog(service.value))
const showInstanceEndpoint = computed(() => isAIInstance.value
  && (servicesType.isUseProxy(service.value) || servicesType.isUseCustomUrl(service.value)))
const presentation = toRef(props, 'presentation')
const options = toRef(props, 'options')
const isValidAzureEndpoint = toRef(props, 'isValidAzureEndpoint')

const MODEL_CATALOG_FAILURE_VALUE = '__fluentread_model_catalog_failure__'
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
      service: instanceId.value,
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

function ensureInstanceCredential(): TranslationServiceCredential {
  const id = instanceId.value
  const existing = config.value.serviceCredentials[id]
  if (existing) return existing
  const usesProviderId = instance.value?.id === instance.value?.provider
  const credential = {
    apiKey: usesProviderId ? config.value.token[service.value] || '' : '',
    appKey: usesProviderId ? config.value.youdaoAppKey || '' : '',
    appSecret: usesProviderId ? config.value.youdaoAppSecret || '' : '',
    secretId: usesProviderId ? config.value.tencentSecretId || '' : '',
    secretKey: usesProviderId ? config.value.tencentSecretKey || '' : '',
  }
  config.value.serviceCredentials[id] = credential
  return credential
}

function instanceCredentialValue(key: keyof TranslationServiceCredential): string {
  const credential = config.value.serviceCredentials[instanceId.value]
  if (credential) return credential[key] || ''
  if (instance.value?.id !== instance.value?.provider) return ''
  if (key === 'apiKey') return config.value.token[service.value] || ''
  if (key === 'appKey') return config.value.youdaoAppKey || ''
  if (key === 'appSecret') return config.value.youdaoAppSecret || ''
  if (key === 'secretId') return config.value.tencentSecretId || ''
  return config.value.tencentSecretKey || ''
}

function legacyProviderMappingValue(mapping: Record<string, string>): string {
  const selected = instance.value
  if (selected && selected.id !== selected.provider) return ''
  return mapping[service.value] || ''
}

const instanceName = computed({
  get: () => instance.value?.name || '',
  set: (value: string) => {
    if (instance.value) instance.value.name = value.trimStart().slice(0, 80)
  },
})
const instanceModelId = computed({
  get: () => instance.value?.modelId || legacyProviderMappingValue(config.value.model),
  set: (value: string) => {
    if (instance.value) instance.value.modelId = value.trim()
    else config.value.model[service.value] = value
  },
})
const instanceEndpoint = computed({
  get: () => {
    const selected = instance.value
    if (!selected) return ''
    return servicesType.isCustom(service.value)
      ? selected.endpoint
      : selected.proxy || selected.endpoint
  },
  set: (value: string) => {
    if (!instance.value) return
    instance.value.endpoint = value.trim()
    if (!servicesType.isCustom(service.value)) instance.value.proxy = ''
  },
})
const apiKey = computed({
  get: () => isAIInstance.value
    ? instanceCredentialValue('apiKey')
    : config.value.token[service.value] || '',
  set: (value: string) => {
    if (isAIInstance.value) ensureInstanceCredential().apiKey = value
    else config.value.token[service.value] = value
  },
})
const appKey = computed({
  get: () => isAIInstance.value ? instanceCredentialValue('appKey') : config.value.youdaoAppKey,
  set: (value: string) => {
    if (isAIInstance.value) ensureInstanceCredential().appKey = value
    else config.value.youdaoAppKey = value
  },
})
const appSecret = computed({
  get: () => isAIInstance.value ? instanceCredentialValue('appSecret') : config.value.youdaoAppSecret,
  set: (value: string) => {
    if (isAIInstance.value) ensureInstanceCredential().appSecret = value
    else config.value.youdaoAppSecret = value
  },
})
const secretId = computed({
  get: () => isAIInstance.value ? instanceCredentialValue('secretId') : config.value.tencentSecretId,
  set: (value: string) => {
    if (isAIInstance.value) ensureInstanceCredential().secretId = value
    else config.value.tencentSecretId = value
  },
})
const secretKey = computed({
  get: () => isAIInstance.value ? instanceCredentialValue('secretKey') : config.value.tencentSecretKey,
  set: (value: string) => {
    if (isAIInstance.value) ensureInstanceCredential().secretKey = value
    else config.value.tencentSecretKey = value
  },
})
const robotId = computed({
  get: () => instance.value?.robotId || legacyProviderMappingValue(config.value.robot_id),
  set: (value: string) => {
    if (instance.value) instance.value.robotId = value
    else config.value.robot_id[service.value] = value
  },
})
const proxy = computed({
  get: () => instance.value?.proxy || legacyProviderMappingValue(config.value.proxy),
  set: (value: string) => {
    if (instance.value) instance.value.proxy = value.trim()
    else config.value.proxy[service.value] = value
  },
})
const systemRole = computed({
  get: () => instance.value?.systemRole || legacyProviderMappingValue(config.value.system_role),
  set: (value: string) => {
    if (instance.value) instance.value.systemRole = value
    else config.value.system_role[service.value] = value
  },
})
const userRole = computed({
  get: () => instance.value?.userRole || legacyProviderMappingValue(config.value.user_role),
  set: (value: string) => {
    if (instance.value) instance.value.userRole = value
    else config.value.user_role[service.value] = value
  },
})
const customBody = computed({
  get: () => instance.value?.customBody || legacyProviderMappingValue(config.value.customBody),
  set: (value: string) => {
    if (instance.value) instance.value.customBody = value
    else config.value.customBody[service.value] = value
  },
})
const minimaxBillingPlan = computed({
  get: () => instance.value?.minimaxBillingPlan || config.value.minimaxBillingPlan,
  set: (value: Config['minimaxBillingPlan']) => {
    if (instance.value) instance.value.minimaxBillingPlan = value
    else config.value.minimaxBillingPlan = value
  },
})
const minimaxRegion = computed({
  get: () => instance.value?.minimaxRegion || config.value.minimaxRegion,
  set: (value: Config['minimaxRegion']) => {
    if (instance.value) instance.value.minimaxRegion = value
    else config.value.minimaxRegion = value
  },
})
const mimoBillingPlan = computed({
  get: () => instance.value?.mimoBillingPlan || config.value.mimoBillingPlan,
  set: (value: Config['mimoBillingPlan']) => {
    if (instance.value) instance.value.mimoBillingPlan = value
    else config.value.mimoBillingPlan = value
  },
})
const mimoRegion = computed({
  get: () => instance.value?.mimoRegion || config.value.mimoRegion,
  set: (value: Config['mimoRegion']) => {
    if (instance.value) instance.value.mimoRegion = value
    else config.value.mimoRegion = value
  },
})
const deepseekApiType = computed({
  get: () => instance.value?.deepseekApiType || config.value.deepseekApiType,
  set: (value: Config['deepseekApiType']) => {
    if (instance.value) instance.value.deepseekApiType = value
    else config.value.deepseekApiType = value
  },
})
const deepseekThinkingMode = computed({
  get: () => instance.value?.deepseekThinkingMode || config.value.deepseekThinkingMode,
  set: (value: Config['deepseekThinkingMode']) => {
    if (instance.value) instance.value.deepseekThinkingMode = value
    else config.value.deepseekThinkingMode = value
  },
})

const minimaxKeyKind = computed(() => {
  const token = apiKey.value.trim()
  return token.startsWith('sk-cp-') ? 'token-plan' : token ? 'other' : 'empty'
})

const minimaxKeyMismatch = computed(() => {
  if (minimaxKeyKind.value === 'empty') return ''
  if (minimaxBillingPlan.value === 'token-plan' && minimaxKeyKind.value !== 'token-plan') {
    return '当前选择的是 Token Plan，但 Key 不是 sk-cp- 开头；请确认 Key 来源，Token Plan 订阅必须有效。'
  }
  if (minimaxBillingPlan.value === 'payg' && minimaxKeyKind.value === 'token-plan') {
    return '当前选择的是按量付费，但检测到 sk-cp- Token Plan Key；两类 Key 不能互换，请切换计费方式或更换 Key。'
  }
  return minimaxBillingPlan.value === 'token-plan'
    ? '当前使用 Token Plan Key；请确认 Token Plan 订阅有效。'
    : ''
})

const minimaxEndpoint = computed(() => {
  const plan = minimaxBillingPlan.value === 'token-plan' ? 'token-plan' : 'payg'
  const region = minimaxRegion.value === 'cn' ? 'cn' : 'global'
  return MINIMAX_ENDPOINTS[plan][region]
})

const mimoKeyKind = computed(() => {
  const token = apiKey.value.trim()
  if (token.startsWith('tp-')) return 'token-plan'
  if (token.startsWith('sk-')) return 'payg'
  return token ? 'other' : 'empty'
})

const mimoKeyMismatch = computed(() => {
  if (mimoKeyKind.value === 'empty') return ''
  if (mimoBillingPlan.value === 'token-plan' && mimoKeyKind.value !== 'token-plan') {
    return '当前选择的是 MiMo Token Plan，但 Key 不是 tp- 开头；请确认 Key 来源和订阅状态。'
  }
  if (mimoBillingPlan.value === 'payg' && mimoKeyKind.value === 'token-plan') {
    return '当前选择的是 MiMo 按量付费，但检测到 tp- Token Plan Key；两类 Key 不能互换，请切换计费方式或更换 Key。'
  }
  if (mimoBillingPlan.value === 'payg' && mimoKeyKind.value === 'other') {
    return 'MiMo 按量付费 Key 通常以 sk- 开头；请确认 Key 来自 API Keys 页面。'
  }
  return mimoBillingPlan.value === 'token-plan'
    ? '当前使用 MiMo Token Plan Key；请确认订阅仍在有效期内。'
    : ''
})

const mimoEndpoint = computed(() => {
  return getMimoEndpoint(mimoBillingPlan.value, mimoRegion.value)
})

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
  connectionTestMessage.value = '正在保存当前配置并请求服务…'

  try {
    await requestConfigSave(config.value, browser.runtime.sendMessage.bind(browser.runtime))
    const response = await browser.runtime.sendMessage({
      type: CONNECTION_TEST_MESSAGE,
      service: instanceId.value,
    }) as {success?: boolean; durationMs?: number; error?: string} | undefined

    if (!response?.success) {
      throw new Error(response?.error || '连接测试失败')
    }

    connectionTestState.value = 'success'
    connectionTestMessage.value = `已完成真实翻译请求${typeof response.durationMs === 'number' ? `（${response.durationMs} ms）` : ''}。`
  } catch (error) {
    connectionTestState.value = 'error'
    connectionTestMessage.value = error instanceof Error ? error.message : String(error)
  } finally {
    connectionTestBusy.value = false
    scheduleConnectionTestReset()
  }
}

function resetCustomTemplate(): void {
  void ElMessageBox.confirm(
    '确定要恢复自定义接口的默认 system 和 user 模板吗？此操作会覆盖当前模板。',
    '恢复默认模板',
    {
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      type: 'warning',
    },
  ).then(() => {
    systemRole.value = defaultOption.system_role
    userRole.value = defaultOption.user_role
    ElMessage.success('已恢复自定义接口默认模板')
  }).catch(() => {
    // 用户取消操作，不做任何处理。
  })
}

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
  color: var(--el-color-danger);
  font-size: 12px;
  line-height: 1.4;
}

.model-catalog-control {
  --model-catalog-control-size: 38px;
  --model-catalog-control-radius: 8px;
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
  height: var(--model-catalog-control-size);
  min-height: var(--model-catalog-control-size);
  box-sizing: border-box;
  border-radius: var(--model-catalog-control-radius);
}

.model-catalog-control :deep(.el-button) {
  width: var(--model-catalog-control-size);
  height: var(--model-catalog-control-size);
  padding: 0;
  aspect-ratio: 1;
  flex: 0 0 var(--model-catalog-control-size);
  border-radius: var(--model-catalog-control-radius);
}

.model-catalog-option {
  display: block;
  width: 100%;
  min-width: 0;
  overflow-wrap: anywhere;
  white-space: normal;
}

:global(.fluentread-model-catalog-popper .el-select-dropdown__item) {
  height: auto;
  min-width: 0;
  min-height: 34px;
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
  animation: fluentread-icon-spin 900ms linear infinite;
}

@keyframes fluentread-icon-spin {
  to { transform: rotate(360deg); }
}

.subsection-heading {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
}

.custom-template-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin: 4px 0 8px;
  padding-top: 12px;
  border-top: 1px solid #eceef3;
}

.custom-template-heading > div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.custom-template-heading strong {
  color: #46526a;
  font-size: 12px;
}

.custom-template-heading small {
  color: #9098a8;
  font-size: 11px;
  line-height: 1.5;
}

.connection-test-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 94px;
  flex: 0 0 auto;
  padding: 7px 12px;
  border: 1px solid #ef4776;
  border-radius: 9px;
  color: #c52f58;
  background: #fff4f7;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: 160ms ease;
}

.connection-test-button:hover:not(:disabled) {
  color: #fff;
  background: #ef4776;
}

.connection-test-button:disabled {
  cursor: wait;
  opacity: .65;
}

.connection-test-button.is-success {
  border-color: #b8e0cb;
  color: #287447;
  background: #effaf3;
}

.connection-test-button.is-success:hover:not(:disabled) {
  border-color: #28aa79;
  color: #fff;
  background: #28aa79;
}

.connection-test-button.is-error {
  border-color: #f2c0ca;
  color: #a52c48;
  background: #fff1f4;
}

.connection-test-button.is-error:hover:not(:disabled) {
  border-color: #d45c70;
  color: #fff;
  background: #d45c70;
}

.minimax-key-note {
  margin: -6px 0 10px;
  color: #6d7890;
  font-size: 11px;
  line-height: 1.5;
}

.mimo-key-note {
  margin: -6px 0 10px;
  color: #6d7890;
  font-size: 11px;
  line-height: 1.5;
}

.minimax-key-note.is-warning {
  color: #a52c48;
}

.mimo-key-note.is-warning {
  color: #a52c48;
}

.minimax-endpoint {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: -4px 0 10px;
  color: #8993a5;
  font-size: 11px;
  line-height: 1.5;
}

.minimax-endpoint code {
  overflow-wrap: anywhere;
  color: #59657b;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.mimo-endpoint {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: -4px 0 10px;
  color: #8993a5;
  font-size: 11px;
  line-height: 1.5;
}

.mimo-endpoint code {
  overflow-wrap: anywhere;
  color: #59657b;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

@media (max-width: 700px) {
  .subsection-heading {
    align-items: flex-start;
    flex-direction: column;
  }

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
