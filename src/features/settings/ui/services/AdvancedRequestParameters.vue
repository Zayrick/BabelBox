<template>
  <details class="advanced-request-parameters">
    <summary>高级请求参数</summary>
    <label class="advanced-request-field">
      <span>自定义请求体</span>
      <el-input
        :model-value="modelValue"
        type="textarea"
        :rows="3"
        :class="{ 'input-error': invalid }"
        placeholder='可选 JSON 对象，例如 {"temperature":0}'
        @update:model-value="emit('update:modelValue', $event)"
      />
      <small v-if="invalid && invalidMessage" class="error-text">{{ invalidMessage }}</small>
    </label>
  </details>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  modelValue: string
  invalid?: boolean
  invalidMessage?: string
}>(), {
  invalid: false,
  invalidMessage: '',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()
</script>

<style scoped>
.advanced-request-parameters {
  width: 100%;
  padding-top: 4px;
  border-top: 1px solid var(--line);
}

summary {
  padding: 10px 0;
  color: var(--brand-strong);
  font-size: var(--font-small);
  font-weight: var(--weight-semibold);
  cursor: pointer;
}

.advanced-request-field {
  display: grid;
  gap: 6px;
  color: var(--ink);
  font-size: var(--font-small);
  font-weight: var(--weight-medium);
}

.input-error :deep(.el-textarea__inner) {
  box-shadow: 0 0 0 1px var(--el-color-danger) inset;
}

.error-text {
  color: var(--danger);
  font-size: var(--font-small);
  font-weight: var(--weight-medium);
  line-height: var(--line-height-body);
}
</style>
