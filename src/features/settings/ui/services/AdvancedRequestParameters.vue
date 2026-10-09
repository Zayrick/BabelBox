<template>
  <details class="advanced-request-parameters">
    <summary><ChevronRight class="summary-icon" aria-hidden="true" />高级请求参数</summary>
    <div class="advanced-request-field">
      <CustomBodyEditor
        :model-value="modelValue"
        :invalid="invalid"
        @update:model-value="emit('update:modelValue', $event)"
      />
      <small v-if="invalid && invalidMessage" class="error-text">{{ invalidMessage }}</small>
    </div>
  </details>
</template>

<script setup lang="ts">
import { ChevronRight } from '@lucide/vue'
import CustomBodyEditor from './CustomBodyEditor.vue'

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
  padding-top: 8px;
}

summary {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 0;
  color: var(--muted);
  font-size: var(--font-small);
  font-weight: var(--weight-medium);
  cursor: pointer;
  list-style: none;
}

summary::-webkit-details-marker { display: none; }
.summary-icon { width: 15px; height: 15px; flex: none; transition: transform 140ms ease; }
.advanced-request-parameters[open] > summary .summary-icon { transform: rotate(90deg); }
summary:hover { color: var(--ink); }

.advanced-request-field {
  display: grid;
  gap: 8px;
  padding: 4px 0 12px;
  color: var(--ink);
  font-size: var(--font-small);
  font-weight: var(--weight-medium);
}

.error-text {
  color: var(--danger);
  font-size: var(--font-small);
  font-weight: var(--weight-medium);
  line-height: var(--line-height-body);
}
</style>
