<template>
  <section id="settings-image-translation" class="settings-section settings-list-section image-ocr-section">
    <div v-if="!browserCapabilities.imageOcr" class="image-ocr-unavailable" role="status">
      <strong>当前浏览器暂不支持图片翻译与 OCR</strong>
      <p>原有图片翻译偏好和语言包记录会保留；请在 Chrome 中使用及管理此功能。</p>
    </div>
    <template v-else>
      <header class="image-ocr-list-heading">
        <h2>语言列表</h2>
        <p>下载对应语言包后，才能识别该语言的图片文字。</p>
      </header>
      <div class="image-ocr-pack-list">
        <article v-for="pack in languagePacks" :key="pack.code" class="image-ocr-pack-card">
          <div class="image-ocr-pack-icon">{{ pack.code === 'chi_sim' ? '中' : pack.code === 'eng' ? 'A' : '日' }}</div>
          <div class="image-ocr-pack-copy">
            <div class="image-ocr-pack-title">
              <strong>{{ pack.label }}</strong>
              <span v-if="pack.recommended" class="image-ocr-recommended">推荐</span>
            </div>
            <small>{{ pack.description }} · {{ pack.size }}</small>
          </div>
          <div class="image-ocr-pack-action">
            <span :class="['image-ocr-pack-status', {ready: downloadedCodes.includes(pack.code)}]">
              {{ downloadedCodes.includes(pack.code) ? '已下载' : '未下载' }}
            </span>
            <button type="button" class="image-ocr-download-button"
              :disabled="downloadedCodes.includes(pack.code) || downloadingCodes.includes(pack.code)"
              @click="downloadLanguages([pack.code])">
              {{ downloadedCodes.includes(pack.code) ? '已就绪' : downloadingCodes.includes(pack.code) ? '下载中…' : '下载' }}
            </button>
          </div>
        </article>
      </div>
      <p v-if="downloadError" class="image-ocr-error">{{ downloadError }}</p>
    </template>
  </section>
</template>

<script setup lang="ts">
import {onMounted, ref} from 'vue';
import {browser} from 'wxt/browser';
import {browserCapabilities} from '@/src/platform/browser/capabilities';
import {
  IMAGE_OCR_LANGUAGE_PACKS,
  IMAGE_OCR_LANGUAGE_STATE_KEY,
  normalizeImageOcrLanguageCodes,
  type ImageOcrLanguageCode,
} from '../ocrLanguages';

const languagePacks = IMAGE_OCR_LANGUAGE_PACKS;
const downloadedCodes = ref<ImageOcrLanguageCode[]>([]);
const downloadingCodes = ref<ImageOcrLanguageCode[]>([]);
const downloadError = ref('');

async function refreshLanguageState() {
  const stored = await browser.storage.local.get(IMAGE_OCR_LANGUAGE_STATE_KEY);
  downloadedCodes.value = normalizeImageOcrLanguageCodes(stored[IMAGE_OCR_LANGUAGE_STATE_KEY]);
}

async function downloadLanguages(languages: ImageOcrLanguageCode[]) {
  if (!browserCapabilities.imageOcr) return;
  const pending = languages.filter(code => !downloadedCodes.value.includes(code));
  if (pending.length === 0) return;
  downloadError.value = '';
  downloadingCodes.value = [...new Set([...downloadingCodes.value, ...pending])];
  try {
    const response = await browser.runtime.sendMessage({
      type: 'fluentReadImageOcrDownload', languages: pending,
    }) as {success?: boolean; languages?: unknown; error?: string} | undefined;
    if (!response?.success) throw new Error(response?.error || '语言包下载失败');
    downloadedCodes.value = normalizeImageOcrLanguageCodes(response.languages);
  } catch (error) {
    downloadError.value = error instanceof Error
      ? `${error.message}。请检查网络后重试。`
      : '语言包下载失败，请检查网络后重试。';
  } finally {
    downloadingCodes.value = downloadingCodes.value.filter(code => !pending.includes(code));
  }
}

onMounted(() => {
  if (browserCapabilities.imageOcr) void refreshLanguageState().catch(() => undefined);
});
</script>

<style scoped src="./image-ocr-settings.css"></style>
