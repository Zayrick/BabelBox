import {describe, expect, it} from 'vitest';

import {
  isSerializedTranslationError,
  serializeTranslationError,
  TranslationRequestError,
  unwrapTranslationResponse,
} from '@/src/services/translation/errors';

describe('translation error serialization', () => {
  it('prioritizes rate-limit evidence over a generic API-key mention', () => {
    expect(serializeTranslationError(
      new Error('Rate limit reached for API key tenant-1 (HTTP 429)'),
    )).toMatchObject({kind: 'rate-limit', retryable: true});
  });

  it('recognizes explicit credential failures without treating model setup as authentication', () => {
    expect(serializeTranslationError(new Error('HTTP 401 Unauthorized')))
      .toMatchObject({kind: 'authentication', retryable: false});
    expect(serializeTranslationError(new Error('模型尚未配置')))
      .toMatchObject({kind: 'bad-request', retryable: false});
  });

  it.each([
    ['request timed out', 'timeout', true],
    ['NetworkError while fetching', 'network', true],
    ['HTTP 400 invalid request', 'bad-request', false],
    ['HTTP 503 service unavailable', 'provider', true],
    ['unexpected provider reply', 'unknown', true],
  ] as const)('classifies %s', (message, kind, retryable) => {
    expect(serializeTranslationError(message)).toMatchObject({message, kind, retryable});
  });

  it('preserves validated structured metadata and explicit policy', () => {
    expect(serializeTranslationError({
      message: '  explicit failure  ',
      kind: 'response',
      retryable: false,
      statusCode: 422,
      code: ' BAD_RESPONSE ',
      retryAfterMs: 1250,
      requestId: ' req-1 ',
    })).toEqual({
      marker: 'fluentread-translation-error-v1',
      message: 'explicit failure',
      kind: 'response',
      retryable: false,
      statusCode: 422,
      code: 'BAD_RESPONSE',
      retryAfterMs: 1250,
      requestId: 'req-1',
    });
  });

  it('drops malformed metadata and uses a stable fallback message', () => {
    expect(serializeTranslationError({
      message: ' ',
      statusCode: Number.POSITIVE_INFINITY,
      code: 42,
      retryAfterMs: 'soon',
      requestId: '',
    })).toEqual({
      marker: 'fluentread-translation-error-v1',
      message: '翻译请求失败',
      kind: 'unknown',
      retryable: true,
      statusCode: undefined,
      code: undefined,
      retryAfterMs: undefined,
      requestId: undefined,
    });
    expect(serializeTranslationError(null).message).toBe('翻译请求失败');
    expect(serializeTranslationError('   ').message).toBe('翻译请求失败');
  });

  it('strictly recognizes the serialized wire shape', () => {
    const valid = serializeTranslationError('timeout');
    expect(isSerializedTranslationError(valid)).toBe(true);
    expect(isSerializedTranslationError(null)).toBe(false);
    expect(isSerializedTranslationError('failure')).toBe(false);
    expect(isSerializedTranslationError({...valid, marker: 'wrong'})).toBe(false);
    expect(isSerializedTranslationError({...valid, message: 1})).toBe(false);
    expect(isSerializedTranslationError({...valid, kind: 1})).toBe(false);
    expect(isSerializedTranslationError({...valid, retryable: 'yes'})).toBe(false);
  });

  it('unwraps normal results and restores structured request errors', () => {
    expect(unwrapTranslationResponse<string>('translated')).toBe('translated');

    const payload = serializeTranslationError({
      message: 'provider unavailable',
      kind: 'provider',
      retryable: false,
      statusCode: 503,
      code: 'UPSTREAM',
      retryAfterMs: 500,
      requestId: 'req-2',
    });
    expect(() => unwrapTranslationResponse(payload)).toThrow(TranslationRequestError);
    try {
      unwrapTranslationResponse(payload);
    } catch (error) {
      expect(error).toMatchObject({
        name: 'TranslationRequestError',
        message: 'provider unavailable',
        kind: 'provider',
        retryable: false,
        statusCode: 503,
        code: 'UPSTREAM',
        retryAfterMs: 500,
        requestId: 'req-2',
      });
    }
  });
});
