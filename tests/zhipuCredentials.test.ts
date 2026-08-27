import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

const mockConfig = vi.hoisted(() => ({
    service: 'zhipu',
    to: 'zh-Hans',
    token: {zhipu: 'api-id.api-secret'},
    model: {zhipu: 'glm-4.5-flash'},
    customModel: {},
    customBody: {},
    system_role: {zhipu: 'Translate safely.'},
    user_role: {zhipu: 'Translate {{origin}} into {{to}}.'},
    requireApiKey: {},
    extra: {zhipu: {secret: 'legacy-persisted-jwt', expiration: Number.MAX_SAFE_INTEGER}},
}));

vi.mock('@/src/services/config/store', () => ({config: mockConfig}));

import zhipu from '@/src/providers/translation/zhipu';

const JWT_TTL_MS = 60 * 60 * 1000;

function getBearerToken(callIndex: number): string {
    const headers = vi.mocked(fetch).mock.calls[callIndex][1]?.headers as Headers;
    const authorization = headers.get('Authorization');
    expect(authorization).toMatch(/^Bearer /);
    return authorization!.slice('Bearer '.length);
}

function decodeJwtPayload(token: string): Record<string, unknown> {
    const encodedPayload = token.split('.')[1];
    if (!encodedPayload) {
        throw new Error('JWT payload is missing');
    }
    const base64 = encodedPayload
        .replace(/-/g, '+')
        .replace(/_/g, '/')
        .padEnd(Math.ceil(encodedPayload.length / 4) * 4, '=');
    return JSON.parse(atob(base64)) as Record<string, unknown>;
}

describe('智谱派生 JWT 凭据', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        vi.stubGlobal('fetch', vi.fn(async () => ({
            ok: true,
            json: async () => ({choices: [{message: {content: 'translated'}}]}),
        })));
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('按毫秒生成一小时 JWT，过期前复用且在边界重新签发', async () => {
        const issuedAt = Date.parse('2026-01-01T00:00:00Z');
        const legacyExtra = structuredClone(mockConfig.extra);
        await zhipu({origin: 'hello', targetLanguage: 'zh-Hans'});

        vi.setSystemTime(new Date(issuedAt + JWT_TTL_MS / 2));
        await zhipu({origin: 'world', targetLanguage: 'zh-Hans'});

        vi.setSystemTime(new Date('2026-01-01T01:00:00Z'));
        await zhipu({origin: 'again', targetLanguage: 'zh-Hans'});

        const firstToken = getBearerToken(0);
        const reusedToken = getBearerToken(1);
        const renewedToken = getBearerToken(2);
        expect(reusedToken).toBe(firstToken);
        expect(renewedToken).not.toBe(firstToken);
        expect(decodeJwtPayload(firstToken)).toEqual({
            api_key: 'api-id',
            exp: issuedAt + JWT_TTL_MS,
            timestamp: issuedAt,
        });
        expect(decodeJwtPayload(renewedToken)).toEqual({
            api_key: 'api-id',
            exp: issuedAt + JWT_TTL_MS * 2,
            timestamp: issuedAt + JWT_TTL_MS,
        });
        expect(mockConfig.extra).toEqual(legacyExtra);
    });
});
