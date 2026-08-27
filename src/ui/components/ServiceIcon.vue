<template>
  <span
    class="service-brand-icon"
    :class="[
      `service-brand-icon--${size}`,
      {'service-brand-icon--fallback': !brandIcon},
    ]"
    :data-service="service"
    :data-icon-source="brandIcon?.slug || 'fallback'"
    :title="label || service"
    aria-hidden="true"
  >
    <img
      v-if="brandIcon"
      :src="brandIcon.src"
      alt=""
      draggable="false"
    />
    <span v-else class="service-brand-fallback">{{ fallbackGlyph }}</span>
  </span>
</template>

<script setup lang="ts">
import {computed} from 'vue'
import {
  resolveServiceBrandIcon,
  resolveServiceIconFallbackGlyph,
} from '@/src/ui/icons/serviceBrandIcons'

const props = withDefaults(defineProps<{
  service: string
  label?: string
  size?: 'small' | 'medium' | 'large' | 'model'
}>(), {
  label: '',
  size: 'medium',
})

const brandIcon = computed(() => resolveServiceBrandIcon(props.service))
const fallbackGlyph = computed(() => resolveServiceIconFallbackGlyph(props.service, props.label))
</script>

<style scoped>
.service-brand-icon {
  display: grid;
  place-items: center;
  box-sizing: border-box;
  flex: none;
  border: 1px solid rgba(31, 41, 55, 0.1);
  border-radius: 11px;
  overflow: hidden;
  background: #fff;
  box-shadow: 0 1px 2px rgba(31, 41, 55, 0.06);
}

.service-brand-icon--small {
  width: 25px;
  height: 25px;
  border-radius: 8px;
}

.service-brand-icon--medium {
  width: 40px;
  height: 40px;
}

.service-brand-icon--large {
  width: 48px;
  height: 48px;
  border-radius: 14px;
}

.service-brand-icon--model {
  width: 30px;
  height: 30px;
  border-radius: 9px;
}

.service-brand-icon img {
  display: block;
  width: 64%;
  height: 64%;
  object-fit: contain;
  pointer-events: none;
  user-select: none;
}

.service-brand-icon--small img,
.service-brand-icon--model img {
  width: 68%;
  height: 68%;
}

.service-brand-icon--fallback {
  color: #536174;
  background: #f3f5f8;
}

.service-brand-fallback {
  font-size: 13px;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.04em;
}

.service-brand-icon--small .service-brand-fallback,
.service-brand-icon--model .service-brand-fallback {
  font-size: 11px;
}
</style>
