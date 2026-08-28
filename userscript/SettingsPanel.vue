<template>
  <div class="fr-userscript-settings-backdrop fr-theme" :class="{ 'fr-dark-theme': isDark }" role="presentation" @click.self="close">
    <section class="fr-userscript-settings" role="dialog" aria-modal="true" aria-labelledby="fr-userscript-settings-title">
      <header>
        <div class="brand">
          <img v-if="iconUrl" :src="iconUrl" alt="" />
          <span><strong id="fr-userscript-settings-title">流畅阅读</strong><small>{{ versionLabel }}</small></span>
        </div>
        <button type="button" class="close" aria-label="关闭设置" @click="close"><X aria-hidden="true" /></button>
      </header>

      <div class="notice">
        该版本复用 FluentRead 当前翻译核心。截图 OCR、圈选翻译、Chrome 内置翻译和扩展右键菜单依赖浏览器扩展权限，userscript 中暂不提供。
      </div>

      <div class="settings-grid">
        <fieldset>
          <legend>基础设置</legend>
          <label class="toggle"><span>启用 FluentRead</span><el-switch v-model="draft.on" class="fr-userscript-switch" aria-label="启用 FluentRead" /></label>
          <label><span>源语言</span><el-select v-model="draft.from" class="fr-userscript-select" aria-label="源语言" :teleported="false" :popper-options="selectPopperOptions"><el-option v-for="item in options.form" :key="item.value" :label="item.label" :value="item.value" /></el-select></label>
          <label><span>目标语言</span><el-select v-model="draft.to" class="fr-userscript-select" aria-label="目标语言" :teleported="false" :popper-options="selectPopperOptions"><el-option v-for="item in options.to" :key="item.value" :label="item.label" :value="item.value" /></el-select></label>
          <label><span>译文显示</span><el-select v-model="draft.display" class="fr-userscript-select" aria-label="译文显示" :teleported="false" :popper-options="selectPopperOptions"><el-option v-for="item in options.display" :key="item.value" :label="item.label" :value="item.value" /></el-select></label>
          <label><span>双语样式</span><el-select v-model="draft.style" class="fr-userscript-select" aria-label="双语样式" :teleported="false" :popper-options="selectPopperOptions"><el-option v-for="item in styleOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></label>
          <label class="toggle"><span>打开网页后自动翻译</span><el-switch v-model="draft.autoTranslate" class="fr-userscript-switch" aria-label="打开网页后自动翻译" /></label>
          <label class="toggle"><span>使用翻译缓存</span><el-switch v-model="draft.useCache" class="fr-userscript-switch" aria-label="使用翻译缓存" /></label>
        </fieldset>

        <fieldset>
          <legend>翻译服务</legend>
          <div class="service-heading">
            <span>已添加服务</span>
            <button type="button" class="add-service" aria-label="添加 AI 翻译服务" @click="showAddService = !showAddService">{{ showAddService ? '×' : '+' }}</button>
          </div>
          <div class="service-inventory">
            <div v-for="item in managedServices" :key="item.id" class="service-row" :class="{ selected: managedServiceId === item.id, disabled: !item.enabled }">
              <ServiceIcon :service="item.provider" :label="providerLabel(item.provider)" size="small" />
              <button type="button" class="service-row-main" @click="selectManagedService(item.id)"><strong>{{ item.name }}</strong><small>{{ providerLabel(item.provider) }}<template v-if="item.modelId"> · {{ item.modelId }}</template></small></button>
              <div class="service-row-actions">
                <button v-if="item.kind === 'ai'" type="button" class="delete-service" :aria-label="`删除 ${item.name}`" @click.stop="removeAIService(item)">删除</button>
                <el-switch class="fr-userscript-switch" size="small" :aria-label="`${item.name} 启用状态`" :model-value="item.enabled" @click.stop @change="setServiceEnabled(item, Boolean($event))" />
              </div>
            </div>
          </div>

          <div v-if="showAddService" class="add-service-panel">
            <div class="add-service-title">
              <strong>添加 AI 翻译服务</strong>
            </div>
            <p class="hint">选择供应商后直接添加；模型、凭据和请求地址在下方服务详情中配置。</p>
            <div class="add-provider-grid" aria-label="可添加的 AI 翻译供应商">
              <button v-for="item in aiProviderOptions" :key="item.value" type="button" @click="addAIService(item.value)">
                <ServiceIcon :service="item.value" :label="item.label" size="small" />
                <span>{{ item.label }}</span>
                <small>添加</small>
              </button>
            </div>
            <div class="add-service-actions"><button type="button" class="secondary" @click="showAddService = false">关闭</button></div>
          </div>

          <label><span>当前使用</span><el-select v-model="draft.service" class="fr-userscript-select" aria-label="翻译服务" :teleported="false" :popper-options="selectPopperOptions" @change="managedServiceId = draft.service"><el-option v-for="item in serviceOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></label>
          <p v-if="serviceDescription" class="hint">{{ serviceDescription }}</p>
          <template v-if="selectedInstance">
            <label v-if="selectedInstance.kind === 'ai'"><span>服务名称</span><input v-model.trim="selectedInstance.name" autocomplete="off" /></label>
            <label v-if="selectedInstance.kind === 'ai' && servicesType.isUseModel(selectedProvider)">
              <span>模型 ID</span>
              <el-select
                v-if="modelCatalogSupported"
                v-model="selectedInstance.modelId"
                class="fr-userscript-select"
                aria-label="模型 ID"
                filterable
                allow-create
                default-first-option
                fit-input-width
                popper-class="fr-userscript-model-catalog-popper"
                :loading="modelCatalogLoading"
                :teleported="false"
                :popper-options="selectPopperOptions"
                placeholder="输入或选择模型 ID"
                @visible-change="onModelCatalogVisible"
              >
                <el-option v-if="modelCatalogError" :label="modelCatalogFailureLabel" :value="MODEL_CATALOG_FAILURE_VALUE" disabled><span class="model-catalog-option">{{ modelCatalogFailureLabel }}</span></el-option>
                <el-option v-for="model in modelCatalogModels" :key="model" :label="model" :value="model"><span class="model-catalog-option">{{ model }}</span></el-option>
              </el-select>
              <input v-else v-model.trim="selectedInstance.modelId" autocomplete="off" />
            </label>
            <label v-if="selectedInstance.kind === 'ai' && usesToken" class="toggle"><span>当前模型需要 API Key</span><el-switch v-model="selectedInstance.requireApiKey" class="fr-userscript-switch" aria-label="当前模型需要 API Key" /></label>
            <label v-if="usesToken"><span>API Key / Token</span><input v-model.trim="serviceApiKey" type="password" autocomplete="off" @change="refreshModelCatalogIfSupported" /></label>
            <label v-if="selectedInstance.kind === 'ai'"><span>请求地址（可选）</span><input v-model.trim="serviceEndpoint" inputmode="url" placeholder="留空使用供应商默认接口" @change="refreshModelCatalogIfSupported" /></label>
            <label v-if="selectedProvider === services.deeplx"><span>DeepLX 地址</span><input v-model.trim="draft.deeplx" inputmode="url" /></label>
            <label v-if="selectedInstance.kind === 'machine' && servicesType.isUseProxy(selectedProvider)"><span>代理地址（可选）</span><input v-model.trim="selectedInstance.proxy" inputmode="url" placeholder="留空使用默认接口" /></label>
          </template>
          <template v-if="selectedProvider === services.youdao">
            <label><span>有道 App Key</span><input v-model.trim="serviceAppKey" autocomplete="off" /></label>
            <label><span>有道 App Secret</span><input v-model.trim="serviceAppSecret" type="password" autocomplete="off" /></label>
          </template>
          <template v-if="servicesType.isTencent(selectedProvider)">
            <label><span>腾讯 Secret ID</span><input v-model.trim="serviceSecretId" autocomplete="off" /></label>
            <label><span>腾讯 Secret Key</span><input v-model.trim="serviceSecretKey" type="password" autocomplete="off" /></label>
          </template>
          <label v-if="selectedInstance && servicesType.isCoze(selectedProvider)"><span>Bot ID</span><input v-model.trim="selectedInstance.robotId" autocomplete="off" /></label>
          <p v-if="credentialWarning" class="warning">{{ credentialWarning }}</p>
          <label class="toggle"><span>AI 网页上下文</span><el-switch v-model="draft.enableAIContext" class="fr-userscript-switch" aria-label="AI 网页上下文" :disabled="!canUseAIContext" /></label>
        </fieldset>

        <fieldset>
          <legend>页面交互</legend>
          <label class="toggle"><span>显示全文翻译悬浮球</span><el-switch v-model="floatingBallEnabled" class="fr-userscript-switch" aria-label="显示全文翻译悬浮球" /></label>
          <label class="toggle"><span>显示翻译进度面板</span><el-switch v-model="draft.translationProgressPanelEnabled" class="fr-userscript-switch" aria-label="显示翻译进度面板" /></label>
          <label><span>全文快捷键</span><el-select v-model="draft.floatingBallHotkey" class="fr-userscript-select" aria-label="全文快捷键" :teleported="false" :popper-options="selectPopperOptions"><el-option v-for="item in options.floatingBallHotkeys" :key="item.value" :label="item.label" :value="item.value" /></el-select></label>
          <label><span>全文翻译范围</span><el-select v-model="draft.fullPageTranslationMode" class="fr-userscript-select" aria-label="全文翻译范围" :teleported="false" :popper-options="selectPopperOptions"><el-option label="按阅读进度（推荐）" value="viewport" /><el-option label="立即翻译到网页底部" value="all" /></el-select></label>
          <p class="hint">“立即翻译到网页底部”会处理当前已加载的整页内容，并持续翻译之后新增的内容；它不会自动滚动页面，但可能产生更多请求。</p>
          <label><span>悬浮翻译触发</span><el-select v-model="draft.hotkey" class="fr-userscript-select" aria-label="悬浮翻译触发" :teleported="false" :popper-options="selectPopperOptions"><el-option v-for="item in hoverOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></label>
          <label><span>划词翻译</span><el-select v-model="draft.selectionTranslatorMode" class="fr-userscript-select" aria-label="划词翻译" :teleported="false" :popper-options="selectPopperOptions"><el-option label="关闭" value="disabled" /><el-option label="原文 + 译文" value="bilingual" /><el-option label="仅译文" value="translation-only" /></el-select></label>
          <label v-if="draft.selectionTranslatorMode !== 'disabled'"><span>划词触发</span><el-select v-model="draft.selectionTranslatorTrigger" class="fr-userscript-select" aria-label="划词触发" :teleported="false" :popper-options="selectPopperOptions"><el-option label="直接显示" value="direct" /><el-option label="翻译图标" value="icon" /><el-option label="小圆点" value="dot" /></el-select></label>
          <label><span>输入框翻译</span><el-select v-model="draft.inputBoxTranslationTrigger" class="fr-userscript-select" aria-label="输入框翻译" :teleported="false" :popper-options="selectPopperOptions"><el-option v-for="item in options.inputBoxTranslationTrigger" :key="item.value" :label="item.label" :value="item.value" /></el-select></label>
          <label v-if="draft.inputBoxTranslationTrigger !== 'disabled'"><span>输入框目标语言</span><el-select v-model="draft.inputBoxTranslationTarget" class="fr-userscript-select" aria-label="输入框目标语言" :teleported="false" :popper-options="selectPopperOptions"><el-option v-for="item in options.inputBoxTranslationTarget" :key="item.value" :label="item.label" :value="item.value" /></el-select></label>
          <label><span>并发翻译数</span><input v-model.number="draft.maxConcurrentTranslations" type="number" min="1" /></label>
          <label><span>动画效果</span><el-select v-model="draft.animationMode" class="fr-userscript-select" aria-label="动画效果" :teleported="false" :popper-options="selectPopperOptions"><el-option v-for="item in options.animationModes" :key="item.value" :label="item.label" :value="item.value" /></el-select></label>
          <label><span>主题</span><el-select v-model="draft.theme" class="fr-userscript-select" aria-label="主题" :teleported="false" :popper-options="selectPopperOptions"><el-option v-for="item in options.theme" :key="item.value" :label="item.label" :value="item.value" /></el-select></label>
        </fieldset>

        <fieldset class="filter-fieldset">
          <legend>内容过滤</legend>
          <p class="hint">默认规则可以编辑或删除。网站规则优先于同一元素命中的全局规则。</p>
          <label class="toggle"><span>跳过隐藏内容</span><el-switch v-model="draft.translationFilter.global.excludeHidden" class="fr-userscript-switch" aria-label="跳过隐藏内容" /></label>
          <label class="toggle"><span>跳过可编辑内容</span><el-switch v-model="draft.translationFilter.global.excludeEditable" class="fr-userscript-switch" aria-label="跳过可编辑内容" /></label>
          <TranslationFilterRulesEditor v-model="draft.translationFilter.global.rules" />
          <div v-if="currentSiteDomain" class="userscript-site-filter-heading">
            <span><strong>当前网站</strong><small>{{ currentSiteDomain }} · 对所有子域生效</small></span>
            <button v-if="currentSiteHasFilter" type="button" @click="removeCurrentSiteFilter">移除网站规则</button>
          </div>
          <TranslationFilterRulesEditor
            v-if="currentSiteDomain"
            compact
            :model-value="currentSiteFilterRules"
            empty-description="添加规则后，会优先处理当前网站中命中的内容。"
            @update:model-value="setCurrentSiteFilterRules"
          />
        </fieldset>

        <details v-if="selectedInstance?.kind === 'ai'">
          <summary>高级 AI 请求设置</summary>
          <label><span>自定义请求体（JSON）</span><textarea v-model="selectedInstance.customBody" rows="4" placeholder="可选：合并到请求体顶层" /></label>
          <label><span>System 提示词</span><textarea v-model="selectedInstance.systemRole" rows="4" /></label>
          <label><span>User 提示词</span><textarea v-model="selectedInstance.userRole" rows="5" /></label>
        </details>
      </div>

      <footer>
        <span class="status" :class="{ error: statusIsError }">{{ status }}</span>
        <div>
          <button type="button" class="secondary" @click="restoreDefaults">恢复默认</button>
          <button type="button" class="secondary" @click="togglePageTranslation">翻译 / 恢复当前页</button>
          <button type="button" class="primary" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存设置' }}</button>
        </div>
      </footer>
    </section>
  </div>
</template>

<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue';
import {X} from '@lucide/vue';
import {ElOption, ElSelect, ElSwitch} from 'element-plus';
import 'element-plus/es/components/select/style/css';
import 'element-plus/es/components/switch/style/css';
import '@/src/ui/styles/tokens.css';
import {browser} from 'wxt/browser';
import ServiceIcon from '@/src/ui/components/ServiceIcon.vue';
import {Config, type TranslationServiceCredential} from '@/src/core/config/model';
import {config as runtimeConfig, configReady, saveConfig} from '@/src/services/config/store';
import {options, services, servicesType} from '@/src/core/config/catalog';
import {getMissingCredentialMessage} from '@/src/core/config/validation';
import {clearTranslationServiceCredentials} from '@/src/core/config/credentials';
import {
  aiTranslationProviders,
  clearTranslationServiceConfiguration,
  createAITranslationService,
  createTranslationServiceId,
  getTranslationProviderDescription,
  getTranslationProviderLabel,
  getTranslationServiceInstance,
  type TranslationServiceInstance,
} from '@/src/core/config/translationServices';
import {getSelectableTranslationServices} from '@/src/services/translation/capabilities';
import {resolvesToDarkTheme} from '@/src/ui/theme/theme';
import {getSiteBaseDomain} from '@/src/core/site-rules/domain';
import {
  getTranslationFilterSite,
  removeTranslationFilterSite,
  upsertTranslationFilterSite,
  type TranslationFilterRule,
} from '@/src/core/translation/filters';
import TranslationFilterRulesEditor from '@/src/features/settings/ui/TranslationFilterRulesEditor.vue';
import {
  hasDynamicTranslationModelCatalog,
  TRANSLATION_MODEL_CATALOG_MESSAGE,
  type TranslationModelCatalogResponse,
} from '@/src/services/translation/modelCatalog';
import {
  getEnabledUserscriptServices,
  isUserscriptServiceSupported,
  normalizeUserscriptConfig,
} from './initialize';

const emit = defineEmits<{close: []}>();
const versionLabel = `FluentRead V${process.env.VUE_APP_VERSION} · Userscript V${process.env.VUE_APP_USERSCRIPT_VERSION}`;
const iconUrl = globalThis.__FLUENTREAD_ICON_DATA__ || '';
const draft = ref(new Config());
const saving = ref(false);
const status = ref('');
const statusIsError = ref(false);
const showAddService = ref(false);
const managedServiceId = ref('');
const selectPopperOptions = {strategy: 'fixed'} as const;
const serviceOptions = computed(() => getSelectableTranslationServices(draft.value)
  .filter(item => isUserscriptServiceSupported(item.provider)));
const managedServices = computed(() => draft.value.translationServices
  .filter(item => isUserscriptServiceSupported(item.provider)));
const aiProviderOptions = options.services.filter(item => (
  !item.disabled && aiTranslationProviders.includes(item.value) && isUserscriptServiceSupported(item.value)
));
const styleOptions = options.styles.filter(item => !item.disabled && typeof item.value === 'number');
const hoverOptions = options.keys.filter(item => !item.disabled);
const currentSiteDomain = getSiteBaseDomain(globalThis.location?.href ?? '') ?? '';
const currentSiteFilter = computed(() => currentSiteDomain
  ? getTranslationFilterSite(draft.value.translationFilter, currentSiteDomain)
  : null);
const currentSiteFilterRules = computed(() => currentSiteFilter.value?.rules ?? []);
const currentSiteHasFilter = computed(() => currentSiteFilter.value !== null);
const selectedInstance = computed(() => getTranslationServiceInstance(
  draft.value,
  managedServiceId.value || draft.value.service,
));
const selectedProvider = computed(() => selectedInstance.value?.provider || '');
const serviceDescription = computed(() => getTranslationProviderDescription(selectedProvider.value));
const usesToken = computed(() => servicesType.isUseToken(selectedProvider.value));
const canUseAIContext = computed(() => servicesType.isUseAIContext(
  selectedProvider.value,
  selectedInstance.value?.modelId || '',
));
const credentialWarning = computed(() => selectedInstance.value
  ? getMissingCredentialMessage(selectedInstance.value.id, draft.value) || ''
  : '');
const modelCatalogSupported = computed(() => selectedInstance.value?.kind === 'ai'
  && hasDynamicTranslationModelCatalog(selectedProvider.value));
const MODEL_CATALOG_FAILURE_VALUE = '__fluentread_model_catalog_failure__';
const modelCatalogModels = ref<string[]>([]);
const modelCatalogLoading = ref(false);
const modelCatalogError = ref('');
const modelCatalogFailureLabel = computed(() => `获取模型列表失败：${modelCatalogError.value}`);
let modelCatalogRequestVersion = 0;
let modelCatalogMounted = true;

type CredentialKey = keyof TranslationServiceCredential;

function selectedCredentialValue(key: CredentialKey): string {
  const instance = selectedInstance.value;
  if (!instance) return '';
  const credential = draft.value.serviceCredentials[instance.id];
  if (credential) return credential[key] || '';
  if (instance.id !== instance.provider) return '';
  if (key === 'apiKey') return draft.value.token[instance.provider] || '';
  if (key === 'appKey') return draft.value.youdaoAppKey || '';
  if (key === 'appSecret') return draft.value.youdaoAppSecret || '';
  if (key === 'secretId') return draft.value.tencentSecretId || '';
  return draft.value.tencentSecretKey || '';
}

function ensureSelectedCredential(): TranslationServiceCredential | null {
  const instance = selectedInstance.value;
  if (!instance) return null;
  const existing = draft.value.serviceCredentials[instance.id];
  if (existing) return existing;
  const usesProviderId = instance.id === instance.provider;
  const credential: TranslationServiceCredential = {
    apiKey: usesProviderId ? draft.value.token[instance.provider] || '' : '',
    appKey: usesProviderId ? draft.value.youdaoAppKey || '' : '',
    appSecret: usesProviderId ? draft.value.youdaoAppSecret || '' : '',
    secretId: usesProviderId ? draft.value.tencentSecretId || '' : '',
    secretKey: usesProviderId ? draft.value.tencentSecretKey || '' : '',
  };
  draft.value.serviceCredentials[instance.id] = credential;
  return credential;
}

function credentialBinding(key: CredentialKey) {
  return computed({
    get: () => selectedCredentialValue(key),
    set: (value: string) => {
      const credential = ensureSelectedCredential();
      if (credential) credential[key] = value;
    },
  });
}

const serviceApiKey = credentialBinding('apiKey');
const serviceAppKey = credentialBinding('appKey');
const serviceAppSecret = credentialBinding('appSecret');
const serviceSecretId = credentialBinding('secretId');
const serviceSecretKey = credentialBinding('secretKey');
const serviceEndpoint = computed({
  get: () => selectedInstance.value?.proxy || selectedInstance.value?.endpoint || '',
  set: (value: string) => {
    const instance = selectedInstance.value;
    if (!instance) return;
    instance.endpoint = value;
    instance.proxy = '';
  },
});
const floatingBallEnabled = computed({
  get: () => !draft.value.disableFloatingBall,
  set: (enabled: boolean) => { draft.value.disableFloatingBall = !enabled; },
});
const themeMedia = window.matchMedia('(prefers-color-scheme: dark)');
const prefersDark = ref(themeMedia.matches);
const isDark = computed(() => resolvesToDarkTheme(draft.value.theme, prefersDark.value));

function updatePreferredTheme(event: MediaQueryListEvent): void {
  prefersDark.value = event.matches;
}

onMounted(async () => {
  themeMedia.addEventListener('change', updatePreferredTheme);
  await configReady;
  if (!modelCatalogMounted) return;
  draft.value = normalizeUserscriptConfig(runtimeConfig);
  managedServiceId.value = draft.value.service;
});

async function refreshModelCatalog(): Promise<void> {
  const service = selectedInstance.value;
  if (!service || !modelCatalogSupported.value) return;
  const requestVersion = ++modelCatalogRequestVersion;
  modelCatalogLoading.value = true;
  modelCatalogError.value = '';

  try {
    const response = await browser.runtime.sendMessage({
      type: TRANSLATION_MODEL_CATALOG_MESSAGE,
      service: service.id,
      config: draft.value,
    }) as TranslationModelCatalogResponse | undefined;
    if (!response?.success) throw new Error(response?.error || '请求模型列表失败');
    if (!modelCatalogMounted || requestVersion !== modelCatalogRequestVersion) return;
    modelCatalogModels.value = response.models;
  } catch (error) {
    if (!modelCatalogMounted || requestVersion !== modelCatalogRequestVersion) return;
    modelCatalogModels.value = [];
    modelCatalogError.value = error instanceof Error ? error.message : String(error);
  } finally {
    if (modelCatalogMounted && requestVersion === modelCatalogRequestVersion) {
      modelCatalogLoading.value = false;
    }
  }
}

function refreshModelCatalogIfSupported(): void {
  if (modelCatalogSupported.value) void refreshModelCatalog();
}

function onModelCatalogVisible(visible: boolean): void {
  if (visible) void refreshModelCatalog();
}

watch([() => selectedInstance.value?.id, modelCatalogSupported], ([, supported]) => {
  modelCatalogRequestVersion += 1;
  modelCatalogModels.value = [];
  modelCatalogError.value = '';
  modelCatalogLoading.value = false;
  if (supported) void refreshModelCatalog();
}, {immediate: true});

onBeforeUnmount(() => {
  themeMedia.removeEventListener('change', updatePreferredTheme);
  modelCatalogMounted = false;
  modelCatalogRequestVersion += 1;
});

function providerLabel(provider: string): string {
  return getTranslationProviderLabel(provider);
}

function selectManagedService(serviceId: string): void {
  managedServiceId.value = serviceId;
}

function setServiceEnabled(instance: TranslationServiceInstance, enabled: boolean): void {
  if (!enabled) {
    const remaining = getEnabledUserscriptServices(draft.value).filter(item => item.id !== instance.id);
    if (!remaining.length) {
      statusIsError.value = true;
      status.value = '至少需要保留一个可用的翻译服务。';
      return;
    }
  }

  instance.enabled = enabled;
  if (!enabled && draft.value.service === instance.id) {
    draft.value.service = getEnabledUserscriptServices(draft.value)[0]?.id || services.microsoft;
  }
  draft.value.translationCenterServices = draft.value.translationCenterServices
    .filter(serviceId => serviceId !== instance.id || enabled);
  statusIsError.value = false;
  status.value = enabled ? `已启用「${instance.name}」。` : `已禁用「${instance.name}」。`;
}

function removeAIService(instance: TranslationServiceInstance): void {
  if (instance.kind !== 'ai') return;
  const remainingEnabled = getEnabledUserscriptServices(draft.value)
    .filter(item => item.id !== instance.id);
  if (instance.enabled && !remainingEnabled.length) {
    statusIsError.value = true;
    status.value = '无法删除最后一个可用的翻译服务。';
    return;
  }
  if (!window.confirm(`确定删除翻译服务「${instance.name}」吗？`)) return;

  draft.value.translationServices = draft.value.translationServices
    .filter(item => item.id !== instance.id);
  clearTranslationServiceConfiguration(draft.value, instance);
  clearTranslationServiceCredentials(draft.value, instance.id);
  draft.value.translationCenterServices = draft.value.translationCenterServices
    .filter(serviceId => serviceId !== instance.id);
  const fallbackId = remainingEnabled[0]?.id || services.microsoft;
  if (draft.value.service === instance.id) draft.value.service = fallbackId;
  if (draft.value.documentService === instance.id) draft.value.documentService = fallbackId;
  if (draft.value.videoService === instance.id) draft.value.videoService = fallbackId;
  if (managedServiceId.value === instance.id) managedServiceId.value = draft.value.service;
  statusIsError.value = false;
  status.value = `已删除「${instance.name}」，保存设置后生效。`;
}

function addAIService(provider: string): void {
  if (!isUserscriptServiceSupported(provider) || !servicesType.isAI(provider)) {
    statusIsError.value = true;
    status.value = '请选择 userscript 支持的 AI 供应商。';
    return;
  }

  const instance = createAITranslationService(provider, {
    id: createTranslationServiceId(provider, draft.value.translationServices),
    modelId: '',
  });
  draft.value.translationServices.push(instance);
  draft.value.service = instance.id;
  managedServiceId.value = instance.id;
  showAddService.value = false;
  statusIsError.value = false;
  status.value = `已添加「${instance.name}」，保存设置后生效。`;
}

function close(): void {
  emit('close');
}

async function syncCurrentPage(next: Config): Promise<void> {
  await browser.tabs.sendMessage(1, {
    type: 'toggleFloatingBall',
    isEnabled: next.on && !next.disableFloatingBall,
  });
  await browser.tabs.sendMessage(1, {
    type: 'updateSelectionTranslatorMode',
    mode: next.on ? next.selectionTranslatorMode : 'disabled',
  });
  await browser.tabs.sendMessage(1, {
    type: 'toggleTranslationProgressPanel',
    isEnabled: next.on && next.translationProgressPanelEnabled,
  });
}

async function save(): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  status.value = '';
  statusIsError.value = false;
  try {
    const next = normalizeUserscriptConfig(draft.value);
    await saveConfig(next, {recordHistory: true, immediateHistory: true});
    draft.value = normalizeUserscriptConfig(next);
    managedServiceId.value = getTranslationServiceInstance(draft.value, managedServiceId.value)?.id
      || draft.value.service;
    await syncCurrentPage(next);
    status.value = '设置已保存，并已应用到当前页面。';
  } catch (error) {
    statusIsError.value = true;
    status.value = `保存失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    saving.value = false;
  }
}

function restoreDefaults(): void {
  const next = new Config();
  next.disableFloatingBall = false;
  draft.value = normalizeUserscriptConfig(next);
  managedServiceId.value = draft.value.service;
  showAddService.value = false;
  statusIsError.value = false;
  status.value = '已载入 userscript 默认设置，点击“保存设置”后生效。';
}

function setCurrentSiteFilterRules(rules: TranslationFilterRule[]): void {
  if (!currentSiteDomain) return;
  draft.value.translationFilter = rules.length > 0
    ? upsertTranslationFilterSite(draft.value.translationFilter, {domain: currentSiteDomain, rules})
    : removeTranslationFilterSite(draft.value.translationFilter, currentSiteDomain);
}

function removeCurrentSiteFilter(): void {
  if (!currentSiteDomain) return;
  draft.value.translationFilter = removeTranslationFilterSite(
    draft.value.translationFilter,
    currentSiteDomain,
  );
}

async function togglePageTranslation(): Promise<void> {
  await browser.tabs.sendMessage(1, {type: 'userscriptTogglePageTranslation'});
  close();
}
</script>

<style scoped>
.fr-userscript-settings-backdrop {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: grid;
  width: 100vw;
  height: 100vh;
  box-sizing: border-box;
  padding: 22px;
  place-items: center;
  color: var(--ink);
  background: var(--mask);
  font-family: var(--font-family);
  pointer-events: auto;
  backdrop-filter: blur(8px);
}
.fr-userscript-settings {
  display: flex;
  width: min(980px, calc(100vw - 32px));
  max-height: min(900px, calc(100vh - 32px));
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 22px;
  background: var(--page);
  box-shadow: 0 28px 90px rgba(15, 20, 32, .32);
  flex-direction: column;
}
header, footer { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 16px 20px; background: var(--surface); }
header { border-bottom: 1px solid var(--line); }
footer { border-top: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 11px; }
.brand img { width: 38px; height: 38px; border-radius: var(--radius-panel); }
.brand span { display: flex; flex-direction: column; }
.brand strong { font-size: var(--font-subtitle); font-weight: var(--weight-bold); }
.brand small { margin-top: 2px; color: var(--muted); font-size: var(--font-caption); }
button { border: 0; color: inherit; font: inherit; cursor: pointer; }
button:focus-visible { outline: 3px solid var(--brand-soft); outline-offset: 2px; }
.close { display: grid; width: 34px; height: 34px; place-items: center; border-radius: var(--radius-control); color: var(--muted); background: var(--surface-soft); line-height: 1; }
.close:hover { color: var(--ink); }
.close svg { width: 18px; height: 18px; }
.notice { margin: 14px 18px 0; padding: 10px 13px; border: 1px solid var(--el-color-primary-light-5); border-radius: var(--radius-panel); color: var(--brand-strong); background: var(--brand-soft); font-size: var(--font-small); line-height: var(--line-height-body); }
.settings-grid { display: grid; overflow: auto; padding: 16px 18px 20px; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
fieldset, details { min-width: 0; margin: 0; padding: 15px; border: 1px solid var(--line); border-radius: var(--radius-overlay); background: var(--surface); }
fieldset:nth-of-type(3), details { grid-column: 1 / -1; }
.filter-fieldset { grid-column: 1 / -1; }
legend, summary { color: var(--brand-strong); font-size: var(--font-small); font-weight: var(--weight-bold); }
summary { cursor: pointer; }
.service-heading { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; color: var(--muted); font-size: var(--font-small); font-weight: var(--weight-semibold); }
.add-service { display: grid; width: 28px; height: 28px; place-items: center; border-radius: var(--radius-control); color: var(--brand-strong); background: var(--brand-soft); font-size: var(--font-title); line-height: 1; }
.service-inventory { display: grid; max-height: 172px; overflow: auto; margin-top: 8px; gap: 6px; }
.service-row { display: flex; min-width: 0; align-items: center; gap: 8px; padding: 7px 9px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface-soft); }
.service-row.selected { border-color: var(--el-color-primary-light-5); background: var(--brand-soft); }
.service-row.disabled { opacity: .62; }
.service-row-main { display: flex; min-width: 0; padding: 0; flex: 1; flex-direction: column; color: var(--ink); background: transparent; text-align: left; }
.service-row-main strong, .service-row-main small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.service-row-main strong { font-size: var(--font-small); }
.service-row-main small { margin-top: 2px; color: var(--muted); font-size: var(--font-caption); }
.service-row-actions { display: flex; align-items: center; gap: 7px; flex: 0 0 auto; }
.delete-service { padding: 3px 5px; border-radius: 6px; color: var(--danger); background: transparent; font-size: var(--font-caption); }
.delete-service:hover { color: var(--danger); background: var(--danger-soft); }
.add-service-panel { margin-top: 9px; padding: 10px; border: 1px solid var(--el-color-primary-light-5); border-radius: var(--radius-panel); background: var(--brand-soft); }
.add-service-title { display: flex; align-items: center; gap: 8px; }
.add-service-title strong { color: var(--brand-strong); font-size: var(--font-small); }
.add-provider-grid { display: grid; max-height: 210px; overflow-y: auto; margin-top: 9px; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.add-provider-grid button { display: grid; min-width: 0; grid-template-columns: 28px minmax(0, 1fr) auto; align-items: center; gap: 7px; padding: 7px; border: 1px solid var(--line); border-radius: var(--radius-control); color: var(--ink); background: var(--surface); text-align: left; }
.add-provider-grid button:hover { border-color: var(--el-color-primary-light-5); background: var(--brand-soft); }
.add-provider-grid button span { overflow: hidden; font-size: var(--font-caption); font-weight: var(--weight-semibold); text-overflow: ellipsis; white-space: nowrap; }
.add-provider-grid button small { color: var(--brand-strong); font-size: var(--font-caption); }
.add-service-actions { display: flex; justify-content: flex-end; margin-top: 10px; gap: 7px; }
.add-service-actions button { padding: 7px 11px; border-radius: var(--radius-control); font-size: var(--font-caption); font-weight: var(--weight-semibold); }
label { display: grid; align-items: center; gap: 10px; margin-top: 11px; grid-template-columns: minmax(120px, .8fr) minmax(0, 1.4fr); color: var(--muted); font-size: var(--font-small); }
label > span { line-height: var(--line-height-tight); }
input, textarea { width: 100%; min-width: 0; box-sizing: border-box; padding: 9px 10px; border: 1px solid var(--line); border-radius: var(--radius-control); color: var(--ink); background: var(--surface-soft); font: inherit; font-size: var(--font-body); outline: none; }
input:focus, textarea:focus { border-color: var(--brand); background: var(--surface); box-shadow: 0 0 0 3px var(--brand-soft); }
.fr-userscript-select { width: 100%; min-width: 0; font-size: var(--font-body); }
.fr-userscript-select :deep(.el-select__wrapper) { min-height: var(--control-height); padding: 0 10px; border: 1px solid var(--line); border-radius: var(--radius-control); background: var(--surface-soft); box-shadow: none; }
.fr-userscript-select :deep(.el-select__wrapper:hover) { border-color: var(--el-color-primary-light-3); }
.fr-userscript-select :deep(.el-select__wrapper.is-focused) { border-color: var(--brand); background: var(--surface); box-shadow: 0 0 0 3px var(--brand-soft); }
.fr-userscript-select :deep(.el-select__selected-item), .fr-userscript-select :deep(.el-select__placeholder) { color: var(--ink); font-size: var(--font-body); }
.fr-userscript-settings :deep(.el-select__popper.el-popper) { border-color: var(--line); background: var(--surface); }
.fr-userscript-settings :deep(.el-select-dropdown__item) { color: var(--ink); font-size: var(--font-body); }
.fr-userscript-settings :deep(.el-select-dropdown__item.is-hovering) { background: var(--brand-soft); }
.fr-userscript-settings :deep(.el-select-dropdown__item.is-selected) { color: var(--brand-strong); font-weight: var(--weight-semibold); }
.fr-userscript-settings :deep(.fr-userscript-model-catalog-popper .el-select-dropdown__item) { height: auto; min-width: 0; min-height: 34px; padding-top: 8px; padding-bottom: 8px; overflow: hidden; line-height: var(--line-height-tight); white-space: normal; }
.model-catalog-option { display: block; width: 100%; min-width: 0; overflow-wrap: anywhere; white-space: normal; }
textarea { resize: vertical; line-height: var(--line-height-body); }
.fr-userscript-switch { --el-switch-on-color: var(--brand); --el-switch-off-color: var(--el-border-color); --el-switch-border-color: var(--el-border-color); justify-self: end; }
.hint, .warning { margin: 8px 0 0; padding: 8px 10px; border-radius: var(--radius-control); font-size: var(--font-caption); line-height: var(--line-height-body); }
.hint { color: var(--muted); background: var(--surface-soft); }
.userscript-site-filter-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); }
.userscript-site-filter-heading > span { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.userscript-site-filter-heading strong { color: var(--ink); font-size: var(--font-small); }
.userscript-site-filter-heading small { color: var(--muted); font-size: var(--font-caption); }
.userscript-site-filter-heading button { flex: none; padding: 5px 7px; border-radius: 7px; color: var(--danger); background: transparent; font-size: var(--font-caption); }
.userscript-site-filter-heading button:hover { background: var(--danger-soft); }
.warning { color: var(--warning); background: var(--warning-soft); }
footer > div { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
footer button { padding: 9px 13px; border-radius: var(--radius-control); font-size: var(--font-small); font-weight: var(--weight-semibold); }
.secondary { border: 1px solid var(--line); color: var(--ink); background: var(--surface); }
.secondary:hover { border-color: var(--el-color-primary-light-5); color: var(--brand-strong); background: var(--brand-soft); }
.primary { color: var(--on-brand); background: var(--brand); }
.primary:disabled { cursor: wait; opacity: .55; }
.status { min-height: 16px; color: var(--success); font-size: var(--font-caption); }
.status.error { color: var(--danger); }
@media (max-width: 720px) {
  .fr-userscript-settings-backdrop { padding: 0; place-items: stretch; }
  .fr-userscript-settings { width: 100vw; max-height: 100vh; border: 0; border-radius: 0; }
  .settings-grid { grid-template-columns: 1fr; }
  fieldset:nth-of-type(3), details { grid-column: auto; }
  .add-provider-grid { grid-template-columns: 1fr; }
  label { grid-template-columns: 1fr; gap: 5px; }
  footer { align-items: stretch; flex-direction: column; }
  footer > div { justify-content: stretch; }
  footer button { flex: 1; }
}
</style>
