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
      <template v-else-if="normalizedPreview">将保存为 <strong>{{ normalizedPreview }}</strong>，并包含所有子域。</template>
      <template v-else>支持粘贴完整 URL；端口、路径和参数不会进入规则。</template>
    </p>

    <div v-if="domains.length" class="site-rules-list" role="list" :aria-label="labels.listLabel">
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
    </div>

    <div v-else class="site-rules-empty" data-site-rules-empty>
      <component :is="emptyIcon" :size="24" :stroke-width="1.7" aria-hidden="true" focusable="false" />
      <strong>{{ labels.emptyTitle }}</strong>
      <small>{{ labels.emptyDescription }}</small>
    </div>
  </section>
</template>

<script lang="ts" setup>
import { computed, nextTick, ref } from 'vue';
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
    description: '输入任意域名或网址，保存时统一归并到主域名；该网站及其所有子域都不会运行扩展功能。',
    countLabel: '禁用扩展网站数量',
    inputLabel: '添加禁用扩展网站',
    placeholder: '例如：https://docs.example.com/article',
    addButton: '添加网站',
    listLabel: '禁用扩展网站名单',
    emptyTitle: '还没有禁用扩展的网站',
    emptyDescription: '可从上方手动添加，也可在扩展弹窗中为当前网站快速禁用。',
    duplicateMessage: (domain: string) => `${domain} 已在禁用扩展名单中。`,
    addedMessage: (domain: string) => `已添加 ${domain}。`,
    removedMessage: (domain: string) => `已删除 ${domain}。`,
  }
  : {
    settingId: 'always-translate-sites',
    titleId: 'always-translate-sites-title',
    feedbackId: 'always-translate-sites-feedback',
    title: '始终翻译网站',
    description: '输入任意域名或网址，保存时统一归并到主域名，并对它的所有子域生效。',
    countLabel: '始终翻译网站数量',
    inputLabel: '添加始终翻译网站',
    placeholder: '例如：https://docs.example.com/article',
    addButton: '添加网站',
    listLabel: '始终翻译网站名单',
    emptyTitle: '还没有始终翻译的网站',
    emptyDescription: '可从上方手动添加，也可在扩展弹窗中为当前网站快速开启。',
    duplicateMessage: (domain: string) => `${domain} 已在始终翻译名单中。`,
    addedMessage: (domain: string) => `已添加 ${domain}。`,
    removedMessage: (domain: string) => `已删除 ${domain}。`,
  });

function clearFeedback() {
  errorMessage.value = '';
  statusMessage.value = '';
}

function addDomain() {
  const input = inputValue.value.trim();
  if (!input) {
    errorMessage.value = '请输入域名或网址。';
    return;
  }

  const domain = getSiteBaseDomain(input);
  if (!domain) {
    errorMessage.value = '无法识别有效的网站主域名，请检查输入内容。';
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
.site-rules-editor {
  margin: 0;
  padding: 16px;
  background: var(--surface);
}

.site-rules-editor + .site-rules-editor {
  border-top: 1px solid var(--line);
}

.site-rules-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.site-rules-heading > div {
  min-width: 0;
}

.site-rules-heading h3 {
  margin: 0 0 4px;
  color: var(--ink);
  font-size: var(--font-subtitle);
}

.site-rules-heading p {
  margin: 0;
  color: var(--muted);
  font-size: var(--font-small);
  line-height: var(--line-height-body);
}

.site-rules-count {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  min-height: 24px;
  padding: 0;
  color: var(--muted);
  background: transparent;
  font-size: var(--font-caption);
  font-weight: var(--weight-semibold);
}

.site-rules-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  margin-top: 12px;
}

.site-rules-input-wrap {
  min-width: 0;
}

.site-rules-input-wrap input {
  width: 100%;
  min-height: var(--control-height);
  padding: 0 12px;
  border: 1px solid var(--el-border-color);
  border-radius: var(--radius-control);
  outline: 0;
  color: var(--ink);
  background: var(--surface);
  font-size: var(--font-body);
  transition: border-color 160ms ease, box-shadow 160ms ease;
}

.site-rules-input-wrap input:hover {
  border-color: var(--el-color-primary-light-3);
}

.site-rules-input-wrap input:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 3px var(--brand-soft);
}

.site-rules-input-wrap input[aria-invalid="true"] {
  border-color: var(--danger);
}

.site-rules-input-wrap input::placeholder {
  color: var(--el-text-color-placeholder);
}

.site-rules-add,
.site-rule-remove {
  border-radius: var(--radius-control);
  font-weight: var(--weight-semibold);
  cursor: pointer;
}

.site-rules-add {
  min-width: 92px;
  min-height: var(--control-height);
  padding: 0 14px;
  border: 0;
  color: var(--on-brand);
  background: var(--brand);
}

.site-rules-add:hover {
  background: var(--brand-strong);
}

.site-rules-feedback {
  min-height: 18px;
  margin: 7px 2px 0;
  color: var(--muted);
  font-size: var(--font-caption);
  line-height: var(--line-height-body);
}

.site-rules-feedback strong {
  color: var(--ink);
}

.site-rules-feedback.error {
  color: var(--danger);
}

.site-rules-list {
  max-height: 360px;
  margin-top: 14px;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius-control);
  scrollbar-width: thin;
}

.site-rule-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 12px;
  min-height: 52px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
}

.site-rule-item:last-child { border-bottom: 0; }

.site-rule-copy { min-width: 0; }

.site-rule-copy strong {
  overflow: hidden;
  color: var(--ink);
  font-size: var(--font-body);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.site-rule-remove {
  min-height: 32px;
  padding: 0 4px;
  border: 0;
  color: var(--brand-strong);
  background: transparent;
  font-size: var(--font-small);
  font-weight: var(--weight-medium);
}

.site-rule-remove:hover {
  color: var(--brand);
}

.site-rules-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 96px;
  margin-top: 14px;
  padding: 16px;
  border: 1px dashed var(--line);
  border-radius: var(--radius-control);
  color: var(--muted);
  background: transparent;
  text-align: center;
  flex-direction: column;
}

.site-rules-empty > svg {
  margin-bottom: 5px;
  color: var(--brand-strong);
}

.site-rules-empty strong {
  color: var(--ink);
  font-size: var(--font-body);
}

.site-rules-empty small {
  max-width: 390px;
  margin-top: 5px;
  font-size: var(--font-caption);
  line-height: var(--line-height-body);
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (max-width: 600px) {
  .site-rules-editor {
    padding: 14px 12px;
  }

  .site-rules-heading {
    gap: 12px;
  }

}

@media (max-width: 480px) {
  .site-rules-heading {
    flex-direction: column;
  }

  .site-rules-form {
    grid-template-columns: minmax(0, 1fr);
  }

  .site-rules-add {
    width: 100%;
  }

  .site-rule-item { padding: 8px 10px; }
}
</style>
