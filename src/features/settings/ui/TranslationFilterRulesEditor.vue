<template>
  <div class="translation-filter-rule-editor" :class="{ compact: props.compact }">
    <div class="translation-filter-rule-heading">
      <div>
        <strong>CSS 过滤规则</strong>
        <small>从上到下匹配；网站规则优先，同一范围内越靠前的规则优先。</small>
      </div>
      <button class="filter-rule-add-trigger" type="button" @click="startAdding">
        <Plus aria-hidden="true" />添加规则
      </button>
    </div>

    <div v-if="rules.length" ref="ruleList" class="translation-filter-rule-list" role="list">
      <article
        v-for="(rule, index) in rules"
        :key="rule.selector"
        class="translation-filter-rule-item"
        :data-rule-selector="rule.selector"
        role="listitem"
      >
        <template v-if="editingIndex !== index">
          <button
            class="filter-rule-drag-handle"
            type="button"
            :disabled="rules.length < 2 || editingIndex !== null"
            :aria-label="`拖动 ${rule.label || rule.selector} 调整顺序，第 ${index + 1} 项，共 ${rules.length} 项`"
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
            title="拖动调整优先级，也可用 Alt+↑/↓"
            @keydown.alt.arrow-up.prevent="moveRule(rule.selector, -1)"
            @keydown.alt.arrow-down.prevent="moveRule(rule.selector, 1)"
          >
            <GripVertical aria-hidden="true" />
          </button>
          <span class="filter-rule-action" :class="rule.action">
            {{ rule.action === 'exclude' ? '不翻译' : '强制翻译' }}
          </span>
          <span class="filter-rule-copy">
            <strong>{{ rule.label || '自定义规则' }}</strong>
            <code :title="rule.selector">{{ rule.selector }}</code>
          </span>
          <span class="filter-rule-actions">
            <button type="button" :aria-label="`编辑 ${rule.label || rule.selector}`" @click="startEditing(index)">
              <Pencil aria-hidden="true" />
            </button>
            <button class="danger" type="button" :aria-label="`删除 ${rule.label || rule.selector}`" @click="removeRule(index)">
              <Trash2 aria-hidden="true" />
            </button>
          </span>
        </template>
        <RuleForm
          v-else
          :action="draftAction"
          :selector="draftSelector"
          :label="draftLabel"
          :error="errorMessage"
          submit-label="保存"
          @update:action="draftAction = $event"
          @update:selector="updateDraftSelector"
          @update:label="draftLabel = $event"
          @submit="saveDraft"
          @cancel="cancelDraft"
        />
      </article>
    </div>

    <div v-else-if="editingIndex !== -1" class="translation-filter-rule-empty">
      <ListFilter :size="22" :stroke-width="1.7" aria-hidden="true" />
      <span><strong>当前没有额外规则</strong><small>{{ props.emptyDescription }}</small></span>
    </div>

    <p class="filter-rule-sort-status" aria-live="polite">{{ sortAnnouncement }}</p>

    <div v-if="editingIndex === -1" class="translation-filter-rule-new">
      <RuleForm
        :action="draftAction"
        :selector="draftSelector"
        :label="draftLabel"
        :error="errorMessage"
        submit-label="添加"
        @update:action="draftAction = $event"
        @update:selector="updateDraftSelector"
        @update:label="draftLabel = $event"
        @submit="saveDraft"
        @cancel="cancelDraft"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import {computed, defineComponent, h, nextTick, onUnmounted, ref, watch, type PropType} from 'vue';
import {GripVertical, ListFilter, Pencil, Plus, Trash2} from '@lucide/vue';
import {ElOption, ElSelect} from 'element-plus';
import Sortable from 'sortablejs';
import {
  MAX_TRANSLATION_FILTER_LABEL_LENGTH,
  MAX_TRANSLATION_FILTER_SELECTOR_LENGTH,
  normalizeTranslationFilterRules,
  reorderTranslationFilterRules,
  type TranslationFilterRule,
  type TranslationFilterRuleAction,
} from '@/src/core/translation/filters';

const props = withDefaults(defineProps<{
  modelValue?: TranslationFilterRule[];
  compact?: boolean;
  emptyDescription?: string;
}>(), {
  modelValue: () => [],
  compact: false,
  emptyDescription: '添加 CSS 选择器后，命中的内容会按指定方式处理。',
});

const emit = defineEmits<{
  'update:modelValue': [value: TranslationFilterRule[]];
}>();

const rules = computed({
  get: () => props.modelValue ?? [],
  set: (value: TranslationFilterRule[]) => emit('update:modelValue', value),
});
const ruleList = ref<HTMLElement | null>(null);
const editingIndex = ref<number | null>(null);
const draftAction = ref<TranslationFilterRuleAction>('exclude');
const draftSelector = ref('');
const draftLabel = ref('');
const errorMessage = ref('');
const sortAnnouncement = ref('');
let sortable: Sortable | null = null;

function resetDraft() {
  draftAction.value = 'exclude';
  draftSelector.value = '';
  draftLabel.value = '';
  errorMessage.value = '';
}

function startAdding() {
  resetDraft();
  editingIndex.value = -1;
}

function startEditing(index: number) {
  const rule = rules.value[index];
  if (!rule) return;
  editingIndex.value = index;
  draftAction.value = rule.action;
  draftSelector.value = rule.selector;
  draftLabel.value = rule.label ?? '';
  errorMessage.value = '';
}

function cancelDraft() {
  editingIndex.value = null;
  resetDraft();
}

function updateDraftSelector(value: string) {
  draftSelector.value = value;
  errorMessage.value = '';
}

function validateSelector(selector: string, currentIndex: number): string {
  if (!selector) return '请输入 CSS 选择器。';
  if (selector.length > MAX_TRANSLATION_FILTER_SELECTOR_LENGTH) {
    return `选择器不能超过 ${MAX_TRANSLATION_FILTER_SELECTOR_LENGTH} 个字符。`;
  }
  try {
    document.documentElement.matches(selector);
  } catch {
    return 'CSS 选择器格式无效。';
  }
  const duplicateIndex = rules.value.findIndex((rule, index) =>
    index !== currentIndex && rule.selector === selector);
  return duplicateIndex >= 0 ? '相同选择器已经存在。' : '';
}

function saveDraft() {
  const selector = draftSelector.value.trim();
  const currentIndex = editingIndex.value ?? -2;
  const validationError = validateSelector(selector, currentIndex);
  if (validationError) {
    errorMessage.value = validationError;
    return;
  }

  const label = draftLabel.value.trim().slice(0, MAX_TRANSLATION_FILTER_LABEL_LENGTH);
  const nextRule: TranslationFilterRule = {
    action: draftAction.value,
    selector,
    ...(label ? {label} : {}),
  };
  const nextRules = [...rules.value];
  if (currentIndex >= 0) nextRules.splice(currentIndex, 1, nextRule);
  else nextRules.unshift(nextRule);
  rules.value = normalizeTranslationFilterRules(nextRules);
  cancelDraft();
}

function removeRule(index: number) {
  rules.value = rules.value.filter((_, itemIndex) => itemIndex !== index);
  if (editingIndex.value === index) cancelDraft();
}

function reorderRule(fromSelector: string, targetIndex: number) {
  const fromIndex = rules.value.findIndex((rule) => rule.selector === fromSelector);
  if (fromIndex < 0 || targetIndex < 0 || targetIndex >= rules.value.length || fromIndex === targetIndex) return;
  const movedRule = rules.value[fromIndex];
  if (!movedRule) return;
  rules.value = reorderTranslationFilterRules(rules.value, fromIndex, targetIndex);
  sortAnnouncement.value = `${movedRule.label || movedRule.selector} 已移到第 ${targetIndex + 1} 项，越靠前的规则优先。`;
}

function moveRule(selector: string, offset: number) {
  if (editingIndex.value !== null) return;
  const fromIndex = rules.value.findIndex((rule) => rule.selector === selector);
  reorderRule(selector, fromIndex + offset);
}

function restoreSortableItem(event: Sortable.SortableEvent) {
  if (event.oldIndex === undefined) return;
  event.item.remove();
  event.from.insertBefore(event.item, event.from.children[event.oldIndex] ?? null);
}

function handleSortUpdate(event: Sortable.SortableEvent) {
  const {oldIndex, newIndex} = event;
  const selector = event.item.dataset.ruleSelector ?? '';
  if (oldIndex === undefined || newIndex === undefined || !selector) return;

  // Sortable 先移动真实 DOM；恢复原顺序后再交给 Vue 更新，避免虚拟 DOM 与页面状态失配。
  restoreSortableItem(event);
  void nextTick(() => reorderRule(selector, newIndex));
}

function createSortable(element: HTMLElement) {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  sortable = Sortable.create(element, {
    animation: reduceMotion ? 0 : 180,
    chosenClass: 'filter-rule-sort-chosen',
    direction: 'vertical',
    disabled: rules.value.length < 2 || editingIndex.value !== null,
    dragClass: 'filter-rule-sort-drag',
    draggable: '.translation-filter-rule-item',
    easing: 'cubic-bezier(.2, .8, .2, 1)',
    fallbackClass: 'filter-rule-sort-fallback',
    fallbackOnBody: true,
    fallbackTolerance: 4,
    forceFallback: true,
    ghostClass: 'filter-rule-sort-ghost',
    handle: '.filter-rule-drag-handle',
    swapThreshold: 0.65,
    onUpdate: handleSortUpdate,
  });
}

function destroySortable() {
  sortable?.destroy();
  sortable = null;
}

watch(ruleList, (element) => {
  destroySortable();
  if (element) {
    createSortable(element);
  }
}, {flush: 'post'});

watch([() => rules.value.length, editingIndex], ([ruleCount, activeEditor]) => {
  sortable?.option('disabled', ruleCount < 2 || activeEditor !== null);
});

onUnmounted(destroySortable);

const RuleForm = defineComponent({
  name: 'TranslationFilterRuleForm',
  props: {
    action: {type: String as PropType<TranslationFilterRuleAction>, required: true},
    selector: {type: String, required: true},
    label: {type: String, required: true},
    error: {type: String, required: true},
    submitLabel: {type: String, required: true},
  },
  emits: ['update:action', 'update:selector', 'update:label', 'submit', 'cancel'],
  setup(formProps, {emit: formEmit}) {
    return () => h('form', {
      class: 'filter-rule-form',
      onSubmit: (event: Event) => {
        event.preventDefault();
        formEmit('submit');
      },
    }, [
      h('div', {class: 'filter-rule-form-main'}, [
        h(ElSelect, {
          class: 'filter-rule-action-select',
          modelValue: formProps.action,
          'aria-label': '规则操作',
          'onUpdate:modelValue': (value: string) => formEmit(
            'update:action',
            value as TranslationFilterRuleAction,
          ),
        }, {
          default: () => [
            h(ElOption, {label: '不翻译', value: 'exclude'}),
            h(ElOption, {label: '强制翻译', value: 'include'}),
          ],
        }),
        h('input', {
          class: 'filter-rule-text-input',
          value: formProps.selector,
          maxlength: MAX_TRANSLATION_FILTER_SELECTOR_LENGTH,
          autocomplete: 'off',
          spellcheck: false,
          placeholder: 'CSS 选择器，例如 .sidebar',
          'aria-label': 'CSS 选择器',
          'aria-invalid': Boolean(formProps.error),
          onInput: (event: Event) => formEmit('update:selector', (event.target as HTMLInputElement).value),
        }),
      ]),
      h('input', {
        class: 'filter-rule-label-input filter-rule-text-input',
        value: formProps.label,
        maxlength: MAX_TRANSLATION_FILTER_LABEL_LENGTH,
        autocomplete: 'off',
        placeholder: '规则名称（可选）',
        'aria-label': '规则名称',
        onInput: (event: Event) => formEmit('update:label', (event.target as HTMLInputElement).value),
      }),
      formProps.error ? h('p', {class: 'filter-rule-error', role: 'alert'}, formProps.error) : null,
      h('div', {class: 'filter-rule-form-actions'}, [
        h('button', {type: 'button', onClick: () => formEmit('cancel')}, '取消'),
        h('button', {type: 'submit', class: 'primary'}, formProps.submitLabel),
      ]),
    ]);
  },
});
</script>

<style scoped>
.translation-filter-rule-editor { margin-top: 12px; }
.translation-filter-rule-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.translation-filter-rule-heading > div { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.translation-filter-rule-heading strong { color: var(--ink); font-size: var(--font-body); }
.translation-filter-rule-heading small { color: var(--muted); font-size: var(--font-caption); line-height: var(--line-height-tight); }
.filter-rule-add-trigger { display: inline-flex; min-height: 30px; flex: none; align-items: center; gap: 5px; padding: 0 9px; border: 1px solid var(--line); border-radius: 8px; color: var(--brand-strong); background: var(--surface); font-size: var(--font-caption); font-weight: var(--weight-semibold); cursor: pointer; }
.filter-rule-add-trigger:hover { border-color: var(--el-color-primary-light-5); background: var(--brand-soft); }
.filter-rule-add-trigger svg { width: 14px; height: 14px; }
.translation-filter-rule-list { margin-top: 10px; overflow: hidden; border: 1px solid var(--line); border-radius: 9px; }
.translation-filter-rule-item { display: grid; box-sizing: border-box; min-height: 54px; grid-template-columns: auto auto minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 9px 10px; border-bottom: 1px solid var(--line); background: var(--surface); transition: background 140ms ease, box-shadow 140ms ease, opacity 140ms ease; }
.translation-filter-rule-item:last-child { border-bottom: 0; }
.translation-filter-rule-item.filter-rule-sort-chosen { background: var(--brand-soft); }
.translation-filter-rule-item.filter-rule-sort-ghost { opacity: .28; background: var(--brand-soft); box-shadow: inset 0 0 0 1px var(--el-color-primary-light-5); }
.translation-filter-rule-item.filter-rule-sort-drag { cursor: grabbing; }
.translation-filter-rule-item.filter-rule-sort-fallback { z-index: 10000; opacity: .97 !important; border: 1px solid var(--el-color-primary-light-5); border-radius: 9px; background: var(--surface); box-shadow: 0 16px 34px rgba(31, 41, 55, .2), 0 4px 10px rgba(31, 41, 55, .1); cursor: grabbing; pointer-events: none; }
.translation-filter-rule-item.filter-rule-sort-fallback .filter-rule-actions { opacity: .56; }
.filter-rule-drag-handle { display: grid; width: 24px; height: 30px; padding: 0; place-items: center; border: 0; border-radius: 6px; outline: 0; color: var(--muted); background: transparent; cursor: grab; touch-action: none; }
.filter-rule-drag-handle:hover:not(:disabled), .filter-rule-drag-handle:focus-visible { color: var(--brand-strong); background: var(--brand-soft); }
.filter-rule-drag-handle:active { cursor: grabbing; }
.filter-rule-drag-handle:disabled { cursor: default; opacity: .34; }
.filter-rule-drag-handle svg { width: 15px; height: 15px; }
.filter-rule-action { display: inline-flex; min-width: 54px; min-height: 24px; align-items: center; justify-content: center; padding: 0 6px; border-radius: 6px; font-size: var(--font-caption); font-weight: var(--weight-semibold); }
.filter-rule-action.exclude { color: var(--muted); background: var(--surface-soft); }
.filter-rule-action.include { color: var(--brand-strong); background: var(--brand-soft); }
.filter-rule-copy { display: flex; min-width: 0; flex-direction: column; gap: 4px; }
.filter-rule-copy strong { overflow: hidden; color: var(--ink); font-size: var(--font-small); text-overflow: ellipsis; white-space: nowrap; }
.filter-rule-copy code { overflow: hidden; color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: var(--font-caption); text-overflow: ellipsis; white-space: nowrap; }
.filter-rule-actions { display: flex; gap: 3px; }
.filter-rule-actions button { display: grid; width: 28px; height: 28px; padding: 0; place-items: center; border: 0; border-radius: 7px; color: var(--muted); background: transparent; cursor: pointer; }
.filter-rule-actions button:hover { color: var(--brand-strong); background: var(--brand-soft); }
.filter-rule-actions button.danger:hover { color: var(--danger); background: var(--danger-soft); }
.filter-rule-actions svg { width: 14px; height: 14px; }
.filter-rule-sort-status { position: absolute; width: 1px; height: 1px; overflow: hidden; margin: -1px; padding: 0; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
.translation-filter-rule-empty { display: flex; align-items: center; gap: 10px; margin-top: 10px; padding: 12px; border: 1px dashed var(--line); border-radius: 9px; color: var(--muted); }
.translation-filter-rule-empty > span { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.translation-filter-rule-empty strong { color: var(--ink); font-size: var(--font-small); }
.translation-filter-rule-empty small { font-size: var(--font-caption); line-height: var(--line-height-tight); }
.translation-filter-rule-new { margin-top: 10px; padding: 10px; border: 1px solid var(--el-color-primary-light-7); border-radius: 9px; background: var(--brand-soft); }
:deep(.filter-rule-form) { display: grid; width: 100%; grid-column: 1 / -1; gap: 8px; }
:deep(.filter-rule-form-main) { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 8px; }
:deep(.filter-rule-text-input) { box-sizing: border-box; width: 100%; min-height: 34px; padding: 0 9px; border: 1px solid var(--line); border-radius: 7px; outline: 0; color: var(--ink); background: var(--surface); font-size: var(--font-small); }
:deep(.filter-rule-action-select) { width: 100%; }
:deep(.filter-rule-action-select .el-select__wrapper) { min-height: 34px; padding: 0 9px; border: 1px solid var(--line); border-radius: 7px; background: var(--surface); box-shadow: none; transition: border-color 140ms ease, box-shadow 140ms ease; }
:deep(.filter-rule-action-select .el-select__wrapper:hover) { border-color: var(--el-color-primary-light-3); }
:deep(.filter-rule-action-select .el-select__wrapper.is-focused) { border-color: var(--brand); box-shadow: 0 0 0 2px var(--brand-soft); }
:deep(.filter-rule-action-select .el-select__selected-item) { color: var(--ink); font-size: var(--font-small); }
:deep(.filter-rule-action-select .el-select__caret) { color: var(--muted); }
:deep(.filter-rule-form input[aria-label="CSS 选择器"]) { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
:deep(.filter-rule-text-input:focus) { border-color: var(--brand); box-shadow: 0 0 0 2px var(--brand-soft); }
:deep(.filter-rule-form input[aria-invalid="true"]) { border-color: var(--danger); }
:deep(.filter-rule-error) { margin: 0; color: var(--danger); font-size: var(--font-caption); }
:deep(.filter-rule-form-actions) { display: flex; justify-content: flex-end; gap: 7px; }
:deep(.filter-rule-form-actions button) { min-height: 30px; padding: 0 12px; border: 1px solid var(--line); border-radius: 7px; color: var(--muted); background: var(--surface); font-size: var(--font-caption); font-weight: var(--weight-semibold); cursor: pointer; }
:deep(.filter-rule-form-actions button.primary) { border-color: var(--brand); color: #fff; background: var(--brand); }
.compact .translation-filter-rule-heading small { max-width: 255px; }
.compact .translation-filter-rule-item { grid-template-columns: auto auto minmax(0, 1fr) auto; padding-inline: 7px; }
.compact .filter-rule-copy strong { font-size: var(--font-caption); }
@media (prefers-reduced-motion: reduce) {
  .translation-filter-rule-item { transition: none; }
}
@media (max-width: 430px) {
  :deep(.filter-rule-form-main) { grid-template-columns: 1fr; }
  .filter-rule-action { min-width: 48px; }
}
</style>
