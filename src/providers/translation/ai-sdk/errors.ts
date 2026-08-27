import {APICallError, RetryError} from 'ai';
import {formatServiceError} from '@/src/services/translation/serviceErrors';
import type {TranslationErrorKind} from '@/src/services/translation/errors';

const MAX_PROVIDER_DETAIL_LENGTH = 800;

export interface LlmTransportErrorOptions {
  kind: TranslationErrorKind;
  retryable: boolean;
  statusCode?: number;
  code?: string;
  retryAfterMs?: number;
  requestId?: string;
}

export class LlmTransportError extends Error {
  readonly kind: TranslationErrorKind;
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly code?: string;
  readonly retryAfterMs?: number;
  readonly requestId?: string;

  constructor(message: string, options: LlmTransportErrorOptions) {
    super(message);
    this.name = 'LlmTransportError';
    this.kind = options.kind;
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.retryAfterMs = options.retryAfterMs;
    this.requestId = options.requestId;
  }
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function extractProviderError(data: unknown): {message?: string; code?: string} {
  const root = recordValue(data);
  if (!root) return {};
  const nested = recordValue(root.error);
  return {
    message: stringValue(nested?.message) || stringValue(root.message) || stringValue(root.error),
    code: stringValue(nested?.code) || stringValue(root.code),
  };
}

function parseResponseBody(body?: string): {message?: string; code?: string} {
  if (!body?.trim()) return {};
  try {
    return extractProviderError(JSON.parse(body));
  } catch {
    return {message: body};
  }
}

function sanitizeProviderDetail(value: string, apiKey?: string): string {
  let result = value
    .replace(/((?:authorization|api[-_ ]?key|access[-_ ]?token)\s*[:=]\s*)(?:bearer\s+)?[^\s,;"'}]+/giu, '$1[已隐藏]')
    .replace(/\b(?:sk|tp)-[a-z0-9_-]{8,}\b/giu, '[已隐藏的密钥]');
  const key = apiKey?.trim();
  if (key) result = result.split(key).join('[已隐藏的密钥]');
  result = result.replace(/\s+/gu, ' ').trim();
  return result.slice(0, MAX_PROVIDER_DETAIL_LENGTH);
}

function parseRetryAfter(headers?: Record<string, string>): number | undefined {
  const millisecondValue = headers?.['retry-after-ms'];
  if (millisecondValue !== undefined) {
    const milliseconds = Number(millisecondValue);
    if (Number.isFinite(milliseconds) && milliseconds >= 0) return milliseconds;
  }

  const value = headers?.['retry-after'];
  if (!value) return undefined;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0) return numeric * 1000;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : undefined;
}

function requestIdFrom(headers?: Record<string, string>): string | undefined {
  return headers?.['x-request-id']
    || headers?.['request-id']
    || headers?.['x-ms-request-id']
    || headers?.['x-amzn-requestid'];
}

function sanitizeMetadata(value: string | undefined, apiKey?: string, maxLength = 160): string | undefined {
  if (!value) return undefined;
  const sanitized = sanitizeProviderDetail(value, apiKey).slice(0, maxLength);
  return sanitized || undefined;
}

function statusKind(statusCode?: number): TranslationErrorKind {
  if (statusCode === 401 || statusCode === 403) return 'authentication';
  if (statusCode === 408) return 'timeout';
  if (statusCode === 429) return 'rate-limit';
  if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) return 'bad-request';
  if (statusCode !== undefined && statusCode >= 500) return 'provider';
  return 'response';
}

function userMessageForStatus(
  service: string,
  statusCode: number | undefined,
  detail: string,
): string {
  const specialized = detail ? formatServiceError(service, detail) : '';
  if (specialized && specialized !== detail) return specialized;

  if (statusCode === 401 || statusCode === 403) {
    return `当前翻译服务的 API Key 无效、已过期或没有模型访问权限（HTTP ${statusCode}）。请检查服务配置。`;
  }
  if (statusCode === 429) {
    return '当前翻译服务的请求频率或配额已达上限（HTTP 429），请稍后重试。';
  }
  if (statusCode === 408) return '当前翻译服务请求超时（HTTP 408），请稍后重试。';
  if (statusCode !== undefined && statusCode >= 500) {
    return `当前翻译服务暂时不可用（HTTP ${statusCode}），请稍后重试。`;
  }
  if (statusCode !== undefined && statusCode >= 400) {
    const suffix = detail ? `：${detail}` : '';
    return `当前翻译服务拒绝了请求（HTTP ${statusCode}）${suffix}`;
  }
  return formatServiceError(service, detail || '翻译服务返回了无法识别的错误');
}

function withRequestId(message: string, requestId?: string): string {
  return requestId ? `${message}\n请求 ID：${requestId}` : message;
}

function unwrapRetryError(error: unknown): unknown {
  return RetryError.isInstance(error) ? error.lastError : error;
}

export function normalizeAiSdkError(
  service: string,
  error: unknown,
  apiKey?: string,
  callerAborted = false,
): LlmTransportError {
  const candidate = unwrapRetryError(error);
  if (APICallError.isInstance(candidate)) {
    const fromData = extractProviderError(candidate.data);
    const fromBody = parseResponseBody(candidate.responseBody);
    const detail = sanitizeProviderDetail(
      fromData.message || fromBody.message || candidate.message || '上游请求失败',
      apiKey,
    );
    const requestId = sanitizeMetadata(requestIdFrom(candidate.responseHeaders), apiKey);
    const code = sanitizeMetadata(fromData.code || fromBody.code, apiKey, 120);
    return new LlmTransportError(
      withRequestId(userMessageForStatus(service, candidate.statusCode, detail), requestId),
      {
        kind: statusKind(candidate.statusCode),
        retryable: candidate.isRetryable,
        statusCode: candidate.statusCode,
        code,
        retryAfterMs: parseRetryAfter(candidate.responseHeaders),
        requestId,
      },
    );
  }

  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  const errorName = error instanceof Error ? error.name : '';
  const timedOut = /timeout|timed out|请求超时/u.test(normalized)
    || (error instanceof Error && error.name === 'TimeoutError')
    // AI SDK also surfaces its internal total-timeout controller as an
    // AbortError (for example while waiting for Retry-After).
    || (error instanceof Error && error.name === 'AbortError' && !callerAborted);
  const aborted = error instanceof Error && error.name === 'AbortError' && callerAborted;
  const network = /failed to fetch|fetch failed|networkerror|network error|load failed|网络连接失败/u.test(normalized);
  const invalidRequest = /invalidprompt|typevalidation|invalidargument/u.test(
    errorName.replace(/[^a-z]/giu, '').toLowerCase(),
  )
    || /invalid prompt|messages? must|prompt must|请求体.*(?:无效|格式)/u.test(normalized);
  const detail = sanitizeProviderDetail(message || '网络请求失败', apiKey);
  return new LlmTransportError(
    timedOut
      ? '当前翻译服务请求超时，请稍后重试。'
      : aborted
        ? '翻译请求已取消。'
        : invalidRequest
          ? `大模型请求配置无效：${detail}`
          : formatServiceError(service, detail),
    {
      kind: timedOut
        ? 'timeout'
        : aborted
          ? 'timeout'
          : invalidRequest
            ? 'bad-request'
            : network
              ? 'network'
              : 'response',
      retryable: !aborted && !invalidRequest && (timedOut || network),
    },
  );
}
