import type {EncryptedCredentialsEnvelope} from '@/src/core/config/credentialStorage';
import {
    parseStoredCredentials,
    type ConfigCredentials,
} from '@/src/core/config/credentials';

const CREDENTIAL_VAULT_DATABASE = 'babelbox-credential-vault';
const CREDENTIAL_VAULT_DATABASE_VERSION = 1;
const CREDENTIAL_VAULT_KEY_STORE = 'keys';
const DEVICE_CREDENTIAL_KEY_ID = 'device-aes-gcm-v1';
const CREDENTIAL_VAULT_AAD = new TextEncoder().encode('BabelBox credential vault\u0000v1');

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB 请求失败'));
    });
}

async function openCredentialVault(): Promise<IDBDatabase> {
    if (!globalThis.indexedDB) throw new Error('当前浏览器不支持 IndexedDB 凭据保险库');
    const request = globalThis.indexedDB.open(
        CREDENTIAL_VAULT_DATABASE,
        CREDENTIAL_VAULT_DATABASE_VERSION,
    );
    request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(CREDENTIAL_VAULT_KEY_STORE)) {
            request.result.createObjectStore(CREDENTIAL_VAULT_KEY_STORE);
        }
    };
    const database = await requestResult(request);
    database.onversionchange = () => database.close();
    return database;
}

async function readDeviceKey(database: IDBDatabase): Promise<CryptoKey | null> {
    const transaction = database.transaction(CREDENTIAL_VAULT_KEY_STORE, 'readonly');
    const value = await requestResult(
        transaction.objectStore(CREDENTIAL_VAULT_KEY_STORE).get(DEVICE_CREDENTIAL_KEY_ID),
    );
    return value instanceof CryptoKey ? value : null;
}

async function addDeviceKey(database: IDBDatabase, key: CryptoKey): Promise<boolean> {
    const transaction = database.transaction(CREDENTIAL_VAULT_KEY_STORE, 'readwrite');
    const request = transaction.objectStore(CREDENTIAL_VAULT_KEY_STORE).add(
        key,
        DEVICE_CREDENTIAL_KEY_ID,
    );
    return new Promise((resolve, reject) => {
        let lostCreationRace = false;
        request.onerror = (event) => {
            // 多个扩展页面同时首次启动时只能有一个 key 获胜。ConstraintError
            // 是正常竞争结果，不应让它中止整个事务。
            if (request.error?.name === 'ConstraintError') {
                lostCreationRace = true;
                event.preventDefault();
                event.stopPropagation();
                return;
            }
            reject(request.error || new Error('设备凭据密钥写入失败'));
        };
        transaction.oncomplete = () => resolve(!lostCreationRace);
        transaction.onabort = () => reject(transaction.error || new Error('设备凭据密钥事务已中止'));
        transaction.onerror = () => {
            if (!lostCreationRace) reject(transaction.error || new Error('设备凭据密钥事务失败'));
        };
    });
}

async function getOrCreateDeviceKey(): Promise<CryptoKey> {
    if (!globalThis.crypto?.subtle) throw new Error('当前浏览器不支持 Web Crypto 凭据保险库');
    const database = await openCredentialVault();
    try {
        const stored = await readDeviceKey(database);
        if (stored) return stored;

        const generated = await globalThis.crypto.subtle.generateKey(
            {name: 'AES-GCM', length: 256},
            false,
            ['encrypt', 'decrypt'],
        );
        if (await addDeviceKey(database, generated)) return generated;
        const winner = await readDeviceKey(database);
        if (!winner) throw new Error('设备凭据密钥创建后无法读取');
        return winner;
    } finally {
        database.close();
    }
}

function bytesToBase64(value: ArrayBuffer | Uint8Array): string {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
}

export async function encryptCredentials(
    credentials: ConfigCredentials,
): Promise<EncryptedCredentialsEnvelope> {
    const key = await getOrCreateDeviceKey();
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(credentials));
    const ciphertext = await globalThis.crypto.subtle.encrypt({
        name: 'AES-GCM',
        iv,
        additionalData: CREDENTIAL_VAULT_AAD,
        tagLength: 128,
    }, key, plaintext);
    return {
        iv: bytesToBase64(iv),
        ciphertext: bytesToBase64(ciphertext),
    };
}

export async function decryptCredentials(
    envelope: EncryptedCredentialsEnvelope,
): Promise<ConfigCredentials> {
    const key = await getOrCreateDeviceKey();
    try {
        const plaintext = await globalThis.crypto.subtle.decrypt({
            name: 'AES-GCM',
            iv: base64ToBytes(envelope.iv),
            additionalData: CREDENTIAL_VAULT_AAD,
            tagLength: 128,
        }, key, base64ToBytes(envelope.ciphertext));
        const credentials = parseStoredCredentials(
            JSON.parse(new TextDecoder().decode(plaintext)),
        );
        if (!credentials) throw new Error();
        return credentials;
    } catch {
        throw new Error('设备凭据保险库无法读取');
    }
}
