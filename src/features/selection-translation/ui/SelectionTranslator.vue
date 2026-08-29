<template>
  <div v-show="showIndicator || showTooltip || noticeMessage || copySuccess" class="babelbox-selection-translator-root" :data-display-delay="selectionSettings.delay" @pointerdown.stop>
    <button v-if="showIndicator && !showTooltip" class="babelbox-selection-indicator" :class="`babelbox-selection-indicator--${triggerMode}`" :style="indicatorStyle" type="button" aria-label="打开划词翻译" title="打开划词翻译" @pointerdown.prevent.stop @click="openTooltip">
      <ArrowUpRight class="babelbox-selection-indicator-glyph" aria-hidden="true" />
    </button>

    <section v-if="showTooltip" ref="tooltip-ref" class="babelbox-translation-tooltip" :class="{ 'babelbox-dark-theme': isDarkTheme }" :data-placement="popupPlacement" :style="tooltipStyle" role="dialog" aria-label="划词翻译结果" @pointerdown.stop>
      <header class="babelbox-tooltip-header">
        <div class="babelbox-tooltip-title"><span>{{ isWordSelection ? '单词学习卡' : '翻译结果' }}</span><small>BabelBox</small></div>
        <div class="babelbox-tooltip-actions">
          <button
            v-if="config.vocabularyBookEnabled && isWordSelection && !isPrivateContext"
            class="babelbox-action-btn babelbox-vocabulary-btn"
            :class="{ 'babelbox-saved': isVocabularySaved }"
            type="button"
            :disabled="vocabularyBusy || !vocabularyAnswer"
            :title="vocabularyButtonTitle"
            :aria-label="vocabularyButtonTitle"
            :aria-pressed="isVocabularySaved"
            @click="saveVocabularyEntry"
          ><Star aria-hidden="true" /></button>
          <button class="babelbox-action-btn" type="button" title="复制译文" aria-label="复制译文" @click="copyTranslation"><Copy aria-hidden="true" /></button>
          <button class="babelbox-close-btn" type="button" title="关闭" aria-label="关闭翻译结果" @click="closeTooltip"><X aria-hidden="true" /></button>
        </div>
      </header>

      <div class="babelbox-tooltip-content" aria-live="polite">
        <div v-if="isLoading && !translationResult && !wordCard && !wordCardError" class="babelbox-loading-state"><span :class="['babelbox-loading-spinner', { 'babelbox-static': !usesAnimatedEffects(config.animationMode) }]" aria-hidden="true" /><span>正在查询…</span></div>
        <div v-else-if="error && !translationResult && !wordCard" class="babelbox-error-state"><span>{{ error }}</span><button type="button" @click="retryTranslation">重试</button></div>
        <div v-else class="babelbox-translation-container">
          <section v-if="isWordSelection && (wordCard || isWordCardLoading)" class="babelbox-word-learning-card" aria-label="单词学习卡">
            <div v-if="isWordCardLoading && !wordCard" class="babelbox-word-card-loading"><span :class="['babelbox-loading-spinner', { 'babelbox-static': !usesAnimatedEffects(config.animationMode) }]" aria-hidden="true" /><span>正在查词…</span></div>
            <template v-else-if="wordCard">
              <div class="babelbox-word-heading">
                <div>
                  <h3>{{ selectedText }}</h3>
                  <span class="babelbox-word-normalized" v-if="selectedText.toLowerCase() !== wordCard.normalizedWord">词典词形：{{ wordCard.word }}</span>
                </div>
                <button v-if="wordCard.phonetics.length === 0" class="babelbox-text-audio-btn babelbox-word-heading-audio" type="button" :aria-label="wordAudioLabel({ text: wordCard.word })" :title="wordAudioLabel({ text: wordCard.word })" @click="toggleWordAudio({ text: wordCard.word })">
                  <Volume2 aria-hidden="true" />
                </button>
              </div>
              <div v-if="wordCard.phonetics.length > 0" class="babelbox-word-pronunciations" aria-label="发音">
                <div v-for="(pronunciation, index) in wordCard.phonetics.slice(0, 4)" :key="`${pronunciation.text || ''}-${pronunciation.audio || ''}-${index}`" class="babelbox-word-pronunciation">
                  <span class="babelbox-word-pronunciation-label">{{ pronunciation.label || (index === 0 ? '发音' : '变体') }}</span>
                  <span class="babelbox-word-ipa">{{ pronunciation.text || '点击播放' }}</span>
                  <button class="babelbox-text-audio-btn" type="button" :aria-label="wordAudioLabel(pronunciation)" :title="wordAudioLabel(pronunciation)" @click="toggleWordAudio(pronunciation)">
                    <Pause v-if="isCurrentWordAudio(pronunciation)" aria-hidden="true" />
                    <Volume2 v-else aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div v-if="translationResult" class="babelbox-word-translation"><span class="babelbox-text-label">译文</span><pre>{{ translationResult }}</pre></div>
              <div v-else-if="isLoading" class="babelbox-word-translation-loading">正在翻译释义…</div>
              <div v-if="wordCard.meanings.length > 0" class="babelbox-word-meaning-toolbar">
                <span>英文释义 · 中文辅助</span>
                <button type="button" @click="showChineseSupport = !showChineseSupport">{{ showChineseSupport ? '隐藏中文辅助' : '显示中文辅助' }}</button>
              </div>
              <div v-if="wordCard.meanings.length > 0" class="babelbox-word-meanings">
                <div v-for="meaning in wordCard.meanings.slice(0, 4)" :key="meaning.partOfSpeech" class="babelbox-word-meaning">
                  <strong>{{ meaning.partOfSpeech }}</strong>
                  <ol>
                    <li v-for="definition in meaning.definitions.slice(0, 4)" :key="`${meaning.partOfSpeech}-${definition.definition}`">
                      <span class="babelbox-word-definition-en">{{ definition.definition }}</span>
                      <span v-if="showChineseSupport && definition.translatedDefinition && definition.translatedDefinition !== definition.definition" class="babelbox-word-definition-zh">{{ definition.translatedDefinition }}</span>
                      <em v-if="definition.example">
                        <span class="babelbox-word-example-en">例句：{{ definition.example }}</span>
                        <span v-if="showChineseSupport && definition.translatedExample && definition.translatedExample !== definition.example" class="babelbox-word-example-zh">译：{{ definition.translatedExample }}</span>
                      </em>
                    </li>
                  </ol>
                </div>
              </div>
              <div v-else class="babelbox-word-empty">暂未找到详细释义，可查看译文。</div>
              <footer class="babelbox-word-card-footer">
                <span>数据来自开放词典</span>
                <a v-for="source in wordCard.sources" :key="source.id" :href="source.url" target="_blank" rel="noreferrer">{{ source.label }}</a>
              </footer>
            </template>
          </section>
          <div v-if="isWordSelection && wordCardError" class="babelbox-word-fallback-note">{{ wordCardError }}，已保留普通翻译。</div>
          <div v-if="selectionSettings.mode === 'bilingual' && !isWordCardVisible" class="babelbox-text-block babelbox-original-text">
            <div class="babelbox-text-label">原文</div><pre>{{ selectedText }}</pre>
            <button class="babelbox-text-audio-btn" type="button" :aria-label="audioLabel('source')" :title="audioLabel('source')" @click="toggleAudio(selectedText, 'source')">
              <Pause v-if="isCurrentAudio('source')" aria-hidden="true" />
              <Volume2 v-else aria-hidden="true" />
            </button>
          </div>
          <div v-if="(selectionSettings.mode === 'bilingual' || selectionSettings.mode === 'translation-only') && !isWordCardVisible" class="babelbox-text-block babelbox-translation-result">
            <div class="babelbox-text-label">译文</div><pre>{{ translationResult }}</pre>
            <button class="babelbox-text-audio-btn" type="button" :aria-label="audioLabel('translation')" :title="audioLabel('translation')" @click="toggleAudio(translationResult, 'translation')">
              <Pause v-if="isCurrentAudio('translation')" aria-hidden="true" />
              <Volume2 v-else aria-hidden="true" />
            </button>
          </div>
          <div v-if="error && (translationResult || wordCard)" class="babelbox-inline-error"><span>{{ error }}</span><button type="button" @click="retryTranslation">重试</button></div>
          <div v-if="isPlaying" class="babelbox-playing-status"><span>正在播放{{ currentAudioKind === 'source' ? '原文' : currentAudioKind === 'word' ? '单词' : '译文' }}</span><button type="button" aria-label="停止播放" title="停止播放" @click="stopAudioFromUi">停止</button></div>
        </div>
      </div>
    </section>

    <div v-if="noticeMessage" class="babelbox-action-toast" :class="{ 'babelbox-dark-theme': isDarkTheme }" role="status"><span>{{ noticeMessage }}</span><button v-if="noticeAction === 'open-vocabulary'" type="button" @click="openVocabularyBook">查看</button></div>
    <div v-else-if="copySuccess" class="babelbox-copy-success-toast" :class="{ 'babelbox-dark-theme': isDarkTheme }" role="status">已复制译文</div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue';
import { ArrowUpRight, Copy, Pause, Star, Volume2, X } from '@lucide/vue';
import {browser} from 'wxt/browser';
import { config, subscribeConfig } from '@/src/services/config/store';
import {resolvesToDarkTheme} from '@/src/ui/theme/theme';
import {usesAnimatedEffects} from '@/src/core/config/animation';
import {translateText} from '@/src/services/translation/client';
import { detectlang } from '@/src/core/language/detect';
import { matchesConfiguredHotkey, matchesModifierOnlyHotkey, resolveConfiguredHotkey } from '@/src/core/hotkey';
import { isSingleEnglishWord, normalizeEnglishWord, type WordCardData, type WordPronunciation } from '@/src/features/selection-translation/services/wordDictionary';
import { calculateSelectionPopupPosition, chooseSelectionRect, getSelectionPresentationDelayRemaining, isSameLanguage, normalizeSelectionText, normalizeSpeechLanguage, reconcileSelectionPresentation, resolveSelectionDictionaryFallback, resolveSelectionVocabularyAnswer, SelectionRequestTokenGate, shouldIgnoreSelection, summarizeSelectionContext, type SelectionAnswerCandidate, type SelectionContentRequest, type SelectionRect } from '@/src/features/selection-translation/core';
import {
  createSelectionTtsClientRequestId,
} from '@/src/features/selection-translation/protocol';
import { createSelectionTtsContentController } from '@/src/features/selection-translation/content/selectionTtsContentController';
import { VOCABULARY_BOOK_CHANGED_MESSAGE, VOCABULARY_BOOK_MESSAGE, type VocabularyBookResponse } from '@/src/features/vocabulary/protocol';
import {getTranslationServiceModel} from '@/src/core/config/translationServices';

type SelectionTrigger = 'direct' | 'icon' | 'dot' | 'shortcut';
type AudioKind = 'source' | 'translation' | 'word';
interface SelectionSnapshot { text: string; range: Range; anchor: SelectionRect; isForward: boolean; }

const tooltipRef = useTemplateRef<HTMLElement>('tooltip-ref');
const selectedText = ref('');
const activeContentRequest = ref<SelectionContentRequest | null>(null);
const translationAnswer = ref<SelectionAnswerCandidate | null>(null);
const dictionaryAnswer = ref<SelectionAnswerCandidate | null>(null);
const translationResult = ref('');
const isLoading = ref(false);
const error = ref('');
const showIndicator = ref(false);
const showTooltip = ref(false);
const copySuccess = ref(false);
const isDarkTheme = ref(false);
const indicatorStyle = ref<Record<string, string>>({});
const tooltipStyle = ref<Record<string, string>>({});
const popupPlacement = ref<'top' | 'bottom'>('top');
const snapshot = ref<SelectionSnapshot | null>(null);
const isPlaying = ref(false);
const currentAudioKind = ref<AudioKind | null>(null);
const currentAudioText = ref('');
const currentAudioKey = ref('');
const wordCard = ref<WordCardData | null>(null);
const isWordCardLoading = ref(false);
const wordCardError = ref('');
const showChineseSupport = ref(true);
const noticeMessage = ref('');
const noticeAction = ref<'open-vocabulary' | null>(null);
const isVocabularySaved = ref(false);
const vocabularyBusy = ref(false);

let selectionFrame: number | null = null;
let positionFrame: number | null = null;
let selectionLossTimer: number | null = null;
let selectionPresentationTimer: number | null = null;
let selectionPresentationVersion = 0;
let selectionSettledAt = 0;
let pendingSelectionPresentation: 'indicator' | 'tooltip' | null = null;
let translationAbortController: AbortController | null = null;
let translationRequestId = 0;
let wordLookupRequestId = 0;
let copyTimer: number | null = null;
const vocabularyLookupGate = new SelectionRequestTokenGate();
const vocabularySaveGate = new SelectionRequestTokenGate();
let contentRequestGeneration = 0;
let noticeTimer: number | null = null;
let lastTrustedSelectionInteractionAt = 0;
const TRUSTED_SELECTION_INTERACTION_GRACE_MS = 1_500;
let audio: HTMLAudioElement | null = null;
let audioUrl = '';
let utterance: SpeechSynthesisUtterance | null = null;
const ttsContentController = createSelectionTtsContentController({
  createClientRequestId: createSelectionTtsClientRequestId,
  stopRemote: (clientRequestId) => browser.runtime.sendMessage({
    type: 'selectionTtsStop',
    clientRequestId,
  }),
});
let isSelecting = false;
let pendingSelectionShortcutUntil = 0;
let selectionShortcutHeld = false;
let uiPointerInteraction = false;
let suppressSelectionUntil = 0;
let systemThemeMedia: MediaQueryList | null = null;
let unsubscribeConfig: (() => void) | null = null;
let tooltipResizeObserver: ResizeObserver | null = null;
const selectionConfigVersion = ref(0);

const selectionShortcutTriggers = new Set(['Control', 'Alt', 'Shift', 'custom']);
const selectionSettings = computed(() => {
  // `config` is shared with the content-script runtime and is mutated outside
  // Vue. Keep a local reactive version so Popup/Options changes refresh the
  // active selection UI without requiring a page reload.
  selectionConfigVersion.value;
  return {
    trigger: config.selectionTranslatorTrigger,
    customHotkey: config.customSelectionTranslatorHotkey,
    delay: config.selectionTranslatorDelay,
    mode: config.selectionTranslatorMode,
    theme: config.theme,
    from: config.from,
    to: config.to,
    service: config.service,
    model: getTranslationServiceModel(config, config.service),
  };
});
const selectionShortcutConfig = computed(() => selectionShortcutTriggers.has(selectionSettings.value.trigger)
  ? selectionSettings.value.trigger
  : 'none');
const selectionShortcut = computed(() => {
  const resolved = resolveConfiguredHotkey(selectionShortcutConfig.value, selectionSettings.value.customHotkey);
  return resolved === 'none' ? '' : resolved;
});
const triggerMode = computed<SelectionTrigger>(() => {
  if (selectionShortcut.value) return 'shortcut';
  if (selectionSettings.value.trigger === 'direct' || selectionSettings.value.trigger === 'dot') return selectionSettings.value.trigger;
  return 'icon';
});
const UI_SELECTION_SUPPRESSION_MS = 350;
const SELECTION_LOSS_GRACE_MS = 160;
const PENDING_SELECTION_SHORTCUT_MS = 250;

const selectedWord = computed(() => normalizeEnglishWord(selectedText.value));
const isWordSelection = computed(() => Boolean(selectedWord.value) && (selectionSettings.value.from === 'auto' || /^en(?:-|$)/i.test(selectionSettings.value.from)));
const isWordCardVisible = computed(() => isWordSelection.value && wordCard.value !== null);
const isPrivateContext = browser.extension.inIncognitoContext === true;
const currentContentRequest = computed<SelectionContentRequest | null>(() => {
  const request = activeContentRequest.value;
  if (!request || snapshot.value?.text !== request.text || selectedText.value !== request.text || config.to !== request.targetLanguage) return null;
  return request;
});
const vocabularyAnswer = computed(() => resolveSelectionVocabularyAnswer(currentContentRequest.value, translationAnswer.value, dictionaryAnswer.value));
const vocabularyButtonTitle = computed(() => {
  if (vocabularyBusy.value) return '正在保存到单词本';
  if (!vocabularyAnswer.value) return '译文准备完成后可收藏';
  if (isVocabularySaved.value) return '已收藏；再次点击更新当前阅读上下文';
  return '收藏到单词本';
});

function updateTheme(): void {
  isDarkTheme.value = resolvesToDarkTheme(
    config.theme,
    systemThemeMedia?.matches ?? window.matchMedia('(prefers-color-scheme: dark)').matches,
  );
}

function toSelectionRect(rect: DOMRect | DOMRectReadOnly): SelectionRect {
  return { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left, width: rect.width, height: rect.height };
}

function isExtensionSelection(selection: Selection): boolean {
  const host = document.getElementById('babelbox-selection-translator-container');
  return Boolean(host && selection.containsNode(host, true));
}

function readSelectionSnapshot(): SelectionSnapshot | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || isExtensionSelection(selection)) return null;
  const text = normalizeSelectionText(selection.toString());
  if (!text || text.length > 4096) return null;

  const range = selection.getRangeAt(0).cloneRange();
  if (shouldIgnoreSelection(range)) return null;
  const rects = Array.from(range.getClientRects()).map(toSelectionRect).filter(rect => rect.width > 0 || rect.height > 0);
  const visualRects = rects.length > 0 ? rects : [toSelectionRect(range.getBoundingClientRect())];
  const isForward = selection.anchorNode === range.startContainer && selection.anchorOffset === range.startOffset;
  const anchor = chooseSelectionRect(visualRects, isForward);
  if (!anchor || (anchor.width === 0 && anchor.height === 0)) return null;
  return { text, range, anchor, isForward };
}

function scheduleSelectionRead(shortcutTriggered = false): void {
  if (shortcutTriggered) pendingSelectionShortcutUntil = performance.now() + PENDING_SELECTION_SHORTCUT_MS;
  if (isSelecting || isSelectionReadSuppressed()) return;
  if (selectionFrame !== null) return;
  selectionFrame = window.requestAnimationFrame(() => {
    selectionFrame = null;
    const shouldTriggerShortcut = pendingSelectionShortcutUntil >= performance.now();
    pendingSelectionShortcutUntil = 0;
    if (!isSelecting && !isSelectionReadSuppressed()) applySelection(readSelectionSnapshot(), shouldTriggerShortcut);
  });
}

function suppressSelectionRead(duration = UI_SELECTION_SUPPRESSION_MS): void {
  suppressSelectionUntil = Math.max(suppressSelectionUntil, performance.now() + duration);
  if (selectionFrame !== null) {
    window.cancelAnimationFrame(selectionFrame);
    selectionFrame = null;
  }
}

function isSelectionReadSuppressed(): boolean {
  return uiPointerInteraction || performance.now() < suppressSelectionUntil;
}

function isSelectionInTargetLanguage(text: string): boolean {
  return isSameLanguage(detectlang(text), config.to);
}

function isSameSelection(left: SelectionSnapshot | null, right: SelectionSnapshot): boolean {
  if (!left || left.text !== right.text) return false;
  return left.range.startContainer === right.range.startContainer
    && left.range.startOffset === right.range.startOffset
    && left.range.endContainer === right.range.endContainer
    && left.range.endOffset === right.range.endOffset;
}

function cancelSelectionLoss(): void {
  if (selectionLossTimer === null) return;
  window.clearTimeout(selectionLossTimer);
  selectionLossTimer = null;
}

function cancelSelectionPresentation(): void {
  if (selectionPresentationTimer !== null) {
    window.clearTimeout(selectionPresentationTimer);
    selectionPresentationTimer = null;
  }
  pendingSelectionPresentation = null;
  selectionPresentationVersion += 1;
}

function resetSelectionContentState(clearSelectionText = false): void {
  translationRequestId += 1;
  translationAbortController?.abort();
  translationAbortController = null;
  wordLookupRequestId += 1;
  isLoading.value = false;
  activeContentRequest.value = null;
  translationAnswer.value = null;
  dictionaryAnswer.value = null;
  translationResult.value = '';
  error.value = '';
  wordCard.value = null;
  isWordCardLoading.value = false;
  wordCardError.value = '';
  showChineseSupport.value = true;
  vocabularyLookupGate.invalidate();
  vocabularySaveGate.invalidate();
  isVocabularySaved.value = false;
  vocabularyBusy.value = false;
  if (clearSelectionText) selectedText.value = '';
  stopAudio();
}

function revealSelectionPresentation(
  presentation: 'indicator' | 'tooltip',
  expectedVersion: number,
): void {
  if (expectedVersion !== selectionPresentationVersion
    || pendingSelectionPresentation !== presentation
    || !snapshot.value) return;

  const expectedSelection = snapshot.value;
  const currentSelection = readSelectionSnapshot();
  if (!currentSelection) { hideAll(); return; }
  if (!isSameSelection(expectedSelection, currentSelection)) {
    applySelection(currentSelection);
    return;
  }

  snapshot.value = currentSelection;
  pendingSelectionPresentation = null;
  if (presentation === 'tooltip') {
    openTooltip();
    return;
  }
  showIndicator.value = true;
  showTooltip.value = false;
  updatePosition(false);
}

function scheduleSelectionPresentation(presentation: 'indicator' | 'tooltip'): void {
  if (!snapshot.value) return;
  if (selectionPresentationTimer !== null) {
    window.clearTimeout(selectionPresentationTimer);
    selectionPresentationTimer = null;
  }
  pendingSelectionPresentation = presentation;
  const expectedVersion = ++selectionPresentationVersion;
  const remaining = getSelectionPresentationDelayRemaining(
    selectionSettings.value.delay,
    selectionSettledAt,
    performance.now(),
  );
  if (remaining === 0) {
    revealSelectionPresentation(presentation, expectedVersion);
    return;
  }
  selectionPresentationTimer = window.setTimeout(() => {
    selectionPresentationTimer = null;
    revealSelectionPresentation(presentation, expectedVersion);
  }, remaining);
}

function scheduleSelectionLoss(): void {
  if (!snapshot.value) return;
  if (selectionLossTimer !== null) return;
  selectionLossTimer = window.setTimeout(() => {
    selectionLossTimer = null;
    if (isSelecting || isSelectionReadSuppressed()) return;
    const recoveredSelection = readSelectionSnapshot();
    if (recoveredSelection) {
      applySelection(recoveredSelection);
      return;
    }
    hideAll();
  }, SELECTION_LOSS_GRACE_MS);
}

function applySelection(next: SelectionSnapshot | null, shortcutTriggered = false): void {
  if (!next) {
    if (!isSelecting) scheduleSelectionLoss();
    return;
  }
  cancelSelectionLoss();
  if (isSameSelection(snapshot.value, next)) {
    if (shortcutTriggered) scheduleSelectionPresentation('tooltip');
    return;
  }
  if (isSelectionInTargetLanguage(next.text)) { hideAll(); return; }
  cancelSelectionPresentation();
  selectionSettledAt = performance.now();
  resetSelectionContentState();
  snapshot.value = next;
  selectedText.value = next.text;
  const waitingForShortcut = triggerMode.value === 'shortcut' && Boolean(selectionShortcut.value) && !shortcutTriggered;
  showIndicator.value = false;
  showTooltip.value = false;
  updatePosition(false);
  if (waitingForShortcut) return;
  scheduleSelectionPresentation(shortcutTriggered || triggerMode.value === 'direct' ? 'tooltip' : 'indicator');
}

function updatePosition(refreshSelection = true): void {
  const current = snapshot.value;
  if (!current) return;
  const rects = refreshSelection
    ? Array.from(current.range.getClientRects()).map(toSelectionRect).filter(rect => rect.width > 0 || rect.height > 0)
    : [];
  const anchor = refreshSelection
    ? chooseSelectionRect(rects.length > 0 ? rects : [current.anchor], current.isForward)
    : current.anchor;
  if (!anchor) return;
  current.anchor = anchor;
  indicatorStyle.value = { left: `${anchor.right}px`, top: `${anchor.bottom}px` };
  if (showTooltip.value) void nextTick(() => {
    const tooltip = tooltipRef.value;
    if (!tooltip || !snapshot.value) return;
    const rect = tooltip.getBoundingClientRect();
    const position = calculateSelectionPopupPosition(snapshot.value.anchor, { width: rect.width, height: rect.height }, { width: window.innerWidth, height: window.innerHeight });
    tooltipStyle.value = { left: `${position.left}px`, top: `${position.top}px`, visibility: 'visible' };
    popupPlacement.value = position.placement;
  });
}

function schedulePositionUpdate(): void {
  if (!showIndicator.value && !showTooltip.value) return;
  if (positionFrame !== null) return;
  positionFrame = window.requestAnimationFrame(() => { positionFrame = null; updatePosition(); });
}

function openTooltip(): void {
  if (!snapshot.value || isSelectionInTargetLanguage(snapshot.value.text)) { hideAll(); return; }
  cancelSelectionPresentation();
  const wasVisible = showTooltip.value;
  showIndicator.value = true;
  showTooltip.value = true;
  if (!wasVisible) tooltipStyle.value = { visibility: 'hidden' };
  if (!wasVisible || error.value) void requestSelectionContent(snapshot.value.text);
  schedulePositionUpdate();
}

function shouldUseWordCard(text: string): boolean {
  return isSingleEnglishWord(text) && (config.from === 'auto' || /^en(?:-|$)/i.test(config.from));
}

function beginSelectionContentRequest(text: string): SelectionContentRequest {
  resetSelectionContentState();
  const request = { text, targetLanguage: config.to, generation: ++contentRequestGeneration };
  activeContentRequest.value = request;
  return request;
}

function isContentRequestCurrent(request: SelectionContentRequest): boolean {
  const current = currentContentRequest.value;
  return Boolean(current && current.generation === request.generation && current.text === request.text && current.targetLanguage === request.targetLanguage);
}

function dictionaryDefinitions(card: WordCardData, targetLanguage: string): string {
  return resolveSelectionDictionaryFallback(targetLanguage, card.meanings.flatMap(meaning => meaning.definitions).map(definition => definition.translatedDefinition));
}

function requestSelectionContent(text: string): void {
  const request = beginSelectionContentRequest(text);
  void requestTranslation(request);
  if (shouldUseWordCard(text)) {
    void requestWordCard(request);
    void refreshVocabularySaved(request);
  }
  else {
    wordLookupRequestId += 1;
    wordCard.value = null;
    isWordCardLoading.value = false;
    wordCardError.value = '';
    dictionaryAnswer.value = null;
    isVocabularySaved.value = false;
    vocabularyBusy.value = false;
  }
}

async function refreshVocabularySaved(request: SelectionContentRequest): Promise<void> {
  const word = normalizeEnglishWord(request.text);
  if (!word || !config.vocabularyBookEnabled || isPrivateContext) {
    vocabularyLookupGate.invalidate();
    isVocabularySaved.value = false;
    return;
  }
  const requestToken = vocabularyLookupGate.begin();
  try {
    const response = await browser.runtime.sendMessage({type: VOCABULARY_BOOK_MESSAGE, action: 'getByTerm', term: word, sourceLanguage: 'en'}) as VocabularyBookResponse<unknown | null>;
    if (!vocabularyLookupGate.isCurrent(requestToken) || !isContentRequestCurrent(request)) return;
    isVocabularySaved.value = response?.success === true && Boolean(response.data);
  } catch {
    if (vocabularyLookupGate.isCurrent(requestToken)) isVocabularySaved.value = false;
  }
}

function selectionContextText(): string {
  const range = snapshot.value?.range;
  if (!range) return '';
  const boundary = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement;
  const prose = boundary?.closest('p, li, blockquote, dd, dt, figcaption, article') || boundary?.parentElement;
  let selectedIndex: number | undefined;
  if (prose?.contains(range.startContainer)) {
    try {
      const prefix = document.createRange();
      prefix.selectNodeContents(prose);
      prefix.setEnd(range.startContainer, range.startOffset);
      selectedIndex = prefix.toString().replace(/\s+/gu, ' ').trimStart().length;
    } catch { selectedIndex = undefined; }
  }
  return summarizeSelectionContext(prose?.textContent || '', selectedText.value, 500, selectedIndex);
}

function pageSourceUrl(): string {
  try {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch { return ''; }
}

async function saveVocabularyEntry(event: MouseEvent): Promise<void> {
  if (!event.isTrusted) return;
  const contentRequest = currentContentRequest.value;
  const answer = vocabularyAnswer.value;
  if (!contentRequest || !selectedWord.value || !answer || vocabularyBusy.value || isPrivateContext) return;
  const wasSaved = isVocabularySaved.value;
  vocabularyBusy.value = true;
  const requestToken = vocabularySaveGate.begin();
  try {
    const response = await browser.runtime.sendMessage({
      type: VOCABULARY_BOOK_MESSAGE,
      action: 'upsert',
      input: {
        term: contentRequest.text,
        sourceLanguage: 'en',
        targetLanguage: contentRequest.targetLanguage,
        translation: answer,
        phonetic: wordCard.value?.phonetics.find(item => item.text)?.text || '',
        partOfSpeech: wordCard.value?.meanings.map(meaning => meaning.partOfSpeech) || [],
        context: {text: selectionContextText(), sourceUrl: pageSourceUrl(), pageTitle: document.title, capturedAt: Date.now()},
      },
    }) as VocabularyBookResponse<unknown>;
    if (!vocabularySaveGate.isCurrent(requestToken) || !isContentRequestCurrent(contentRequest)) return;
    if (!response?.success || !response.data) throw new Error(response?.success ? '保存失败' : response?.error?.message || '保存失败');
    isVocabularySaved.value = true;
    showNotice(wasSaved ? '已更新当前阅读上下文' : '已加入单词本', 'open-vocabulary');
  } catch (cause) {
    if (vocabularySaveGate.isCurrent(requestToken)) showNotice(cause instanceof Error ? `保存失败：${cause.message}` : '保存失败，未写入单词本');
  } finally {
    if (vocabularySaveGate.isCurrent(requestToken)) vocabularyBusy.value = false;
  }
}

function showNotice(message: string, action: 'open-vocabulary' | null = null): void {
  noticeMessage.value = message;
  noticeAction.value = action;
  if (noticeTimer !== null) window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => { noticeMessage.value = ''; noticeAction.value = null; }, 2600);
}

function openVocabularyBook(): void {
  void browser.runtime.sendMessage({type: 'openOptionsPage', section: 'settings-vocabulary'});
  noticeMessage.value = '';
  noticeAction.value = null;
}

async function requestTranslation(request: SelectionContentRequest): Promise<void> {
  const text = request.text;
  translationAbortController?.abort();
  const controller = new AbortController();
  translationAbortController = controller;
  const requestId = ++translationRequestId;
  isLoading.value = true;
  error.value = '';
  try {
    const result = await translateText(text, document.title, { signal: controller.signal, targetLanguage: request.targetLanguage });
    if (requestId !== translationRequestId || !isContentRequestCurrent(request)) return;
    translationResult.value = result;
    translationAnswer.value = {...request, answer: result};
  } catch (cause) {
    if (requestId !== translationRequestId || !isContentRequestCurrent(request)) return;
    if (cause instanceof Error && cause.name === 'AbortError') return;
    console.error('Selection translation error:', cause);
    error.value = '翻译失败，请重试';
  } finally {
    if (translationAbortController === controller) translationAbortController = null;
    if (requestId === translationRequestId) isLoading.value = false;
  }
}

function retryTranslation(): void {
  if (!snapshot.value) return;
  requestSelectionContent(snapshot.value.text);
}

async function requestWordCard(request: SelectionContentRequest): Promise<void> {
  const text = request.text;
  const word = normalizeEnglishWord(text);
  if (!word) return;
  const requestId = ++wordLookupRequestId;
  isWordCardLoading.value = true;
  wordCardError.value = '';
  try {
    const response = await browser.runtime.sendMessage({ type: 'selectionWordLookup', word, targetLanguage: request.targetLanguage }) as {
      success?: boolean;
      data?: WordCardData | null;
    };
    if (requestId !== wordLookupRequestId || !isContentRequestCurrent(request)) return;
    if (!response?.success || !response.data) {
      wordCard.value = null;
      dictionaryAnswer.value = null;
      wordCardError.value = '暂未找到这个单词的词典条目';
    } else {
      wordCard.value = response.data;
      dictionaryAnswer.value = {...request, answer: dictionaryDefinitions(response.data, request.targetLanguage)};
    }
  } catch (cause) {
    if (requestId !== wordLookupRequestId || !isContentRequestCurrent(request)) return;
    console.warn('Selection word lookup unavailable:', cause);
    wordCard.value = null;
    dictionaryAnswer.value = null;
    wordCardError.value = '词典服务暂时不可用';
  } finally {
    if (requestId === wordLookupRequestId) isWordCardLoading.value = false;
  }
}

async function copyTranslation(): Promise<void> {
  if (!translationResult.value) return;
  try {
    await navigator.clipboard.writeText(translationResult.value);
    copySuccess.value = true;
    if (copyTimer !== null) window.clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => { copySuccess.value = false; }, 1500);
  } catch (cause) { console.error('Copy translation failed:', cause); }
}

function sourceLanguage(text: string): string { return normalizeSpeechLanguage(config.from === 'auto' ? detectlang(text) : config.from, 'en-US'); }
function translationLanguage(): string { return normalizeSpeechLanguage(config.to, 'zh-CN'); }
function speechLanguage(text: string, kind: AudioKind): string { return kind === 'translation' ? translationLanguage() : sourceLanguage(text); }

function selectVoice(language: string): SpeechSynthesisVoice | undefined {
  if (!('speechSynthesis' in window)) return undefined;
  const voices = window.speechSynthesis.getVoices();
  const normalized = language.toLowerCase();
  const exact = voices.filter(voice => voice.lang.toLowerCase() === normalized);
  const preferredNames = normalized.startsWith('en-')
    ? ['ava', 'aria', 'jenny', 'samantha', 'google us english', 'zira']
    : normalized.startsWith('zh-')
      ? ['xiaoxiao', 'ting-ting', 'tingting', 'huihui']
      : [];
  const preferred = exact.find(voice => preferredNames.some(name => voice.name.toLowerCase().includes(name)));
  if (preferred) return preferred;
  if (exact.length > 0) return exact[0];
  const base = language.split('-')[0]?.toLowerCase();
  return voices.find(voice => voice.lang.toLowerCase().startsWith(`${base}-`) || voice.lang.toLowerCase() === base);
}

function isCurrentAudio(kind: AudioKind, key = currentAudioText.value): boolean {
  return isPlaying.value && currentAudioKind.value === kind && currentAudioKey.value === key;
}
function audioLabel(kind: AudioKind): string {
  const label = kind === 'source' ? '原文' : kind === 'translation' ? '译文' : '单词';
  return isCurrentAudio(kind) ? `停止播放${label}` : `播放${label}`;
}
function wordAudioKey(pronunciation: WordPronunciation): string {
  return pronunciation.audio || pronunciation.text || wordCard.value?.word || selectedText.value;
}
function wordAudioLabel(pronunciation: WordPronunciation): string {
  const label = pronunciation.label || '单词发音';
  return isCurrentWordAudio(pronunciation) ? `停止播放${label}` : `播放${label}`;
}
function isCurrentWordAudio(pronunciation: WordPronunciation): boolean {
  return isCurrentAudio('word', wordAudioKey(pronunciation));
}

function releasePageAudio(): void {
  if (audio) { audio.pause(); audio.removeAttribute('src'); audio = null; }
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = '';
}

function stopAudio(notifyRemote = true): void {
  ttsContentController.stop(notifyRemote);
  releasePageAudio();
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  utterance = null;
  isPlaying.value = false;
  currentAudioKind.value = null;
  currentAudioText.value = '';
  currentAudioKey.value = '';
}

function stopAudioFromUi(): void { stopAudio(); }

function base64ToBlobUrl(audioBase64: string, contentType: string): string {
  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return URL.createObjectURL(new Blob([bytes], { type: contentType }));
}

async function playEdgeSpeech(text: string, language: string, kind: AudioKind, requestId: number): Promise<boolean> {
  const remoteRequest = ttsContentController.beginRemoteRequest();
  try {
    const response = await browser.runtime.sendMessage({
      type: 'selectionTts',
      text,
      language,
      clientRequestId: remoteRequest.clientRequestId,
    }) as {
      success?: boolean;
      audioBase64?: string;
      contentType?: string;
      transport?: 'offscreen' | 'page';
    };
    const remoteResult = ttsContentController.completeRemoteRequest(remoteRequest, response);
    if (remoteResult === 'stale') return true;
    if (remoteResult === 'failed') return false;
    if (remoteResult === 'offscreen') {
      currentAudioKind.value = kind;
      currentAudioText.value = text;
      isPlaying.value = true;
      return true;
    }
    if (!response.audioBase64) return false;
    const nextAudioUrl = base64ToBlobUrl(response.audioBase64, response.contentType || 'audio/mpeg');
    const nextAudio = new Audio(nextAudioUrl);
    nextAudio.preload = 'auto';
    nextAudio.onended = () => { if (audio === nextAudio) { releasePageAudio(); stopAudio(); } };
    nextAudio.onerror = () => {
      if (audio !== nextAudio) return;
      releasePageAudio();
      isPlaying.value = false;
      currentAudioKind.value = null;
      currentAudioText.value = '';
    };
    audio = nextAudio;
    audioUrl = nextAudioUrl;
    currentAudioKind.value = kind;
    currentAudioText.value = text;
    currentAudioKey.value = text;
    isPlaying.value = true;
    try {
      await nextAudio.play();
      return true;
    } catch (cause) {
      if (audio === nextAudio) releasePageAudio();
      if (ttsContentController.isCurrentGeneration(requestId)) {
        isPlaying.value = false;
        currentAudioKind.value = null;
        currentAudioText.value = '';
      }
      if (ttsContentController.isCurrentGeneration(requestId)) console.warn('Page audio unavailable, trying browser speech:', cause);
      return false;
    }
  } catch (cause) {
    const isCurrent = ttsContentController.rejectRemoteRequest(remoteRequest);
    if (isCurrent) console.warn('Edge TTS unavailable, trying browser speech:', cause);
    return !isCurrent;
  }
}

function playBrowserSpeech(text: string, language: string, kind: AudioKind): boolean {
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return false;
  try {
    const nextUtterance = new SpeechSynthesisUtterance(text);
    nextUtterance.lang = language;
    nextUtterance.voice = selectVoice(language) ?? null;
    nextUtterance.onend = () => { if (utterance === nextUtterance) stopAudio(); };
    nextUtterance.onerror = event => { if (utterance === nextUtterance && event.error !== 'canceled' && event.error !== 'interrupted') stopAudio(); };
    utterance = nextUtterance;
    currentAudioKind.value = kind;
    currentAudioText.value = text;
    currentAudioKey.value = text;
    isPlaying.value = true;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(nextUtterance);
    return true;
  } catch (cause) { console.warn('Browser speech synthesis unavailable:', cause); return false; }
}

async function playGoogleFallback(text: string, language: string, kind: AudioKind): Promise<void> {
  const requestId = ttsContentController.currentGeneration();
  const remoteRequest = ttsContentController.beginRemoteRequest();
  try {
    const response = await browser.runtime.sendMessage({
      type: 'selectionTtsGoogle',
      text,
      language,
      clientRequestId: remoteRequest.clientRequestId,
    }) as {
      success?: boolean;
      transport?: 'offscreen' | 'page';
    };
    const remoteResult = ttsContentController.completeRemoteRequest(remoteRequest, response);
    if (remoteResult === 'stale') return;
    if (remoteResult === 'offscreen') {
      currentAudioKind.value = kind;
      currentAudioText.value = text;
      isPlaying.value = true;
      return;
    }
  } catch (cause) {
    const isCurrent = ttsContentController.rejectRemoteRequest(remoteRequest);
    if (!isCurrent) return;
    console.warn('Offscreen Google TTS unavailable, trying page audio:', cause);
  }

  if (!ttsContentController.isCurrentGeneration(requestId)) return;
  const speechUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${encodeURIComponent(language)}&client=tw-ob&q=${encodeURIComponent(text)}`;
  const nextAudio = new Audio(speechUrl);
  nextAudio.preload = 'auto';
  nextAudio.onended = () => { if (audio === nextAudio) { releasePageAudio(); stopAudio(); } };
  nextAudio.onerror = () => {
    if (audio !== nextAudio) return;
    console.warn('Fallback speech audio failed');
    releasePageAudio();
    stopAudio(false);
  };
  audio = nextAudio;
  currentAudioKind.value = kind;
  currentAudioText.value = text;
  currentAudioKey.value = text;
  isPlaying.value = true;
  try {
    await nextAudio.play();
  } catch {
    if (audio === nextAudio) releasePageAudio();
    if (ttsContentController.isCurrentGeneration(requestId)) stopAudio(false);
  }
}

async function playExternalAudio(url: string, text: string, kind: AudioKind, key: string, requestId: number): Promise<boolean> {
  if (!ttsContentController.isCurrentGeneration(requestId)) return true;
  const nextAudio = new Audio(url);
  audio = nextAudio;
  currentAudioKind.value = kind;
  currentAudioText.value = text;
  currentAudioKey.value = key;
  isPlaying.value = true;
  nextAudio.onended = () => { if (audio === nextAudio) stopAudio(); };
  nextAudio.onerror = () => {
    if (audio !== nextAudio) return;
    audio = null;
    nextAudio.removeAttribute('src');
    isPlaying.value = false;
  };
  try {
    await nextAudio.play();
    return true;
  } catch (cause) {
    if (audio === nextAudio) {
      audio = null;
      nextAudio.removeAttribute('src');
      isPlaying.value = false;
    }
    if (ttsContentController.isCurrentGeneration(requestId)) console.warn('Dictionary pronunciation audio unavailable:', cause);
    return false;
  }
}

async function toggleAudio(text: string, kind: AudioKind): Promise<void> {
  const cleanText = text.trim();
  if (!cleanText) return;
  if (isCurrentAudio(kind) && currentAudioText.value === cleanText) { stopAudio(); return; }
  stopAudio();
  const language = speechLanguage(cleanText, kind);
  const requestId = ttsContentController.currentGeneration();
  isPlaying.value = true;
  currentAudioKind.value = kind;
  currentAudioText.value = cleanText;
  currentAudioKey.value = cleanText;
  const edgeStarted = await playEdgeSpeech(cleanText, language, kind, requestId);
  if (edgeStarted || !ttsContentController.isCurrentGeneration(requestId)) return;
  if (!playBrowserSpeech(cleanText, language, kind)) await playGoogleFallback(cleanText, language, kind);
}

function handleSelectionTtsState(message: unknown): true | undefined {
  const state = ttsContentController.matchRemoteState(message);
  if (!state) return undefined;

  const text = currentAudioText.value;
  const kind = currentAudioKind.value;
  const language = kind && text ? speechLanguage(text, kind) : '';
  if (state === 'ended' || state === 'stopped') {
    stopAudio(false);
    return true;
  }
  if (state === 'error') {
    stopAudio(false);
    if (text && kind && !playBrowserSpeech(text, language, kind)) void playGoogleFallback(text, language, kind);
    return true;
  }
  return undefined;
}

async function toggleWordAudio(pronunciation: WordPronunciation): Promise<void> {
  const word = wordCard.value?.word || selectedWord.value || selectedText.value;
  const cleanText = word.trim();
  if (!cleanText) return;
  const key = wordAudioKey(pronunciation);
  if (isCurrentAudio('word', key)) { stopAudio(); return; }
  stopAudio();
  const requestId = ttsContentController.currentGeneration();
  isPlaying.value = true;
  currentAudioKind.value = 'word';
  currentAudioText.value = cleanText;
  currentAudioKey.value = key;
  const externalAudio = pronunciation.audio;
  if (externalAudio) {
    const externalStarted = await playExternalAudio(externalAudio, cleanText, 'word', key, requestId);
    if (externalStarted || !ttsContentController.isCurrentGeneration(requestId)) return;
  }
  const edgeStarted = await playEdgeSpeech(cleanText, 'en-US', 'word', requestId);
  if (edgeStarted || !ttsContentController.isCurrentGeneration(requestId)) return;
  if (!playBrowserSpeech(cleanText, 'en-US', 'word')) playGoogleFallback(cleanText, 'en-US', 'word');
}

function closeTooltip(): void { hideAll(); }
function hideAll(): void {
  cancelSelectionLoss();
  cancelSelectionPresentation();
  selectionSettledAt = 0;
  resetSelectionContentState(true);
  showIndicator.value = false;
  showTooltip.value = false;
  snapshot.value = null;
  pendingSelectionShortcutUntil = 0;
  isVocabularySaved.value = false;
  vocabularyBusy.value = false;
}
function isInsideUi(target: EventTarget | null): boolean {
  const node = target instanceof Node ? target : null;
  if (!node) return false;
  const host = document.getElementById('babelbox-selection-translator-container');
  const root = node.getRootNode();
  return Boolean(node === host || host?.contains(node) || root === host?.shadowRoot);
}
function matchesSelectionModifierOnPointer(event: PointerEvent): boolean {
  const shortcut = selectionShortcut.value;
  if (!['Control', 'Alt', 'Shift'].includes(shortcut)) return false;
  const modifierState = {
    ctrlKey: event.ctrlKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
    metaKey: event.metaKey,
    key: shortcut === 'Control' ? 'Control' : shortcut === 'Alt' ? 'Alt' : 'Shift',
  };
  return matchesModifierOnlyHotkey(modifierState, shortcut);
}
function handlePointerDown(event: PointerEvent): void {
  if (!event.isTrusted) return;
  lastTrustedSelectionInteractionAt = Date.now();
  if (isInsideUi(event.target)) {
    uiPointerInteraction = true;
    isSelecting = false;
    suppressSelectionRead();
    return;
  }
  uiPointerInteraction = false;
  suppressSelectionUntil = 0;
  isSelecting = true;
  pendingSelectionShortcutUntil = 0;
  if (snapshot.value) hideAll();
}
function handlePointerUp(event: PointerEvent): void {
  if (!event.isTrusted) return;
  lastTrustedSelectionInteractionAt = Date.now();
  if (uiPointerInteraction || isInsideUi(event.target)) {
    uiPointerInteraction = false;
    isSelecting = false;
    suppressSelectionRead();
    return;
  }
  uiPointerInteraction = false;
  isSelecting = false;
  scheduleSelectionRead(matchesSelectionModifierOnPointer(event) || selectionShortcutHeld);
}
function handlePointerCancel(event: PointerEvent): void {
  if (!event.isTrusted) return;
  if (uiPointerInteraction || isInsideUi(event.target)) {
    uiPointerInteraction = false;
    isSelecting = false;
    suppressSelectionRead();
    return;
  }
  isSelecting = false;
}
function handleSelectionChange(event: Event): void {
  if (!event.isTrusted || Date.now() - lastTrustedSelectionInteractionAt > TRUSTED_SELECTION_INTERACTION_GRACE_MS) return;
  if (!isSelectionReadSuppressed()) scheduleSelectionRead(selectionShortcutHeld);
}
function handleWheel(event: WheelEvent): void { if (isInsideUi(event.target)) suppressSelectionRead(); }
function handleScroll(event: Event): void {
  if (isInsideUi(event.target)) {
    suppressSelectionRead();
    return;
  }
  schedulePositionUpdate();
}
function handleKeydown(event: KeyboardEvent): void {
  if (!event.isTrusted) return;
  lastTrustedSelectionInteractionAt = Date.now();
  if (isInsideUi(event.target)) {
    suppressSelectionRead();
    if (event.key === 'Escape' && snapshot.value) hideAll();
    return;
  }
  if (event.key === 'Escape' && snapshot.value) { hideAll(); return; }
  if (event.repeat) return;
  const matchesSelectionShortcut = matchesConfiguredHotkey(event, selectionShortcutConfig.value, selectionSettings.value.customHotkey);
  if (!matchesSelectionShortcut) return;
  selectionShortcutHeld = true;
  const currentSelection = readSelectionSnapshot();
  if (currentSelection) {
    event.preventDefault();
    event.stopPropagation();
    applySelection(currentSelection, true);
    return;
  }
  if (!snapshot.value) {
    scheduleSelectionRead(true);
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  scheduleSelectionPresentation('tooltip');
}

function handleKeyup(): void {
  selectionShortcutHeld = false;
}

function handleWindowBlur(): void {
  selectionShortcutHeld = false;
  pendingSelectionShortcutUntil = 0;
}

function handleSelectionSettingsMessage(message: unknown): undefined {
  if (!message || typeof message !== 'object') return undefined;
  const type = (message as { type?: unknown }).type;
  if (type !== 'updateSelectionTranslatorSettings' && type !== 'updateSelectionTranslatorMode') return undefined;
  selectionConfigVersion.value += 1;
  return undefined;
}

function handleVocabularyBookChanged(message: unknown): undefined {
  if (!message || typeof message !== 'object' || (message as {type?: unknown}).type !== VOCABULARY_BOOK_CHANGED_MESSAGE) return undefined;
  const request = currentContentRequest.value;
  if (request && isWordSelection.value) void refreshVocabularySaved(request);
  return undefined;
}

onMounted(() => {
  updateTheme();
  systemThemeMedia = window.matchMedia('(prefers-color-scheme: dark)');
  systemThemeMedia.addEventListener('change', updateTheme);
  browser.runtime.onMessage.addListener(handleSelectionSettingsMessage);
  browser.runtime.onMessage.addListener(handleVocabularyBookChanged);
  unsubscribeConfig = subscribeConfig(() => { selectionConfigVersion.value += 1; });
  document.addEventListener('pointerdown', handlePointerDown, true);
  document.addEventListener('pointerup', handlePointerUp, true);
  document.addEventListener('pointercancel', handlePointerCancel, true);
  document.addEventListener('selectionchange', handleSelectionChange);
  document.addEventListener('keydown', handleKeydown, true);
  document.addEventListener('keyup', handleKeyup, true);
  window.addEventListener('blur', handleWindowBlur);
  browser.runtime.onMessage.addListener(handleSelectionTtsState);
  document.addEventListener('wheel', handleWheel, true);
  window.addEventListener('scroll', handleScroll, true);
  window.addEventListener('resize', schedulePositionUpdate);
  watch(tooltipRef, (tooltip) => {
    tooltipResizeObserver?.disconnect();
    tooltipResizeObserver = null;
    if (!tooltip || typeof ResizeObserver === 'undefined') return;
    tooltipResizeObserver = new ResizeObserver(schedulePositionUpdate);
    tooltipResizeObserver.observe(tooltip);
  }, { flush: 'post' });
  watch(() => [
    selectionSettings.value.theme,
    selectionSettings.value.trigger,
    selectionSettings.value.customHotkey,
    selectionSettings.value.delay,
    selectionSettings.value.mode,
    selectionSettings.value.to,
    selectionSettings.value.from,
    selectionSettings.value.service,
    selectionSettings.value.model,
    config.vocabularyBookEnabled,
  ] as const, (nextSettings, previousSettings) => {
    const themeChanged = !previousSettings || nextSettings[0] !== previousSettings[0];
    const triggerChanged = !previousSettings
      || nextSettings[1] !== previousSettings[1]
      || nextSettings[2] !== previousSettings[2];
    const delayChanged = !previousSettings || nextSettings[3] !== previousSettings[3];
    const languageChanged = !previousSettings
      || nextSettings[5] !== previousSettings[5]
      || nextSettings[6] !== previousSettings[6];
    const translationProviderChanged = !previousSettings
      || nextSettings[7] !== previousSettings[7]
      || nextSettings[8] !== previousSettings[8];
    if (themeChanged) updateTheme();
    if (!snapshot.value) return;
    if (languageChanged && isSelectionInTargetLanguage(snapshot.value.text)) { hideAll(); return; }
    if (languageChanged || translationProviderChanged) resetSelectionContentState();
    if (triggerChanged) {
      const nextPresentation = reconcileSelectionPresentation({
        showIndicator: showIndicator.value,
        showTooltip: showTooltip.value,
      }, triggerMode.value, true);
      cancelSelectionPresentation();
      showIndicator.value = false;
      showTooltip.value = false;
      if (nextPresentation.showTooltip) scheduleSelectionPresentation('tooltip');
      else if (nextPresentation.showIndicator) scheduleSelectionPresentation('indicator');
      return;
    }
    if (delayChanged && pendingSelectionPresentation) {
      scheduleSelectionPresentation(pendingSelectionPresentation);
      return;
    }
    if (languageChanged || translationProviderChanged) {
      if (showTooltip.value) void requestSelectionContent(snapshot.value.text);
    }
    if (previousSettings && nextSettings[9] !== previousSettings[9] && showTooltip.value && isWordSelection.value) {
      const request = currentContentRequest.value;
      if (request) void refreshVocabularySaved(request);
    }
  });
});

onBeforeUnmount(() => {
  if (selectionFrame !== null) window.cancelAnimationFrame(selectionFrame);
  if (positionFrame !== null) window.cancelAnimationFrame(positionFrame);
  cancelSelectionLoss();
  cancelSelectionPresentation();
  if (copyTimer !== null) window.clearTimeout(copyTimer);
  if (noticeTimer !== null) window.clearTimeout(noticeTimer);
  systemThemeMedia?.removeEventListener('change', updateTheme);
  browser.runtime.onMessage.removeListener(handleSelectionSettingsMessage);
  browser.runtime.onMessage.removeListener(handleVocabularyBookChanged);
  unsubscribeConfig?.();
  unsubscribeConfig = null;
  tooltipResizeObserver?.disconnect();
  tooltipResizeObserver = null;
  document.removeEventListener('pointerdown', handlePointerDown, true);
  document.removeEventListener('pointerup', handlePointerUp, true);
  document.removeEventListener('pointercancel', handlePointerCancel, true);
  document.removeEventListener('selectionchange', handleSelectionChange);
  document.removeEventListener('keydown', handleKeydown, true);
  document.removeEventListener('keyup', handleKeyup, true);
  window.removeEventListener('blur', handleWindowBlur);
  browser.runtime.onMessage.removeListener(handleSelectionTtsState);
  document.removeEventListener('wheel', handleWheel, true);
  window.removeEventListener('scroll', handleScroll, true);
  window.removeEventListener('resize', schedulePositionUpdate);
  resetSelectionContentState(true);
});
</script>

<style scoped>
.babelbox-selection-translator-root { position: fixed; inset: 0; z-index: 2147483647; width: 100vw; height: 100vh; pointer-events: none; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #25252a; }
.babelbox-selection-indicator, .babelbox-translation-tooltip, .babelbox-copy-success-toast, .babelbox-action-toast { pointer-events: auto; }
.babelbox-selection-indicator { position: fixed; display: grid; width: 18px; height: 18px; padding: 0; place-items: center; border: 0; border-radius: 50%; transform: translate(-50%, -50%); background: #ef4b86; color: #fff; box-shadow: 0 2px 7px rgba(204, 40, 104, .28), 0 0 0 2px rgba(255, 255, 255, .94); cursor: pointer; transition: transform .14s ease, box-shadow .14s ease; }
.babelbox-selection-indicator--dot { width: 8px; height: 8px; }
.babelbox-selection-indicator--dot .babelbox-selection-indicator-glyph { display: none; }
.babelbox-selection-indicator:hover, .babelbox-selection-indicator:focus-visible { transform: translate(-50%, -50%) scale(1.1); box-shadow: 0 4px 14px rgba(204, 40, 104, .4), 0 0 0 3px rgba(255, 255, 255, .95); outline: none; }
.babelbox-selection-indicator-glyph { width: 11px; height: 11px; stroke-width: 2.4; }
.babelbox-translation-tooltip, .babelbox-translation-tooltip * { box-sizing: border-box; }
.babelbox-translation-tooltip, .babelbox-copy-success-toast, .babelbox-action-toast {
  --babelbox-selection-font-caption: 10px;
  --babelbox-selection-font-small: 11px;
  --babelbox-selection-font-body: 13px;
  --babelbox-selection-font-subtitle: 15px;
  --babelbox-selection-font-reading: 18px;
  --babelbox-selection-font-display: 27px;
  --babelbox-selection-weight-medium: 600;
  --babelbox-selection-weight-semibold: 700;
  --babelbox-selection-weight-bold: 800;
  --babelbox-selection-toast-surface: #2c2c35;
  --babelbox-selection-toast-ink: #fff;
  --babelbox-selection-toast-action: #ffc2d5;
}
.babelbox-translation-tooltip {
  --babelbox-selection-border: rgba(35, 35, 43, .11);
  --babelbox-selection-surface: rgba(255, 254, 252, .98);
  --babelbox-selection-ink: #39363d;
  --babelbox-selection-heading: #292832;
  --babelbox-selection-line: #eeecee;
  --babelbox-selection-line-soft: #f2f0f1;
  --babelbox-selection-muted: #9a9298;
  --babelbox-selection-accent-muted: #9e5d71;
  --babelbox-selection-pronunciation-label: #a36b7b;
  --babelbox-selection-ipa: #4a454c;
  --babelbox-selection-hover: #f4f4f7;
  --babelbox-selection-hover-ink: #303038;
  --babelbox-selection-action-hover-ink: #ef4b86;
  --babelbox-selection-original-surface: #f7f7f9;
  --babelbox-selection-original-ink: #666670;
  --babelbox-selection-result-surface: #fff3f7;
  --babelbox-selection-result-ink: #33333a;
  --babelbox-selection-audio-surface: #f5eff1;
  --babelbox-selection-audio-ink: #936173;
  --babelbox-selection-badge-border: #ead8de;
  --babelbox-selection-badge-surface: #fbf5f6;
  --babelbox-selection-badge-ink: #9e5d71;
  --babelbox-selection-secondary-ink: #74676d;
  --babelbox-selection-fallback-surface: #fff8fa;
  --babelbox-selection-brand: #ef4b86;
  --babelbox-selection-brand-soft: rgba(239, 75, 134, .13);
  --babelbox-selection-danger: #c43b63;
  --babelbox-selection-danger-border: #e8a4bc;
  --babelbox-selection-spinner-border: #f5bfd3;
  position: fixed;
  width: min(360px, calc(100vw - 20px));
  max-height: min(500px, calc(100vh - 20px));
  overflow: hidden;
  border: 1px solid var(--babelbox-selection-border);
  border-radius: 17px;
  color: var(--babelbox-selection-ink);
  background: var(--babelbox-selection-surface);
  box-shadow: 0 18px 46px rgba(35, 33, 43, .15), 0 3px 10px rgba(35, 33, 43, .06);
  backdrop-filter: blur(18px);
  -webkit-user-select: none;
  user-select: none;
}
.babelbox-tooltip-header { display: flex; align-items: center; justify-content: space-between; padding: 11px 14px; border-bottom: 1px solid var(--babelbox-selection-line); font-size: var(--babelbox-selection-font-body); font-weight: var(--babelbox-selection-weight-semibold); }
.babelbox-tooltip-title { display: flex; align-items: baseline; gap: 6px; }
.babelbox-tooltip-header small { color: var(--babelbox-selection-muted); font-size: var(--babelbox-selection-font-caption); font-weight: var(--babelbox-selection-weight-medium); letter-spacing: .01em; }
.babelbox-tooltip-actions { display: flex; align-items: center; gap: 2px; }
.babelbox-action-btn, .babelbox-close-btn, .babelbox-text-audio-btn, .babelbox-playing-status button { border: 0; background: transparent; color: var(--babelbox-selection-muted); cursor: pointer; }
.babelbox-action-btn { display: grid; width: 26px; height: 26px; place-items: center; border-radius: 7px; }
.babelbox-action-btn svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.babelbox-action-btn:hover, .babelbox-action-btn:focus-visible { background: var(--babelbox-selection-hover); color: var(--babelbox-selection-action-hover-ink); outline: none; }
.babelbox-action-btn:disabled { cursor: not-allowed; opacity: .38; }
.babelbox-vocabulary-btn.babelbox-saved { color: var(--babelbox-selection-brand); }
.babelbox-vocabulary-btn.babelbox-saved svg { fill: currentColor; stroke: currentColor; }
.babelbox-close-btn { display: grid; width: 26px; height: 26px; place-items: center; border-radius: 7px; }
.babelbox-close-btn svg { width: 16px; height: 16px; }
.babelbox-close-btn:hover, .babelbox-close-btn:focus-visible { background: var(--babelbox-selection-hover); color: var(--babelbox-selection-hover-ink); outline: none; }
.babelbox-tooltip-content { max-height: min(440px, calc(100vh - 72px)); overflow: auto; padding: 13px 14px 15px; scrollbar-color: rgba(108, 105, 112, .4) transparent; scrollbar-width: thin; }
.babelbox-loading-state, .babelbox-error-state { display: flex; align-items: center; justify-content: center; gap: 9px; min-height: 80px; color: var(--babelbox-selection-muted); font-size: var(--babelbox-selection-font-body); }
.babelbox-error-state { flex-direction: column; color: var(--babelbox-selection-danger); }
.babelbox-error-state button { border: 1px solid currentColor; border-radius: 7px; padding: 4px 10px; background: transparent; color: inherit; cursor: pointer; }
.babelbox-loading-spinner { width: 18px; height: 18px; border: 2px solid var(--babelbox-selection-spinner-border); border-top-color: var(--babelbox-selection-brand); border-radius: 50%; animation: babelbox-spin .7s linear infinite; }
.babelbox-loading-spinner.babelbox-static { animation: none; }
@keyframes babelbox-spin { to { transform: rotate(360deg); } }
.babelbox-word-learning-card { padding: 1px 1px 0; color: var(--babelbox-selection-ink); }
.babelbox-word-card-loading { display: flex; align-items: center; justify-content: center; gap: 9px; min-height: 74px; color: var(--babelbox-selection-muted); font-size: var(--babelbox-selection-font-body); }
.babelbox-word-heading { position: relative; display: flex; align-items: flex-start; justify-content: space-between; min-height: 58px; padding: 4px 34px 14px 1px; border-bottom: 1px solid var(--babelbox-selection-line); }
.babelbox-word-heading h3 { margin: 0; color: var(--babelbox-selection-heading); font-size: var(--babelbox-selection-font-display); font-weight: var(--babelbox-selection-weight-semibold); letter-spacing: -.035em; line-height: 1.08; }
.babelbox-word-normalized { display: block; margin-top: 5px; color: var(--babelbox-selection-muted); font-size: var(--babelbox-selection-font-caption); }
.babelbox-word-heading-audio { top: 1px; right: 0; background: var(--babelbox-selection-audio-surface); color: var(--babelbox-selection-audio-ink); }
.babelbox-word-pronunciations { display: grid; gap: 0; margin-top: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--babelbox-selection-line); }
.babelbox-word-pronunciation { position: relative; display: flex; align-items: center; gap: 8px; min-height: 29px; padding: 3px 31px 3px 1px; border-bottom: 1px solid var(--babelbox-selection-line-soft); }
.babelbox-word-pronunciation:last-child { border-bottom: 0; }
.babelbox-word-pronunciation-label { min-width: 34px; color: var(--babelbox-selection-pronunciation-label); font-size: var(--babelbox-selection-font-caption); font-weight: var(--babelbox-selection-weight-semibold); }
.babelbox-word-ipa { color: var(--babelbox-selection-ipa); font-family: Georgia, "Times New Roman", serif; font-size: var(--babelbox-selection-font-body); }
.babelbox-word-translation { margin-top: 12px; padding: 1px 1px 12px; border-bottom: 1px solid var(--babelbox-selection-line); color: var(--babelbox-selection-ink); }
.babelbox-word-translation pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: inherit; font-size: var(--babelbox-selection-font-reading); font-weight: var(--babelbox-selection-weight-semibold); line-height: 1.3; }
.babelbox-word-translation-loading, .babelbox-word-empty { margin-top: 12px; color: var(--babelbox-selection-muted); font-size: var(--babelbox-selection-font-small); }
.babelbox-word-meaning-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 14px; color: var(--babelbox-selection-muted); font-size: var(--babelbox-selection-font-small); font-weight: var(--babelbox-selection-weight-semibold); }
.babelbox-word-meaning-toolbar button { border: 0; padding: 3px 0; background: transparent; color: var(--babelbox-selection-accent-muted); cursor: pointer; font: inherit; font-weight: var(--babelbox-selection-weight-medium); }
.babelbox-word-meaning-toolbar button:hover, .babelbox-word-meaning-toolbar button:focus-visible { color: var(--babelbox-selection-brand); text-decoration: underline; outline: none; }
.babelbox-word-meanings { display: grid; gap: 16px; margin-top: 14px; }
.babelbox-word-meaning-toolbar + .babelbox-word-meanings { margin-top: 8px; }
.babelbox-word-meaning { color: var(--babelbox-selection-ink); font-size: var(--babelbox-selection-font-body); line-height: 1.52; }
.babelbox-word-meaning > strong { display: inline-flex; padding: 3px 7px; border: 1px solid var(--babelbox-selection-badge-border); border-radius: 6px; background: var(--babelbox-selection-badge-surface); color: var(--babelbox-selection-badge-ink); font-size: var(--babelbox-selection-font-caption); font-weight: var(--babelbox-selection-weight-semibold); }
.babelbox-word-meaning ol { margin: 7px 0 0; padding: 0; list-style: none; counter-reset: definition; }
.babelbox-word-meaning li { position: relative; padding-left: 21px; }
.babelbox-word-meaning li::before { position: absolute; top: 0; left: 0; width: 14px; color: var(--babelbox-selection-muted); content: counter(definition); counter-increment: definition; font-size: var(--babelbox-selection-font-small); text-align: right; }
.babelbox-word-meaning li + li { margin-top: 9px; }
.babelbox-word-definition-en, .babelbox-word-example-en { display: block; }
.babelbox-word-definition-zh, .babelbox-word-example-zh { display: block; margin-top: 3px; color: var(--babelbox-selection-muted); font-size: var(--babelbox-selection-font-small); }
.babelbox-word-meaning em { display: block; margin-top: 4px; padding-left: 8px; border-left: 2px solid var(--babelbox-selection-badge-border); color: var(--babelbox-selection-secondary-ink); font-size: var(--babelbox-selection-font-small); font-style: normal; line-height: 1.45; }
.babelbox-word-card-footer { display: flex; flex-wrap: wrap; align-items: center; gap: 5px 8px; margin-top: 16px; padding-top: 10px; border-top: 1px solid var(--babelbox-selection-line); color: var(--babelbox-selection-muted); font-size: var(--babelbox-selection-font-caption); }
.babelbox-word-card-footer a { color: var(--babelbox-selection-accent-muted); text-decoration: none; }
.babelbox-word-card-footer a:hover, .babelbox-word-card-footer a:focus-visible { text-decoration: underline; }
.babelbox-word-fallback-note, .babelbox-inline-error { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 8px; color: var(--babelbox-selection-danger); font-size: var(--babelbox-selection-font-small); }
.babelbox-word-fallback-note { padding: 6px 8px; border-radius: 7px; background: var(--babelbox-selection-fallback-surface); }
.babelbox-inline-error button, .babelbox-word-fallback-note button { border: 1px solid currentColor; border-radius: 6px; padding: 2px 7px; background: transparent; color: inherit; cursor: pointer; font-size: var(--babelbox-selection-font-small); }
.babelbox-text-block { position: relative; padding: 9px 36px 10px 11px; border-radius: 11px; }
.babelbox-text-block + .babelbox-text-block { margin-top: 8px; }
.babelbox-original-text { background: var(--babelbox-selection-original-surface); color: var(--babelbox-selection-original-ink); }
.babelbox-translation-result { background: var(--babelbox-selection-result-surface); color: var(--babelbox-selection-result-ink); box-shadow: inset 2px 0 0 var(--babelbox-selection-brand-soft); }
.babelbox-text-label { margin-bottom: 3px; color: var(--babelbox-selection-muted); font-size: var(--babelbox-selection-font-caption); font-weight: var(--babelbox-selection-weight-semibold); letter-spacing: .02em; }
.babelbox-text-block pre { max-height: 170px; margin: 0; overflow: auto; white-space: pre-wrap; word-break: break-word; font: inherit; font-size: var(--babelbox-selection-font-subtitle); line-height: 1.48; }
.babelbox-text-audio-btn { position: absolute; top: 8px; right: 7px; display: grid; width: 26px; height: 26px; place-items: center; border-radius: 8px; }
.babelbox-text-audio-btn svg { width: 17px; height: 17px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.babelbox-text-audio-btn:hover, .babelbox-text-audio-btn:focus-visible { background: var(--babelbox-selection-brand-soft); color: var(--babelbox-selection-brand); outline: none; }
.babelbox-playing-status { display: flex; align-items: center; justify-content: space-between; margin-top: 10px; color: var(--babelbox-selection-muted); font-size: var(--babelbox-selection-font-small); }
.babelbox-playing-status button { border: 1px solid var(--babelbox-selection-danger-border); border-radius: 7px; padding: 3px 8px; color: var(--babelbox-selection-danger); }
.babelbox-copy-success-toast { position: fixed; right: 18px; bottom: 18px; padding: 9px 13px; border-radius: 9px; background: var(--babelbox-selection-toast-surface); color: var(--babelbox-selection-toast-ink); font-size: var(--babelbox-selection-font-small); box-shadow: 0 6px 18px rgba(0, 0, 0, .18); }
.babelbox-action-toast { position: fixed; right: 18px; bottom: 18px; display: flex; align-items: center; gap: 10px; padding: 9px 13px; border-radius: 9px; background: var(--babelbox-selection-toast-surface); color: var(--babelbox-selection-toast-ink); font-size: var(--babelbox-selection-font-small); box-shadow: 0 6px 18px rgba(0, 0, 0, .18); }
.babelbox-action-toast button { padding: 0; border: 0; color: var(--babelbox-selection-toast-action); background: transparent; cursor: pointer; font: inherit; font-weight: var(--babelbox-selection-weight-semibold); }
.babelbox-dark-theme {
  --babelbox-selection-toast-surface: #f4f5f8;
  --babelbox-selection-toast-ink: #25252a;
  --babelbox-selection-toast-action: #b02f5d;
  --babelbox-selection-border: #44444e;
  --babelbox-selection-surface: rgba(40, 40, 48, .98);
  --babelbox-selection-ink: #f2e8ed;
  --babelbox-selection-heading: #f2e8ed;
  --babelbox-selection-line: #4b4148;
  --babelbox-selection-line-soft: #443a42;
  --babelbox-selection-muted: #c8aab5;
  --babelbox-selection-accent-muted: #f0b9cb;
  --babelbox-selection-pronunciation-label: #e0a7b9;
  --babelbox-selection-ipa: #f0dce4;
  --babelbox-selection-hover: #50505b;
  --babelbox-selection-hover-ink: #fff;
  --babelbox-selection-action-hover-ink: #fff;
  --babelbox-selection-original-surface: #34343d;
  --babelbox-selection-original-ink: #d0d0d7;
  --babelbox-selection-result-surface: #4b2e3a;
  --babelbox-selection-result-ink: #fff0f5;
  --babelbox-selection-audio-surface: #493842;
  --babelbox-selection-audio-ink: #f0c3d2;
  --babelbox-selection-badge-border: #684b58;
  --babelbox-selection-badge-surface: #493842;
  --babelbox-selection-badge-ink: #ffd9e7;
  --babelbox-selection-secondary-ink: #c8aab5;
  --babelbox-selection-fallback-surface: #4a303b;
  --babelbox-selection-brand: #ff80ae;
  --babelbox-selection-brand-soft: rgba(255, 128, 174, .16);
  --babelbox-selection-danger: #ffc0d3;
  --babelbox-selection-danger-border: #9d5871;
  --babelbox-selection-spinner-border: #684b58;
}
@media (prefers-reduced-motion: reduce) { .babelbox-selection-indicator, .babelbox-loading-spinner { transition: none; animation: none; } }
</style>
