import {describe, expect, it} from 'vitest';
import {hmacSha256Base64, sha256Hex} from '@/src/core/crypto/sha256';

describe('SHA-256 primitives', () => {
    it('matches standard SHA-256 vectors and encodes Unicode as UTF-8', () => {
        expect(sha256Hex('')).toBe(
            'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        );
        expect(sha256Hex('abc')).toBe(
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        );
        expect(sha256Hex('中文🙂')).toBe(
            '3f7e2b3029a16c844f54b308c8035842509a1a8d8a4f35a7548d2384f3b51901',
        );
    });

    it('matches the RFC 4231 HMAC-SHA-256 vector and returns Base64', () => {
        expect(hmacSha256Base64('what do ya want for nothing?', 'Jefe')).toBe(
            'W9zBRr9gdU5qBCQmCJV1x1oAPwidJzmDnexYuWTsOEM=',
        );
    });
});
