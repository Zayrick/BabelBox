import {describe, expect, it, vi} from 'vitest';
import {
    createTranslationRequestHandler,
    parseTranslationRequest,
} from '@/src/app/background/handlers/translation';

describe('background translation handler', () => {
    it('validates the wire message and passes only supported fields to the broker', async () => {
        const translate = vi.fn().mockResolvedValue('你好');
        const handler = createTranslationRequestHandler({translate, serializeError: vi.fn()});
        const message = {
            type: 'translate' as const,
            origin: 'hello',
            context: 'title',
            pageContext: 'article',
            useCache: false,
            serviceOverride: 'google',
            modelOverride: 'model',
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            requestTimeoutMs: 12_000,
            injected: 'must-not-pass',
        };

        expect(handler.type).toBe('translate');
        await expect(handler.handle(message, undefined)).resolves.toBe('你好');
        expect(translate).toHaveBeenCalledWith({
            origin: 'hello',
            context: 'title',
            pageContext: 'article',
            useCache: false,
            serviceOverride: 'google',
            modelOverride: 'model',
            sourceLanguage: 'en',
            targetLanguage: 'zh-CN',
            requestTimeoutMs: 12_000,
        });
    });

    it('preserves batches and rejects malformed boundary fields', () => {
        expect(parseTranslationRequest({type: 'translate', origin: ['a', 'b']})).toEqual({origin: ['a', 'b']});
        expect(() => parseTranslationRequest({type: 'translate', origin: ['ok', 2]})).toThrow('origin');
        expect(() => parseTranslationRequest({type: 'translate', origin: 'ok', useCache: 'yes'})).toThrow('useCache');
        expect(() => parseTranslationRequest({
            type: 'translate',
            origin: 'ok',
            requestTimeoutMs: Number.NaN,
        })).toThrow('requestTimeoutMs');
    });

    it('serializes validation and broker failures', async () => {
        const error = new Error('provider failed');
        const serializeError = vi.fn((value: unknown) => ({kind: 'translation-error', error: value}));
        const handler = createTranslationRequestHandler({
            translate: vi.fn().mockRejectedValue(error),
            serializeError,
        });

        await expect(handler.handle({type: 'translate', origin: 'hello'}, undefined)).resolves.toEqual({
            kind: 'translation-error',
            error,
        });
        await expect(handler.handle({type: 'translate', origin: 1}, undefined)).resolves.toMatchObject({
            kind: 'translation-error',
        });
        expect(serializeError).toHaveBeenCalledTimes(2);
    });
});
