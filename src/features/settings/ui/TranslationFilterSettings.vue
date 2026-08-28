<template>
  <section class="translation-filter-settings" aria-labelledby="translation-filter-title">
    <header class="translation-filter-settings-heading">
      <div>
        <h3 id="translation-filter-title">内容过滤</h3>
        <p>控制哪些网页 DOM 不翻译或强制翻译。内置规则只是默认值，可以编辑、删除或恢复。</p>
      </div>
      <button class="translation-filter-reset" type="button" @click="resetDefaults">
        <RotateCcw aria-hidden="true" />恢复默认
      </button>
    </header>

    <section class="translation-filter-scope" aria-labelledby="global-filter-title">
      <div class="translation-filter-scope-heading">
        <div>
          <strong id="global-filter-title">全局规则</strong>
          <small>应用到所有网页；网站规则命中同一元素时优先。</small>
        </div>
        <span>{{ filterConfig.global.rules.length }} 条规则</span>
      </div>

      <div class="translation-filter-toggles">
        <label>
          <span><strong>跳过隐藏内容</strong><small>包括 display:none、aria-hidden 和视觉隐藏节点</small></span>
          <el-switch
            :model-value="filterConfig.global.excludeHidden"
            aria-label="跳过隐藏内容"
            @change="updateGlobalOption('excludeHidden', Boolean($event))"
          />
        </label>
        <label>
          <span><strong>跳过可编辑内容</strong><small>避免翻译输入区域、草稿与在线编辑器</small></span>
          <el-switch
            :model-value="filterConfig.global.excludeEditable"
            aria-label="跳过可编辑内容"
            @change="updateGlobalOption('excludeEditable', Boolean($event))"
          />
        </label>
      </div>

      <TranslationFilterRulesEditor
        :model-value="filterConfig.global.rules"
        empty-description="没有全局 CSS 规则时，只保留上面的隐藏与可编辑内容开关。"
        @update:model-value="updateGlobalRules"
      />
    </section>

    <section class="translation-filter-sites" aria-labelledby="site-filter-title">
      <div class="translation-filter-scope-heading">
        <div>
          <strong id="site-filter-title">网站规则</strong>
          <small>按主域名生效，并覆盖同一元素命中的全局规则。</small>
        </div>
        <span>{{ filterConfig.sites.length }} 个网站</span>
      </div>

      <form class="translation-filter-site-form" @submit.prevent="addSite">
        <input
          v-model.trim="siteInput"
          type="text"
          inputmode="url"
          autocomplete="off"
          spellcheck="false"
          aria-label="添加内容过滤网站"
          placeholder="域名或网址，例如 discord.com"
          :aria-invalid="Boolean(siteError)"
          @input="siteError = ''"
        />
        <button type="submit">添加网站</button>
      </form>
      <p v-if="siteError" class="translation-filter-site-error" role="alert">{{ siteError }}</p>
      <p v-else class="translation-filter-site-help">网站规则只保存主域名，并对其所有子域生效。</p>

      <div v-if="filterConfig.sites.length" class="translation-filter-site-list">
        <details v-for="site in filterConfig.sites" :key="site.domain" class="translation-filter-site-item">
          <summary>
            <span class="translation-filter-site-icon" aria-hidden="true"><Globe2 /></span>
            <span><strong>{{ site.domain }}</strong><small>{{ site.rules.length }} 条网站规则</small></span>
            <button
              class="translation-filter-site-remove"
              type="button"
              :aria-label="`删除 ${site.domain} 的内容过滤规则`"
              :title="`删除 ${site.domain}`"
              @click.stop.prevent="removeSite(site.domain)"
            >
              <Trash2 aria-hidden="true" />
            </button>
            <ChevronDown aria-hidden="true" />
          </summary>
          <div class="translation-filter-site-body">
            <p class="translation-filter-site-note">父级被全局排除时，子级的“强制翻译”不会重新打开该区域。</p>
            <TranslationFilterRulesEditor
              compact
              :model-value="site.rules"
              empty-description="添加规则后才会覆盖此网站上的全局处理。"
              @update:model-value="updateSiteRules(site.domain, $event)"
            />
          </div>
        </details>
      </div>
      <div v-else class="translation-filter-site-empty">
        <Globe2 :size="24" :stroke-width="1.7" aria-hidden="true" />
        <span><strong>还没有网站规则</strong><small>也可以从扩展弹窗为当前网站快速添加。</small></span>
      </div>
    </section>
  </section>
</template>

<script lang="ts" setup>
import {computed, ref} from 'vue';
import {ChevronDown, Globe2, RotateCcw, Trash2} from '@lucide/vue';
import {ElMessageBox} from 'element-plus';
import {getSiteBaseDomain} from '@/src/core/site-rules/domain';
import {
  createDefaultTranslationFilterConfig,
  createTranslationFilterSite,
  normalizeTranslationFilterConfig,
  removeTranslationFilterSite,
  upsertTranslationFilterSite,
  type TranslationFilterConfig,
  type TranslationFilterRule,
} from '@/src/core/translation/filters';
import TranslationFilterRulesEditor from './TranslationFilterRulesEditor.vue';

const props = defineProps<{
  modelValue: TranslationFilterConfig;
}>();

const emit = defineEmits<{
  'update:modelValue': [value: TranslationFilterConfig];
}>();

const filterConfig = computed(() => normalizeTranslationFilterConfig(props.modelValue));
const siteInput = ref('');
const siteError = ref('');

function commit(value: TranslationFilterConfig) {
  emit('update:modelValue', normalizeTranslationFilterConfig(value));
}

function updateGlobalOption(option: 'excludeHidden' | 'excludeEditable', value: boolean) {
  commit({
    ...filterConfig.value,
    global: {...filterConfig.value.global, [option]: value},
  });
}

function updateGlobalRules(rules: TranslationFilterRule[]) {
  commit({
    ...filterConfig.value,
    global: {...filterConfig.value.global, rules},
  });
}

function addSite() {
  const input = siteInput.value.trim();
  const domain = getSiteBaseDomain(input);
  if (!input) {
    siteError.value = '请输入域名或网址。';
    return;
  }
  if (!domain) {
    siteError.value = '无法识别有效的网站主域名。';
    return;
  }
  if (filterConfig.value.sites.some((site) => site.domain === domain)) {
    siteError.value = `${domain} 已经存在。`;
    return;
  }
  const site = createTranslationFilterSite(domain);
  if (!site) return;
  commit(upsertTranslationFilterSite(filterConfig.value, site));
  siteInput.value = '';
  siteError.value = '';
}

function updateSiteRules(domain: string, rules: TranslationFilterRule[]) {
  commit(upsertTranslationFilterSite(filterConfig.value, {domain, rules}));
}

function removeSite(domain: string) {
  commit(removeTranslationFilterSite(filterConfig.value, domain));
}

async function resetDefaults() {
  try {
    await ElMessageBox.confirm(
      '将恢复内置全局规则和默认网站规则，当前自定义内容过滤会被替换。',
      '恢复默认内容过滤',
      {confirmButtonText: '恢复默认', cancelButtonText: '取消', type: 'warning'},
    );
    commit(createDefaultTranslationFilterConfig());
  } catch {
    // 用户取消时保持当前配置。
  }
}
</script>

<style scoped>
.translation-filter-settings { border-top: 1px solid var(--line); background: var(--surface); }
.translation-filter-settings-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 16px; border-bottom: 1px solid var(--line); }
.translation-filter-settings-heading > div { min-width: 0; }
.translation-filter-settings-heading h3 { margin: 0 0 5px; color: var(--ink); font-size: var(--font-subtitle); }
.translation-filter-settings-heading p { margin: 0; color: var(--muted); font-size: var(--font-small); line-height: var(--line-height-body); }
.translation-filter-reset { display: inline-flex; min-height: 32px; flex: none; align-items: center; gap: 5px; padding: 0 9px; border: 1px solid var(--line); border-radius: 8px; color: var(--muted); background: var(--surface); font-size: var(--font-caption); font-weight: var(--weight-semibold); cursor: pointer; }
.translation-filter-reset:hover { color: var(--brand-strong); border-color: var(--el-color-primary-light-5); background: var(--brand-soft); }
.translation-filter-reset svg { width: 14px; height: 14px; }
.translation-filter-scope, .translation-filter-sites { padding: 16px; border-bottom: 1px solid var(--line); }
.translation-filter-scope-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.translation-filter-scope-heading > div { display: flex; min-width: 0; flex-direction: column; gap: 4px; }
.translation-filter-scope-heading strong { color: var(--ink); font-size: var(--font-body); }
.translation-filter-scope-heading small { color: var(--muted); font-size: var(--font-caption); line-height: var(--line-height-tight); }
.translation-filter-scope-heading > span { flex: none; color: var(--muted); font-size: var(--font-caption); font-weight: var(--weight-semibold); }
.translation-filter-toggles { margin-top: 12px; overflow: hidden; border: 1px solid var(--line); border-radius: 9px; }
.translation-filter-toggles label { display: flex; min-height: 54px; align-items: center; justify-content: space-between; gap: 14px; padding: 8px 10px; border-bottom: 1px solid var(--line); }
.translation-filter-toggles label:last-child { border-bottom: 0; }
.translation-filter-toggles label > span { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.translation-filter-toggles strong { color: var(--ink); font-size: var(--font-small); }
.translation-filter-toggles small { color: var(--muted); font-size: var(--font-caption); line-height: var(--line-height-tight); }
.translation-filter-site-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; margin-top: 12px; }
.translation-filter-site-form input { box-sizing: border-box; width: 100%; min-height: var(--control-height); padding: 0 11px; border: 1px solid var(--line); border-radius: 8px; outline: 0; color: var(--ink); background: var(--surface); font-size: var(--font-small); }
.translation-filter-site-form input:focus { border-color: var(--brand); box-shadow: 0 0 0 3px var(--brand-soft); }
.translation-filter-site-form input[aria-invalid="true"] { border-color: var(--danger); }
.translation-filter-site-form button { min-width: 88px; min-height: var(--control-height); padding: 0 12px; border: 0; border-radius: 8px; color: #fff; background: var(--brand); font-size: var(--font-small); font-weight: var(--weight-semibold); cursor: pointer; }
.translation-filter-site-help, .translation-filter-site-error { min-height: 18px; margin: 6px 0 0; font-size: var(--font-caption); line-height: var(--line-height-tight); }
.translation-filter-site-help { color: var(--muted); }
.translation-filter-site-error { color: var(--danger); }
.translation-filter-site-list { display: grid; gap: 8px; margin-top: 10px; }
.translation-filter-site-item { overflow: hidden; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); }
.translation-filter-site-item summary { display: grid; min-height: 54px; grid-template-columns: 32px minmax(0, 1fr) auto auto; align-items: center; gap: 9px; padding: 7px 10px; list-style: none; cursor: pointer; }
.translation-filter-site-item summary::-webkit-details-marker { display: none; }
.translation-filter-site-icon { display: grid; width: 32px; height: 32px; place-items: center; border-radius: 8px; color: var(--brand-strong); background: var(--brand-soft); }
.translation-filter-site-icon svg { width: 16px; height: 16px; }
.translation-filter-site-item summary > span:nth-child(2) { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.translation-filter-site-item summary strong { overflow: hidden; color: var(--ink); font-size: var(--font-small); text-overflow: ellipsis; white-space: nowrap; }
.translation-filter-site-item summary small { color: var(--muted); font-size: var(--font-caption); }
.translation-filter-site-remove { display: grid; width: 30px; height: 30px; margin-right: -4px; padding: 0; place-items: center; border: 0; border-radius: 7px; color: var(--muted); background: transparent; cursor: pointer; }
.translation-filter-site-remove:hover, .translation-filter-site-remove:focus-visible { color: var(--danger); background: var(--danger-soft); }
.translation-filter-site-remove svg { width: 14px; height: 14px; }
.translation-filter-site-item summary > svg { width: 16px; height: 16px; color: var(--muted); transition: transform 160ms ease; }
.translation-filter-site-item[open] summary > svg { transform: rotate(180deg); }
.translation-filter-site-body { padding: 12px; border-top: 1px solid var(--line); background: var(--surface-soft); }
.translation-filter-site-note { margin: 0; color: var(--muted); font-size: var(--font-caption); line-height: var(--line-height-tight); }
.translation-filter-site-empty { display: flex; align-items: center; gap: 10px; margin-top: 10px; padding: 12px; border: 1px dashed var(--line); border-radius: 9px; color: var(--muted); }
.translation-filter-site-empty > span { display: flex; flex-direction: column; gap: 3px; }
.translation-filter-site-empty strong { color: var(--ink); font-size: var(--font-small); }
.translation-filter-site-empty small { font-size: var(--font-caption); }
</style>
