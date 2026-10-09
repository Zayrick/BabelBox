<template>
  <section class="settings-group" :aria-label="title || undefined">
    <header v-if="title || $slots.actions" class="settings-group-header">
      <div class="settings-group-heading">
        <h2 v-if="title">{{ title }}</h2>
        <p v-if="description">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="settings-group-actions"><slot name="actions" /></div>
    </header>
    <div class="settings-group-body"><slot /></div>
  </section>
</template>

<script setup lang="ts">
defineProps<{
  title?: string
  description?: string
}>()
</script>
