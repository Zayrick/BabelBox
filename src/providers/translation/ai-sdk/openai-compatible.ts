import {createOpenAICompatible} from '@ai-sdk/openai-compatible';
import {generateText} from 'ai';
import {config} from '@/src/services/config/store';
import {stripTranslationReasoning as contentPostHandler} from '@/src/core/translation/prompts';
import {commonMsgTemplate} from '@/src/services/translation/templates';
import {services} from '@/src/core/config/catalog';
import {
  resolveOpenAICompatibleEndpoint,
  type ResolvedOpenAICompatibleEndpoint,
} from './endpoints';
import {LlmTransportError, normalizeAiSdkError} from './errors';
import {
  getTranslationProviderConfig,
  type TranslationProviderRequestContext,
} from '@/src/services/translation/requestSnapshot';
import type {TranslationProviderConfigSnapshot} from '@/src/services/translation/types';

export const AI_SDK_REQUEST_TIMEOUT_MS = 40_000;
export const AI_SDK_MAX_RETRIES = 2;

export interface AiSdkTranslationRequest extends TranslationProviderRequestContext {
  origin: string | string[];
  pageContext?: string;
  summaryPrompt?: string;
  summarySystemPrompt?: string;
  serviceOverride?: string;
  modelOverride?: string;
  targetLanguage?: string;
  requestTimeoutMs?: number;
  abortSignal?: AbortSignal;
}

interface OpenAICompatiblePayload extends Record<string, unknown> {
  model: string;
  messages: unknown[];
}

function parsePayload(body: string): OpenAICompatiblePayload {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new LlmTransportError('大模型请求体生成失败，请检查自定义请求体配置。', {
      kind: 'bad-request',
      retryable: false,
    });
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new LlmTransportError('大模型请求体必须是 JSON 对象。', {
      kind: 'bad-request',
      retryable: false,
    });
  }

  const candidate = payload as Record<string, unknown>;
  if (typeof candidate.model !== 'string' || !candidate.model.trim()) {
    throw new LlmTransportError('模型尚未配置，请前往设置页面进行检查。', {
      kind: 'bad-request',
      retryable: false,
    });
  }
  if (!Array.isArray(candidate.messages)) {
    throw new LlmTransportError('自定义请求体中的 messages 必须是数组。', {
      kind: 'bad-request',
      retryable: false,
    });
  }

  return {
    ...candidate,
    model: candidate.model.trim(),
    messages: candidate.messages,
  };
}

function providerHeaders(service: string, apiKey: string): Record<string, string> | undefined {
  const headers: Record<string, string> = {};
  if (service === services.azureOpenai && apiKey) headers['api-key'] = apiKey;
  if (service === services.openrouter) {
    headers['HTTP-Referer'] = 'https://fluent.thinkstu.com';
    headers['X-Title'] = 'FluentRead';
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

async function normalizeSuccessfulTextResponse(response: Response): Promise<Response> {
  if (!response.ok) return response;

  try {
    const body = await response.clone().json() as {
      choices?: Array<{message?: {content?: unknown}; finish_reason?: unknown}>;
    };
    const choice = body?.choices?.[0];
    const content = choice?.message?.content;
    const finishReason = choice?.finish_reason;
    if (typeof content !== 'string') return response;

    // FluentRead only consumes text. Rebuild the minimal response shape the
    // legacy adapters accepted so non-standard optional metadata (for example
    // string token counts) cannot make the SDK reject an otherwise valid
    // translation.
    const normalizedBody = {
      choices: [{
        message: {role: 'assistant', content},
        finish_reason: typeof finishReason === 'string' ? finishReason : null,
      }],
    };
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.set('content-type', 'application/json');
    return new Response(JSON.stringify(normalizedBody), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } catch {
    return response;
  }
}

function compatibilityFetch(endpoint: ResolvedOpenAICompatibleEndpoint) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const response = await fetch(endpoint.exactEndpoint || input, init);
    return normalizeSuccessfulTextResponse(response);
  };
}

function normalizedTimeout(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return AI_SDK_REQUEST_TIMEOUT_MS;
  return Math.min(120_000, Math.max(1, Math.floor(value)));
}

function createRequestAbortContext(timeoutMs: number, callerSignal?: AbortSignal) {
  const controller = new AbortController();
  let abortedByCaller = false;
  const onCallerAbort = () => {
    abortedByCaller = true;
    controller.abort();
  };
  if (callerSignal?.aborted) onCallerAbort();
  else callerSignal?.addEventListener('abort', onCallerAbort, {once: true});

  // Avoid AI SDK's AbortSignal.timeout dependency so the extension remains
  // usable on browsers that support AbortController but not that newer helper.
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    abortedByCaller: () => abortedByCaller,
    cleanup: () => {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onCallerAbort);
    },
  };
}

async function translateSingle(
  request: AiSdkTranslationRequest,
  service: string,
  origin: string,
  current: TranslationProviderConfigSnapshot,
): Promise<string> {
  let endpoint: ResolvedOpenAICompatibleEndpoint;
  try {
    endpoint = resolveOpenAICompatibleEndpoint(service, current);
  } catch (error) {
    throw new LlmTransportError(
      error instanceof Error ? error.message : String(error),
      {kind: 'bad-request', retryable: false},
    );
  }
  const apiKey = current.token[service]?.trim() || '';
  const payload = parsePayload(commonMsgTemplate(
    origin,
    request.pageContext,
    request.summaryPrompt,
    request.summarySystemPrompt,
    service,
    request.targetLanguage,
    request.modelOverride,
    current,
  ));

  // The SDK owns the protocol's stream flag. Custom bodies may still replace
  // model/messages and add arbitrary OpenAI-compatible provider fields, but
  // cannot switch a generateText call to SSE behind the parser's back.
  const requestBody: Record<string, unknown> = {...payload, stream: false};
  const provider = createOpenAICompatible({
    name: 'fluentread',
    baseURL: endpoint.baseURL,
    apiKey: service === services.azureOpenai ? undefined : apiKey || undefined,
    headers: providerHeaders(service, apiKey),
    queryParams: endpoint.queryParams,
    fetch: compatibilityFetch(endpoint),
    transformRequestBody: () => requestBody,
  });
  const abortContext = createRequestAbortContext(
    normalizedTimeout(request.requestTimeoutMs),
    request.abortSignal,
  );

  try {
    const result = await generateText({
      model: provider(payload.model),
      // transformRequestBody supplies the actual provider payload. A fixed,
      // SDK-valid prompt prevents its ModelMessage schema from rejecting valid
      // OpenAI extensions such as developer roles or image_url content first.
      prompt: 'FluentRead OpenAI-compatible request',
      maxRetries: AI_SDK_MAX_RETRIES,
      abortSignal: abortContext.signal,
    });
    const text = contentPostHandler(result.text || '');
    if (!text) {
      throw new LlmTransportError('翻译服务已响应，但没有返回有效译文。', {
        kind: 'response',
        retryable: false,
      });
    }
    return text;
  } catch (error) {
    if (error instanceof LlmTransportError) throw error;
    throw normalizeAiSdkError(service, error, apiKey, abortContext.abortedByCaller());
  } finally {
    abortContext.cleanup();
  }
}

export async function translateWithOpenAICompatibleAiSdk(
  request: AiSdkTranslationRequest,
): Promise<string | string[]> {
  const current = getTranslationProviderConfig(request, config);
  const service = request.serviceOverride || current.service;
  const requestBudget = normalizedTimeout(request.requestTimeoutMs);
  if (!Array.isArray(request.origin)) {
    return translateSingle({...request, requestTimeoutMs: requestBudget}, service, request.origin, current);
  }

  // Batch messages are uncommon for AI services, but image translation can
  // provide them. Keep one upstream request in flight at a time so a single
  // background queue lease cannot bypass FluentRead's concurrency limit.
  const translations: string[] = [];
  const deadline = Date.now() + requestBudget;
  for (const origin of request.origin) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new LlmTransportError('当前翻译服务请求超时，请稍后重试。', {
        kind: 'timeout',
        retryable: true,
      });
    }
    translations.push(await translateSingle(
      {...request, requestTimeoutMs: remaining},
      service,
      origin,
      current,
    ));
  }
  return translations;
}
