import {browser} from 'wxt/browser';
import {detectlang} from '@/src/core/language/detect';
import {servicesType} from '@/src/core/config/catalog';
import {
  getTranslationServiceModel,
  getTranslationServiceProvider,
} from '@/src/core/config/translationServices';
import {getMissingCredentialMessage} from '@/src/core/config/validation';
import {isTrustedCredentialStorageContext} from '@/src/platform/storage/credentialContext';
import {config, requestConfigCountIncrement} from '@/src/services/config/store';
import {getTranslationLanguages} from '@/src/services/translation/languages';
import {getPageTranslationContext} from '@/src/services/translation/context';
import {
  enqueueTranslation,
  clearTranslationQueue,
  type TranslationQueueLease,
  type TranslationQueueSession,
} from '@/src/services/translation/queue';
import {unwrapTranslationResponse} from '@/src/services/translation/errors';

const isDev = process.env.NODE_ENV === 'development';
const VIDEO_COUNT_SAVE_INTERVAL = 10_000;
const TRANSLATION_COUNT_SAVE_INTERVAL = 500;
let videoCountSaveTimer: ReturnType<typeof setTimeout> | undefined;
let translationCountSaveTimer: ReturnType<typeof setTimeout> | undefined;
let pendingVideoCount = 0;
let pendingTranslationCount = 0;

function persistCountIncrement(delta: number): Promise<number> {
  return requestConfigCountIncrement(delta, browser.runtime.sendMessage.bind(browser.runtime));
}

function createAbortError(): Error {
  const error = new Error('翻译已取消');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

function waitForRequest<T>(
  request: PromiseLike<T>,
  timeout: number,
  signal?: AbortSignal,
  lease?: TranslationQueueLease,
): Promise<T> {
  throwIfAborted(signal);
  const transportSettlement = new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => finish(() => reject(new Error('翻译请求超时'))), timeout);
    Promise.resolve(request).then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });

  // Aborting a DOM attempt cannot cancel an already-dispatched extension
  // message. Keep the queue slot leased until that transport settles or its
  // timeout fires, while allowing the caller to stop waiting immediately.
  lease?.holdUntil(transportSettlement);
  if (!signal) return transportSettlement;

  return new Promise<T>((resolve, reject) => {
    let callerSettled = false;
    const finishCaller = (callback: () => void) => {
      if (callerSettled) return;
      callerSettled = true;
      signal.removeEventListener('abort', onAbort);
      callback();
    };
    const onAbort = () => finishCaller(() => reject(createAbortError()));
    signal.addEventListener('abort', onAbort, {once: true});
    if (signal.aborted) {
      onAbort();
      return;
    }
    transportSettlement.then(
      (value) => finishCaller(() => resolve(value)),
      (error) => finishCaller(() => reject(error)),
    );
  });
}

function scheduleTranslationCountSave(): void {
  config.count++;
  pendingTranslationCount++;
  if (translationCountSaveTimer) return;
  translationCountSaveTimer = setTimeout(() => {
    translationCountSaveTimer = undefined;
    const delta = pendingTranslationCount;
    pendingTranslationCount = 0;
    void persistCountIncrement(delta).catch((error) => console.error('[BabelBox] 保存翻译计数失败:', error));
  }, TRANSLATION_COUNT_SAVE_INTERVAL);
}

function flushTranslationCountSave(): void {
  if (!translationCountSaveTimer) return;
  clearTimeout(translationCountSaveTimer);
  translationCountSaveTimer = undefined;
  const delta = pendingTranslationCount;
  pendingTranslationCount = 0;
  void persistCountIncrement(delta).catch((error) => console.error('[BabelBox] 保存翻译计数失败:', error));
}

function scheduleVideoCountSave(): void {
  config.count++;
  pendingVideoCount++;
  if (videoCountSaveTimer) return;

  videoCountSaveTimer = setTimeout(() => {
    videoCountSaveTimer = undefined;
    const delta = pendingVideoCount;
    pendingVideoCount = 0;
    void persistCountIncrement(delta).catch((error) => console.error('[BabelBox] 保存视频翻译计数失败:', error));
  }, VIDEO_COUNT_SAVE_INTERVAL);
}

/**
 * 翻译API的统一入口
 * 所有翻译请求都应该通过此函数发送，以便集中管理队列和请求生命周期
 *
 * @param origin 原始文本
 * @param context 上下文信息，通常是页面标题
 * @param options 翻译选项
 * @returns 翻译结果的Promise
 */
export async function translateText(origin: string, context: string = document.title, options: TranslateOptions = {}): Promise<string> {
  const selectedService = options.serviceOverride || config.service;
  const selectedModel = options.modelOverride || getTranslationServiceModel(config, selectedService);
  const selectedLanguages = getTranslationLanguages(options);
  const {
    timeout = 45000,
    useCache = config.useCache,
    skipLanguageDetection = false,
    signal,
    queueSession,
  } = options;
  throwIfAborted(signal);
  const cleanedOrigin = origin.replace(/[\s\u3000]/g, '');
  if (!cleanedOrigin) return origin;

  assertTranslationCredentials(selectedService, selectedModel);
  if (!skipLanguageDetection && detectlang(origin.replace(/[\s\u3000]/g, '')) === selectedLanguages.targetLanguage) {
    return origin;
  }

  const pageContext = await resolvePageContext(options.pageContext, selectedService, selectedModel);
  throwIfAborted(signal);

  // 同一富文本回退可能产生多个短请求；合并持久化写入，避免每个 slot
  // 都触发 storage watcher 和页面配置刷新。
  scheduleTranslationCountSave();

  return enqueueTranslation(async (lease) => {
    throwIfAborted(signal);
    const response = await waitForRequest(
      browser.runtime.sendMessage({
        type: 'translate',
        context,
        pageContext,
        origin,
        useCache,
        serviceOverride: selectedService,
        sourceLanguage: selectedLanguages.sourceLanguage,
        targetLanguage: selectedLanguages.targetLanguage,
        modelOverride: selectedModel,
        requestTimeoutMs: Math.max(1_000, timeout - 1_000),
      }),
      timeout,
      signal,
      lease,
    );
    const result = unwrapTranslationResponse<string>(response);
    return result;
  }, queueSession);
}

/**
 * 批量翻译纯文本片段。用于仅译文模式保留原始 DOM 结构，避免机器翻译接口修改标签和属性。
 */
export async function translateTextBatch(
  origins: string[],
  context: string = document.title,
  options: TranslateOptions = {},
): Promise<string[]> {
  if (origins.length === 0) return [];

  const selectedService = options.serviceOverride || config.service;
  const selectedModel = options.modelOverride || getTranslationServiceModel(config, selectedService);
  const selectedLanguages = getTranslationLanguages(options);
  const {
    timeout = 45000,
    useCache = config.useCache,
    signal,
    queueSession,
  } = options;
  assertTranslationCredentials(selectedService, selectedModel);
  throwIfAborted(signal);
  const pageContext = await resolvePageContext(options.pageContext, selectedService, selectedModel);
  throwIfAborted(signal);

  scheduleTranslationCountSave();

  return enqueueTranslation(async (lease) => {
    throwIfAborted(signal);
    const response = await waitForRequest(
      browser.runtime.sendMessage({
        type: 'translate',
        context,
        pageContext,
        origin: origins,
        useCache,
        serviceOverride: selectedService,
        sourceLanguage: selectedLanguages.sourceLanguage,
        targetLanguage: selectedLanguages.targetLanguage,
        modelOverride: selectedModel,
        requestTimeoutMs: Math.max(1_000, timeout - 1_000),
      }),
      timeout,
      signal,
      lease,
    );
    const result = unwrapTranslationResponse<string[]>(response);

    if (!Array.isArray(result) || result.length !== origins.length ||
      result.some(item => typeof item !== 'string' || !item.trim())) {
      throw new Error('批量翻译返回格式异常');
    }

    return result;
  }, queueSession);
}

/**
 * 翻译视频字幕。视频字幕使用独立的服务配置，但仍通过 background
 * 统一请求、缓存和错误边界；只发送 YouTube 已提供的纯文本字幕内容。
 */
export async function translateVideoText(origin: string): Promise<string> {
  const cleanedOrigin = origin.replace(/[\s\u3000]/g, '');
  if (!cleanedOrigin) return origin;

  const service = config.videoService;
  const model = getTranslationServiceModel(config, service);
  const languages = getTranslationLanguages();
  const useCache = config.useCache;
  const pageContext = await resolvePageContext(undefined, service, model);

  // 视频字幕是高频、短文本请求。计数保留在内存中，并合并为低频写入。
  scheduleVideoCountSave();
  return enqueueTranslation(async (lease) => {
    const response = await waitForRequest(browser.runtime.sendMessage({
      type: 'translate',
      context: `YouTube 视频字幕：${document.title}`,
      pageContext,
      origin,
      useCache,
      serviceOverride: service,
      modelOverride: model,
      sourceLanguage: languages.sourceLanguage,
      targetLanguage: languages.targetLanguage,
      requestTimeoutMs: 19_000,
    }), 20_000, undefined, lease);
    return unwrapTranslationResponse<string>(response);
  });
}

export function cancelAllTranslations() {
  if (isDev) {
    console.log('[翻译API] 取消所有等待中的翻译任务');
  }
  clearTranslationQueue();
  flushTranslationCountSave();
}

export interface TranslateOptions {
  /** 超时时间(毫秒) */
  timeout?: number;
  /** 是否使用缓存 */
  useCache?: boolean;
  /** 仅对当前请求使用的翻译服务，不改变网页翻译默认服务。 */
  serviceOverride?: string;
  /** 仅对当前请求使用的源语言，不改变通用设置。 */
  sourceLanguage?: string;
  /** 仅对当前请求使用的目标语言，不改变通用设置。 */
  targetLanguage?: string;
  /** 发送给 LLM 的网页参考上下文；未提供时按当前页面自动提取。 */
  pageContext?: string;
  /** Internal structured packets contain ASCII sentinels that must not affect source-language detection. */
  skipLanguageDetection?: boolean;
  /** Stop waiting after the DOM attempt is restored; the dispatched runtime request may still settle later. */
  signal?: AbortSignal;
  /** Queue scope used to reject work that has not started when one DOM attempt is cancelled. */
  queueSession?: TranslationQueueSession;
  /** 为文档等独立入口覆盖当前请求的实际模型，不改写网页翻译配置。 */
  modelOverride?: string;
}

function assertTranslationCredentials(service = config.service, modelOverride?: string): void {
  // Content scripts intentionally receive only the public configuration and
  // therefore cannot inspect API credentials. The background request boundary
  // performs the authoritative check after it has loaded session credentials.
  // Keep the local fast-fail only for extension pages, where the credentials
  // are available by design.
  if (!isTrustedCredentialStorageContext()) return;

  const credentialConfig = modelOverride
    ? {
      ...config,
      model: {...config.model, [service]: modelOverride},
      customModel: {...config.customModel, [service]: modelOverride},
    }
    : config;
  const message = getMissingCredentialMessage(service, credentialConfig);
  if (message) throw new Error(message);
}

async function resolvePageContext(suppliedContext?: string, serviceOverride = config.service, modelOverride?: string): Promise<string | undefined> {
  const service = serviceOverride || config.service;
  const provider = getTranslationServiceProvider(config, service);
  const selectedModel = modelOverride || getTranslationServiceModel(config, service);
  if (!config.enableAIContext || !servicesType.isUseAIContext(provider, selectedModel)) return undefined;
  return suppliedContext?.trim().slice(0, 4000) || await getPageTranslationContext() || undefined;
}
