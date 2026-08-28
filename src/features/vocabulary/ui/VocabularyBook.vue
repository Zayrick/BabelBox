<template>
  <div id="settings-vocabulary" class="vocabulary-book">
    <section class="beta-panel" :class="{ enabled: betaEnabled }">
      <div class="beta-copy">
        <span class="beta-mark">Beta</span>
        <div>
          <h3>{{ betaEnabled ? '单词本收藏入口已开启' : '先开启本地单词本' }}</h3>
          <p>只在你主动点击星标时保存；关闭功能不会删除已经积累的词条和复习记录。</p>
        </div>
      </div>
      <button
        class="beta-switch"
        type="button"
        role="switch"
        aria-label="启用或关闭本地单词本 Beta"
        :aria-checked="betaEnabled"
        :disabled="configBusy"
        @click="setBetaEnabled(!betaEnabled)"
      ><i /></button>
    </section>

    <div v-if="betaEnabled && !selectionTranslatorEnabled" class="selection-reminder" role="note">
      <span>单词收藏入口位于划词翻译卡中；当前划词翻译仍是关闭状态。</span>
      <button type="button" @click="emit('navigate', 'settings-shortcuts')">前往开启<ArrowRight class="button-icon" aria-hidden="true" /></button>
    </div>

    <section class="privacy-note" aria-label="本地存储说明">
      <span class="privacy-note-icon" aria-hidden="true"><HardDrive /></span>
      <div><strong>学习数据仅保存在当前浏览器</strong><small>不建账号、不上传复习记录；卸载扩展前请导出备份。无痕窗口不提供持久收藏。</small></div>
    </section>

    <div v-if="loadError" class="error-state" role="alert">
      <span>{{ loadError }}</span><button type="button" @click="loadEntries"><RefreshCw class="button-icon" aria-hidden="true" />重试</button>
    </div>

    <template v-else>
      <section class="summary-grid" aria-label="单词本概览">
        <article><span>今日待复习</span><strong>{{ dueEntries.length }}</strong></article>
        <article><span>新词</span><strong>{{ statusCounts.new }}</strong></article>
        <article><span>学习中 / 熟悉</span><strong>{{ statusCounts.learning + statusCounts.familiar }}</strong></article>
        <article><span>已掌握</span><strong>{{ statusCounts.mastered }}</strong></article>
      </section>

      <section v-if="reviewActive" class="review-shell" aria-live="polite">
        <header class="review-header">
          <strong>复习 {{ reviewPosition }} / {{ reviewTotal }}</strong>
          <button type="button" :disabled="actionBusy" @click="finishReview"><X class="button-icon" aria-hidden="true" />退出本轮</button>
        </header>

        <div v-if="currentReview" class="review-card">
          <span class="status-pill" :class="`status-${currentReview.status}`">{{ statusLabel(currentReview.status) }}</span>
          <div class="review-prompt">
            <p v-if="currentClozeContext" class="cloze-context">{{ currentClozeContext }}</p>
            <h3 v-else>{{ currentReview.term }}</h3>
            <small>{{ currentClozeContext ? '回忆空缺处的单词和含义' : '先在心里回忆它的含义' }}</small>
          </div>

          <button v-if="!reviewAnswerVisible" class="reveal-button" type="button" @click="reviewAnswerVisible = true">显示答案 <kbd>Space</kbd></button>

          <div v-else class="review-answer">
            <div class="answer-heading"><h3>{{ currentReview.term }}</h3><span v-if="currentReview.phonetic">{{ currentReview.phonetic }}</span></div>
            <p class="answer-translation">{{ entryTranslation(currentReview) || '暂无可用译义' }}</p>
            <p v-if="latestContext(currentReview)?.text" class="answer-context">{{ latestContext(currentReview)?.text }}</p>
            <a v-if="latestContext(currentReview)?.sourceUrl" :href="latestContext(currentReview)?.sourceUrl" target="_blank" rel="noreferrer">查看收藏来源<ExternalLink class="inline-link-icon" aria-hidden="true" /></a>
            <div class="review-actions">
              <button type="button" class="again" :disabled="actionBusy" @click="rateReview('again')"><span>1</span><strong>忘了</strong><small>约 10 分钟后</small></button>
              <button type="button" class="good" :disabled="actionBusy" @click="rateReview('good')"><span>2</span><strong>记得</strong><small>{{ goodIntervalLabel(currentReview) }}</small></button>
            </div>
          </div>
        </div>

        <div v-else class="review-complete">
          <span class="review-complete-icon" aria-hidden="true"><CircleCheck /></span>
          <h3>本轮复习完成</h3>
          <p>复习 {{ reviewStats.reviewed }} 个 · 记得 {{ reviewStats.good }} 个 · 忘了 {{ reviewStats.again }} 个</p>
          <button type="button" @click="finishReview"><ArrowLeft class="button-icon" aria-hidden="true" />返回单词本</button>
        </div>
      </section>

      <template v-else>
        <section class="primary-actions">
          <button class="start-review" type="button" :disabled="loading || actionBusy || reviewPlan.length === 0" @click="startReview">
            <span aria-hidden="true"><Play /></span>
            <strong>{{ reviewPlan.length ? `开始复习 ${reviewPlan.length} 个` : '今天没有到期单词' }}</strong>
          </button>
          <button type="button" class="refresh-button" :disabled="loading" @click="loadEntries"><RefreshCw class="button-icon" aria-hidden="true" />{{ loading ? '读取中…' : '刷新' }}</button>
        </section>

        <section class="toolbar" aria-label="筛选单词">
          <label class="search-field"><Search class="search-field-icon" aria-hidden="true" /><input v-model.trim="query" type="search" placeholder="搜索单词、译义或上下文" /></label>
          <el-select v-model="statusFilter" class="toolbar-select" aria-label="掌握状态">
            <el-option label="全部状态" value="all" />
            <el-option label="待复习" value="due" />
            <el-option label="新词" value="new" />
            <el-option label="学习中" value="learning" />
            <el-option label="熟悉" value="familiar" />
            <el-option label="已掌握" value="mastered" />
          </el-select>
          <el-select v-model="sortOrder" class="toolbar-select" aria-label="排序方式">
            <el-option label="按复习时间" value="due" />
            <el-option label="按最近收藏" value="recent" />
            <el-option label="按字母顺序" value="term" />
          </el-select>
        </section>

        <section v-if="loading && entries.length === 0" class="empty-state"><span class="loading-ring" /><p>正在读取本地单词本…</p></section>
        <section v-else-if="entries.length === 0" class="empty-state">
          <BookOpen class="empty-state-icon" aria-hidden="true" /><h3>还没有收藏单词</h3><p>开启 Beta 后，在网页中划选一个英文单词，再点击学习卡标题栏的星标。</p>
        </section>
        <section v-else-if="filteredEntries.length === 0" class="empty-state"><Search class="empty-state-icon" aria-hidden="true" /><h3>没有匹配的词条</h3><p>试试清空搜索内容或切换掌握状态。</p></section>

        <section v-else class="word-list" aria-label="收藏的单词">
          <article v-for="entry in pagedEntries" :key="entry.id" class="word-row">
            <div class="word-main">
              <div class="word-heading"><h3>{{ entry.term }}</h3><span v-if="entry.phonetic">{{ entry.phonetic }}</span></div>
              <p>{{ entryTranslation(entry) || '暂无可用译义' }}</p>
              <small v-if="latestContext(entry)?.text" class="context-preview">{{ latestContext(entry)?.text }}</small>
              <div class="word-meta">
                <span v-if="entry.partOfSpeech">{{ entry.partOfSpeech }}</span>
                <span>{{ entry.encounterCount }} 次收藏记录</span>
                <a v-if="latestContext(entry)?.sourceUrl" :href="latestContext(entry)?.sourceUrl" target="_blank" rel="noreferrer">{{ sourceHost(latestContext(entry)?.sourceUrl) }}<ExternalLink class="inline-link-icon" aria-hidden="true" /></a>
              </div>
            </div>
            <div class="word-progress">
              <span class="status-pill" :class="`status-${entry.status}`">{{ statusLabel(entry.status) }}</span>
              <small>{{ nextReviewLabel(entry) }}</small>
              <div class="row-actions">
                <button v-if="entry.status !== 'mastered'" type="button" :disabled="actionBusy" @click="setMastered(entry)"><Check class="button-icon" aria-hidden="true" />标记掌握</button>
                <button v-else type="button" :disabled="actionBusy" @click="relearn(entry)"><RotateCcw class="button-icon" aria-hidden="true" />重新学习</button>
                <button type="button" class="danger" :disabled="actionBusy" @click="removeEntry(entry)"><Trash2 class="button-icon" aria-hidden="true" />删除</button>
              </div>
            </div>
          </article>

          <nav v-if="pageCount > 1" class="pagination" aria-label="单词本分页">
            <button type="button" :disabled="page <= 1" @click="page -= 1"><ArrowLeft class="button-icon" aria-hidden="true" />上一页</button>
            <span>第 {{ page }} / {{ pageCount }} 页 · 共 {{ filteredEntries.length }} 个</span>
            <button type="button" :disabled="page >= pageCount" @click="page += 1">下一页<ArrowRight class="button-icon" aria-hidden="true" /></button>
          </nav>
        </section>

        <section class="data-panel">
          <div class="data-heading"><div><h3>独立备份与迁移</h3><p>不会混入普通配置 JSON，也不会被清除翻译缓存。</p></div></div>
          <label class="privacy-export"><input v-model="includePrivateContext" type="checkbox" /><span><strong>导出上下文和来源</strong><small>可能包含浏览过的页面标题、文本片段与去参数后的网址，默认不导出。</small></span></label>
          <div class="data-actions">
            <button type="button" :disabled="actionBusy || entries.length === 0" @click="exportJson"><Download class="button-icon" aria-hidden="true" />导出 FluentRead JSON</button>
            <button type="button" :disabled="actionBusy || entries.length === 0" @click="exportAnki"><Download class="button-icon" aria-hidden="true" />导出 Anki TSV</button>
            <button type="button" :disabled="actionBusy" @click="importInput?.click()"><Upload class="button-icon" aria-hidden="true" />合并导入 JSON</button>
            <button type="button" class="danger" :disabled="actionBusy || entries.length === 0" @click="clearAll"><Trash2 class="button-icon" aria-hidden="true" />清空单词本</button>
            <input ref="import-input" class="visually-hidden" type="file" accept="application/json,.json" @change="importJson" />
          </div>
        </section>
      </template>
    </template>

    <div v-if="toastMessage" class="book-toast" role="status">
      <span>{{ toastMessage }}</span><button v-if="undoExport" type="button" @click="undoRemove"><Undo2 class="button-icon" aria-hidden="true" />撤销</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from 'vue';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  CircleCheck,
  Download,
  ExternalLink,
  HardDrive,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  Undo2,
  Upload,
  X,
} from '@lucide/vue';
import {browser} from 'wxt/browser';
import {
  config as runtimeConfig,
  configReady,
  requestConfigSave,
  subscribeConfig,
} from '@/src/services/config/store';
import {
  buildAnkiTsv,
  buildVocabularyCloze,
  advanceVocabularyReviewSession,
  createVocabularyLifecycleGuard,
  createVocabularyReviewSession,
  reconcileVocabularyReviewSession,
  vocabularyReviewSessionProgress,
  VOCABULARY_BOOK_CHANGED_MESSAGE,
  VOCABULARY_BOOK_EXPORT_FORMAT,
  VOCABULARY_BOOK_EXPORT_VERSION,
  VOCABULARY_BOOK_MESSAGE,
  type VocabularyBookChangedMessage,
  type VocabularyBookExport,
  type VocabularyBookRequest,
  type VocabularyBookResponse,
  type VocabularyContext,
  type VocabularyEntry,
  type VocabularyImportResult,
  type VocabularyRemovalSnapshot,
  type VocabularyReviewResult,
  type VocabularyReviewSessionState,
  type VocabularyScheduledReviewRating,
  type VocabularyStatus,
  vocabularyImportNeedsConfirmation,
} from '@/src/features/vocabulary/learningModel';

const emit = defineEmits<{ navigate: [section: string] }>();
const importInput = useTemplateRef<HTMLInputElement>('import-input');
const betaEnabled = ref(false);
const selectionTranslatorEnabled = ref(false);
const targetLanguageKey = ref('');
const configBusy = ref(false);
const entries = ref<VocabularyEntry[]>([]);
const loading = ref(false);
const actionBusy = ref(false);
const loadError = ref('');
const query = ref('');
const statusFilter = ref<'all' | 'due' | VocabularyStatus>('all');
const sortOrder = ref<'due' | 'recent' | 'term'>('due');
const includePrivateContext = ref(false);
const page = ref(1);
const pageSize = 50;
const reviewBatchSize = 20;
const reviewQueue = ref<VocabularyEntry[]>([]);
const reviewIndex = ref(0);
const reviewAnswerVisible = ref(false);
const reviewStarted = ref(false);
const reviewStats = ref({ reviewed: 0, good: 0, again: 0 });
const toastMessage = ref('');
// Keep the structured-clone snapshot raw so browser.runtime.sendMessage never receives a Vue Proxy.
const undoExport = shallowRef<VocabularyBookExport | null>(null);
const currentTime = ref(Date.now());
const lifecycle = createVocabularyLifecycleGuard();
let toastTimer: number | null = null;
let timeRefreshTimer: number | null = null;
let darkMedia: MediaQueryList | null = null;
let loadRequestGeneration = 0;
let completedLoadGeneration = 0;
let loadLoopPromise: Promise<void> | null = null;

const reviewActive = computed(() => reviewStarted.value);
const reviewSessionProgress = computed(() => vocabularyReviewSessionProgress(reviewSessionState()));
const currentReview = computed(() => reviewSessionProgress.value.current);
const reviewTotal = computed(() => reviewSessionProgress.value.total);
const reviewPosition = computed(() => reviewSessionProgress.value.position);
const dueEntries = computed(() => entries.value
  .filter(entry => entry.nextReviewAt !== null && entry.nextReviewAt <= currentTime.value)
  .sort((left, right) => (left.nextReviewAt || 0) - (right.nextReviewAt || 0)));
const reviewPlan = computed(() => {
  const scheduled = dueEntries.value.filter(entry => entry.status !== 'new').slice(0, reviewBatchSize);
  const fresh = dueEntries.value
    .filter(entry => entry.status === 'new')
    .slice(0, Math.min(10, reviewBatchSize - scheduled.length));
  return [...scheduled, ...fresh];
});
const statusCounts = computed(() => entries.value.reduce((counts, entry) => {
  counts[entry.status] += 1;
  return counts;
}, { new: 0, learning: 0, familiar: 0, mastered: 0 }));
const filteredEntries = computed(() => {
  const keyword = query.value.toLocaleLowerCase();
  const filtered = entries.value.filter(entry => {
    if (statusFilter.value === 'due' && !(entry.nextReviewAt !== null && entry.nextReviewAt <= currentTime.value)) return false;
    if (statusFilter.value !== 'all' && statusFilter.value !== 'due' && entry.status !== statusFilter.value) return false;
    if (!keyword) return true;
    const searchable = [
      entry.term,
      entry.normalizedTerm,
      ...Object.values(entry.translations).map(item => item.text),
      ...entry.contexts.map(context => `${context.text} ${context.pageTitle || ''}`),
    ].join(' ').toLocaleLowerCase();
    return searchable.includes(keyword);
  });
  return filtered.sort((left, right) => {
    if (sortOrder.value === 'term') return left.normalizedTerm.localeCompare(right.normalizedTerm);
    if (sortOrder.value === 'recent') return right.lastSeenAt - left.lastSeenAt;
    return (left.nextReviewAt ?? Number.MAX_SAFE_INTEGER) - (right.nextReviewAt ?? Number.MAX_SAFE_INTEGER)
      || left.createdAt - right.createdAt;
  });
});
const pageCount = computed(() => Math.max(1, Math.ceil(filteredEntries.value.length / pageSize)));
const pagedEntries = computed(() => filteredEntries.value.slice((page.value - 1) * pageSize, page.value * pageSize));
const currentClozeContext = computed(() => {
  const entry = currentReview.value;
  const context = entry ? latestContext(entry)?.text : '';
  if (!entry || !context) return '';
  return buildVocabularyCloze(context, entry.term);
});

watch([query, statusFilter, sortOrder], () => { page.value = 1; });
watch(pageCount, count => { if (page.value > count) page.value = count; });

async function requestVocabulary<T>(request: VocabularyBookRequest): Promise<T> {
  const response = await browser.runtime.sendMessage(request) as VocabularyBookResponse<T>;
  if (!response?.success) throw new Error(response?.error?.message || '单词本操作失败');
  return response.data;
}

function applyTheme(): void {
  const dark = runtimeConfig.theme === 'dark'
    || (runtimeConfig.theme === 'auto' && Boolean(darkMedia?.matches));
  document.documentElement.classList.toggle('dark', dark);
}

function scheduleTimeRefresh(): void {
  if (timeRefreshTimer !== null) window.clearTimeout(timeRefreshTimer);
  timeRefreshTimer = null;
  if (!lifecycle.isActive()) return;
  const timestamp = Date.now();
  currentTime.value = timestamp;
  if (document.visibilityState === 'hidden') return;

  const nearestDueAt = entries.value.reduce((nearest, entry) => {
    if (entry.nextReviewAt === null || entry.nextReviewAt <= timestamp) return nearest;
    return Math.min(nearest, entry.nextReviewAt);
  }, Number.POSITIVE_INFINITY);
  const untilNextMinute = 60_000 - (timestamp % 60_000);
  const untilNearestDue = nearestDueAt - timestamp;
  const delay = Math.max(100, Math.min(untilNextMinute, untilNearestDue));
  timeRefreshTimer = window.setTimeout(scheduleTimeRefresh, delay + 20);
}

function handleVisibilityChange(): void {
  if (!lifecycle.isActive()) return;
  scheduleTimeRefresh();
  if (document.visibilityState === 'visible') void loadEntries();
}

async function loadEntries(): Promise<void> {
  if (!lifecycle.isActive()) return;
  loadRequestGeneration += 1;
  if (loadLoopPromise) return loadLoopPromise;
  loadLoopPromise = runLoadEntriesLoop().finally(() => { loadLoopPromise = null; });
  return loadLoopPromise;
}

async function runLoadEntriesLoop(): Promise<void> {
  if (!lifecycle.isActive()) return;
  loading.value = true;
  loadError.value = '';
  try {
    while (lifecycle.isActive() && completedLoadGeneration < loadRequestGeneration) {
      const generation = loadRequestGeneration;
      try {
        const nextEntries = await requestVocabulary<VocabularyEntry[]>({ type: VOCABULARY_BOOK_MESSAGE, action: 'list' });
        if (lifecycle.isActive() && generation === loadRequestGeneration) {
          entries.value = nextEntries;
          loadError.value = '';
          reconcileActiveReviewQueue();
        }
      } catch (cause) {
        if (lifecycle.isActive() && generation === loadRequestGeneration) {
          loadError.value = cause instanceof Error ? cause.message : '无法读取本地单词本';
        }
      } finally {
        completedLoadGeneration = generation;
      }
    }
  } finally {
    if (lifecycle.isActive()) {
      loading.value = false;
      scheduleTimeRefresh();
    }
  }
}

async function setBetaEnabled(enabled: boolean): Promise<void> {
  if (configBusy.value) return;
  const previous = runtimeConfig.vocabularyBookEnabled;
  configBusy.value = true;
  runtimeConfig.vocabularyBookEnabled = enabled;
  betaEnabled.value = enabled;
  try {
    await requestConfigSave(runtimeConfig, browser.runtime.sendMessage.bind(browser.runtime));
    showToast(enabled ? '单词本 Beta 已开启' : '收藏入口已关闭，学习数据仍保留');
  } catch (cause) {
    runtimeConfig.vocabularyBookEnabled = previous;
    betaEnabled.value = previous;
    showToast(cause instanceof Error ? cause.message : '设置保存失败');
  } finally {
    configBusy.value = false;
  }
}

function replaceEntry(next: VocabularyEntry): void {
  const index = entries.value.findIndex(entry => entry.id === next.id);
  if (index < 0) entries.value = [next, ...entries.value];
  else entries.value.splice(index, 1, next);
  scheduleTimeRefresh();
}

function reviewSessionState(): VocabularyReviewSessionState {
  return {
    queue: reviewQueue.value,
    completed: reviewIndex.value,
    answerVisible: reviewAnswerVisible.value,
  };
}

function applyReviewSession(session: VocabularyReviewSessionState): void {
  reviewQueue.value = session.queue;
  reviewIndex.value = session.completed;
  reviewAnswerVisible.value = session.answerVisible;
}

function reconcileActiveReviewQueue(): void {
  if (!reviewActive.value || actionBusy.value) return;
  applyReviewSession(reconcileVocabularyReviewSession(
    reviewSessionState(),
    entries.value,
    Date.now(),
  ));
}

function startReview(): void {
  applyReviewSession(createVocabularyReviewSession(reviewPlan.value));
  reviewStats.value = { reviewed: 0, good: 0, again: 0 };
  reviewStarted.value = reviewQueue.value.length > 0;
}

function finishReview(): void {
  reviewStarted.value = false;
  applyReviewSession(createVocabularyReviewSession([]));
}

async function rateReview(rating: VocabularyScheduledReviewRating): Promise<void> {
  const entry = currentReview.value;
  if (!entry || actionBusy.value) return;
  actionBusy.value = true;
  try {
    const result = await requestVocabulary<VocabularyReviewResult>({
      type: VOCABULARY_BOOK_MESSAGE,
      action: 'review',
      entryId: entry.id,
      rating,
    });
    replaceEntry(result.entry);
    reviewStats.value.reviewed += 1;
    reviewStats.value[rating] += 1;
    applyReviewSession(advanceVocabularyReviewSession(reviewSessionState(), entry.id));
  } catch (cause) {
    showToast(cause instanceof Error ? cause.message : '复习记录保存失败');
  } finally {
    try {
      await loadEntries();
    } finally {
      actionBusy.value = false;
      reconcileActiveReviewQueue();
    }
  }
}

async function setMastered(entry: VocabularyEntry): Promise<void> {
  if (actionBusy.value) return;
  actionBusy.value = true;
  try {
    const result = await requestVocabulary<VocabularyReviewResult>({ type: VOCABULARY_BOOK_MESSAGE, action: 'setMastery', entryId: entry.id });
    replaceEntry(result.entry);
    showToast(`${entry.term} 已标记为掌握`);
  } catch (cause) { showToast(cause instanceof Error ? cause.message : '更新失败'); }
  finally { actionBusy.value = false; }
}

async function relearn(entry: VocabularyEntry): Promise<void> {
  if (actionBusy.value) return;
  actionBusy.value = true;
  try {
    const result = await requestVocabulary<VocabularyReviewResult>({ type: VOCABULARY_BOOK_MESSAGE, action: 'relearn', entryId: entry.id });
    replaceEntry(result.entry);
    showToast(`${entry.term} 已回到学习队列`);
  } catch (cause) { showToast(cause instanceof Error ? cause.message : '更新失败'); }
  finally { actionBusy.value = false; }
}

async function removeEntry(entry: VocabularyEntry): Promise<void> {
  if (actionBusy.value || !window.confirm(`确认删除“${entry.term}”及其复习记录吗？`)) return;
  actionBusy.value = true;
  try {
    const snapshot = await requestVocabulary<VocabularyRemovalSnapshot | null>({
      type: VOCABULARY_BOOK_MESSAGE,
      action: 'removeWithSnapshot',
      entryId: entry.id,
    });
    if (!snapshot) throw new Error('词条已不存在');
    entries.value = entries.value.filter(item => item.id !== entry.id);
    undoExport.value = {
      format: VOCABULARY_BOOK_EXPORT_FORMAT,
      version: VOCABULARY_BOOK_EXPORT_VERSION,
      exportedAt: Date.now(),
      includesPrivateContext: true,
      entries: [snapshot.entry],
      reviewLogs: snapshot.reviewLogs,
    };
    scheduleTimeRefresh();
    showToast(`已删除 ${entry.term}`, true);
  } catch (cause) { showToast(cause instanceof Error ? cause.message : '删除失败'); }
  finally { actionBusy.value = false; }
}

async function undoRemove(): Promise<void> {
  const data = undoExport.value;
  if (!data || actionBusy.value) return;
  actionBusy.value = true;
  try {
    await requestVocabulary<VocabularyImportResult>({ type: VOCABULARY_BOOK_MESSAGE, action: 'importData', data });
    undoExport.value = null;
    await loadEntries();
    showToast('已恢复刚才删除的词条');
  } catch (cause) { showToast(cause instanceof Error ? cause.message : '恢复失败'); }
  finally { actionBusy.value = false; }
}

async function exportJson(): Promise<void> {
  actionBusy.value = true;
  try {
    const data = await requestVocabulary<VocabularyBookExport>({
      type: VOCABULARY_BOOK_MESSAGE,
      action: 'exportData',
      options: { includePrivateContext: includePrivateContext.value },
    });
    downloadFile(`fluentread-vocabulary-${dateStamp()}.json`, JSON.stringify(data, null, 2), 'application/json;charset=utf-8');
    showToast(`已导出 ${data.entries.length} 个词条`);
  } catch (cause) { showToast(cause instanceof Error ? cause.message : '导出失败'); }
  finally { actionBusy.value = false; }
}

function exportAnki(): void {
  const header = ['Term', 'Meaning', 'Context', 'Source', 'Tags'];
  const rows = entries.value.map(entry => {
    const context = includePrivateContext.value ? latestContext(entry) : undefined;
    return [
      entry.term,
      entryTranslation(entry),
      context?.text || '',
      context?.sourceUrl || '',
      `fluentread ${entry.status}`,
    ];
  });
  const body = buildAnkiTsv(header, rows);
  downloadFile(`fluentread-anki-${dateStamp()}.tsv`, `\uFEFF${body}`, 'text/tab-separated-values;charset=utf-8');
  showToast(`已导出 ${rows.length} 个 Anki 词条`);
}

async function importJson(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (vocabularyImportNeedsConfirmation(file.size)) {
    const sizeMb = Math.ceil(file.size / (1024 * 1024));
    if (!window.confirm(`这个备份约 ${sizeMb} MB，读取和校验可能需要较长时间。确认继续吗？`)) return;
  }
  actionBusy.value = true;
  try {
    const data = JSON.parse(await file.text()) as unknown;
    const count = Array.isArray((data as { entries?: unknown[] })?.entries) ? (data as { entries: unknown[] }).entries.length : 0;
    if (!window.confirm(`将把文件中的 ${count} 个词条合并到当前单词本，继续吗？`)) return;
    const result = await requestVocabulary<VocabularyImportResult>({ type: VOCABULARY_BOOK_MESSAGE, action: 'importData', data });
    await loadEntries();
    showToast(`导入完成：新增 ${result.inserted}，更新 ${result.updated}，跳过 ${result.skipped}`);
  } catch (cause) { showToast(cause instanceof Error ? cause.message : 'JSON 文件无效'); }
  finally { actionBusy.value = false; }
}

async function clearAll(): Promise<void> {
  if (!window.confirm('确认清空全部词条和复习记录吗？此操作无法撤销。')) return;
  actionBusy.value = true;
  try {
    await requestVocabulary<boolean>({ type: VOCABULARY_BOOK_MESSAGE, action: 'clear' });
    entries.value = [];
    scheduleTimeRefresh();
    finishReview();
    showToast('单词本已清空');
  } catch (cause) { showToast(cause instanceof Error ? cause.message : '清空失败'); }
  finally { actionBusy.value = false; }
}

function entryTranslation(entry: VocabularyEntry): string {
  const preferred = entry.translations[targetLanguageKey.value];
  if (preferred?.text) return preferred.text;
  return Object.values(entry.translations).sort((left, right) => right.updatedAt - left.updatedAt)[0]?.text || '';
}
function latestContext(entry: VocabularyEntry): VocabularyContext | undefined { return entry.contexts[entry.contexts.length - 1]; }
function sourceHost(value?: string): string {
  if (!value) return '';
  try { return new URL(value).hostname; } catch { return '收藏来源'; }
}
function statusLabel(status: VocabularyStatus): string { return ({ new: '新词', learning: '学习中', familiar: '熟悉', mastered: '已掌握' })[status]; }
function nextReviewLabel(entry: VocabularyEntry): string {
  if (entry.nextReviewAt === null) return '未安排复习';
  const delta = entry.nextReviewAt - currentTime.value;
  if (delta <= 0) return '现在可以复习';
  if (delta < 60 * 60 * 1000) return `${Math.max(1, Math.ceil(delta / 60000))} 分钟后`;
  if (delta < 24 * 60 * 60 * 1000) return `${Math.ceil(delta / 3600000)} 小时后`;
  return `${Math.ceil(delta / 86400000)} 天后`;
}
function normalizeLanguageKey(value: unknown): string {
  const normalized = String(value ?? '').trim().replaceAll('_', '-').toLowerCase();
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) ? normalized : '';
}
function goodIntervalLabel(entry: VocabularyEntry): string {
  return ['1 天后', '1 天后', '3 天后', '7 天后', '14 天后', '30 天后'][Math.min(5, entry.masteryLevel + 1)] || '30 天后';
}
function dateStamp(): string { return new Date().toISOString().slice(0, 10); }
function downloadFile(name: string, body: string, type: string): void {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function showToast(message: string, keepUndo = false): void {
  if (!lifecycle.isActive()) return;
  toastMessage.value = message;
  if (!keepUndo) undoExport.value = null;
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toastMessage.value = ''; undoExport.value = null; }, keepUndo ? 5000 : 2600);
}

function handleBookChanged(message: unknown): undefined {
  if (lifecycle.isActive() && (message as VocabularyBookChangedMessage)?.type === VOCABULARY_BOOK_CHANGED_MESSAGE) void loadEntries();
  return undefined;
}
function handleReviewKeyboard(event: KeyboardEvent): void {
  if (!lifecycle.isActive() || !reviewActive.value || actionBusy.value) return;
  const target = event.target as HTMLElement | null;
  if (target?.matches('input, textarea, select, button, a')) return;
  if (event.key === 'Escape') { event.preventDefault(); finishReview(); return; }
  if (event.code === 'Space' && currentReview.value && !reviewAnswerVisible.value) {
    event.preventDefault(); reviewAnswerVisible.value = true; return;
  }
  if (!reviewAnswerVisible.value) return;
  if (event.key === '1') { event.preventDefault(); void rateReview('again'); }
  if (event.key === '2') { event.preventDefault(); void rateReview('good'); }
}

let unsubscribeConfig: (() => void) | null = null;
onMounted(async () => {
  darkMedia = window.matchMedia('(prefers-color-scheme: dark)');
  darkMedia.addEventListener('change', applyTheme);
  await lifecycle.runAfterReady(configReady, async () => {
    betaEnabled.value = runtimeConfig.vocabularyBookEnabled;
    selectionTranslatorEnabled.value = runtimeConfig.selectionTranslatorMode !== 'disabled';
    targetLanguageKey.value = normalizeLanguageKey(runtimeConfig.to);
    applyTheme();
    unsubscribeConfig = subscribeConfig(next => {
      betaEnabled.value = next.vocabularyBookEnabled;
      selectionTranslatorEnabled.value = next.selectionTranslatorMode !== 'disabled';
      targetLanguageKey.value = normalizeLanguageKey(next.to);
      applyTheme();
    });
    browser.runtime.onMessage.addListener(handleBookChanged);
    window.addEventListener('keydown', handleReviewKeyboard);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    await loadEntries();
  });
});

onBeforeUnmount(() => {
  lifecycle.dispose();
  unsubscribeConfig?.();
  browser.runtime.onMessage.removeListener(handleBookChanged);
  window.removeEventListener('keydown', handleReviewKeyboard);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  darkMedia?.removeEventListener('change', applyTheme);
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  if (timeRefreshTimer !== null) window.clearTimeout(timeRefreshTimer);
});
</script>

<style scoped>
.vocabulary-book { position: relative; display: grid; gap: 12px; color: #172033; }
.beta-panel, .privacy-note, .selection-reminder, .review-shell { border: 1px solid #e6e8ef; border-radius: 10px; background: #fff; }
.beta-panel { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 13px 14px; }
.beta-panel.enabled { border-color: rgba(239, 71, 118, .25); }
.beta-copy { display: flex; min-width: 0; align-items: flex-start; gap: 10px; }
.beta-copy h3, .data-heading h3 { margin: 0; font-size: 15px; }
.beta-copy p, .data-heading p { margin: 5px 0 0; color: #737c8f; font-size: 11px; line-height: 1.55; }
.beta-mark { flex: none; padding: 4px 7px; border-radius: 7px; color: #d72f61; background: #ffe8ef; font-size: 9px; font-weight: 800; letter-spacing: .06em; }
.beta-switch { position: relative; flex: none; width: 48px; height: 28px; padding: 3px; border: 0; border-radius: 999px; background: #cfd3dc; cursor: pointer; }
.beta-switch i { display: block; width: 22px; height: 22px; border-radius: 50%; background: #fff; box-shadow: 0 2px 5px rgba(0,0,0,.16); transition: transform 180ms ease; }
.beta-switch[aria-checked="true"] { background: #ef4776; }
.beta-switch[aria-checked="true"] i { transform: translateX(20px); }
.selection-reminder { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; border-color: #f2d59f; color: #7e5912; background: #fff9ec; font-size: 11px; }
.selection-reminder button { display: inline-flex; align-items: center; gap: 5px; border: 0; color: #a56600; background: transparent; cursor: pointer; font: inherit; font-weight: 800; }
.privacy-note { display: flex; align-items: center; gap: 10px; padding: 11px 12px; color: #365f54; background: #f1fbf7; }
.privacy-note > span { display: grid; width: 28px; height: 28px; place-items: center; border-radius: 7px; background: #dff5ec; font-size: 15px; }
.privacy-note-icon svg { width: 16px; height: 16px; }
.privacy-note div { display: flex; flex-direction: column; }
.privacy-note strong { font-size: 11px; }
.privacy-note small { margin-top: 3px; color: #628078; font-size: 9.5px; line-height: 1.45; }
.summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.summary-grid article { display: flex; min-height: 76px; padding: 12px; border: 1px solid #e8eaf0; border-radius: 8px; background: #fbfcfe; flex-direction: column; }
.summary-grid span { color: #737c8f; font-size: 10px; font-weight: 700; }
.summary-grid strong { margin: 8px 0 0; color: #172033; font-size: 24px; line-height: 1; }
.primary-actions { display: flex; align-items: stretch; gap: 8px; padding: 0; background: transparent; }
.start-review { display: flex; min-height: 48px; padding: 8px 13px; border: 0; border-radius: 8px; color: #fff; background: #ef4776; flex: 1; align-items: center; gap: 10px; text-align: left; cursor: pointer; }
.start-review:disabled { color: #8c94a3; background: #e8eaf0; cursor: not-allowed; }
.start-review > span:first-child { display: grid; width: 26px; height: 26px; place-items: center; border-radius: 50%; background: rgba(255,255,255,.18); }
.start-review > span:first-child svg { width: 13px; height: 13px; fill: currentColor; }
.start-review strong { font-size: 12px; }
.refresh-button { display: inline-flex; min-width: 70px; align-items: center; justify-content: center; gap: 5px; border: 1px solid #e1e4ec; border-radius: 8px; color: #dc315f; background: #fff; cursor: pointer; font-size: 10px; font-weight: 750; }
.toolbar { display: grid; grid-template-columns: minmax(220px, 1fr) 150px 150px; gap: 8px; padding: 0; background: transparent; }
.search-field { display: flex; height: 40px; align-items: center; gap: 8px; padding: 0 11px; border: 1px solid #e1e4ec; border-radius: 8px; background: #fff; transition: border-color 140ms ease, box-shadow 140ms ease; }
.search-field:focus-within { border-color: #ef4776; box-shadow: 0 0 0 3px rgba(239, 71, 118, .1); }
.search-field-icon { width: 16px; height: 16px; flex: none; color: #8b93a2; }
.search-field input { width: 100%; border: 0; outline: 0; color: #172033; background: transparent; font-size: 11px; }
.toolbar-select { width: 100%; min-width: 0; }
.toolbar-select :deep(.el-select__wrapper) {
  min-height: 40px;
  padding: 0 10px;
  border: 1px solid #e1e4ec;
  border-radius: 8px;
  background: #fff;
  box-shadow: none;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}
.toolbar-select :deep(.el-select__wrapper:hover) { border-color: #ef9ab1; }
.toolbar-select :deep(.el-select__wrapper.is-focused) {
  border-color: #ef4776;
  box-shadow: 0 0 0 3px rgba(239, 71, 118, .1);
}
.toolbar-select :deep(.el-select__selected-item) { color: #172033; font-size: 10px; }
.toolbar-select :deep(.el-select__caret) { color: #8b93a2; }
.word-list { display: grid; gap: 0; border-top: 1px solid #e8eaf0; }
.word-row { display: grid; grid-template-columns: minmax(0, 1fr) 190px; gap: 16px; padding: 14px 4px; border-bottom: 1px solid #e8eaf0; background: transparent; }
.word-main { min-width: 0; }
.word-heading { display: flex; min-width: 0; align-items: baseline; gap: 9px; }
.word-heading h3 { min-width: 0; margin: 0; overflow-wrap: anywhere; color: #172033; font-size: 19px; }
.word-heading > span { color: #886373; font-family: Georgia, serif; font-size: 12px; }
.word-main > p { margin: 7px 0 0; overflow-wrap: anywhere; color: #383f4c; font-size: 12px; font-weight: 650; white-space: pre-wrap; }
.context-preview { display: -webkit-box; margin-top: 8px; overflow: hidden; overflow-wrap: anywhere; color: #737c8f; font-size: 10px; line-height: 1.5; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.word-meta { display: flex; flex-wrap: wrap; gap: 5px 10px; margin-top: 9px; color: #9299a8; font-size: 9px; }
.word-meta a { display: inline-flex; align-items: center; gap: 3px; color: #b03c62; text-decoration: none; }
.word-progress { display: flex; align-items: flex-end; flex-direction: column; }
.word-progress > small { margin-top: 7px; color: #737c8f; font-size: 9px; }
.status-pill { display: inline-flex; padding: 4px 8px; border-radius: 6px; font-size: 9px; font-weight: 800; }
.status-new { color: #7c5c13; background: #fff2cc; }
.status-learning { color: #b23b61; background: #ffe8f0; }
.status-familiar { color: #2a68a1; background: #e8f3ff; }
.status-mastered { color: #17765a; background: #e3f7ef; }
.row-actions { display: flex; gap: 6px; margin-top: auto; padding-top: 14px; }
.row-actions button, .data-actions button, .pagination button { display: inline-flex; min-height: 30px; align-items: center; justify-content: center; gap: 5px; padding: 0 9px; border: 1px solid #e1e4ec; border-radius: 7px; color: #4a5261; background: #fff; cursor: pointer; font-size: 9px; font-weight: 700; }
.row-actions button:hover, .data-actions button:hover, .pagination button:hover { border-color: #ef9ab1; color: #dc315f; }
button.danger { color: #c53d4f; }
button:disabled { cursor: not-allowed; opacity: .55; }
.pagination { display: flex; align-items: center; justify-content: center; gap: 12px; padding-top: 7px; }
.pagination span { color: #737c8f; font-size: 9px; }
.data-panel { padding: 14px 0 0; border-top: 1px solid #e6e8ef; background: transparent; }
.data-heading { display: flex; align-items: flex-start; justify-content: space-between; }
.privacy-export { display: flex; gap: 9px; margin-top: 12px; padding: 10px; border: 1px solid #e5e8ef; border-radius: 8px; background: #fff; }
.privacy-export input { margin-top: 2px; accent-color: #ef4776; }
.privacy-export span { display: flex; flex-direction: column; }
.privacy-export strong { font-size: 10px; }
.privacy-export small { margin-top: 3px; color: #737c8f; font-size: 9px; line-height: 1.4; }
.data-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.data-actions button { min-height: 34px; padding: 0 11px; background: #fff; }
.empty-state { display: grid; min-height: 170px; place-items: center; align-content: center; gap: 7px; padding: 24px; border: 1px dashed #dfe3eb; border-radius: 10px; color: #9aa1af; background: #fbfcfe; text-align: center; }
.empty-state-icon { width: 28px; height: 28px; }
.empty-state h3, .empty-state p { margin: 0; }
.empty-state h3 { color: #4d5563; font-size: 14px; }
.empty-state p { max-width: 420px; font-size: 10px; line-height: 1.55; }
.loading-ring { width: 24px; height: 24px; border: 2px solid #f6cada; border-top-color: #ef4776; border-radius: 50%; animation: spin .7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.error-state { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; border: 1px solid #f2c7ce; border-radius: 8px; color: #a73045; background: #fff3f5; font-size: 11px; }
.error-state button { display: inline-flex; align-items: center; gap: 5px; border: 0; color: inherit; background: transparent; cursor: pointer; font-weight: 800; }
.review-shell { padding: 14px; }
.review-header { display: flex; align-items: center; justify-content: space-between; }
.review-header strong { font-size: 11px; }
.review-header button { display: inline-flex; align-items: center; gap: 5px; border: 0; color: #737c8f; background: transparent; cursor: pointer; font-size: 10px; }
.review-card { position: relative; display: grid; min-height: 300px; margin-top: 10px; padding: 16px; place-items: center; align-content: center; text-align: center; }
.review-card > .status-pill { position: absolute; align-self: start; justify-self: start; }
.review-prompt { min-width: 0; max-width: 620px; }
.review-prompt h3 { margin: 0; overflow-wrap: anywhere; color: #172033; font-size: 34px; }
.review-prompt small { display: block; margin-top: 10px; color: #8b93a2; font-size: 10px; }
.cloze-context { margin: 20px 0 0; overflow-wrap: anywhere; color: #27303f; font-family: Georgia, serif; font-size: 20px; line-height: 1.65; }
.reveal-button { min-height: 42px; margin-top: 22px; padding: 0 17px; border: 0; border-radius: 8px; color: #fff; background: #ef4776; cursor: pointer; font-size: 11px; font-weight: 750; }
.reveal-button kbd { margin-left: 8px; padding: 2px 6px; border: 1px solid rgba(255,255,255,.35); border-radius: 5px; background: rgba(255,255,255,.12); font: inherit; font-size: 8px; }
.review-answer { width: min(100%, 620px); min-width: 0; margin-top: 20px; }
.answer-heading { display: flex; min-width: 0; align-items: baseline; justify-content: center; gap: 10px; }
.answer-heading h3 { min-width: 0; margin: 0; overflow-wrap: anywhere; color: #172033; font-size: 30px; }
.answer-heading span { color: #8b6474; font-family: Georgia, serif; font-size: 14px; }
.answer-translation { margin: 10px 0 0; overflow-wrap: anywhere; color: #ba315f; font-size: 18px; font-weight: 750; white-space: pre-wrap; }
.answer-context { margin: 12px 0 0; padding: 10px 12px; overflow-wrap: anywhere; border-radius: 8px; color: #606978; background: #f7f8fb; font-size: 10px; line-height: 1.55; text-align: left; }
.review-answer > a { display: inline-flex; align-items: center; gap: 4px; margin-top: 8px; color: #a13b60; font-size: 9px; text-decoration: none; }
.review-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 18px; }
.review-actions button { display: grid; min-height: 54px; grid-template-columns: 22px 1fr; grid-template-rows: 1fr 1fr; padding: 8px 11px; border: 1px solid #e3e6ed; border-radius: 8px; background: #fff; text-align: left; cursor: pointer; }
.review-actions button > span { grid-row: 1 / 3; align-self: center; color: #8b93a2; font-size: 10px; }
.review-actions strong { font-size: 11px; }
.review-actions small { color: #8b93a2; font-size: 8.5px; }
.review-actions .again:hover { border-color: #ef9aa9; background: #fff5f6; }
.review-actions .good:hover { border-color: #70c8ab; background: #f1fbf7; }
.review-complete { display: grid; min-height: 280px; place-items: center; align-content: center; gap: 8px; }
.review-complete > span { display: grid; width: 54px; height: 54px; place-items: center; border-radius: 50%; color: #fff; background: #27ae80; font-size: 25px; }
.review-complete-icon svg { width: 27px; height: 27px; }
.review-complete h3, .review-complete p { margin: 0; }
.review-complete p { color: #737c8f; font-size: 10px; }
.review-complete button { display: inline-flex; min-height: 38px; align-items: center; gap: 6px; margin-top: 10px; padding: 0 15px; border: 0; border-radius: 8px; color: #fff; background: #ef4776; cursor: pointer; font-size: 10px; font-weight: 750; }
.book-toast { position: fixed; z-index: 30; right: 28px; bottom: 24px; display: flex; align-items: center; gap: 12px; padding: 11px 14px; border-radius: 8px; color: #fff; background: #252a33; box-shadow: 0 8px 22px rgba(0,0,0,.2); font-size: 10px; }
.book-toast button { display: inline-flex; align-items: center; gap: 5px; padding: 0; border: 0; color: #ffb8ce; background: transparent; cursor: pointer; font: inherit; font-weight: 800; }
.button-icon { width: 13px; height: 13px; flex: none; }
.inline-link-icon { width: 11px; height: 11px; flex: none; }
.visually-hidden { position: fixed; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

:global(:root.dark .vocabulary-book) { color: #f4f5f8; }
:global(:root.dark .beta-panel), :global(:root.dark .privacy-note), :global(:root.dark .selection-reminder),
:global(:root.dark .review-shell),
:global(:root.dark .privacy-export) { border-color: #343844; background: #20232a; }
:global(:root.dark .word-list), :global(:root.dark .word-row), :global(:root.dark .data-panel) { border-color: #343844; background: transparent; }
:global(:root.dark .summary-grid article), :global(:root.dark .empty-state) { border-color: #343844; background: #252830; }
:global(:root.dark .summary-grid strong), :global(:root.dark .word-heading h3),
:global(:root.dark .review-prompt h3), :global(:root.dark .answer-heading h3),
:global(:root.dark .empty-state h3), :global(:root.dark .search-field input) { color: #f4f5f8; }
:global(:root.dark .beta-copy p), :global(:root.dark .data-heading p),
:global(:root.dark .summary-grid span),
:global(:root.dark .context-preview), :global(:root.dark .word-meta),
:global(:root.dark .word-progress > small), :global(:root.dark .privacy-export small),
:global(:root.dark .review-header button), :global(:root.dark .review-prompt small),
:global(:root.dark .review-actions button > span), :global(:root.dark .review-actions small),
:global(:root.dark .review-complete p) { color: #b8bec9; }
:global(:root.dark .word-heading > span), :global(:root.dark .answer-heading span) { color: #e1aec1; }
:global(:root.dark .review-answer > a) { color: #ff9abb; }
:global(:root.dark .search-field),
:global(:root.dark .refresh-button), :global(:root.dark .row-actions button),
:global(:root.dark .data-actions button), :global(:root.dark .pagination button) { border-color: #3b3f4a; color: #d9dce3; background: #292c34; }
:global(:root.dark .toolbar-select .el-select__wrapper) { border-color: #3b3f4a; background: #292c34; }
:global(:root.dark .toolbar-select .el-select__selected-item) { color: #f4f5f8; }
:global(:root.dark .review-actions button) { border-color: #3b3f4a; color: #e8eaf0; background: #292c34; }
:global(:root.dark .word-main > p), :global(:root.dark .cloze-context) { color: #e5e7eb; }
:global(:root.dark .answer-context) { color: #c1c6d0; background: #292c34; }
:global(:root.dark .privacy-note) { border-color: #2b6152; color: #d7f5eb; background: #19332c; }
:global(:root.dark .privacy-note > span) { color: #d7f5eb; background: #265044; }
:global(:root.dark .privacy-note small) { color: #add9cc; }
:global(:root.dark .selection-reminder) { border-color: #705a31; color: #ffe5af; background: #3a301f; }
:global(:root.dark .selection-reminder button) { color: #ffd37b; }

@media (max-width: 900px) {
  .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .toolbar { grid-template-columns: 1fr 1fr; }
  .search-field { grid-column: 1 / -1; }
  .word-row { grid-template-columns: minmax(0, 1fr); }
  .word-progress { align-items: flex-start; }
}
@media (max-width: 560px) {
  .beta-panel { align-items: flex-start; }
  .word-heading, .answer-heading { flex-wrap: wrap; }
  .summary-grid { grid-template-columns: 1fr; }
  .toolbar { grid-template-columns: 1fr; }
  .search-field { grid-column: auto; }
  .primary-actions { flex-direction: column; }
  .refresh-button { min-height: 38px; }
  .review-card { padding: 18px 13px; }
  .review-actions { grid-template-columns: 1fr; }
  .data-actions { display: grid; grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) { .beta-switch i, .loading-ring { transition: none; animation: none; } }
</style>
