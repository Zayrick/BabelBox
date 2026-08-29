export type TranslationErrorKind =
  | 'authentication'
  | 'rate-limit'
  | 'timeout'
  | 'network'
  | 'bad-request'
  | 'provider'
  | 'response'
  | 'unknown';

export const TRANSLATION_ERROR_MARKER = 'babelbox-translation-error-v1' as const;

export interface SerializedTranslationError {
  marker: typeof TRANSLATION_ERROR_MARKER;
  message: string;
  kind: TranslationErrorKind;
  retryable: boolean;
  statusCode?: number;
  code?: string;
  retryAfterMs?: number;
  requestId?: string;
}

interface TranslationErrorLike {
  message?: unknown;
  kind?: unknown;
  retryable?: unknown;
  statusCode?: unknown;
  code?: unknown;
  retryAfterMs?: unknown;
  requestId?: unknown;
}

function optionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function classifyMessage(message: string): Pick<SerializedTranslationError, 'kind' | 'retryable'> {
  const normalized = message.toLowerCase();
  if (/429|rate.?limit|quota|频率|配额/u.test(normalized)) {
    return {kind: 'rate-limit', retryable: true};
  }
  if (/\b40[13]\b|api key|unauthori[sz]ed|forbidden|auth failed|访问令牌|鉴权|(?:app key|secretid|secretkey|凭据|密钥).*(?:未配置|没有配置)/u.test(normalized)) {
    return {kind: 'authentication', retryable: false};
  }
  if (/timeout|timed out|请求超时|超时/u.test(normalized)) {
    return {kind: 'timeout', retryable: true};
  }
  if (/failed to fetch|networkerror|network error|网络/u.test(normalized)) {
    return {kind: 'network', retryable: true};
  }
  if (/\b40[04]\b|invalid model|model.*(?:missing|not configured|not found)|模型.*(?:尚未配置|未配置|无效|不存在)|请求.*(?:无效|格式)/u.test(normalized)) {
    return {kind: 'bad-request', retryable: false};
  }
  if (/\b5\d\d\b|服务.*(?:不可用|内部错误)/u.test(normalized)) {
    return {kind: 'provider', retryable: true};
  }
  return {kind: 'unknown', retryable: true};
}

export function serializeTranslationError(error: unknown): SerializedTranslationError {
  const candidate = error && typeof error === 'object'
    ? error as TranslationErrorLike
    : {};
  const message = optionalString(candidate.message)
    || (typeof error === 'string' && error.trim() ? error.trim() : '翻译请求失败');
  const classified = classifyMessage(message);
  const kind = typeof candidate.kind === 'string'
    ? candidate.kind as TranslationErrorKind
    : classified.kind;

  return {
    marker: TRANSLATION_ERROR_MARKER,
    message,
    kind,
    retryable: typeof candidate.retryable === 'boolean' ? candidate.retryable : classified.retryable,
    statusCode: optionalFiniteNumber(candidate.statusCode),
    code: optionalString(candidate.code),
    retryAfterMs: optionalFiniteNumber(candidate.retryAfterMs),
    requestId: optionalString(candidate.requestId),
  };
}

export function isSerializedTranslationError(value: unknown): value is SerializedTranslationError {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SerializedTranslationError>;
  return candidate.marker === TRANSLATION_ERROR_MARKER
    && typeof candidate.message === 'string'
    && typeof candidate.kind === 'string'
    && typeof candidate.retryable === 'boolean';
}

export class TranslationRequestError extends Error {
  readonly kind: TranslationErrorKind;
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly code?: string;
  readonly retryAfterMs?: number;
  readonly requestId?: string;

  constructor(payload: SerializedTranslationError) {
    super(payload.message);
    this.name = 'TranslationRequestError';
    this.kind = payload.kind;
    this.retryable = payload.retryable;
    this.statusCode = payload.statusCode;
    this.code = payload.code;
    this.retryAfterMs = payload.retryAfterMs;
    this.requestId = payload.requestId;
  }
}

export function unwrapTranslationResponse<T>(value: unknown): T {
  if (isSerializedTranslationError(value)) throw new TranslationRequestError(value);
  return value as T;
}
