<!-- 文档页面归 app 层所有；WXT 入口只负责启动。 -->
<template>
  <div class="document-app" :class="{ dark: isDark }">
    <header class="document-header">
      <a class="document-brand" href="#" aria-label="流畅阅读文档翻译" @click.prevent="resetDocument">
        <img src="/icon/128.png" alt="" />
        <span>
          <strong>流畅阅读</strong>
          <small>FluentRead · 文档翻译 Beta</small>
        </span>
      </a>
      <span v-if="parsedDocument" class="document-status" :class="{ complete: hasTranslation }">
        <strong>{{ hasTranslation ? '已完成翻译' : '等待翻译' }}</strong>
        <span>{{ hasTranslation ? '✅' : 'Beta' }}</span>
      </span>
      <div class="header-actions">
        <span class="privacy-note"><i /> 文件只在当前浏览器中处理</span>
        <button class="ghost-button" type="button" @click="openSettings">翻译设置 ↗</button>
      </div>
    </header>

    <main class="document-main">
      <section v-if="!parsedDocument" class="landing-section">
        <div class="landing-copy">
          <span class="eyebrow">流畅阅读 · 文档翻译 Beta</span>
          <h1>把本地文件变成双语阅读体验</h1>
          <p>保留原有结构、时间轴和格式标记，在浏览器中完成翻译并下载结果。</p>
        </div>

        <div
          class="file-drop-zone"
          :class="{ dragging: isDragging }"
          role="button"
          tabindex="0"
          aria-label="打开文档文件"
          @click="openFilePicker"
          @keydown.enter.prevent="openFilePicker"
          @keydown.space.prevent="openFilePicker"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="handleDrop"
        >
          <input ref="fileInput" class="visually-hidden" type="file" :accept="accept" @change="handleFileInput" />
          <div class="format-list" aria-label="支持的文件格式">
            <div v-for="item in formatCards" :key="item.code" class="format-card">
              <span class="format-icon" :class="item.tone"><b>{{ item.code }}</b><i /></span>
              <span>{{ item.label }}</span>
            </div>
          </div>

          <button class="open-file-button" type="button" :disabled="openingFile" @click.stop="openFilePicker">
            {{ openingFile ? '正在解析文件…' : '打开文件' }}
          </button>
          <p>点击打开文件，或把本地文件拖到这里</p>
          <small>支持单个文件，最大 {{ maxFileSizeLabel }} · 文件不会上传到 FluentRead 服务器</small>
        </div>

        <p v-if="errorMessage" class="notice error" role="alert">{{ errorMessage }}</p>
      </section>

      <section v-else class="workspace-section">
        <div class="workspace-heading">
          <div class="file-heading">
            <span class="file-type-badge" :class="formatTone">{{ formatCode }}</span>
            <div>
              <h1>{{ parsedDocument.fileName }}</h1>
              <p>{{ parsedDocument.label }} · {{ parsedDocument.segments.length }} 个可翻译片段</p>
            </div>
          </div>
          <button class="ghost-button" type="button" :disabled="translating" @click="resetDocument">打开新文件</button>
        </div>

        <div class="control-panel">
          <label class="language-control">
            <span>源语言</span>
            <el-select
              v-model="config.from"
              class="document-control-select"
              :disabled="translating"
              :teleported="false"
              popper-class="document-select-popper"
              aria-label="文档源语言"
            >
              <el-option v-for="item in sourceLanguageOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </label>
          <span class="language-arrow" aria-hidden="true">→</span>
          <label class="language-control">
            <span>目标语言</span>
            <el-select
              v-model="config.to"
              class="document-control-select"
              :disabled="translating"
              :teleported="false"
              popper-class="document-select-popper"
              aria-label="文档目标语言"
            >
              <el-option v-for="item in options.to" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </label>
          <label class="service-control">
            <span>翻译服务</span>
            <el-select
              v-model="config.documentService"
              class="document-control-select"
              :disabled="translating"
              :teleported="false"
              popper-class="document-select-popper"
              aria-label="文档翻译服务"
            >
              <el-option
                v-if="documentServiceUnavailableMessage"
                label="Chrome内置AI翻译（当前浏览器不可用）"
                :value="config.documentService"
                disabled
              />
              <el-option v-for="item in serviceOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
          </label>
          <label v-if="documentUsesModel" class="model-control">
            <span>模型</span>
            <el-select
              v-model="selectedDocumentModel"
              class="document-control-select"
              :disabled="translating"
              :teleported="false"
              popper-class="document-select-popper"
              aria-label="文档翻译模型"
            >
              <el-option v-for="model in documentModelOptions" :key="model" :label="model" :value="model" />
            </el-select>
            <input
              v-if="selectedDocumentModel === customModelString"
              v-model="selectedDocumentCustomModel"
              :disabled="translating"
              type="text"
              placeholder="输入自定义模型名称"
              aria-label="文档自定义模型名称"
            />
          </label>
          <div v-else class="model-summary">
            <span>模型</span>
            <strong>当前服务无需模型</strong>
          </div>
          <div class="mode-control" role="group" aria-label="导出模式">
            <span>译文显示</span>
            <div class="mode-buttons">
              <button type="button" :class="{ selected: outputMode === 'bilingual' }" @click="outputMode = 'bilingual'">双语对照</button>
              <button type="button" :class="{ selected: outputMode === 'translated' }" @click="outputMode = 'translated'">仅译文</button>
            </div>
          </div>
          <button class="translate-document-button" type="button" :disabled="translating || !parsedDocument.segments.length || Boolean(documentServiceUnavailableMessage)" @click="startTranslation">
            <span v-if="translating" class="spinner" />
            <span>{{ translating ? `翻译中 ${progress}%` : hasTranslation ? '重新翻译' : '开始翻译' }}</span>
          </button>
          <button v-if="hasTranslation" class="download-button" type="button" :disabled="preparingDownload" @click="downloadDocument">
            {{ preparingDownload ? '正在生成文件…' : `下载${outputMode === 'bilingual' ? '双语' : '译文'}文件` }}
          </button>
        </div>

        <p v-if="credentialWarning" class="notice warning" role="alert">{{ credentialWarning }} <button type="button" @click="openSettings">去配置</button></p>
        <p v-if="errorMessage" class="notice error" role="alert">{{ errorMessage }}</p>

        <div v-if="translating || hasTranslation" class="progress-panel" :class="{ complete: hasTranslation && !translating }">
          <div class="progress-copy">
            <strong>{{ translating ? `正在翻译 ${parsedDocument.fileName}` : '翻译完成，可以编辑译文后下载' }}</strong>
            <span>{{ completedSegments }} / {{ parsedDocument.segments.length }} 个片段</span>
          </div>
          <div class="progress-track"><i :style="{ width: `${progress}%` }" /></div>
        </div>

        <div class="preview-heading">
          <div>
            <span class="eyebrow">{{ previewMeta.eyebrow }}</span>
            <h2>{{ previewMeta.title }}</h2>
          </div>
          <span class="preview-hint">{{ previewMeta.hint }}</span>
        </div>

        <section
          v-if="isPdfDocument"
          class="pdf-layout-viewer"
          aria-label="PDF 版式翻译预览"
          data-document-reader="pdf"
          :data-segment-count="parsedDocument.segments.length"
        >
          <div class="pdf-viewer-toolbar">
            <div class="pdf-page-summary" aria-label="PDF 连续页面阅读状态">
              <strong>{{ pdfPageCount }} 页</strong>
              <span>原文与译文已按页面纵向连续排列</span>
            </div>
            <label class="pdf-zoom-control">
              <span>缩放</span>
              <el-select
                v-model="pdfZoom"
                class="document-zoom-select"
                :teleported="false"
                popper-class="document-select-popper"
                aria-label="PDF 预览缩放"
              >
                <el-option label="75%" :value="0.75" />
                <el-option label="100%" :value="1" />
                <el-option label="125%" :value="1.25" />
                <el-option label="150%" :value="1.5" />
              </el-select>
            </label>
          </div>

          <div class="pdf-page-scroll" data-pdf-scroll>
            <article
              v-for="pdfPage in pdfPreviewPageStates"
              :key="pdfPage.pageNumber"
              class="pdf-page-row"
              :data-page-number="pdfPage.pageNumber"
            >
              <div class="pdf-page-row-heading">
                <strong>第 {{ pdfPage.pageNumber }} 页</strong>
                <span>{{ pdfPage.loading ? '正在渲染…' : '版式已保留' }}</span>
              </div>
              <div
                class="pdf-page-stage"
                :class="{ single: outputMode === 'translated' }"
                :style="{ '--pdf-page-min-width': `${400 * pdfZoom}px`, '--pdf-page-max-width': `${720 * pdfZoom}px` }"
              >
                <figure v-if="outputMode === 'bilingual'" class="pdf-page-column">
                  <figcaption><span>原文</span><strong>第 {{ pdfPage.pageNumber }} 页</strong></figcaption>
                  <div class="pdf-page-frame" :style="{ aspectRatio: `${pdfPage.width} / ${pdfPage.height}` }">
                    <img v-if="pdfPage.originalUrl" :src="pdfPage.originalUrl" :alt="`PDF 原文第 ${pdfPage.pageNumber} 页`" />
                    <span v-else class="pdf-page-loading">正在渲染原页…</span>
                  </div>
                </figure>
                <figure class="pdf-page-column translated">
                  <figcaption><span>译文</span><strong>保留原版式</strong></figcaption>
                  <div class="pdf-page-frame" :style="{ aspectRatio: `${pdfPage.width} / ${pdfPage.height}` }">
                    <img v-if="pdfPage.translatedUrl" :src="pdfPage.translatedUrl" :alt="`PDF 译文第 ${pdfPage.pageNumber} 页`" />
                    <div v-else class="pdf-page-pending">
                      <span v-if="pdfPage.loading || pdfPreviewLoading" class="spinner dark-spinner" />
                      <strong>{{ translating ? '正在翻译并重排本页' : '等待生成译页' }}</strong>
                      <small>译文会写回对应文本框，图表与页面布局保持原位</small>
                    </div>
                  </div>
                </figure>
              </div>

              <details v-if="pdfRowsForPage(pdfPage.pageNumber).length" class="pdf-proofreading">
                <summary>校对第 {{ pdfPage.pageNumber }} 页译文 <span>{{ pdfRowsForPage(pdfPage.pageNumber).length }} 个版面文本块</span></summary>
                <article v-for="row in pdfRowsForPage(pdfPage.pageNumber)" :key="row.index" class="pdf-proofreading-row">
                  <p class="document-source">{{ row.source }}</p>
                  <textarea
                    class="pdf-proofreading-translation document-translation"
                    :value="row.translation"
                    :aria-label="`PDF 第 ${pdfPage.pageNumber} 页第 ${row.index + 1} 个文本块译文`"
                    :disabled="!hasTranslation || translating"
                    @input="updateTranslation(row.index, $event)"
                  />
                </article>
              </details>
            </article>
            <div v-if="!pdfPreviewPageStates.length" class="pdf-page-empty">
              <span class="spinner dark-spinner" />
              <strong>正在准备 PDF 连续阅读页…</strong>
            </div>
          </div>
        </section>

        <section
          v-else-if="isRichDocument"
          class="rich-document-reader"
          :class="`reader-${parsedDocument.format}`"
          data-document-reader="rich"
          :data-segment-count="parsedDocument.segments.length"
          aria-label="排版文档双语阅读预览"
        >
          <nav v-if="isEpubDocument" class="reader-native-toolbar" aria-label="ePub 章节导航">
            <button
              v-for="(chapter, index) in epubChapters"
              :key="chapter.path"
              type="button"
              :class="{ selected: epubChapterIndex === index }"
              @click="epubChapterIndex = index"
            >
              <span>{{ index + 1 }}</span>{{ chapter.title }}
            </button>
          </nav>
          <iframe
            class="rich-preview-frame"
            :srcdoc="richPreviewHtml"
            sandbox=""
            :title="`${parsedDocument.label}排版阅读预览`"
          />
          <details class="native-proofreading">
            <summary>校对当前{{ isEpubDocument ? '章节' : '文档' }}译文 <span>{{ currentRichRows.length }} 个文本片段</span></summary>
            <article v-for="row in currentRichRows" :key="row.index" class="native-proofreading-row">
              <p class="document-source">{{ readerText(row.source) }}</p>
              <textarea
                class="document-translation"
                :value="row.translation"
                :placeholder="translating ? '等待翻译…' : '开始翻译后显示译文'"
                :aria-label="`第 ${row.index + 1} 个文本片段译文`"
                :disabled="!hasTranslation || translating"
                @input="updateTranslation(row.index, $event)"
              />
            </article>
          </details>
        </section>

        <section
          v-else-if="isDocxDocument"
          class="docx-document-reader"
          data-document-reader="docx"
          :data-segment-count="parsedDocument.segments.length"
          aria-label="Word 文档页面预览"
        >
          <nav class="reader-native-toolbar" aria-label="Word 文档部分">
            <button
              v-for="(part, index) in docxParts"
              :key="part.path"
              type="button"
              :class="{ selected: docxPartIndex === index }"
              @click="docxPartIndex = index"
            >
              {{ docxPartLabel(part.path) }}
            </button>
          </nav>
          <div class="docx-page-stage">
            <article class="docx-page">
              <span class="docx-page-label">{{ docxPartLabel(currentDocxPart?.path || '') }}</span>
              <section
                v-for="row in currentDocxRows"
                :key="row.index"
                class="docx-paragraph"
                :class="`docx-role-${row.role || 'paragraph'}`"
              >
                <p v-if="outputMode === 'bilingual'" class="docx-source document-source">{{ row.source }}</p>
                <textarea
                  class="docx-translation document-translation"
                  :value="row.translation"
                  :placeholder="translating ? '等待翻译…' : '开始翻译后显示译文'"
                  :aria-label="`Word 第 ${row.index + 1} 段译文`"
                  :disabled="!hasTranslation || translating"
                  @input="updateTranslation(row.index, $event)"
                />
              </section>
            </article>
          </div>
        </section>

        <section
          v-else-if="isSubtitleDocument"
          class="subtitle-document-reader"
          data-document-reader="subtitle"
          :data-segment-count="parsedDocument.segments.length"
          aria-label="字幕时间轴翻译表格"
        >
          <div class="subtitle-table-scroll">
            <table>
              <thead><tr><th>#</th><th>开始时间</th><th>结束时间</th><th>原文</th><th>译文（可编辑）</th></tr></thead>
              <tbody>
                <tr v-for="row in subtitleRows" :key="row.index">
                  <td class="subtitle-index">{{ row.index + 1 }}</td>
                  <td><time>{{ row.timeStart || '—' }}</time></td>
                  <td><time>{{ row.timeEnd || '—' }}</time></td>
                  <td><p class="subtitle-source document-source">{{ readerText(row.source) }}</p></td>
                  <td>
                    <textarea
                      class="subtitle-translation document-translation"
                      :value="row.translation"
                      :placeholder="translating ? '等待翻译…' : '开始翻译后显示译文'"
                      :aria-label="`第 ${row.index + 1} 条字幕译文`"
                      :disabled="!hasTranslation || translating"
                      @input="updateTranslation(row.index, $event)"
                    />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section
          v-else-if="isJsonDocument"
          class="json-document-reader"
          data-document-reader="json"
          :data-segment-count="parsedDocument.segments.length"
          aria-label="JSON 字符串路径翻译表格"
        >
          <div class="json-table-header"><span>JSONPath</span><span>原字符串</span><span>译文（可编辑）</span></div>
          <article v-for="row in jsonRows" :key="row.index" class="json-table-row">
            <code>{{ row.pathLabel || '$' }}</code>
            <p class="json-source document-source">{{ row.source }}</p>
            <textarea
              class="json-translation document-translation"
              :value="row.translation"
              :placeholder="translating ? '等待翻译…' : '开始翻译后显示译文'"
              :aria-label="`${row.pathLabel || '$'} 的译文`"
              :disabled="!hasTranslation || translating"
              @input="updateTranslation(row.index, $event)"
            />
          </article>
        </section>

        <div v-else class="document-reader" data-document-reader="generic" :data-segment-count="parsedDocument.segments.length" :class="`reader-${parsedDocument.format}`" aria-label="文档双语阅读预览">
          <article v-for="row in previewRows" :key="row.index" class="reader-block">
            <span v-if="row.contextLabel" class="reader-context">{{ row.contextLabel }}</span>
            <div v-if="outputMode === 'bilingual'" class="reader-source document-source" :class="readerSourceClass(row.source)">
              {{ readerText(row.source) }}
            </div>
            <textarea
              class="reader-translation document-translation"
              :value="row.translation"
              :placeholder="translating ? '等待翻译…' : '开始翻译后显示译文'"
              :aria-label="`第 ${row.index + 1} 段译文`"
              :disabled="!hasTranslation || translating"
              @input="updateTranslation(row.index, $event)"
            />
          </article>
        </div>
        <p v-if="!hasTranslation" class="reader-empty">
          {{ emptyReaderHint }}
        </p>
        <p v-if="showPreviewLimitNote" class="preview-more">当前展示前 {{ previewLimit }} 个片段，下载时会包含完整文件。</p>
      </section>
    </main>

    <footer class="document-footer">
      <span>流畅阅读文档翻译 Beta · PDF / ePub / HTML / JSON / TXT / DOCX / Markdown / 字幕</span>
      <a href="https://github.com/Bistutu/FluentRead" target="_blank" rel="noreferrer">开源项目 ↗</a>
    </footer>
  </div>
</template>

<script lang="ts" setup>
import {computed, onMounted, onUnmounted, reactive, ref, watch} from 'vue';
import browser from 'webextension-polyfill';
import {
  Config,
  DOCUMENT_MAX_BYTES,
  createDocumentDownload,
  createDocumentPreviewHtml,
  createPdfPagePreview,
  filterAvailableTranslationServices,
  formatDocumentReaderText,
  getDocumentAcceptAttribute,
  getDocumentEmptyReaderHint,
  getDocumentFormatTone,
  getDocumentFormat,
  getDocumentPreviewMeta,
  getDocumentReaderSourceClass,
  getDocxPartLabel as docxPartLabel,
  getMissingCredentialMessage,
  getTranslationServiceUnavailableMessage,
  isRichDocumentFormat,
  isSubtitleDocumentFormat,
  customModelString,
  configReady,
  models,
  options,
  parseDocument,
  parseDocumentFile,
  requestConfigSave,
  resolveConfiguredModel,
  runtimeConfig,
  saveConfig,
  servicesType,
  translateDocumentSegments,
  type DocumentRenderMode,
  type ParsedDocument,
} from '@/src/app/document-translation';

const PREVIEW_LIMIT = 80;

interface PdfPreviewPageState {
  pageNumber: number;
  width: number;
  height: number;
  originalUrl: string;
  translatedUrl: string;
  loading: boolean;
}

const config = reactive(new Config());
const fileInput = ref<HTMLInputElement | null>(null);
const parsedDocument = ref<ParsedDocument | null>(null);
const translatedSegments = ref<string[]>([]);
const outputMode = ref<DocumentRenderMode>('bilingual');
const isDragging = ref(false);
const translating = ref(false);
const progress = ref(0);
const errorMessage = ref('');
const openingFile = ref(false);
const preparingDownload = ref(false);
const pdfZoom = ref(1);
const pdfPreviewLoading = ref(false);
const pdfPreviewPageStates = ref<PdfPreviewPageState[]>([]);
const epubChapterIndex = ref(0);
const docxPartIndex = ref(0);
const hydrated = ref(false);
const colorSchemeMedia = window.matchMedia('(prefers-color-scheme: dark)');
const isDark = ref(colorSchemeMedia.matches);
let abortController: AbortController | null = null;
let translationRequestId = 0;
let lastSerialized = '';
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let pdfPreviewTimer: ReturnType<typeof setTimeout> | undefined;
let pdfPreviewRequest = 0;

const accept = getDocumentAcceptAttribute();
const maxFileSizeLabel = `${Math.round(DOCUMENT_MAX_BYTES / 1024 / 1024)} MB`;
const sourceLanguageOptions = [{value: 'auto', label: '自动检测'}, ...options.to];
const formatCards = [
  {code: 'PDF', label: 'pdf 文件', tone: 'coral'},
  {code: 'EPUB', label: 'ePub 电子书', tone: 'teal'},
  {code: 'HTML', label: 'html 文件', tone: 'coral'},
  {code: 'JSON', label: 'json 文件', tone: 'teal'},
  {code: 'TXT', label: 'txt 文件', tone: 'slate'},
  {code: 'DOCX', label: 'Word 文档', tone: 'slate'},
  {code: 'MD', label: 'markdown 文件', tone: 'sand'},
  {code: 'SUB', label: '各种字幕文件', tone: 'violet'},
];

const serviceOptions = computed(() => filterAvailableTranslationServices(options.services).filter((item: any) => !item.disabled));
const documentServiceUnavailableMessage = computed(() => getTranslationServiceUnavailableMessage(config.documentService));
const documentUsesModel = computed(() => servicesType.isUseModel(config.documentService));
const documentModelOptions = computed(() => models.get(config.documentService) || []);
const selectedDocumentModel = computed({
  get: () => config.documentModel[config.documentService] || documentModelOptions.value[0] || '',
  set: (value: string) => { config.documentModel[config.documentService] = value; },
});
const selectedDocumentCustomModel = computed({
  get: () => config.documentCustomModel[config.documentService] || '',
  set: (value: string) => { config.documentCustomModel[config.documentService] = value; },
});
const documentModelValue = computed(() => resolveConfiguredModel(selectedDocumentModel.value, selectedDocumentCustomModel.value));
const credentialWarning = computed(() => {
  if (documentServiceUnavailableMessage.value) return documentServiceUnavailableMessage.value;
  if (documentUsesModel.value && !documentModelValue.value.trim()) {
    return '文档翻译模型尚未配置，请先选择模型或填写自定义模型名称。';
  }

  const credentialConfig = {
    ...config,
    model: {...config.model, [config.documentService]: selectedDocumentModel.value},
    customModel: {...config.customModel, [config.documentService]: selectedDocumentCustomModel.value},
  };
  return getMissingCredentialMessage(config.documentService, credentialConfig);
});
const previewRows = computed(() => (parsedDocument.value?.segments || []).slice(0, PREVIEW_LIMIT).map((segment) => ({
  index: segment.id,
  source: segment.source,
  contextLabel: segment.contextLabel,
  timeStart: segment.timeStart,
  timeEnd: segment.timeEnd,
  pathLabel: segment.pathLabel,
  role: segment.role,
  translation: translatedSegments.value[segment.id] || '',
})));
const previewLimit = PREVIEW_LIMIT;
const hasMorePreviewRows = computed(() => Boolean(parsedDocument.value && parsedDocument.value.segments.length > PREVIEW_LIMIT));
const hasTranslation = computed(() => translatedSegments.value.some((item) => item.trim().length > 0));
const completedSegments = computed(() => translatedSegments.value.filter((item) => item !== undefined && item !== '').length);
const isPdfDocument = computed(() => parsedDocument.value?.binary?.kind === 'pdf');
const isEpubDocument = computed(() => parsedDocument.value?.binary?.kind === 'epub');
const isDocxDocument = computed(() => parsedDocument.value?.binary?.kind === 'docx');
const isSubtitleDocument = computed(() => isSubtitleDocumentFormat(parsedDocument.value?.format));
const isJsonDocument = computed(() => parsedDocument.value?.format === 'json');
const isRichDocument = computed(() => isRichDocumentFormat(parsedDocument.value?.format));
const pdfPageCount = computed(() => parsedDocument.value?.binary?.kind === 'pdf' ? parsedDocument.value.binary.pages.length : 0);
const pdfRowsForPage = (pageNumber: number) => {
  const document = parsedDocument.value;
  const page = document?.binary?.kind === 'pdf'
    ? document.binary.pages.find((entry) => entry.pageNumber === pageNumber)
    : undefined;
  if (!document || !page) return [];
  return page.segmentIndexes.map((index) => ({
    index,
    source: document.segments[index]?.source || '',
    translation: translatedSegments.value[index] || '',
  }));
};
const epubChapters = computed(() => parsedDocument.value?.binary?.kind === 'epub'
  ? parsedDocument.value.binary.chapters
  : []);
const currentEpubChapter = computed(() => epubChapters.value[epubChapterIndex.value]);
const richPreviewDocument = computed<ParsedDocument | null>(() => {
  const document = parsedDocument.value;
  if (!document) return null;
  if (document.binary?.kind === 'epub') {
    const chapter = currentEpubChapter.value;
    return chapter ? parseDocument('chapter.html', chapter.source) : null;
  }
  return ['html', 'markdown', 'txt'].includes(document.format) ? document : null;
});
const richPreviewTranslations = computed(() => {
  const chapter = currentEpubChapter.value;
  return chapter
    ? translatedSegments.value.slice(chapter.segmentOffset, chapter.segmentOffset + chapter.segmentCount)
    : translatedSegments.value;
});
const richPreviewHtml = computed(() => {
  const document = richPreviewDocument.value;
  if (!document) return '';
  return createDocumentPreviewHtml(
    document,
    richPreviewTranslations.value,
    hasTranslation.value ? outputMode.value : 'source',
  );
});
const currentRichRows = computed(() => {
  const document = parsedDocument.value;
  const chapter = currentEpubChapter.value;
  if (!document) return [];
  if (!chapter) return previewRows.value;
  return document.segments
    .slice(chapter.segmentOffset, chapter.segmentOffset + Math.min(chapter.segmentCount, PREVIEW_LIMIT))
    .map((segment) => ({
      index: segment.id,
      source: segment.source,
      translation: translatedSegments.value[segment.id] || '',
    }));
});
const docxParts = computed(() => parsedDocument.value?.binary?.kind === 'docx'
  ? parsedDocument.value.binary.parts
  : []);
const currentDocxPart = computed(() => docxParts.value[docxPartIndex.value]);
const currentDocxRows = computed(() => {
  const document = parsedDocument.value;
  const part = currentDocxPart.value;
  if (!document || !part) return [];
  return part.paragraphSegments.slice(0, PREVIEW_LIMIT).map(({segmentIndex}) => {
    const segment = document.segments[segmentIndex];
    return {
      index: segmentIndex,
      source: segment?.source || '',
      role: segment?.role,
      translation: translatedSegments.value[segmentIndex] || '',
    };
  });
});
const subtitleRows = computed(() => previewRows.value);
const jsonRows = computed(() => previewRows.value);
const previewMeta = computed(() => getDocumentPreviewMeta(parsedDocument.value));
const emptyReaderHint = computed(() => getDocumentEmptyReaderHint(parsedDocument.value));
const showPreviewLimitNote = computed(() => hasMorePreviewRows.value
  && (isSubtitleDocument.value || isJsonDocument.value || isDocxDocument.value));
const formatCode = computed(() => parsedDocument.value?.format.toUpperCase() || 'FILE');
const formatTone = computed(() => getDocumentFormatTone(parsedDocument.value?.format));

function pngObjectUrl(bytes: Uint8Array): string {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return URL.createObjectURL(new Blob([buffer], {type: 'image/png'}));
}

function clearPdfPreviewUrls(): void {
  pdfPreviewPageStates.value.forEach((page) => {
    if (page.originalUrl) URL.revokeObjectURL(page.originalUrl);
    if (page.translatedUrl) URL.revokeObjectURL(page.translatedUrl);
  });
  pdfPreviewPageStates.value = [];
}

async function refreshPdfPreviews(): Promise<void> {
  const document = parsedDocument.value;
  if (document?.binary?.kind !== 'pdf') {
    clearPdfPreviewUrls();
    return;
  }
  const request = ++pdfPreviewRequest;
  pdfPreviewLoading.value = true;

  const previousPages = new Map(pdfPreviewPageStates.value.map((page) => [page.pageNumber, page]));
  previousPages.forEach((page) => {
    if (page.translatedUrl) URL.revokeObjectURL(page.translatedUrl);
  });
  pdfPreviewPageStates.value = document.binary.pages.map((page) => {
    const previous = previousPages.get(page.pageNumber);
    return {
      pageNumber: page.pageNumber,
      width: page.width,
      height: page.height,
      // Reuse the original page while only the translated raster is changing.
      originalUrl: previous?.originalUrl || '',
      translatedUrl: '',
      loading: true,
    };
  });

  try {
    for (const page of document.binary.pages) {
      if (request !== pdfPreviewRequest) return;
      const preview = await createPdfPagePreview(
        document,
        page.pageNumber,
        hasTranslation.value ? translatedSegments.value : undefined,
      );
      if (request !== pdfPreviewRequest) return;
      const state = pdfPreviewPageStates.value.find((entry) => entry.pageNumber === page.pageNumber);
      if (!state) continue;
      if (!state.originalUrl) state.originalUrl = pngObjectUrl(preview.original);
      if (preview.translated) state.translatedUrl = pngObjectUrl(preview.translated);
      state.loading = false;
    }
  } catch (error) {
    if (request === pdfPreviewRequest) showError(error instanceof Error ? error.message : String(error));
  } finally {
    if (request === pdfPreviewRequest) pdfPreviewLoading.value = false;
  }
}

function schedulePdfPreview(): void {
  if (pdfPreviewTimer) clearTimeout(pdfPreviewTimer);
  pdfPreviewTimer = setTimeout(() => { void refreshPdfPreviews(); }, 350);
}

function readerText(value: string): string {
  return formatDocumentReaderText(parsedDocument.value?.format, value);
}

function readerSourceClass(value: string): string {
  return getDocumentReaderSourceClass(parsedDocument.value?.format, value);
}

function applyTheme(): void {
  isDark.value = colorSchemeMedia.matches;
}

async function hydrateConfig(): Promise<void> {
  await configReady;
  Object.assign(config, runtimeConfig);
  lastSerialized = JSON.stringify(config);
  hydrated.value = true;
}
void hydrateConfig();

watch(config, (value) => {
  if (!hydrated.value) return;
  const serialized = JSON.stringify(value);
  if (serialized === lastSerialized) return;
  lastSerialized = serialized;
  void requestConfigSave(value, browser.runtime.sendMessage.bind(browser.runtime)).catch((error) => {
    console.warn('[FluentRead] 保存文档翻译设置失败', error);
  });
}, {deep: true, flush: 'sync'});

watch(parsedDocument, () => {
  if (isPdfDocument.value) void refreshPdfPreviews();
}, {flush: 'post'});

watch(translatedSegments, () => {
  if (isPdfDocument.value) schedulePdfPreview();
}, {deep: true});

function openFilePicker(): void {
  fileInput.value?.click();
}

function showError(message: string): void {
  errorMessage.value = message;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { errorMessage.value = ''; }, 6000);
}

async function loadFile(file: File): Promise<void> {
  errorMessage.value = '';
  if (!getDocumentFormat(file.name)) {
    showError('暂不支持该文件格式，请选择 PDF、ePub、HTML、JSON、TXT、DOCX、Markdown 或字幕文件。');
    return;
  }
  if (file.size > DOCUMENT_MAX_BYTES) {
    showError(`文件大小超过 ${maxFileSizeLabel}，请先拆分文件后再翻译。`);
    return;
  }

  try {
    openingFile.value = true;
    const parsed = await parseDocumentFile(file);
    if (parsed.segments.length === 0) throw new Error('文件中没有找到可翻译的文本片段。');
    clearPdfPreviewUrls();
    parsedDocument.value = parsed;
    translatedSegments.value = [];
    outputMode.value = 'bilingual';
    pdfZoom.value = 1;
    epubChapterIndex.value = 0;
    docxPartIndex.value = 0;
    progress.value = 0;
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    openingFile.value = false;
  }
}

function handleFileInput(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) void loadFile(file);
  input.value = '';
}

function handleDrop(event: DragEvent): void {
  isDragging.value = false;
  const file = event.dataTransfer?.files?.[0];
  if (file) void loadFile(file);
}

function resetDocument(): void {
  translationRequestId += 1;
  abortController?.abort();
  abortController = null;
  translating.value = false;
  parsedDocument.value = null;
  translatedSegments.value = [];
  progress.value = 0;
  errorMessage.value = '';
  openingFile.value = false;
  preparingDownload.value = false;
  pdfZoom.value = 1;
  epubChapterIndex.value = 0;
  docxPartIndex.value = 0;
  pdfPreviewLoading.value = false;
  pdfPreviewRequest += 1;
  if (pdfPreviewTimer) clearTimeout(pdfPreviewTimer);
  clearPdfPreviewUrls();
}

async function startTranslation(): Promise<void> {
  const document = parsedDocument.value;
  if (!document || translating.value) return;
  if (credentialWarning.value) {
    showError(credentialWarning.value);
    return;
  }

  translating.value = true;
  progress.value = 0;
  errorMessage.value = '';
  const controller = new AbortController();
  const requestId = ++translationRequestId;
  abortController = controller;
  try {
    const result = await translateDocumentSegments(document.segments, {
      fileName: document.fileName,
      serviceOverride: config.documentService,
      modelOverride: documentUsesModel.value ? documentModelValue.value : undefined,
      sourceLanguage: config.from,
      targetLanguage: config.to,
      signal: controller.signal,
      onProgress: ({completed, total}) => {
        if (requestId !== translationRequestId || parsedDocument.value !== document) return;
        progress.value = total > 0 ? Math.round((completed / total) * 100) : 100;
        translatedSegments.value = translatedSegments.value.length === total
          ? translatedSegments.value
          : new Array<string>(total).fill('');
      },
    });
    if (requestId !== translationRequestId || parsedDocument.value !== document) return;
    translatedSegments.value = result;
    progress.value = 100;
  } catch (error) {
    if (requestId !== translationRequestId || parsedDocument.value !== document) return;
    if (controller.signal.aborted) {
      showError('文档翻译已取消。');
    } else {
      showError(error instanceof Error ? error.message : String(error));
    }
  } finally {
    if (requestId === translationRequestId) {
      translating.value = false;
      if (abortController === controller) abortController = null;
    }
  }
}

function updateTranslation(index: number, event: Event): void {
  translatedSegments.value[index] = (event.target as HTMLTextAreaElement).value;
}

async function downloadDocument(): Promise<void> {
  const document = parsedDocument.value;
  if (!document || !hasTranslation.value || preparingDownload.value) return;
  preparingDownload.value = true;
  errorMessage.value = '';
  try {
    const download = await createDocumentDownload(document, translatedSegments.value, outputMode.value);
    const blob = new Blob([download.data], {type: download.mimeType});
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = download.fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  } finally {
    preparingDownload.value = false;
  }
}

async function openSettings(): Promise<void> {
  await browser.tabs.create({url: `${browser.runtime.getURL('options.html')}#settings-services`});
}

onMounted(() => {
  colorSchemeMedia.addEventListener?.('change', applyTheme);
  window.addEventListener('pagehide', resetDocument);
});

onUnmounted(() => {
  translationRequestId += 1;
  abortController?.abort();
  void saveConfig(config).catch(() => undefined);
  if (noticeTimer) clearTimeout(noticeTimer);
  if (pdfPreviewTimer) clearTimeout(pdfPreviewTimer);
  clearPdfPreviewUrls();
  colorSchemeMedia.removeEventListener?.('change', applyTheme);
  window.removeEventListener('pagehide', resetDocument);
});
</script>
