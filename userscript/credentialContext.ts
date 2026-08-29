/** Userscript 的配置适配器只读写脚本管理器 GM 存储，因此可在该沙箱内读取凭据。 */
export function isTrustedCredentialStorageContext(): boolean {
    return true;
}

export const ENCRYPTED_CREDENTIAL_VAULT_ENABLED = false;
