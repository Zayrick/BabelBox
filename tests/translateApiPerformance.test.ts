import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mocks = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  getPageTranslationContext: vi.fn(),
  saveConfig: vi.fn(async () => undefined),
  getMissingCredentialMessage: vi.fn(() => null as string | null),
  config: {
    count: 0,
    maxConcurrentTranslations: 6,
    model: {mock: 'mock-model', 'mock-ai': 'mock-ai-model'} as Record<string, string>,
    customModel: {mock: '', 'mock-ai': ''} as Record<string, string>,
    service: 'mock',
    from: 'en',
    to: 'zh-CN',
    useCache: true,
    enableAIContext: false,
    videoService: 'mock',
  },
}));

vi.mock('wxt/browser', () => ({
  browser: {runtime: {sendMessage: mocks.sendMessage}},
}));
vi.mock('@/src/services/config/store', () => ({
  config: mocks.config,
  saveConfig: mocks.saveConfig,
  requestConfigCountIncrement: mocks.saveConfig,
}));
vi.mock('@/src/core/language/detect', () => ({detectlang: () => 'eng'}));
vi.mock('@/src/core/config/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/core/config/catalog')>();
  return {
    ...actual,
    resolveConfiguredModel: (model: string) => model,
    servicesType: {
      ...actual.servicesType,
      isUseAIContext: (service: string) => service === 'mock-ai',
    },
  };
});
vi.mock('@/src/services/translation/context', () => ({getPageTranslationContext: mocks.getPageTranslationContext}));
vi.mock('@/src/core/config/validation', () => ({getMissingCredentialMessage: mocks.getMissingCredentialMessage}));

import {translateText, translateTextBatch, translateVideoText} from '@/src/services/translation/client';
import {clearTranslationQueue} from '@/src/services/translation/queue';

const originalDocument = globalThis.document;
const originalLocation = globalThis.location;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return {promise, resolve, reject};
}

describe('translation API request lifecycle performance', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.sendMessage.mockReset();
    mocks.getPageTranslationContext.mockReset();
    mocks.saveConfig.mockClear();
    mocks.getMissingCredentialMessage.mockReset().mockReturnValue(null);
    mocks.config.count = 0;
    mocks.config.maxConcurrentTranslations = 6;
    mocks.config.enableAIContext = false;
    mocks.config.service = 'mock';
    mocks.config.videoService = 'mock';
    mocks.config.from = 'en';
    mocks.config.to = 'zh-CN';
    mocks.config.useCache = true;
    mocks.config.model.mock = 'mock-model';
    mocks.config.model['mock-ai'] = 'mock-ai-model';
    Object.defineProperty(globalThis, 'document', {
      value: {title: 'Fixture video title'},
      configurable: true,
    });
    Object.defineProperty(globalThis, 'location', {
      value: {protocol: 'https:'},
      configurable: true,
    });
  });

  afterEach(async () => {
    clearTranslationQueue();
    await vi.runAllTimersAsync();
    vi.useRealTimers();
    Object.defineProperty(globalThis, 'document', {value: originalDocument, configurable: true});
    Object.defineProperty(globalThis, 'location', {value: originalLocation, configurable: true});
  });

  it('网页上下文不因无法读取 API Key 而阻止 background 请求', async () => {
    mocks.config.service = 'mock-ai';
    mocks.getMissingCredentialMessage.mockReturnValue('DeepSeek 需要 API Key（访问令牌），当前尚未配置');
    mocks.sendMessage.mockResolvedValue('网页译文');

    await expect(translateText('Readable source', 'Context')).resolves.toBe('网页译文');

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('网页批量翻译不因无法读取 API Key 而被本地拦截', async () => {
    mocks.config.service = 'mock-ai';
    mocks.getMissingCredentialMessage.mockReturnValue('DeepSeek 需要 API Key（访问令牌），当前尚未配置');
    mocks.sendMessage.mockResolvedValue(['网页批量译文']);

    await expect(translateTextBatch(['Readable source'], 'Context'))
      .resolves.toEqual(['网页批量译文']);

    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('扩展页面仍会在本地凭据缺失时快速失败', async () => {
    Object.defineProperty(globalThis, 'location', {
      value: {protocol: 'chrome-extension:'},
      configurable: true,
    });
    mocks.config.service = 'mock-ai';
    mocks.getMissingCredentialMessage.mockReturnValue('DeepSeek 需要 API Key（访问令牌），当前尚未配置');

    await expect(translateText('Readable source', 'Context'))
      .rejects.toThrow('DeepSeek 需要 API Key');

    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });

  it('clears successful request timeouts and coalesces count persistence', async () => {
    mocks.sendMessage.mockResolvedValue('译文');

    const requests = Array.from({length: 24}, (_, index) =>
      translateText(`Readable source ${index}`, 'Context'));
    await expect(Promise.all(requests)).resolves.toHaveLength(24);

    // Every 45-second request timer has been cleared; only the shared 500ms
    // count persistence timer remains.
    expect(vi.getTimerCount()).toBe(1);
    expect(mocks.saveConfig).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.saveConfig).toHaveBeenCalledTimes(1);
    expect(mocks.saveConfig).toHaveBeenCalledWith(24, expect.any(Function));
    expect(mocks.config.count).toBe(24);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('发送独立入口的服务、语言和模型覆盖，不修改网页默认配置', async () => {
    mocks.sendMessage.mockResolvedValue('文档译文');

    await expect(translateText('Document source', 'Document context', {
      serviceOverride: 'mock-ai',
      modelOverride: 'document-model',
      sourceLanguage: 'en',
      targetLanguage: 'ja',
      useCache: false,
    })).resolves.toBe('文档译文');

    expect(mocks.config.service).toBe('mock');
    expect(mocks.config.to).toBe('zh-CN');
    expect(mocks.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      origin: 'Document source',
      serviceOverride: 'mock-ai',
      modelOverride: 'document-model',
      sourceLanguage: 'en',
      targetLanguage: 'ja',
      useCache: false,
      requestTimeoutMs: 44_000,
    }));
    expect(mocks.config.model['mock-ai']).toBe('mock-ai-model');
  });

  it('普通单条和批量请求在排队前冻结默认服务、模型与语言', async () => {
    mocks.config.maxConcurrentTranslations = 1;
    const blocker = deferred<string>();
    mocks.sendMessage.mockImplementation(({origin}: {origin: string | string[]}) => {
      if (origin === 'Blocking source') return blocker.promise;
      return Promise.resolve(Array.isArray(origin) ? origin.map(value => `译:${value}`) : `译:${origin}`);
    });

    const first = translateText('Blocking source', 'Context');
    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(1));
    const queuedSingle = translateText('Queued source', 'Context');
    const queuedBatch = translateTextBatch(['Queued batch source'], 'Context');

    mocks.config.service = 'mock-ai';
    mocks.config.model['mock-ai'] = 'changed-model';
    mocks.config.from = 'ja';
    mocks.config.to = 'fr';
    blocker.resolve('阻塞请求译文');

    await expect(first).resolves.toBe('阻塞请求译文');
    await expect(queuedSingle).resolves.toBe('译:Queued source');
    await expect(queuedBatch).resolves.toEqual(['译:Queued batch source']);

    expect(mocks.sendMessage.mock.calls.slice(1).map(([message]) => message)).toEqual([
      expect.objectContaining({
        origin: 'Queued source',
        serviceOverride: 'mock',
        modelOverride: 'mock-model',
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
      }),
      expect.objectContaining({
        origin: ['Queued batch source'],
        serviceOverride: 'mock',
        modelOverride: 'mock-model',
        sourceLanguage: 'en',
        targetLanguage: 'zh-CN',
      }),
    ]);
  });

  it('视频请求在排队前冻结视频服务、模型与语言', async () => {
    mocks.config.maxConcurrentTranslations = 1;
    const blocker = deferred<string>();
    mocks.sendMessage
      .mockImplementationOnce(() => blocker.promise)
      .mockResolvedValueOnce('字幕译文');

    const first = translateText('Blocking source', 'Context');
    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(1));
    mocks.config.videoService = 'mock-ai';
    mocks.config.model['mock-ai'] = 'video-model';
    mocks.config.from = 'en';
    mocks.config.to = 'ja';
    const video = translateVideoText('Queued subtitle');
    await Promise.resolve();

    mocks.config.videoService = 'mock';
    mocks.config.model['mock-ai'] = 'changed-video-model';
    mocks.config.from = 'de';
    mocks.config.to = 'fr';
    mocks.config.useCache = false;
    blocker.resolve('阻塞请求译文');

    await expect(first).resolves.toBe('阻塞请求译文');
    await expect(video).resolves.toBe('字幕译文');
    expect(mocks.sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      origin: 'Queued subtitle',
      serviceOverride: 'mock-ai',
      modelOverride: 'video-model',
      sourceLanguage: 'en',
      targetLanguage: 'ja',
      useCache: true,
    }));
  });

  it('preserves structured background error details', async () => {
    mocks.config.service = 'mock-ai';
    mocks.sendMessage.mockResolvedValue({
      marker: 'fluentread-translation-error-v1',
      message: '当前翻译服务的 API Key 无效（HTTP 401）。',
      kind: 'authentication',
      retryable: false,
      statusCode: 401,
      requestId: 'req-test',
    });

    const request = translateText('Readable source', 'Context');
    await expect(request).rejects.toMatchObject({
      name: 'TranslationRequestError',
      statusCode: 401,
      retryable: false,
      requestId: 'req-test',
    });
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('aborts the DOM caller immediately but does not release the real transport concurrency slot', async () => {
    mocks.config.maxConcurrentTranslations = 1;
    const firstTransport = deferred<string>();
    mocks.sendMessage
      .mockImplementationOnce(() => firstTransport.promise)
      .mockResolvedValueOnce('第二段译文');
    const controller = new AbortController();
    const first = translateText('First readable source', 'Context', {
      signal: controller.signal,
    });
    const firstOutcome = first.catch((error) => error);

    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(1));
    controller.abort();
    await expect(firstOutcome).resolves.toMatchObject({name: 'AbortError'});

    const second = translateText('Second readable source', 'Context');
    await Promise.resolve();
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);

    firstTransport.resolve('迟到的第一段译文');
    await vi.waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(2));
    await expect(second).resolves.toBe('第二段译文');
  });

  it('releases an aborted caller lease only at transport timeout and removes its abort listener', async () => {
    mocks.config.maxConcurrentTranslations = 1;
    const firstTransport = deferred<string>();
    mocks.sendMessage
      .mockImplementationOnce(() => firstTransport.promise)
      .mockResolvedValueOnce('第二段译文');
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, 'addEventListener');
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const first = translateText('First timeout source', 'Context', {
      signal: controller.signal,
      timeout: 10_000,
    });
    const firstOutcome = first.catch((error) => error);

    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    controller.abort();
    await expect(firstOutcome).resolves.toMatchObject({name: 'AbortError'});
    expect(addListener).toHaveBeenCalledWith('abort', expect.any(Function), {once: true});
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function));

    const second = translateText('Second timeout source', 'Context');
    await vi.advanceTimersByTimeAsync(9_999);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.sendMessage).toHaveBeenCalledTimes(2);
    await expect(second).resolves.toBe('第二段译文');

    // The late raw transport rejection is still observed by waitForRequest.
    firstTransport.reject(new Error('late transport rejection'));
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the video AI service when resolving and sending page context', async () => {
    mocks.config.enableAIContext = true;
    mocks.config.videoService = 'mock-ai';
    const pageContext = 'Page title: Fixture video title\nReadable page context for subtitle terminology.';
    mocks.getPageTranslationContext.mockResolvedValue(pageContext);
    mocks.sendMessage.mockResolvedValue('字幕译文');

    await expect(translateVideoText('A subtitle source')).resolves.toBe('字幕译文');

    expect(mocks.getPageTranslationContext).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessage).toHaveBeenCalledWith({
      type: 'translate',
      context: 'YouTube 视频字幕：Fixture video title',
      pageContext,
      origin: 'A subtitle source',
      useCache: true,
      serviceOverride: 'mock-ai',
      modelOverride: 'mock-ai-model',
      sourceLanguage: 'en',
      targetLanguage: 'zh-CN',
      requestTimeoutMs: 19_000,
    });
  });
});
