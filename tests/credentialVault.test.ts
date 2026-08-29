import 'fake-indexeddb/auto';
import {beforeEach, describe, expect, it} from 'vitest';
import {extractConfigCredentials} from '@/src/core/config/credentials';
import {
    decryptCredentials,
    encryptCredentials,
} from '@/src/platform/storage/credentialVault';

const databaseName = 'babelbox-credential-vault';

function deleteDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(databaseName);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('测试凭据数据库仍被占用'));
    });
}

function readStoredDeviceKey(): Promise<CryptoKey> {
    return new Promise((resolve, reject) => {
        const open = indexedDB.open(databaseName);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const database = open.result;
            const transaction = database.transaction('keys', 'readonly');
            const request = transaction.objectStore('keys').getAll();
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
                database.close();
                const [key] = request.result;
                if (key instanceof CryptoKey) resolve(key);
                else reject(new Error('测试未找到设备密钥'));
            };
        };
    });
}

describe('设备 API 凭据保险库', () => {
    beforeEach(async () => {
        await deleteDatabase();
    });

    it('用不可导出的设备密钥加密，并能跨上下文重新读取', async () => {
        const secret = 'device-vault-secret-sentinel';
        const credentials = extractConfigCredentials({
            token: {openai: secret},
            serviceCredentials: {
                'service:openai:test': {
                    apiKey: secret,
                    appKey: '',
                    appSecret: '',
                    secretId: '',
                    secretKey: '',
                },
            },
        });

        const envelope = await encryptCredentials(credentials);
        const deviceKey = await readStoredDeviceKey();

        expect(JSON.stringify(envelope)).not.toContain(secret);
        expect(deviceKey.extractable).toBe(false);
        await expect(decryptCredentials(structuredClone(envelope))).resolves.toEqual(credentials);
    });
});
