import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';

import zhipu from '@/src/providers/translation/zhipu';
import {providerRequest, resolvedService} from './fixtures/translationService';

const service = resolvedService('zhipu', {
    modelId: 'glm-4.5-flash',
    systemRole: 'Translate safely.',
    userRole: 'Translate {{origin}} into {{to}}.',
}, {apiKey: 'api-id.api-secret'});

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
        await zhipu(providerRequest(service, {origin: 'hello'}));

        vi.setSystemTime(new Date(issuedAt + JWT_TTL_MS / 2));
        await zhipu(providerRequest(service, {origin: 'world'}));

        vi.setSystemTime(new Date('2026-01-01T01:00:00Z'));
        await zhipu(providerRequest(service, {origin: 'again'}));

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
    });
});
