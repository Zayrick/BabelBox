<template>
  <Transition name="babelbox-progress-panel">
    <aside
      v-if="isVisible"
      class="babelbox-translation-progress"
      :class="{ 'babelbox-dark': isDark, 'babelbox-static': !animationsEnabled }"
      :data-session-id="progress.sessionId"
      :data-running="progress.running"
      :data-remaining="progress.remaining"
      :data-queued="progress.queued"
      :data-offscreen="progress.offscreen"
    >
      <span class="babelbox-progress-indicator" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>

      <span
        class="babelbox-progress-copy"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        :aria-label="statusLabel"
      >
        <strong>翻译进度</strong>
        <span class="babelbox-progress-counts">
          <span>进行中 <b>{{ progress.running }}</b></span>
          <span class="babelbox-progress-divider" aria-hidden="true" />
          <span>剩余 <b>{{ progress.remaining }}</b></span>
        </span>
        <small v-if="progress.offscreen > 0">
          {{ progress.offscreen }} 项将在滚动到附近时翻译
        </small>
      </span>

      <button type="button" aria-label="本次全文翻译不再显示进度面板" title="本次隐藏" @click="dismiss">
        <X aria-hidden="true" />
      </button>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { X } from '@lucide/vue';
import {
  getFullPageTranslationProgress,
  subscribeFullPageTranslationProgress,
} from '@/src/features/full-page-translation/progress';
import {config, subscribeConfig} from '@/src/services/config/store';
import {usesAnimatedEffects} from '@/src/core/config/animation';
import {resolvesToDarkTheme} from '@/src/ui/theme/theme';

const progress = ref(getFullPageTranslationProgress());
const dismissedSessionId = ref<number | null>(null);
const animationsEnabled = ref(usesAnimatedEffects(config.animationMode));
const configuredTheme = ref(config.theme || 'auto');
const prefersDark = ref(false);
const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

let unsubscribeProgress: (() => void) | null = null;
let unsubscribeConfig: (() => void) | null = null;

const isDark = computed(() => resolvesToDarkTheme(configuredTheme.value, prefersDark.value));

const isVisible = computed(() => progress.value.active &&
  progress.value.sessionId !== dismissedSessionId.value &&
  (progress.value.running > 0 || progress.value.remaining > 0));

const statusLabel = computed(() => {
  const offscreen = progress.value.offscreen > 0
    ? `，其中 ${progress.value.offscreen} 个任务将在滚动到附近时翻译`
    : '';
  return `翻译进度：正在进行 ${progress.value.running} 个任务，剩余 ${progress.value.remaining} 个任务${offscreen}`;
});

function updatePreferredTheme(event?: MediaQueryListEvent): void {
  prefersDark.value = event?.matches ?? darkModeMediaQuery.matches;
}

function dismiss(): void {
  dismissedSessionId.value = progress.value.sessionId;
}

onMounted(() => {
  updatePreferredTheme();
  darkModeMediaQuery.addEventListener('change', updatePreferredTheme);
  unsubscribeProgress = subscribeFullPageTranslationProgress((nextProgress) => {
    progress.value = nextProgress;
  });
  unsubscribeConfig = subscribeConfig((nextConfig) => {
    animationsEnabled.value = usesAnimatedEffects(nextConfig.animationMode);
    configuredTheme.value = nextConfig.theme || 'auto';
  });
});

onBeforeUnmount(() => {
  darkModeMediaQuery.removeEventListener('change', updatePreferredTheme);
  unsubscribeProgress?.();
  unsubscribeProgress = null;
  unsubscribeConfig?.();
  unsubscribeConfig = null;
});
</script>

<style scoped>
.babelbox-translation-progress {
  --babelbox-progress-font-caption: 10px;
  --babelbox-progress-font-small: 11px;
  --babelbox-progress-font-body: 13px;
  --babelbox-progress-weight-semibold: 700;
  --babelbox-progress-weight-bold: 800;
  --babelbox-progress-border: rgba(229, 88, 139, 0.24);
  --babelbox-progress-surface: rgba(255, 252, 253, 0.96);
  --babelbox-progress-shadow: 0 12px 32px rgba(68, 38, 52, 0.18), 0 2px 8px rgba(68, 38, 52, 0.08);
  --babelbox-progress-ink: #3f3540;
  --babelbox-progress-heading: #342b35;
  --babelbox-progress-muted: #746875;
  --babelbox-progress-caption: #70636e;
  --babelbox-progress-brand: #bd2f62;
  --babelbox-progress-indicator: linear-gradient(145deg, #fff0f5, #ffe0eb);
  --babelbox-progress-divider-color: #e7dce1;
  --babelbox-progress-hover: #f8e9ef;
  --babelbox-progress-hover-ink: #cf3e73;
  position: fixed;
  right: max(16px, env(safe-area-inset-right));
  bottom: max(16px, env(safe-area-inset-bottom));
  z-index: 2147483645;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 28px;
  gap: 10px;
  align-items: center;
  width: min(286px, calc(100vw - 32px));
  padding: 11px 10px 11px 12px;
  border: 1px solid var(--babelbox-progress-border);
  border-radius: 14px;
  background: var(--babelbox-progress-surface);
  box-shadow: var(--babelbox-progress-shadow);
  color: var(--babelbox-progress-ink);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: var(--babelbox-progress-font-small);
  line-height: 1.35;
  pointer-events: auto;
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.babelbox-progress-indicator {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 3px;
  width: 34px;
  height: 34px;
  padding: 8px 7px;
  border-radius: 10px;
  background: var(--babelbox-progress-indicator);
  color: var(--babelbox-progress-brand);
}

.babelbox-progress-indicator i {
  display: block;
  width: 4px;
  height: 8px;
  border-radius: 999px;
  background: currentColor;
  animation: babelbox-progress-pulse 0.72s ease-in-out infinite alternate;
}

.babelbox-progress-indicator i:nth-child(2) {
  height: 14px;
  animation-delay: 0.16s;
}

.babelbox-progress-indicator i:nth-child(3) {
  height: 11px;
  animation-delay: 0.32s;
}

.babelbox-progress-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 2px;
}

.babelbox-progress-copy strong {
  color: var(--babelbox-progress-heading);
  font-size: var(--babelbox-progress-font-body);
  font-weight: var(--babelbox-progress-weight-semibold);
  letter-spacing: 0.01em;
}

.babelbox-progress-counts {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--babelbox-progress-muted);
  white-space: nowrap;
}

.babelbox-progress-counts b {
  color: var(--babelbox-progress-brand);
  font-variant-numeric: tabular-nums;
  font-weight: var(--babelbox-progress-weight-bold);
}

.babelbox-progress-divider {
  width: 1px;
  height: 10px;
  background: var(--babelbox-progress-divider-color);
}

.babelbox-progress-copy small {
  overflow: hidden;
  color: var(--babelbox-progress-caption);
  font-size: var(--babelbox-progress-font-caption);
  text-overflow: ellipsis;
  white-space: nowrap;
}

button {
  display: grid;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--babelbox-progress-caption);
  cursor: pointer;
}

button:hover,
button:focus-visible {
  background: var(--babelbox-progress-hover);
  color: var(--babelbox-progress-hover-ink);
  outline: none;
}

button:focus-visible {
  box-shadow: 0 0 0 2px rgba(232, 79, 135, 0.28);
}

button svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-width: 1.6;
}

.babelbox-translation-progress.babelbox-dark {
  --babelbox-progress-border: rgba(242, 116, 162, 0.3);
  --babelbox-progress-surface: rgba(38, 31, 39, 0.96);
  --babelbox-progress-shadow: 0 14px 36px rgba(0, 0, 0, 0.34), 0 2px 8px rgba(0, 0, 0, 0.2);
  --babelbox-progress-ink: #f7edf1;
  --babelbox-progress-heading: #fff7fa;
  --babelbox-progress-muted: #d1c2c9;
  --babelbox-progress-caption: #bfaeb7;
  --babelbox-progress-brand: #ff80ae;
  --babelbox-progress-indicator: linear-gradient(145deg, #593043, #442635);
  --babelbox-progress-divider-color: #5d4c55;
  --babelbox-progress-hover: #523242;
  --babelbox-progress-hover-ink: #ff91b8;
}

.babelbox-progress-panel-enter-active,
.babelbox-progress-panel-leave-active {
  transition: opacity 0.18s ease, transform 0.22s cubic-bezier(0.22, 1, 0.36, 1);
}

.babelbox-progress-panel-enter-from,
.babelbox-progress-panel-leave-to {
  opacity: 0;
  transform: translateY(8px) scale(0.98);
}

.babelbox-static .babelbox-progress-indicator i {
  animation: none;
}

.babelbox-static.babelbox-progress-panel-enter-active,
.babelbox-static.babelbox-progress-panel-leave-active {
  transition: none;
}

@keyframes babelbox-progress-pulse {
  from { transform: scaleY(0.5); opacity: 0.5; }
  to { transform: scaleY(1); opacity: 1; }
}

@media (max-width: 420px) {
  .babelbox-translation-progress {
    right: max(10px, env(safe-area-inset-right));
    bottom: max(10px, env(safe-area-inset-bottom));
    width: min(270px, calc(100vw - 20px));
  }
}

@media (prefers-reduced-motion: reduce) {
  .babelbox-translation-progress,
  .babelbox-progress-indicator i {
    animation: none;
    transition: none;
  }
}
</style>
