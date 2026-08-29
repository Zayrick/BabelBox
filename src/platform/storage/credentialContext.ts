const TRUSTED_EXTENSION_PROTOCOLS = new Set([
    'chrome-extension:',
    'moz-extension:',
    'safari-web-extension:',
]);

/**
 * 扩展构建只有自身页面能直接读取凭据；普通 content page 只能使用公开配置。
 * Userscript 构建会在 Vite 中把本模块替换为 GM 私有存储实现。
 */
export function isTrustedCredentialStorageContext(protocol = globalThis.location?.protocol): boolean {
    return typeof protocol === 'string' && TRUSTED_EXTENSION_PROTOCOLS.has(protocol);
}

/** Userscript 构建通过同名平台模块将该常量替换为 false。 */
export const ENCRYPTED_CREDENTIAL_VAULT_ENABLED = true;
