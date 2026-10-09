<template>
  <section
    class="site-rules-editor"
    :data-setting="labels.settingId"
    :aria-labelledby="labels.titleId"
  >
    <header class="site-rules-heading">
      <div>
        <h3 :id="labels.titleId">{{ labels.title }}</h3>
        <p>{{ labels.description }}</p>
      </div>
      <span class="site-rules-count" :aria-label="labels.countLabel">{{ domains.length }} 个网站</span>
    </header>

    <form class="site-rules-form" @submit.prevent="addDomain">
      <label class="site-rules-input-wrap">
        <span class="sr-only">{{ labels.inputLabel }}</span>
        <input
          ref="domainInput"
          v-model.trim="inputValue"
          type="text"
          inputmode="url"
          autocomplete="off"
          spellcheck="false"
          :aria-label="labels.inputLabel"
          :placeholder="labels.placeholder"
          :aria-invalid="Boolean(errorMessage)"
          :aria-describedby="labels.feedbackId"
          @input="clearFeedback"
        />
      </label>
      <button class="site-rules-add" type="submit">{{ labels.addButton }}</button>
    </form>

    <p :id="labels.feedbackId" class="site-rules-feedback" :class="{ error: errorMessage }" aria-live="polite">
      <template v-if="errorMessage">{{ errorMessage }}</template>
      <template v-else-if="statusMessage">{{ statusMessage }}</template>
      <template v-else-if="normalizedPreview">将保存为 <strong>{{ normalizedPreview }}</strong>（含子域）</template>
      <template v-else>可直接粘贴网址，只保留主域名</template>
    </p>

    <el-scrollbar
      v-if="domains.length"
      class="site-rules-list"
      max-height="360px"
      tag="div"
      role="list"
      :aria-label="labels.listLabel"
    >
      <article
        v-for="domain in domains"
        :key="domain"
        class="site-rule-item"
        role="listitem"
        :data-site-rule="domain"
      >
        <span class="site-rule-copy">
          <strong :title="domain">{{ domain }}</strong>
        </span>
        <button class="site-rule-remove" type="button" :aria-label="`删除 ${domain}`" :title="`删除 ${domain}`" @click="removeDomain(domain)">
          删除
        </button>
      </article>
    </el-scrollbar>

    <div v-else class="site-rules-empty" data-site-rules-empty>
      <component :is="emptyIcon" :size="24" :stroke-width="1.7" aria-hidden="true" focusable="false" />
      <strong>{{ labels.emptyTitle }}</strong>
      <small>{{ labels.emptyDescription }}</small>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { computed, nextTick, ref } from 'vue';
import { ElScrollbar } from 'element-plus';
import { Globe, ShieldCheck } from '@lucide/vue';
import { getSiteBaseDomain } from '@/src/core/site-rules/domain';

const props = withDefaults(defineProps<{
  modelValue?: string[];
  variant?: 'always-translate' | 'disable-extension';
}>(), {
  modelValue: () => [],
  variant: 'always-translate',
});

const emit = defineEmits<{
  'update:modelValue': [value: string[]];
}>();

const inputValue = ref('');
const errorMessage = ref('');
const statusMessage = ref('');
const domainInput = ref<HTMLInputElement | null>(null);
const domains = computed(() => props.modelValue ?? []);
const normalizedPreview = computed(() => inputValue.value ? getSiteBaseDomain(inputValue.value) : null);
const emptyIcon = computed(() => props.variant === 'disable-extension' ? ShieldCheck : Globe);
const labels = computed(() => props.variant === 'disable-extension'
  ? {
    settingId: 'disabled-extension-sites',
    titleId: 'disabled-extension-sites-title',
    feedbackId: 'disabled-extension-sites-feedback',
    title: '禁用扩展网站',
    description: '在这些网站及其子域上不运行扩展。',
    countLabel: '禁用扩展网站数量',
    inputLabel: '添加禁用扩展网站',
    placeholder: '域名或网址，如 example.com',
    addButton: '添加网站',
    listLabel: '禁用扩展网站名单',
    emptyTitle: '暂无网站',
    emptyDescription: '也可以在扩展弹窗中禁用当前网站',
    duplicateMessage: (domain: string) => `${domain} 已在列表中`,
    addedMessage: (domain: string) => `已添加 ${domain}`,
    removedMessage: (domain: string) => `已删除 ${domain}`,
  }
  : {
    settingId: 'always-translate-sites',
    titleId: 'always-translate-sites-title',
    feedbackId: 'always-translate-sites-feedback',
    title: '始终翻译网站',
    description: '打开这些网站及其子域时自动翻译。',
    countLabel: '始终翻译网站数量',
    inputLabel: '添加始终翻译网站',
    placeholder: '域名或网址，如 example.com',
    addButton: '添加网站',
    listLabel: '始终翻译网站名单',
    emptyTitle: '暂无网站',
    emptyDescription: '也可以在扩展弹窗中添加当前网站',
    duplicateMessage: (domain: string) => `${domain} 已在列表中`,
    addedMessage: (domain: string) => `已添加 ${domain}`,
    removedMessage: (domain: string) => `已删除 ${domain}`,
  });

function clearFeedback() {
  errorMessage.value = '';
  statusMessage.value = '';
}

function addDomain() {
  const input = inputValue.value.trim();
  if (!input) {
    errorMessage.value = '请输入域名或网址';
    return;
  }

  const domain = getSiteBaseDomain(input);
  if (!domain) {
    errorMessage.value = '无法识别该网址';
    return;
  }
  if (domains.value.includes(domain)) {
    errorMessage.value = labels.value.duplicateMessage(domain);
    return;
  }

  emit('update:modelValue', [...domains.value, domain]);
  inputValue.value = '';
  errorMessage.value = '';
  statusMessage.value = labels.value.addedMessage(domain);
}

function removeDomain(domain: string) {
  emit('update:modelValue', domains.value.filter(item => item !== domain));
  errorMessage.value = '';
  statusMessage.value = labels.value.removedMessage(domain);
  void nextTick(() => domainInput.value?.focus());
}
</script>

<style scoped>
.site-rules-editor { margin: 0; }
.site-rules-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; padding-bottom: 10px; border-bottom: 1px solid var(--line); }
.site-rules-heading > div { min-width: 0; }
.site-rules-heading h3 { margin: 0; color: var(--ink); font-size: var(--font-subtitle); font-weight: var(--weight-semibold); }
.site-rules-heading p { max-width: 560px; margin: 4px 0 0; color: var(--muted); font-size: var(--font-small); line-height: var(--line-height-body); }
.site-rules-count { flex: none; color: var(--muted); font-family: var(--font-mono); font-size: var(--font-caption); }

.site-rules-form { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; margin-top: 16px; }
.site-rules-input-wrap { min-width: 0; }
.site-rules-input-wrap input {
  width: 100%;
  min-height: var(--control-height);
  padding: 0 12px;
  border: 0;
  border-radius: var(--radius-control);
  outline: 0;
  color: var(--ink);
  background: var(--surface-soft);
  font-family: var(--font-mono);
  font-size: var(--font-small);
  transition: box-shadow 140ms ease;
}
.site-rules-input-wrap input:focus { box-shadow: var(--focus-ring); }
.site-rules-input-wrap input[aria-invalid="true"] { box-shadow: var(--invalid-ring); }
.site-rules-input-wrap input::placeholder { color: var(--muted); font-family: var(--font-family); }

.site-rules-add, .site-rule-remove { border-radius: var(--radius-control); font-weight: var(--weight-medium); cursor: pointer; }
.site-rules-add { min-height: var(--control-height); padding: 0 16px; border: 0; color: var(--surface); background: var(--ink); font-size: var(--font-small); }
.site-rules-add:hover { opacity: .86; }

.site-rules-feedback { min-height: 18px; margin: 6px 0 0; color: var(--muted); font-size: var(--font-caption); line-height: var(--line-height-body); }
.site-rules-feedback strong { color: var(--ink); font-family: var(--font-mono); }
.site-rules-feedback.error { color: var(--danger); }

.site-rules-list { height: auto; margin-top: 8px; border-top: 1px solid var(--line); }
.site-rule-item { display: grid; min-height: 48px; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; border-bottom: 1px solid var(--line); }
.site-rule-copy { min-width: 0; }
.site-rule-copy strong { overflow: hidden; color: var(--ink); font-family: var(--font-mono); font-size: var(--font-small); font-weight: var(--weight-medium); text-overflow: ellipsis; white-space: nowrap; }
.site-rule-remove { min-height: 30px; padding: 0 8px; border: 0; color: var(--muted); background: transparent; font-size: var(--font-small); }
.site-rule-remove:hover { color: var(--danger); background: var(--danger-soft); }

/* 空状态只是一行说明，不再画虚线框。 */
.site-rules-empty { display: flex; flex-direction: column; gap: 2px; margin-top: 8px; padding: 14px 0; border-bottom: 1px solid var(--line); color: var(--muted); }
.site-rules-empty > svg { display: none; }
.site-rules-empty strong { color: var(--muted); font-size: var(--font-small); font-weight: var(--weight-medium); }
.site-rules-empty small { font-size: var(--font-caption); line-height: var(--line-height-body); }

.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

@media (max-width: 480px) {
  .site-rules-heading { align-items: flex-start; flex-direction: column; gap: 6px; }
  .site-rules-form { grid-template-columns: minmax(0, 1fr); }
}
</style>
