import {hmac} from '@noble/hashes/hmac.js';
import {sha256} from '@noble/hashes/sha2.js';
import {bytesToHex, utf8ToBytes} from '@noble/hashes/utils.js';

function bytesToBase64(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

export function sha256Hex(value: string): string {
    return bytesToHex(sha256(utf8ToBytes(value)));
}

export function hmacSha256Base64(value: string, secret: string): string {
    return bytesToBase64(hmac(sha256, utf8ToBytes(secret), utf8ToBytes(value)));
}
