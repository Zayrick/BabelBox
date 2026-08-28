<template>
  <span class="settings-help-label popup-text popup-vertical-left">
    <span class="settings-help-label-text"><slot /></span>
    <el-tooltip
      effect="dark"
      :content="content"
      placement="top"
      :show-after="showAfter"
    >
      <button
        type="button"
        class="settings-help-trigger"
        :aria-label="ariaLabel"
        @click.prevent
      >
        <CircleHelp aria-hidden="true" />
      </button>
    </el-tooltip>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { CircleHelp } from '@lucide/vue'

const props = withDefaults(defineProps<{
  content: string
  showAfter?: number
}>(), {
  showAfter: 500,
})

const ariaLabel = computed(() => `查看说明：${props.content}`)
</script>

<style scoped>
.settings-help-label {
  display: inline-flex;
  align-items: center;
  gap: 0.25em;
  max-width: 100%;
}

.settings-help-label-text {
  min-width: 0;
}

.settings-help-trigger {
  display: inline-flex;
  width: 1em;
  height: 1em;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0;
  border: 0;
  color: currentColor;
  background: transparent;
  font: inherit;
  line-height: 1;
  cursor: help;
}

.settings-help-trigger svg {
  display: block;
  width: 1em;
  height: 1em;
}

.settings-help-trigger:focus-visible {
  border-radius: 50%;
  outline: 2px solid var(--el-color-primary);
  outline-offset: 2px;
}
</style>
