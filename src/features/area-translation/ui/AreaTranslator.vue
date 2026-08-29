<template>
  <div v-show="isSelecting || phase !== 'idle'" class="babelbox-area-translator-root" @pointerdown.stop>
    <div v-if="isSelecting && selectionRect" class="babelbox-area-selection" :style="areaStyle(selectionRect)" aria-hidden="true">
      <span>松开鼠标翻译</span>
    </div>

    <div v-else-if="phase === 'loading' && activeRect && !capturePending" class="babelbox-area-loading" :style="areaStyle(activeRect)" role="status" aria-live="polite">
      <span class="babelbox-area-spinner" aria-hidden="true" />
      <span>正在识别并翻译…</span>
    </div>

    <section v-else-if="phase === 'translated' && activeRect" class="babelbox-area-result" :class="{ 'babelbox-dark-theme': isDarkTheme }" :style="areaStyle(activeRect)" role="dialog" aria-label="圈选翻译结果">
      <img :src="translatedImage" alt="圈选翻译结果" draggable="false" />
      <div class="babelbox-area-toolbar">
        <span>圈选翻译</span>
        <button type="button" aria-label="关闭圈选翻译结果" title="关闭" @click="clearResult"><X aria-hidden="true" /></button>
      </div>
    </section>

    <section v-else-if="phase === 'error' && activeRect" class="babelbox-area-error" :class="{ 'babelbox-dark-theme': isDarkTheme }" :style="errorStyle(activeRect)" role="alert">
      <strong>圈选翻译失败</strong>
      <span>{{ errorMessage }}</span>
      <div>
        <button type="button" @click="retryTranslation">重试</button>
        <button type="button" @click="clearResult">关闭</button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { X } from '@lucide/vue';
import { config } from '@/src/services/config/store';
import {resolvesToDarkTheme} from '@/src/ui/theme/theme';
import { captureVisibleAreaInExtension, translateCapturedAreaInExtension } from '@/src/features/area-translation/services/client';
import { isAreaHotkey, isAreaZKey, isUsableAreaRect, normalizeAreaRect, type AreaPoint, type AreaRect } from '@/src/features/area-translation/core';

type AreaPhase = 'idle' | 'selecting' | 'loading' | 'translated' | 'error';

const phase = ref<AreaPhase>('idle');
const selectionRect = ref<AreaRect | null>(null);
const activeRect = ref<AreaRect | null>(null);
const translatedImage = ref('');
const errorMessage = ref('');
const isDarkTheme = ref(false);
const capturePending = ref(false);

let areaHotkeyPressed = false;
let pointerDown = false;
let startPoint: AreaPoint | null = null;
let translationRequestId = 0;
let systemThemeMedia: MediaQueryList | null = null;

function areaStyle(rect: AreaRect): Record<string, string> {
  return {
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  };
}

function errorStyle(rect: AreaRect): Record<string, string> {
  const width = Math.min(340, Math.max(230, rect.width));
  return {
    ...areaStyle(rect),
    width: `${width}px`,
    height: 'auto',
  };
}

function updateTheme(): void {
  isDarkTheme.value = resolvesToDarkTheme(
    config.theme,
    systemThemeMedia?.matches ?? window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
}

function isInsideExtensionUi(target: EventTarget | null): boolean {
  const host = document.getElementById('babelbox-area-translator-container');
  return Boolean(host && target instanceof Node && host.contains(target));
}

function isEditableTarget(target: EventTarget | null): boolean {
  const activeElement = document.activeElement;
  const element = target instanceof HTMLElement
    ? target
    : activeElement instanceof HTMLElement
      ? activeElement
      : null;
  if (!element) return false;
  if (element.isContentEditable || element.closest('[contenteditable="true"], [contenteditable="plaintext-only"]')) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(element.tagName);
}

function isEnabled(): boolean {
  return config.on !== false && config.selectionAreaEnabled === true;
}

function clearResult(): void {
  translationRequestId += 1;
  capturePending.value = false;
  phase.value = 'idle';
  selectionRect.value = null;
  activeRect.value = null;
  translatedImage.value = '';
  errorMessage.value = '';
}

function cancelSelection(): void {
  pointerDown = false;
  startPoint = null;
  selectionRect.value = null;
  if (phase.value === 'selecting') phase.value = 'idle';
}

function handleKeydown(event: KeyboardEvent): void {
  if (!event.isTrusted) return;
  if (event.key === 'Escape' && (isSelecting.value || phase.value !== 'idle')) {
    event.preventDefault();
    cancelSelection();
    clearResult();
    return;
  }
  if (!isEnabled() || event.repeat || event.isComposing || !isAreaHotkey(event) || isInsideExtensionUi(event.target) || isEditableTarget(event.target)) return;
  areaHotkeyPressed = true;
  event.preventDefault();
}

function handleKeyup(event: KeyboardEvent): void {
  if (!event.isTrusted) return;
  if (!isAreaZKey(event)) return;
  areaHotkeyPressed = false;
  if (isSelecting.value && !pointerDown) finishSelection();
}

function pointFromEvent(event: PointerEvent): AreaPoint {
  return { x: Math.min(window.innerWidth, Math.max(0, event.clientX)), y: Math.min(window.innerHeight, Math.max(0, event.clientY)) };
}

function handlePointerdown(event: PointerEvent): void {
  if (!event.isTrusted) return;
  if (!areaHotkeyPressed || event.button !== 0 || !isEnabled() || isInsideExtensionUi(event.target) || isEditableTarget(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
  pointerDown = true;
  startPoint = pointFromEvent(event);
  selectionRect.value = { left: startPoint.x, top: startPoint.y, width: 0, height: 0 };
  activeRect.value = null;
  translatedImage.value = '';
  errorMessage.value = '';
  phase.value = 'selecting';
  window.getSelection()?.removeAllRanges();
}

function handlePointermove(event: PointerEvent): void {
  if (!event.isTrusted) return;
  if (!isSelecting.value || !startPoint) return;
  event.preventDefault();
  event.stopPropagation();
  selectionRect.value = normalizeAreaRect(startPoint, pointFromEvent(event), { width: window.innerWidth, height: window.innerHeight });
}

function handlePointerup(event: PointerEvent): void {
  if (!event.isTrusted) return;
  if (!isSelecting.value) return;
  event.preventDefault();
  event.stopPropagation();
  pointerDown = false;
  finishSelection();
}

function handlePointercancel(event: PointerEvent): void {
  if (!event.isTrusted) return;
  if (isSelecting.value) cancelSelection();
}

function handleWindowBlur(): void {
  areaHotkeyPressed = false;
  if (isSelecting.value) cancelSelection();
}

const isSelecting = computed(() => phase.value === 'selecting');

function finishSelection(): void {
  if (!isSelecting.value) return;
  const rect = selectionRect.value;
  cancelSelection();
  if (!rect || !isUsableAreaRect(rect)) return;

  activeRect.value = rect;
  phase.value = 'loading';
  capturePending.value = true;
  void requestTranslation(rect);
}

async function requestTranslation(rect: AreaRect): Promise<void> {
  const requestId = ++translationRequestId;
  errorMessage.value = '';
  try {
    const selection = {
      ...rect,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    };
    // 先让框选层完全消失，再截图；否则选区边框会被 OCR 当作页面内容。
    await nextTick();
    const screenshot = await captureVisibleAreaInExtension();
    if (requestId !== translationRequestId || activeRect.value !== rect) return;
    capturePending.value = false;
    const result = await translateCapturedAreaInExtension(screenshot, selection, config.from, document.title);
    if (requestId !== translationRequestId || activeRect.value !== rect) return;
    translatedImage.value = result.image;
    phase.value = 'translated';
  } catch (error) {
    if (requestId !== translationRequestId || activeRect.value !== rect) return;
    capturePending.value = false;
    errorMessage.value = error instanceof Error ? error.message : String(error);
    phase.value = 'error';
  }
}

function retryTranslation(): void {
  if (activeRect.value) {
    phase.value = 'loading';
    capturePending.value = true;
    void requestTranslation(activeRect.value);
  }
}

function handleViewportChange(): void {
  if (!isSelecting.value) clearResult();
}

const stopConfigWatch = watch(() => [config.on, config.selectionAreaEnabled, config.theme] as const, ([enabled]) => {
  updateTheme();
  if (!enabled || config.selectionAreaEnabled !== true) {
    areaHotkeyPressed = false;
    cancelSelection();
    clearResult();
  }
});

onMounted(() => {
  updateTheme();
  systemThemeMedia = window.matchMedia('(prefers-color-scheme: dark)');
  systemThemeMedia.addEventListener('change', updateTheme);
  document.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('keyup', handleKeyup, true);
  document.addEventListener('pointerdown', handlePointerdown, true);
  document.addEventListener('pointermove', handlePointermove, true);
  document.addEventListener('pointerup', handlePointerup, true);
  document.addEventListener('pointercancel', handlePointercancel, true);
  window.addEventListener('scroll', handleViewportChange, true);
  window.addEventListener('resize', handleViewportChange);
  window.addEventListener('blur', handleWindowBlur);
});

onBeforeUnmount(() => {
  systemThemeMedia?.removeEventListener('change', updateTheme);
  document.removeEventListener('keydown', handleKeydown, true);
  document.removeEventListener('keyup', handleKeyup, true);
  document.removeEventListener('pointerdown', handlePointerdown, true);
  document.removeEventListener('pointermove', handlePointermove, true);
  document.removeEventListener('pointerup', handlePointerup, true);
  document.removeEventListener('pointercancel', handlePointercancel, true);
  window.removeEventListener('scroll', handleViewportChange, true);
  window.removeEventListener('resize', handleViewportChange);
  window.removeEventListener('blur', handleWindowBlur);
  stopConfigWatch();
  capturePending.value = false;
  clearResult();
});
</script>

<style scoped>
.babelbox-area-translator-root { --babelbox-area-font-caption: 10px; --babelbox-area-font-small: 11px; --babelbox-area-font-body: 13px; --babelbox-area-weight-semibold: 700; position: fixed; inset: 0; z-index: 2147483647; width: 100vw; height: 100vh; pointer-events: none; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #25252a; }
.babelbox-area-selection { position: fixed; box-sizing: border-box; border: 2px solid #ef4b86; border-radius: 9px; background: rgba(239, 75, 134, .12); box-shadow: 0 0 0 1px rgba(255, 255, 255, .8), 0 8px 26px rgba(163, 35, 91, .2); pointer-events: none; }
.babelbox-area-selection span { position: absolute; left: 8px; top: 8px; padding: 4px 8px; border-radius: 999px; background: rgba(44, 35, 43, .88); color: #fff; font-size: var(--babelbox-area-font-small); white-space: nowrap; }
.babelbox-area-loading, .babelbox-area-error { position: fixed; box-sizing: border-box; pointer-events: auto; }
.babelbox-area-loading { display: flex; align-items: center; justify-content: center; gap: 9px; min-width: 190px; min-height: 58px; border: 1px solid rgba(239, 75, 134, .55); border-radius: 12px; background: rgba(38, 31, 39, .8); color: #fff; font-size: var(--babelbox-area-font-body); box-shadow: 0 12px 30px rgba(35, 25, 38, .24); backdrop-filter: blur(8px); }
.babelbox-area-spinner { width: 18px; height: 18px; border: 2px solid rgba(255, 255, 255, .35); border-top-color: #ef4b86; border-radius: 50%; animation: babelbox-area-spin .7s linear infinite; }
@keyframes babelbox-area-spin { to { transform: rotate(360deg); } }
.babelbox-area-result,
.babelbox-area-error {
  --babelbox-area-result-border: rgba(28, 28, 36, .14);
  --babelbox-area-result-surface: #fff;
  --babelbox-area-error-border: #f0b4c8;
  --babelbox-area-error-surface: rgba(255, 248, 250, .98);
  --babelbox-area-error-ink: #6c263d;
  --babelbox-area-error-button-border: #e6a3ba;
  --babelbox-area-error-button-surface: #fff;
  --babelbox-area-error-button-ink: #c43b63;
  --babelbox-area-error-button-hover: #fff0f5;
}
.babelbox-area-result { position: fixed; overflow: hidden; border: 1px solid var(--babelbox-area-result-border); border-radius: 10px; background: var(--babelbox-area-result-surface); box-shadow: 0 14px 35px rgba(30, 28, 40, .24); pointer-events: auto; }
.babelbox-area-result img { display: block; width: 100%; height: 100%; user-select: none; -webkit-user-drag: none; }
.babelbox-area-toolbar { position: absolute; top: 7px; right: 7px; display: flex; align-items: center; gap: 5px; padding: 3px 4px 3px 8px; border-radius: 999px; background: rgba(30, 27, 34, .82); color: #fff; font-size: var(--babelbox-area-font-caption); line-height: 22px; pointer-events: none; backdrop-filter: blur(6px); }
.babelbox-area-toolbar button { width: 22px; height: 22px; padding: 0; border: 0; border-radius: 50%; background: rgba(255, 255, 255, .14); color: #fff; line-height: 18px; cursor: pointer; pointer-events: auto; }
.babelbox-area-toolbar button svg { width: 13px; height: 13px; }
.babelbox-area-toolbar button:hover, .babelbox-area-toolbar button:focus-visible { background: rgba(255, 255, 255, .28); outline: none; }
.babelbox-area-error { display: flex; flex-direction: column; gap: 7px; min-width: 230px; max-width: 340px; padding: 13px; border: 1px solid var(--babelbox-area-error-border); border-radius: 12px; background: var(--babelbox-area-error-surface); color: var(--babelbox-area-error-ink); font-size: var(--babelbox-area-font-small); box-shadow: 0 12px 30px rgba(75, 30, 47, .2); }
.babelbox-area-error strong { font-size: var(--babelbox-area-font-body); font-weight: var(--babelbox-area-weight-semibold); }
.babelbox-area-error span { line-height: 1.45; overflow-wrap: anywhere; }
.babelbox-area-error div { display: flex; gap: 7px; }
.babelbox-area-error button { padding: 5px 10px; border: 1px solid var(--babelbox-area-error-button-border); border-radius: 7px; background: var(--babelbox-area-error-button-surface); color: var(--babelbox-area-error-button-ink); cursor: pointer; }
.babelbox-area-error button:hover, .babelbox-area-error button:focus-visible { background: var(--babelbox-area-error-button-hover); outline: none; }
.babelbox-dark-theme {
  --babelbox-area-result-border: #53535f;
  --babelbox-area-result-surface: #2e2e38;
  --babelbox-area-error-border: #744356;
  --babelbox-area-error-surface: rgba(47, 35, 43, .98);
  --babelbox-area-error-ink: #ffd8e4;
  --babelbox-area-error-button-border: #9d5871;
  --babelbox-area-error-button-surface: #3d2c36;
  --babelbox-area-error-button-ink: #ffd8e4;
  --babelbox-area-error-button-hover: #513443;
}
@media (prefers-reduced-motion: reduce) { .babelbox-area-spinner { animation: none; } }
</style>
