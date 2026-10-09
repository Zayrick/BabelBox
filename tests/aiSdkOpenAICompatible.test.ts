import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import {services} from '@/src/core/config/catalog';
import {translateWithOpenAICompatibleAiSdk} from '@/src/providers/translation/ai-sdk/openai-compatible';
import {normalizeAiSdkError} from '@/src/providers/translation/ai-sdk/errors';
import type {ResolvedTranslationService, TranslationProviderRequest} from '@/src/services/translation/types';
import {providerRequest, resolvedService} from './fixtures/translationService';

type MutableService = {-readonly [K in keyof ResolvedTranslationService]: ResolvedTranslationService[K]} & {
  credential: {apiKey: string; appKey: string; appSecret: string; secretId: string; secretKey: string};
};

let svc: MutableService;

function translate(overrides: Partial<Omit<TranslationProviderRequest, 'service'>> = {}) {
  return translateWithOpenAICompatibleAiSdk(providerRequest(svc, {origin: 'hello', ...overrides}));
}

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
    svc = resolvedService(services.custom, {
      modelId: 'base-model',
      endpoint: 'http://127.0.0.1:11434/v1/chat/completions',
      systemRole: 'You are a translator.',
      userRole: 'Translate {{origin}} into {{to}}.',
    }, {apiKey: 'sk-local-secret-value'}) as MutableService;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('preserves custom top-level fields while keeping the SDK-owned stream mode', async () => {
    svc.endpoint = 'http://127.0.0.1:11434/non-standard-generate';
    svc.customBody = JSON.stringify({
      vendor_flag: 'kept',
      model: 'custom-model',
      stream: true,
    });
    const fetchMock = vi.fn().mockResolvedValue(successResponse());
    vi.stubGlobal('fetch', fetchMock);

    await expect(translate({
      origin: 'hello',
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

  it('sends the request service endpoint, credential, prompts and custom body', async () => {
    svc.endpoint = 'https://snapshot-a.example/v1/chat/completions';
    svc.credential.apiKey = 'snapshot-token-a';
    svc.modelId = 'snapshot-model-a';
    svc.customBody = '{"temperature":0.2,"snapshot":"a"}';
    svc.systemRole = 'snapshot-system-a';
    svc.userRole = 'snapshot-user-a {{origin}} to {{to}}';

    const fetchMock = vi.fn().mockResolvedValue(successResponse());
    vi.stubGlobal('fetch', fetchMock);
    await expect(translate({targetLanguage: 'fr'})).resolves.toBe('译文');

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
    svc.endpoint = '';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const error = await translate({
      origin: 'hello',
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
    svc.customBody = JSON.stringify({messages: customMessages});
    const fetchMock = vi.fn().mockResolvedValue(successResponse());
    vi.stubGlobal('fetch', fetchMock);

    await expect(translate({
      origin: 'hello',
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

    await expect(translate({
      origin: 'hello',
    })).resolves.toBe('兼容旧 Custom 的译文');
  });

  it('does not retry permanent authentication errors and redacts secrets', async () => {
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(
      401,
      `invalid api_key=sk-local-secret-value`,
      {'x-request-id': 'req-auth-test-sk-local-secret-value'},
    ));
    vi.stubGlobal('fetch', fetchMock);

    const error = await translate({
      origin: 'hello',
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
    svc = resolvedService(service, {modelId: 'provider-model'}, {apiKey: 'sk-provider-test'}) as MutableService;
    const fetchMock = vi.fn().mockResolvedValue(errorResponse(401, providerMessage));
    vi.stubGlobal('fetch', fetchMock);

    const error = await translate({
      origin: 'hello',
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

    const request = translate({
      origin: 'hello',
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

    const error = await translate({
      origin: 'hello',
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

    const outcome = translate({
      origin: 'hello',
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

    const outcome = translate({
      origin: ['first', 'second'],
      requestTimeoutMs: 1_000,
    }).catch((reason) => reason);
    await vi.advanceTimersByTimeAsync(1_000);
    const error = await outcome;

    expect(error).toMatchObject({kind: 'timeout', retryable: true});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
