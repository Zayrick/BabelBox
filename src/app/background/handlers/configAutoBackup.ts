import type {BackgroundMessageHandler} from '@/src/platform/browser/messageRouter';

export const CONFIG_AUTO_BACKUP_RESTORE_MESSAGE_TYPE = 'configAutoBackupRestore' as const;

export interface ConfigAutoBackupRestoreMessage {
    type: typeof CONFIG_AUTO_BACKUP_RESTORE_MESSAGE_TYPE;
    version?: unknown;
}

export type ConfigAutoBackupRestoreResponse<T> =
    | {success: true; result: T}
    | {success: false; error: string};

export function createConfigAutoBackupRestoreHandler<T>(
    restoreConfigAutoBackup: (version: number) => Promise<T>,
): BackgroundMessageHandler<unknown, ConfigAutoBackupRestoreMessage, ConfigAutoBackupRestoreResponse<T>> {
    return {
        type: CONFIG_AUTO_BACKUP_RESTORE_MESSAGE_TYPE,
        async handle(message) {
            const version = message.version;
            if (typeof version !== 'number'
                || !Number.isSafeInteger(version)
                || version < 1) {
                return {success: false, error: '无效的自动配置备份版本'};
            }
            return {success: true, result: await restoreConfigAutoBackup(version)};
        },
    };
}
