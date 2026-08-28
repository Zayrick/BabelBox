<template>
  <Teleport v-if="presentation.showConnectionTest" defer to=".detail-hero">
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
    :data-service-configuration-service="service"
    :data-custom-service-configuration="presentation.fields.customService ? 'true' : 'false'"
  >
    <div v-if="credentialWarning" class="credential-warning" role="alert">
      <TriangleAlert class="status-icon" aria-hidden="true" />
      <strong>配置提醒</strong>
      <span>{{ credentialWarning }}</span>
    </div>
    <div class="subsection-heading">
      <div>
        <strong>连接参数</strong>
        <small v-if="presentation.showCredentialNotice" class="connection-test-hint">API 凭据默认仅保留在当前浏览器会话；检查连接会发送一条短测试请求，可能产生少量用量。</small>
      </div>
    </div>

    <div v-if="presentation.fields.apiKeyPolicy" class="api-key-policy">
      <div class="api-key-policy-copy">
        <div class="api-key-policy-title">
          <strong>API Key 鉴权</strong>
          <el-tooltip class="box-item" effect="dark" content="关闭后，当前模型可在没有 API Key 时发起请求。" placement="top" :show-after="500">
            <el-icon aria-label="API Key 鉴权说明"><InfoFilled /></el-icon>
          </el-tooltip>
          <span class="api-key-policy-status" :class="{ 'is-off': !requireApiKey }">
            {{ requireApiKey ? '需要' : '免 Key' }}
          </span>
        </div>
        <small class="api-key-policy-model">{{ config.model[service] || '未选择' }}</small>
      </div>
      <el-switch v-model="requireApiKey" aria-label="当前模型是否需要 API Key" size="small" />
    </div>

    <el-row v-if="presentation.fields.token" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <SettingsHelpLabel content="API 访问令牌默认仅保存在当前浏览器会话。只有在配置管理中明确开启后，才会以明文写入扩展本地存储并跨重启保留。获取方式请参考对应服务的官方文档；翻译服务为 ollama 时，token 可为任意值">访问令牌</SettingsHelpLabel>
      </el-col>
      <el-col :span="12"><el-input v-model="config.token[service]" type="password" show-password placeholder="请输入API访问令牌" /></el-col>
    </el-row>
    <p v-if="presentation.fields.minimaxRegion && minimaxKeyMismatch" class="minimax-key-note is-warning">
      {{ minimaxKeyMismatch }}
    </p>

    <el-row v-if="presentation.fields.minimaxRegion" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <SettingsHelpLabel content="按量付费和 Token Plan 使用不同的账户权益；请按控制台中 Key 的来源选择。">MiniMax 计费方式</SettingsHelpLabel>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.minimaxBillingPlan" aria-label="MiniMax 计费方式" placeholder="请选择 MiniMax 计费方式">
          <el-option class="select-left" v-for="item in options.minimaxBillingPlan" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </el-col>
    </el-row>

    <el-row v-if="presentation.fields.minimaxRegion" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <SettingsHelpLabel content="选择与 MiniMax Key 来源一致的 API 区域。Token Plan Key（sk-cp-）和按量付费 Key 不能互换。">MiniMax 区域</SettingsHelpLabel>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.minimaxRegion" aria-label="MiniMax API 区域" placeholder="请选择 MiniMax API 区域">
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
        <el-select v-model="config.mimoBillingPlan" aria-label="小米 MiMo 计费方式" placeholder="请选择小米 MiMo 计费方式">
          <el-option class="select-left" v-for="item in options.mimoBillingPlan" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </el-col>
    </el-row>

    <el-row v-if="presentation.fields.mimoRegion" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner">
        <SettingsHelpLabel content="Token Plan 必须使用购买页面提供的集群地址；中国、新加坡和欧洲集群的 tp- Key 不能混用。按量付费统一使用 api.xiaomimimo.com。">MiMo API 集群</SettingsHelpLabel>
      </el-col>
      <el-col :span="12">
        <el-select v-model="config.mimoRegion" aria-label="小米 MiMo API 集群" placeholder="请选择小米 MiMo API 集群">
          <el-option class="select-left" v-for="item in options.mimoRegion" :key="item.value" :label="item.label" :value="item.value" />
        </el-select>
      </el-col>
    </el-row>

    <div v-if="presentation.fields.mimoRegion" class="mimo-endpoint" data-mimo-endpoint>
      <span>当前 API 地址</span>
      <code>{{ mimoEndpoint }}</code>
    </div>

    <el-row v-if="presentation.fields.azureOpenaiEndpoint" class="margin-bottom margin-left-2em">
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

    <el-row v-if="presentation.fields.akSkCredentials" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><SettingsHelpLabel content="服务商提供的访问密钥。" :show-after="300">API Key</SettingsHelpLabel></el-col>
      <el-col :span="12"><el-input v-model="config.ak" placeholder="请输入Access Key" /></el-col>
    </el-row>
    <el-row v-if="presentation.fields.akSkCredentials" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><SettingsHelpLabel content="服务商提供的私密密钥，请妥善保管。" :show-after="300">Secret Key</SettingsHelpLabel></el-col>
      <el-col :span="12"><el-input v-model="config.sk" type="password" placeholder="请输入Secret Key" /></el-col>
    </el-row>

    <el-row v-if="presentation.fields.youdaoCredentials" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><SettingsHelpLabel content="有道翻译服务提供的 App Key。" :show-after="300">App Key</SettingsHelpLabel></el-col>
      <el-col :span="12"><el-input v-model="config.youdaoAppKey" placeholder="有道 AppKey" /></el-col>
    </el-row>
    <el-row v-if="presentation.fields.youdaoCredentials" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><SettingsHelpLabel content="有道翻译服务提供的 App Secret。" :show-after="300">App Secret</SettingsHelpLabel></el-col>
      <el-col :span="12"><el-input v-model="config.youdaoAppSecret" type="password" show-password placeholder="有道 AppSecret" /></el-col>
    </el-row>

    <el-row v-if="presentation.fields.tencentCredentials" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><SettingsHelpLabel content="腾讯云翻译服务提供的 SecretId。" :show-after="300">Secret ID</SettingsHelpLabel></el-col>
      <el-col :span="12"><el-input v-model="config.tencentSecretId" placeholder="腾讯云 SecretId" /></el-col>
    </el-row>
    <el-row v-if="presentation.fields.tencentCredentials" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><SettingsHelpLabel content="腾讯云翻译服务提供的 SecretKey。" :show-after="300">Secret Key</SettingsHelpLabel></el-col>
      <el-col :span="12"><el-input v-model="config.tencentSecretKey" type="password" show-password placeholder="腾讯云 SecretKey" /></el-col>
    </el-row>

    <el-row v-if="presentation.fields.robotId" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><SettingsHelpLabel content="填写对应 Coze 机器人的 ID。" :show-after="300">机器人ID</SettingsHelpLabel></el-col>
      <el-col :span="12"><el-input v-model="config.robot_id[service]" placeholder="请输入Coze机器人ID" /></el-col>
    </el-row>

    <el-row v-if="presentation.fields.customService" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><SettingsHelpLabel content="填写兼容翻译请求的自定义接口地址。" :show-after="300">自定义接口</SettingsHelpLabel></el-col>
      <el-col :span="12"><el-input v-model="config.custom" placeholder="请输入自定义接口地址" /></el-col>
    </el-row>

    <el-row v-if="presentation.fields.customService" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><SettingsHelpLabel content="可选的代理地址；填写后，自定义接口请求会优先发送到这里。" :show-after="300">代理地址</SettingsHelpLabel></el-col>
      <el-col :span="12"><el-input v-model="config.proxy[service]" placeholder="默认直连自定义接口" /></el-col>
    </el-row>
    <el-row v-if="presentation.fields.newApiEndpoint" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><SettingsHelpLabel content="填写 New API 服务的接口地址。" :show-after="300">NewAPI接口</SettingsHelpLabel></el-col>
      <el-col :span="12"><el-input v-model="config.newApiUrl" placeholder="请输入您的New API接口地址" /></el-col>
    </el-row>

    <el-row v-if="presentation.fields.customModel" class="margin-bottom margin-left-2em">
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
          <el-input v-model="config.system_role[service]" type="textarea" maxlength="8192" placeholder="system message" />
        </el-col>
      </el-row>

      <el-row class="settings-control-row">
        <el-col :span="8" class="settings-control-label lightblue rounded-corner">
          <SettingsHelpLabel content="以 user 身份发送的对话模板；{{to}} 表示目标语言，{{origin}} 表示待翻译文本。" :show-after="300">user</SettingsHelpLabel>
        </el-col>
        <el-col :span="16" class="settings-control-field">
          <el-input v-model="config.user_role[service]" type="textarea" maxlength="8192" placeholder="user message template" />
        </el-col>
      </el-row>
    </template>

    <el-row v-if="presentation.fields.deepseekApiType" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><SettingsHelpLabel content="选择 DeepSeek 接口使用的 API 格式。" :show-after="300">API 格式</SettingsHelpLabel></el-col>
      <el-col :span="12"><el-select v-model="config.deepseekApiType" placeholder="请选择 API 格式"><el-option class="select-left" v-for="item in options.deepseekApiType" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-col>
    </el-row>
    <el-row v-if="presentation.fields.deepseekThinkingMode" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><SettingsHelpLabel content="控制 DeepSeek 是否启用思考过程。" :show-after="300">思考模式</SettingsHelpLabel></el-col>
      <el-col :span="12"><el-select v-model="config.deepseekThinkingMode" placeholder="请选择思考模式"><el-option class="select-left" v-for="item in options.deepseekThinkingMode" :key="item.value" :label="item.label" :value="item.value" /></el-select></el-col>
    </el-row>

    <el-row v-if="presentation.fields.customBody" class="margin-bottom margin-left-2em">
      <el-col :span="12" class="lightblue rounded-corner"><SettingsHelpLabel content="填写要合并到翻译请求中的 JSON 参数对象。" :show-after="300">自定义请求体</SettingsHelpLabel></el-col>
      <el-col :span="12">
        <el-input v-model="config.customBody[service]" :class="{ 'input-error': !isValidCustomBody(config.customBody[service]) }" placeholder='例如：{"thinking": {"type": "disabled"}}' />
        <div v-if="!isValidCustomBody(config.customBody[service])" class="error-text">请输入合法的 JSON 对象，否则该配置将被忽略</div>
      </el-col>
    </el-row>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRef, watch } from 'vue'
import {
  CircleCheck,
  CircleHelp as InfoFilled,
  CircleX,
  LoaderCircle,
  PlugZap,
  RotateCcw,
  TriangleAlert,
} from '@lucide/vue'
import type { Config } from '@/src/core/config/model'
import { defaultOption, options as optionConfig } from '@/src/core/config/catalog'
import { isValidCustomBody } from '@/src/core/config/customBody'
import {
  getApiKeyRequirementKey,
  getMissingCredentialMessage,
  isApiKeyRequired,
} from '@/src/core/config/validation'
import type {ServiceConfigurationPresentation} from '@/src/features/settings/model/serviceConfiguration'
import {browser} from 'wxt/browser'
import { requestConfigSave } from '@/src/services/config/store'
import { CONNECTION_TEST_MESSAGE, getMimoEndpoint, MINIMAX_ENDPOINTS } from '@/src/core/config/constants'
import { ElMessage, ElMessageBox } from 'element-plus'
import SettingsHelpLabel from '../SettingsHelpLabel.vue'

const props = defineProps<{
  config: Config
  service: string
  presentation: ServiceConfigurationPresentation
  options: typeof optionConfig
  isValidAzureEndpoint: (endpoint: string) => boolean
}>()

const config = toRef(props, 'config')
const service = toRef(props, 'service')
const presentation = toRef(props, 'presentation')
const options = toRef(props, 'options')
const isValidAzureEndpoint = toRef(props, 'isValidAzureEndpoint')

const requireApiKey = computed({
  get: () => isApiKeyRequired(service.value, config.value),
  set: (value: boolean) => {
    config.value.requireApiKey[getApiKeyRequirementKey(service.value, config.value)] = value
  },
})
const credentialWarning = computed(
  () => getMissingCredentialMessage(service.value, config.value),
)

const minimaxKeyKind = computed(() => {
  const token = config.value.token[service.value]?.trim() || ''
  return token.startsWith('sk-cp-') ? 'token-plan' : token ? 'other' : 'empty'
})

const minimaxKeyMismatch = computed(() => {
  if (minimaxKeyKind.value === 'empty') return ''
  if (config.value.minimaxBillingPlan === 'token-plan' && minimaxKeyKind.value !== 'token-plan') {
    return '当前选择的是 Token Plan，但 Key 不是 sk-cp- 开头；请确认 Key 来源，Token Plan 订阅必须有效。'
  }
  if (config.value.minimaxBillingPlan === 'payg' && minimaxKeyKind.value === 'token-plan') {
    return '当前选择的是按量付费，但检测到 sk-cp- Token Plan Key；两类 Key 不能互换，请切换计费方式或更换 Key。'
  }
  return config.value.minimaxBillingPlan === 'token-plan'
    ? '当前使用 Token Plan Key；请确认 Token Plan 订阅有效。'
    : ''
})

const minimaxEndpoint = computed(() => {
  const plan = config.value.minimaxBillingPlan === 'token-plan' ? 'token-plan' : 'payg'
  const region = config.value.minimaxRegion === 'cn' ? 'cn' : 'global'
  return MINIMAX_ENDPOINTS[plan][region]
})

const mimoKeyKind = computed(() => {
  const token = config.value.token[service.value]?.trim() || ''
  if (token.startsWith('tp-')) return 'token-plan'
  if (token.startsWith('sk-')) return 'payg'
  return token ? 'other' : 'empty'
})

const mimoKeyMismatch = computed(() => {
  if (mimoKeyKind.value === 'empty') return ''
  if (config.value.mimoBillingPlan === 'token-plan' && mimoKeyKind.value !== 'token-plan') {
    return '当前选择的是 MiMo Token Plan，但 Key 不是 tp- 开头；请确认 Key 来源和订阅状态。'
  }
  if (config.value.mimoBillingPlan === 'payg' && mimoKeyKind.value === 'token-plan') {
    return '当前选择的是 MiMo 按量付费，但检测到 tp- Token Plan Key；两类 Key 不能互换，请切换计费方式或更换 Key。'
  }
  if (config.value.mimoBillingPlan === 'payg' && mimoKeyKind.value === 'other') {
    return 'MiMo 按量付费 Key 通常以 sk- 开头；请确认 Key 来自 API Keys 页面。'
  }
  return config.value.mimoBillingPlan === 'token-plan'
    ? '当前使用 MiMo Token Plan Key；请确认订阅仍在有效期内。'
    : ''
})

const mimoEndpoint = computed(() => {
  return getMimoEndpoint(config.value.mimoBillingPlan, config.value.mimoRegion)
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
      service: service.value,
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
    config.value.system_role[service.value] = defaultOption.system_role
    config.value.user_role[service.value] = defaultOption.user_role
    ElMessage.success('已恢复自定义接口默认模板')
  }).catch(() => {
    // 用户取消操作，不做任何处理。
  })
}

watch(service, resetConnectionTest)
onBeforeUnmount(() => {
  connectionTestMounted = false
  clearConnectionTestResetTimer()
})
</script>

<style scoped>
.credential-warning {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 12px;
  padding: 10px 12px;
  border: 1px solid #f3d19e;
  border-radius: 10px;
  color: #8a5a00;
  background: #fdf6ec;
  font-size: 12px;
  line-height: 1.5;
}

.status-icon,
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

.subsection-heading > div:first-child {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 7px;
}

.connection-test-hint {
  color: #9098a8;
  font-size: 11px;
  font-weight: 400;
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
  margin-left: auto;
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

  .subsection-heading > div:first-child {
    align-items: flex-start;
    flex-direction: column;
    gap: 3px;
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

.credential-warning strong {
  flex: 0 0 auto;
  font-weight: 750;
}

.api-key-policy {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin: 0 0 8px;
  padding: 10px 12px;
  border: 1px solid #edf0f5;
  border-radius: 10px;
  background: #fbfcfe;
  transition: border-color 160ms ease, background 160ms ease;
}

.api-key-policy:hover {
  border-color: #e5b4c2;
  background: #fff;
}

.api-key-policy-copy {
  min-width: 0;
}

.api-key-policy-title {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  color: #172033;
  font-size: 13px;
}

.api-key-policy-title strong {
  font-weight: 650;
}

.api-key-policy-title .el-icon {
  color: #8b93a4;
  font-size: 13px;
}

.api-key-policy-status {
  display: inline-flex;
  align-items: center;
  margin-left: 3px;
  padding: 2px 7px;
  border: 1px solid #f4c5d2;
  border-radius: 6px;
  color: #c52f58;
  background: #fff2f5;
  font-size: 10px;
  font-weight: 750;
  line-height: 1.3;
}

.api-key-policy-status.is-off {
  border-color: #dfe3eb;
  color: #687286;
  background: #f5f6f8;
}

.api-key-policy-model {
  display: block;
  max-width: 100%;
  margin-top: 4px;
  overflow: hidden;
  color: #909399;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.api-key-policy :deep(.el-switch) {
  flex: 0 0 auto;
  --el-switch-on-color: #ef4776;
  --el-switch-off-color: #cfd5df;
}
</style>
