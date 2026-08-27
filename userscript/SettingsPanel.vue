<template>
  <div class="fr-userscript-settings-backdrop" :class="{ dark: isDark }" role="presentation" @click.self="close">
    <section class="fr-userscript-settings" role="dialog" aria-modal="true" aria-labelledby="fr-userscript-settings-title">
      <header>
        <div class="brand">
          <img v-if="iconUrl" :src="iconUrl" alt="" />
          <span><strong id="fr-userscript-settings-title">流畅阅读</strong><small>{{ versionLabel }}</small></span>
        </div>
        <button type="button" class="close" aria-label="关闭设置" @click="close">×</button>
      </header>

      <div class="notice">
        该版本复用 FluentRead 当前翻译核心。截图 OCR、圈选翻译、Chrome 内置翻译和扩展右键菜单依赖浏览器扩展权限，userscript 中暂不提供。
      </div>

      <div class="settings-grid">
        <fieldset>
          <legend>基础设置</legend>
          <label class="toggle"><span>启用 FluentRead</span><input v-model="draft.on" type="checkbox" /></label>
          <label><span>源语言</span><el-select v-model="draft.from" class="fr-userscript-select" aria-label="源语言" :teleported="false" :popper-options="selectPopperOptions"><el-option v-for="item in options.form" :key="item.value" :label="item.label" :value="item.value" /></el-select></label>
          <label><span>目标语言</span><el-select v-model="draft.to" class="fr-userscript-select" aria-label="目标语言" :teleported="false" :popper-options="selectPopperOptions"><el-option v-for="item in options.to" :key="item.value" :label="item.label" :value="item.value" /></el-select></label>
          <label><span>译文显示</span><el-select v-model="draft.display" class="fr-userscript-select" aria-label="译文显示" :teleported="false" :popper-options="selectPopperOptions"><el-option v-for="item in options.display" :key="item.value" :label="item.label" :value="item.value" /></el-select></label>
          <label><span>双语样式</span><el-select v-model="draft.style" class="fr-userscript-select" aria-label="双语样式" :teleported="false" :popper-options="selectPopperOptions"><el-option v-for="item in styleOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></label>
          <label class="toggle"><span>打开网页后自动翻译</span><input v-model="draft.autoTranslate" type="checkbox" /></label>
          <label class="toggle"><span>使用翻译缓存</span><input v-model="draft.useCache" type="checkbox" /></label>
        </fieldset>

        <fieldset>
          <legend>翻译服务</legend>
          <label><span>服务</span><el-select v-model="draft.service" class="fr-userscript-select" aria-label="翻译服务" :teleported="false" :popper-options="selectPopperOptions"><el-option v-for="item in serviceOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></label>
          <p v-if="serviceDescription" class="hint">{{ serviceDescription }}</p>
          <label v-if="usesModel"><span>模型</span><el-select v-model="draft.model[draft.service]" class="fr-userscript-select" aria-label="翻译模型" :teleported="false" :popper-options="selectPopperOptions"><el-option v-for="model in modelOptions" :key="model" :label="model" :value="model" /></el-select></label>
          <label v-if="usesModel && draft.model[draft.service] === customModelString"><span>自定义模型</span><input v-model.trim="draft.customModel[draft.service]" autocomplete="off" /></label>
          <label v-if="servicesType.isAI(draft.service) && usesToken" class="toggle"><span>当前模型需要 API Key</span><input v-model="requiresApiKey" type="checkbox" /></label>
          <label v-if="usesToken"><span>API Key / Token</span><input v-model.trim="draft.token[draft.service]" type="password" autocomplete="off" /></label>
          <label v-if="draft.service === services.custom"><span>自定义接口地址</span><input v-model.trim="draft.custom" inputmode="url" /></label>
          <label v-if="draft.service === services.deeplx"><span>DeepLX 地址</span><input v-model.trim="draft.deeplx" inputmode="url" /></label>
          <label v-if="draft.service === services.newapi"><span>New API 地址</span><input v-model.trim="draft.newApiUrl" inputmode="url" /></label>
          <label v-if="draft.service === services.azureOpenai"><span>Azure OpenAI 地址</span><input v-model.trim="draft.azureOpenaiEndpoint" inputmode="url" /></label>
          <label v-if="servicesType.isUseProxy(draft.service)"><span>代理地址（可选）</span><input v-model.trim="draft.proxy[draft.service]" inputmode="url" placeholder="留空使用默认接口" /></label>
          <template v-if="draft.service === services.youdao">
            <label><span>有道 App Key</span><input v-model.trim="draft.youdaoAppKey" autocomplete="off" /></label>
            <label><span>有道 App Secret</span><input v-model.trim="draft.youdaoAppSecret" type="password" autocomplete="off" /></label>
          </template>
          <template v-if="servicesType.isTencent(draft.service)">
            <label><span>腾讯 Secret ID</span><input v-model.trim="draft.tencentSecretId" autocomplete="off" /></label>
            <label><span>腾讯 Secret Key</span><input v-model.trim="draft.tencentSecretKey" type="password" autocomplete="off" /></label>
          </template>
          <label v-if="servicesType.isCoze(draft.service)"><span>Bot ID</span><input v-model.trim="draft.robot_id[draft.service]" autocomplete="off" /></label>
          <p v-if="credentialWarning" class="warning">{{ credentialWarning }}</p>
          <label class="toggle"><span>AI 网页上下文</span><input v-model="draft.enableAIContext" type="checkbox" :disabled="!canUseAIContext" /></label>
        </fieldset>

        <fieldset>
          <legend>页面交互</legend>
          <label class="toggle"><span>显示全文翻译悬浮球</span><input v-model="floatingBallEnabled" type="checkbox" /></label>
          <label class="toggle"><span>显示翻译进度面板</span><input v-model="draft.translationProgressPanelEnabled" type="checkbox" /></label>
          <label><span>全文快捷键</span><el-select v-model="draft.floatingBallHotkey" class="fr-userscript-select" aria-label="全文快捷键" :teleported="false" :popper-options="selectPopperOptions"><el-option v-for="item in options.floatingBallHotkeys" :key="item.value" :label="item.label" :value="item.value" /></el-select></label>
          <label><span>全文翻译范围</span><el-select v-model="draft.fullPageTranslationMode" class="fr-userscript-select" aria-label="全文翻译范围" :teleported="false" :popper-options="selectPopperOptions"><el-option label="按阅读进度（推荐）" value="viewport" /><el-option label="立即翻译到网页底部" value="all" /></el-select></label>
          <p class="hint">“立即翻译到网页底部”会处理当前已加载的整页内容，并持续翻译之后新增的内容；它不会自动滚动页面，但可能产生更多请求。</p>
          <label><span>悬浮翻译触发</span><el-select v-model="draft.hotkey" class="fr-userscript-select" aria-label="悬浮翻译触发" :teleported="false" :popper-options="selectPopperOptions"><el-option v-for="item in hoverOptions" :key="item.value" :label="item.label" :value="item.value" /></el-select></label>
          <label><span>划词翻译</span><el-select v-model="draft.selectionTranslatorMode" class="fr-userscript-select" aria-label="划词翻译" :teleported="false" :popper-options="selectPopperOptions"><el-option label="关闭" value="disabled" /><el-option label="原文 + 译文" value="bilingual" /><el-option label="仅译文" value="translation-only" /></el-select></label>
          <label v-if="draft.selectionTranslatorMode !== 'disabled'"><span>划词触发</span><el-select v-model="draft.selectionTranslatorTrigger" class="fr-userscript-select" aria-label="划词触发" :teleported="false" :popper-options="selectPopperOptions"><el-option label="直接显示" value="direct" /><el-option label="翻译图标" value="icon" /><el-option label="小圆点" value="dot" /></el-select></label>
          <label><span>输入框翻译</span><el-select v-model="draft.inputBoxTranslationTrigger" class="fr-userscript-select" aria-label="输入框翻译" :teleported="false" :popper-options="selectPopperOptions"><el-option v-for="item in options.inputBoxTranslationTrigger" :key="item.value" :label="item.label" :value="item.value" /></el-select></label>
          <label v-if="draft.inputBoxTranslationTrigger !== 'disabled'"><span>输入框目标语言</span><el-select v-model="draft.inputBoxTranslationTarget" class="fr-userscript-select" aria-label="输入框目标语言" :teleported="false" :popper-options="selectPopperOptions"><el-option v-for="item in options.inputBoxTranslationTarget" :key="item.value" :label="item.label" :value="item.value" /></el-select></label>
          <label><span>并发翻译数</span><input v-model.number="draft.maxConcurrentTranslations" type="number" min="1" max="20" /></label>
          <label class="toggle"><span>界面动画</span><input v-model="draft.animations" type="checkbox" /></label>
          <label><span>主题</span><el-select v-model="draft.theme" class="fr-userscript-select" aria-label="主题" :teleported="false" :popper-options="selectPopperOptions"><el-option v-for="item in options.theme" :key="item.value" :label="item.label" :value="item.value" /></el-select></label>
        </fieldset>

        <details>
          <summary>高级 AI 请求设置</summary>
          <label><span>自定义请求体（JSON）</span><textarea v-model="draft.customBody[draft.service]" rows="4" placeholder="可选：合并到请求体顶层" /></label>
          <label><span>System 提示词</span><textarea v-model="draft.system_role[draft.service]" rows="4" /></label>
          <label><span>User 提示词</span><textarea v-model="draft.user_role[draft.service]" rows="5" /></label>
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
import {computed, onMounted, ref} from 'vue';
import {ElOption, ElSelect} from 'element-plus';
import 'element-plus/es/components/select/style/css';
import browser from 'webextension-polyfill';
import {Config} from '@/src/core/config/model';
import {config as runtimeConfig, configReady, saveConfig} from '@/src/services/config/store';
import {customModelString, models, options, services, servicesType} from '@/src/core/config/catalog';
import {getApiKeyRequirementKey, getMissingCredentialMessage, isApiKeyRequired} from '@/src/core/config/validation';
import {isUserscriptServiceSupported, normalizeUserscriptConfig} from './initialize';

const emit = defineEmits<{close: []}>();
const versionLabel = `FluentRead V${process.env.VUE_APP_VERSION} · Userscript V${process.env.VUE_APP_USERSCRIPT_VERSION}`;
const iconUrl = globalThis.__FLUENTREAD_ICON_DATA__ || '';
const draft = ref(new Config());
const saving = ref(false);
const status = ref('');
const statusIsError = ref(false);
const selectPopperOptions = {strategy: 'fixed'} as const;

const serviceOptions = options.services.filter(item => !item.disabled && isUserscriptServiceSupported(item.value));
const styleOptions = options.styles.filter(item => !item.disabled && typeof item.value === 'number');
const hoverOptions = options.keys.filter(item => !item.disabled);
const selectedService = computed(() => serviceOptions.find(item => item.value === draft.value.service));
const serviceDescription = computed(() => selectedService.value && 'description' in selectedService.value ? selectedService.value.description : '');
const modelOptions = computed(() => models.get(draft.value.service) || []);
const usesModel = computed(() => servicesType.isUseModel(draft.value.service));
const usesToken = computed(() => servicesType.isUseToken(draft.value.service));
const requiresApiKey = computed({
  get: () => isApiKeyRequired(draft.value.service, draft.value),
  set: (required: boolean) => {
    draft.value.requireApiKey[getApiKeyRequirementKey(draft.value.service, draft.value)] = required;
  },
});
const canUseAIContext = computed(() => servicesType.isUseAIContext(
  draft.value.service,
  draft.value.model[draft.value.service] || '',
));
const credentialWarning = computed(() => getMissingCredentialMessage(draft.value.service, draft.value) || '');
const floatingBallEnabled = computed({
  get: () => !draft.value.disableFloatingBall,
  set: (enabled: boolean) => { draft.value.disableFloatingBall = !enabled; },
});
const isDark = computed(() => draft.value.theme === 'dark' || (
  draft.value.theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches
));

onMounted(async () => {
  await configReady;
  draft.value = normalizeUserscriptConfig(runtimeConfig);
});

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
  statusIsError.value = false;
  status.value = '已载入 userscript 默认设置，点击“保存设置”后生效。';
}

async function togglePageTranslation(): Promise<void> {
  await browser.tabs.sendMessage(1, {type: 'userscriptTogglePageTranslation'});
  close();
}
</script>

<style scoped>
.fr-userscript-settings-backdrop { position: fixed; inset: 0; z-index: 2147483647; display: grid; width: 100vw; height: 100vh; padding: 22px; place-items: center; box-sizing: border-box; background: rgba(20, 24, 34, .48); color: #182033; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif; pointer-events: auto; backdrop-filter: blur(8px); }
.fr-userscript-settings { --el-color-primary: #ef4776; --el-text-color-primary: #20283a; --el-text-color-regular: #4d5668; --el-text-color-placeholder: #8b93a2; --el-border-color: #dfe3eb; --el-border-color-light: #e5e8ef; --el-fill-color-blank: #fff; --el-fill-color-light: #f3f5f9; --el-bg-color-overlay: #fff; display: flex; width: min(980px, calc(100vw - 32px)); max-height: min(900px, calc(100vh - 32px)); overflow: hidden; border: 1px solid rgba(25, 35, 54, .12); border-radius: 22px; background: #f7f8fb; box-shadow: 0 28px 90px rgba(15, 20, 32, .32); flex-direction: column; }
header, footer { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 16px 20px; background: #fff; }
header { border-bottom: 1px solid #e5e8ef; }
footer { border-top: 1px solid #e5e8ef; }
.brand { display: flex; align-items: center; gap: 11px; }
.brand img { width: 38px; height: 38px; border-radius: 11px; }
.brand span { display: flex; flex-direction: column; }
.brand strong { font-size: 16px; }
.brand small { margin-top: 2px; color: #7c8493; font-size: 10px; }
button { border: 0; font: inherit; cursor: pointer; }
.close { width: 34px; height: 34px; border-radius: 10px; background: #f2f3f7; color: #727a88; font-size: 22px; line-height: 1; }
.notice { margin: 14px 18px 0; padding: 10px 13px; border: 1px solid #f0c7d4; border-radius: 11px; background: #fff4f7; color: #7a3148; font-size: 11px; line-height: 1.55; }
.settings-grid { display: grid; overflow: auto; padding: 16px 18px 20px; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
fieldset, details { min-width: 0; margin: 0; padding: 15px; border: 1px solid #e2e6ee; border-radius: 15px; background: #fff; }
fieldset:nth-of-type(3), details { grid-column: 1 / -1; }
legend, summary { color: #d93d6b; font-size: 12px; font-weight: 800; }
summary { cursor: pointer; }
label { display: grid; align-items: center; gap: 10px; margin-top: 11px; grid-template-columns: minmax(120px, .8fr) minmax(0, 1.4fr); color: #4d5668; font-size: 11px; }
label > span { line-height: 1.35; }
input, textarea { width: 100%; min-width: 0; padding: 9px 10px; border: 1px solid #dfe3eb; border-radius: 9px; outline: none; box-sizing: border-box; background: #f8f9fb; color: #20283a; font: inherit; font-size: 12px; }
input:focus, textarea:focus { border-color: #ef4776; box-shadow: 0 0 0 3px rgba(239, 71, 118, .1); background: #fff; }
.fr-userscript-select { width: 100%; min-width: 0; font-size: 12px; }
.fr-userscript-select :deep(.el-select__wrapper) { min-height: 36px; padding: 0 10px; border: 1px solid #dfe3eb; border-radius: 9px; background: #f8f9fb; box-shadow: none; }
.fr-userscript-select :deep(.el-select__wrapper:hover) { border-color: #ef8eaa; }
.fr-userscript-select :deep(.el-select__wrapper.is-focused) { border-color: #ef4776; background: #fff; box-shadow: 0 0 0 3px rgba(239, 71, 118, .1); }
.fr-userscript-select :deep(.el-select__selected-item), .fr-userscript-select :deep(.el-select__placeholder) { color: #20283a; font-size: 12px; }
.fr-userscript-settings :deep(.el-select__popper.el-popper) { border-color: #dfe3eb; background: #fff; }
.fr-userscript-settings :deep(.el-select-dropdown__item) { color: #20283a; font-size: 12px; }
.fr-userscript-settings :deep(.el-select-dropdown__item.is-hovering) { background: #fff0f4; }
.fr-userscript-settings :deep(.el-select-dropdown__item.is-selected) { color: #d93d6b; font-weight: 700; }
textarea { resize: vertical; line-height: 1.45; }
.toggle input { justify-self: end; width: 38px; height: 20px; accent-color: #ef4776; }
.hint, .warning { margin: 8px 0 0; padding: 8px 10px; border-radius: 9px; font-size: 10px; line-height: 1.5; }
.hint { background: #f3f5f9; color: #70798a; }
.warning { background: #fff2e7; color: #8a4a1e; }
footer > div { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
footer button { padding: 9px 13px; border-radius: 9px; font-size: 11px; font-weight: 700; }
.secondary { border: 1px solid #dfe3eb; background: #fff; color: #4c5567; }
.primary { background: #ef4776; color: #fff; }
.primary:disabled { opacity: .55; cursor: wait; }
.status { min-height: 16px; color: #2c7a55; font-size: 10px; }
.status.error { color: #b72f4e; }
.dark { color: #f2f3f7; }
.dark .fr-userscript-settings { --el-text-color-primary: #f1f2f5; --el-text-color-regular: #d2d5dc; --el-text-color-placeholder: #aeb3be; --el-border-color: #50535f; --el-border-color-light: #444754; --el-fill-color-blank: #30323c; --el-fill-color-light: #393c46; --el-bg-color-overlay: #30323c; border-color: #444754; background: #272932; }
.dark header, .dark footer, .dark fieldset, .dark details { border-color: #444754; background: #30323c; }
.dark .notice { border-color: #6f4654; background: #3b2e35; color: #f0c0d0; }
.dark label { color: #d2d5dc; }
.dark input, .dark textarea, .dark .close, .dark .secondary { border-color: #50535f; background: #3a3d47; color: #f1f2f5; }
.dark .fr-userscript-select :deep(.el-select__wrapper), .dark .fr-userscript-select :deep(.el-select__wrapper.is-focused) { border-color: #50535f; background: #3a3d47; }
.dark .fr-userscript-select :deep(.el-select__selected-item), .dark .fr-userscript-select :deep(.el-select__placeholder), .dark .fr-userscript-select :deep(.el-select__caret) { color: #f1f2f5; }
.dark .fr-userscript-settings :deep(.el-select__popper.el-popper) { border-color: #50535f; background: #30323c; }
.dark .fr-userscript-settings :deep(.el-select-dropdown__item) { color: #f1f2f5; }
.dark .fr-userscript-settings :deep(.el-select-dropdown__item.is-hovering) { background: #3b2e35; }
.dark .hint { background: #393c46; color: #bdc1cb; }
@media (max-width: 720px) {
  .fr-userscript-settings-backdrop { padding: 0; place-items: stretch; }
  .fr-userscript-settings { width: 100vw; max-height: 100vh; border: 0; border-radius: 0; }
  .settings-grid { grid-template-columns: 1fr; }
  fieldset:nth-of-type(3), details { grid-column: auto; }
  label { grid-template-columns: 1fr; gap: 5px; }
  footer { align-items: stretch; flex-direction: column; }
  footer > div { justify-content: stretch; }
  footer button { flex: 1; }
}
</style>
