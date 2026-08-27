import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const {mockConfig} = vi.hoisted(() => ({
  mockConfig: {
    service: 'custom',
    from: 'auto',
    to: 'zh-Hans',
    useCache: true,
    enableAIContext: false,
    token: {} as Record<string, string>,
    model: {} as Record<string, string>,
    customModel: {} as Record<string, string>,
    customBody: {} as Record<string, string>,
    system_role: {} as Record<string, string>,
    user_role: {} as Record<string, string>,
    robot_id: {} as Record<string, string>,
    requireApiKey: {} as Record<string, boolean>,
    proxy: {} as Record<string, string>,
    custom: 'http://127.0.0.1:11434/v1/chat/completions',
    deeplx: '',
    newApiUrl: '',
    azureOpenaiEndpoint: '',
    minimaxBillingPlan: 'payg',
    minimaxRegion: 'cn',
    mimoBillingPlan: 'payg',
    mimoRegion: 'cn',
    deepseekApiType: 'auto',
    deepseekThinkingMode: 'disabled',
    youdaoAppKey: '',
    youdaoAppSecret: '',
    tencentSecretId: '',
    tencentSecretKey: '',
  },
}));

vi.mock('@/src/services/config/store', () => ({config: mockConfig}));

import {services} from '@/src/core/config/catalog';
import {translateWithOpenAICompatibleAiSdk} from '@/src/providers/translation/ai-sdk/openai-compatible';
import {normalizeAiSdkError} from '@/src/providers/translation/ai-sdk/errors';
import {
  attachTranslationProviderConfig,
  createTranslationProviderConfigSnapshot,
} from '@/src/services/translation/requestSnapshot';

function successResponse(text = '译文') {
  return new Response(JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 1,
    model: 'test-model',
    choices: [{index: 0, message: {role: 'assistant', content: text}, finish_reason: 'stop'}],
    usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2},
  }), {
    status: 200,
    headers: {'content-type': 'application/json'},
  });
}

function errorResponse(status: number, message: string, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({error: {message, code: `code-${status}`}}), {
    status,
    statusText: 'Provider Error',
    headers: {'content-type': 'application/json', ...headers},
  });
}

describe('Vercel AI SDK OpenAI-compatible transport', () => {
  beforeEach(() => {
    vi.useRealTimers();
    mockConfig.service = services.custom;
    mockConfig.to = 'zh-Hans';
    mockConfig.token = {[services.custom]: 'sk-local-secret-value'};
    mockConfig.model = {[services.custom]: 'base-model'};
    mockConfig.customModel = {};
    mockConfig.customBody = {};
    mockConfig.system_role = {[services.custom]: 'You are a translator.'};
    mockConfig.user_role = {[services.custom]: 'Translate {{origin}} into {{to}}.'};
    mockConfig.proxy = {};
    mockConfig.custom = 'http://127.0.0.1:11434/v1/chat/completions';
    mockConfig.newApiUrl = '';
    mockConfig.azureOpenaiEndpoint = '';
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('preserves custom top-level fields while keeping the SDK-owned stream mode', async () => {
    mockConfig.custom = 'http://127.0.0.1:11434/non-standard-generate';
    mockConfig.customBody[services.custom] = JSON.stringify({
      vendor_flag: 'kept',
      model: 'custom-model',
      stream: true,
    });
    const fetchMock = vi.fn().mockResolvedValue(successResponse());
    vi.stubGlobal('fetch', fetchMock);

    await expect(translateWithOpenAICompatibleAiSdk({
      origin: 'hello',
      serviceOverride: services.custom,
      requestTimeoutMs: 5_000,
    })).resolves.toBe('译文');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:11434/non-standard-generate');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer sk-local-secret-value');
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'custom-model',
      stream: false,
      vendor_flag: 'kept',
    });
  });

  it('uses the broker-attached endpoint, credential, prompt, and custom body snapshot', async () => {
    mockConfig.custom = 'https://snapshot-a.example/v1/chat/completions';
    mockConfig.token[services.custom] = 'snapshot-token-a';
    mockConfig.model[services.custom] = 'snapshot-model-a';
    mockConfig.customBody[services.custom] = '{"temperature":0.2,"snapshot":"a"}';
    mockConfig.system_role[services.custom] = 'snapshot-system-a';
    mockConfig.user_role[services.custom] = 'snapshot-user-a {{origin}} to {{to}}';
    const snapshot = createTranslationProviderConfigSnapshot(mockConfig);

    mockConfig.custom = 'https://snapshot-b.example/v1/chat/completions';
    mockConfig.token[services.custom] = 'snapshot-token-b';
    mockConfig.model[services.custom] = 'snapshot-model-b';
    mockConfig.customBody[services.custom] = '{"temperature":0.9,"snapshot":"b"}';
    mockConfig.system_role[services.custom] = 'snapshot-system-b';
    mockConfig.user_role[services.custom] = 'snapshot-user-b {{origin}} to {{to}}';

    const fetchMock = vi.fn().mockResolvedValue(successResponse());
    vi.stubGlobal('fetch', fetchMock);
    await expect(translateWithOpenAICompatibleAiSdk(attachTranslationProviderConfig({
      origin: 'hello',
      serviceOverride: services.custom,
      targetLanguage: 'fr',
    }, snapshot))).resolves.toBe('译文');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://snapshot-a.example/v1/chat/completions');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer snapshot-token-a');
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: 'snapshot-model-a',
      temperature: 0.2,
      snapshot: 'a',
      messages: [
        {role: 'system', content: 'snapshot-system-a'},
        {role: 'user', content: 'snapshot-user-a hello to fr'},
      ],
    });
  });

  it('classifies a missing custom endpoint as a permanent configuration error', async () => {
    mockConfig.custom = '';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const error = await translateWithOpenAICompatibleAiSdk({
      origin: 'hello',
      serviceOverride: services.custom,
    }).catch((reason) => reason);

    expect(error).toMatchObject({kind: 'bad-request', retryable: false});
    expect(error.message).toContain('未配置');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes OpenAI-specific custom messages without SDK prompt-schema rejection', async () => {
    const customMessages = [
      {role: 'developer', content: 'Return only a translation.'},
      {role: 'user', content: [{type: 'text', text: 'hello'}, {type: 'image_url', image_url: {url: 'data:image/png;base64,AA=='}}]},
    ];
    mockConfig.customBody[services.custom] = JSON.stringify({messages: customMessages});
    const fetchMock = vi.fn().mockResolvedValue(successResponse());
    vi.stubGlobal('fetch', fetchMock);

    await expect(translateWithOpenAICompatibleAiSdk({
      origin: 'hello',
      serviceOverride: services.custom,
    })).resolves.toBe('译文');

    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).messages).toEqual(customMessages);
  });

  it('accepts valid translation text when optional provider metadata is non-standard', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 123,
      created: 'now',
      choices: [{message: {content: '兼容旧 Custom 的译文'}, finish_reason: 0}],
      usage: {prompt_tokens: '12', completion_tokens: '4', total_tokens: '16'},
    }), {
      status: 200,
      headers: {'content-type': 'application/json'},
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(translateWithOpenAICompatibleAiSdk({
      origin: 'hello',
      serviceOverride: services.custom,
    })).resolves.toBe('兼容旧 Custom 的译文');
  });

  it('does not retry permanent authentication errors and redacts secrets', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(
      401,
      `invalid api_key=sk-local-secret-value`,
      {'x-request-id': 'req-auth-test-sk-local-secret-value'},
    ));
    vi.stubGlobal('fetch', fetchMock);

    const error = await translateWithOpenAICompatibleAiSdk({
      origin: 'hello',
      serviceOverride: services.custom,
    }).catch((reason) => reason);

    expect(error).toMatchObject({
      name: 'LlmTransportError',
      kind: 'authentication',
      retryable: false,
      statusCode: 401,
      code: 'code-401',
    });
    expect(error.message).toContain('HTTP 401');
    expect(error.requestId).not.toContain('sk-local-secret-value');
    expect(error.message).toContain('req-auth-test');
    expect(error.message).not.toContain('sk-local-secret-value');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [services.minimax, 'invalid api key (code 2049)', 'Token Plan Key'],
    [services.mimo, 'invalid api key', '集群不匹配'],
  ])('retains specialized credential diagnostics for %s', async (service, providerMessage, expectedDetail) => {
    mockConfig.token[service] = 'sk-provider-test';
    mockConfig.model[service] = 'provider-model';
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(401, providerMessage));
    vi.stubGlobal('fetch', fetchMock);

    const error = await translateWithOpenAICompatibleAiSdk({
      origin: 'hello',
      serviceOverride: service,
    }).catch((reason) => reason);

    expect(error).toMatchObject({kind: 'authentication', retryable: false, statusCode: 401});
    expect(error.message).toContain(expectedDetail);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('lets the SDK retry transient 429 responses and retains Retry-After metadata', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(errorResponse(
      429,
      'rate limited',
      {'retry-after': '1', 'retry-after-ms': '250', 'x-request-id': 'req-rate-test'},
    )));
    vi.stubGlobal('fetch', fetchMock);

    const request = translateWithOpenAICompatibleAiSdk({
      origin: 'hello',
      serviceOverride: services.custom,
      requestTimeoutMs: 30_000,
    });
    const outcome = request.catch((reason) => reason);
    await vi.runAllTimersAsync();
    const error = await outcome;

    expect(error).toMatchObject({
      name: 'LlmTransportError',
      kind: 'rate-limit',
      retryable: true,
      statusCode: 429,
      retryAfterMs: 250,
      requestId: 'req-rate-test',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('classifies a rejected browser fetch for the outer network-only fallback', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);

    const error = await translateWithOpenAICompatibleAiSdk({
      origin: 'hello',
      serviceOverride: services.custom,
    }).catch((reason) => reason);

    expect(error).toMatchObject({
      name: 'LlmTransportError',
      kind: 'network',
      retryable: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not misclassify SDK prompt/schema failures as retryable network errors', () => {
    const invalidPrompt = new Error('messages must not be empty');
    invalidPrompt.name = 'AI_InvalidPromptError';
    expect(normalizeAiSdkError(services.custom, invalidPrompt)).toMatchObject({
      kind: 'bad-request',
      retryable: false,
    });

    expect(normalizeAiSdkError(services.custom, new Error('Unexpected SDK response state'))).toMatchObject({
      kind: 'response',
      retryable: false,
    });
  });

  it('classifies an SDK deadline during Retry-After as timeout, not user cancellation', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(
      429,
      'rate limited',
      {'retry-after': '10'},
    ));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = translateWithOpenAICompatibleAiSdk({
      origin: 'hello',
      serviceOverride: services.custom,
      requestTimeoutMs: 1_000,
    }).catch((reason) => reason);
    await vi.advanceTimersByTimeAsync(1_000);
    const error = await outcome;

    expect(error).toMatchObject({
      name: 'LlmTransportError',
      kind: 'timeout',
      retryable: true,
    });
    expect(error.message).toContain('请求超时');
  });

  it('shares one absolute deadline across a sequential batch', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockImplementation((_input, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(successResponse()), 600);
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        const abortError = new Error('The operation was aborted');
        abortError.name = 'AbortError';
        reject(abortError);
      }, {once: true});
    }));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = translateWithOpenAICompatibleAiSdk({
      origin: ['first', 'second'],
      serviceOverride: services.custom,
      requestTimeoutMs: 1_000,
    }).catch((reason) => reason);
    await vi.advanceTimersByTimeAsync(1_000);
    const error = await outcome;

    expect(error).toMatchObject({kind: 'timeout', retryable: true});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
