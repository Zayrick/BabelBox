import {
    CREDENTIAL_STORAGE_MODE_MESSAGE,
    isCredentialStorageMode,
    type CredentialStorageMode,
} from '@/src/core/config/credentialStorage';
import type {BackgroundMessageHandler} from '@/src/platform/browser/messageRouter';
import type {ConfigPersistenceContext} from './configPersistence';

export interface CredentialStorageModeMessage {
    type: typeof CREDENTIAL_STORAGE_MODE_MESSAGE;
    mode?: unknown;
}

export interface CredentialStorageModeResponse {
    success: true;
    mode: CredentialStorageMode;
}

export function createCredentialStorageModeHandler(
    setMode: (mode: CredentialStorageMode) => Promise<CredentialStorageMode>,
    isExtensionUrl: (url: string) => boolean,
): BackgroundMessageHandler<ConfigPersistenceContext, CredentialStorageModeMessage, CredentialStorageModeResponse> {
    return {
        type: CREDENTIAL_STORAGE_MODE_MESSAGE,
        async handle(message, context) {
            const senderUrl = typeof context.sender?.url === 'string' ? context.sender.url : '';
            if (!isExtensionUrl(senderUrl)) throw new Error('只有扩展设置页面可以修改 API 凭据存储方式');
            if (!isCredentialStorageMode(message.mode)) throw new TypeError('无效的 API 凭据存储方式');
            return {success: true, mode: await setMode(message.mode)};
        },
    };
}
