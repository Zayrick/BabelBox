<!-- settings-control-row 是浏览器回归脚本定位单项设置的公开钩子。 -->
<template>
  <div class="settings-row settings-control-row" :class="{ stacked }">
    <div class="settings-row-copy">
      <span class="settings-row-label">{{ label }}<slot name="badge" /></span>
      <p v-if="description || $slots.description" class="settings-row-description">
        <slot name="description">{{ description }}</slot>
      </p>
    </div>
    <div v-if="$slots.default" class="settings-row-control"><slot /></div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  label: string
  description?: string
  /** 控件放到说明下方，供多行输入或预览这类需要整行宽度的内容使用。 */
  stacked?: boolean
}>()
</script>
