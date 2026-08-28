import type {ConfigAutoBackupState} from '@/src/services/config/autoBackup';

export const CONFIG_AUTO_BACKUP_ALARM = 'fluentread-config-auto-backup' as const;
export const CONFIG_AUTO_BACKUP_INTERVAL_MINUTES = 6 * 60;
export const CONFIG_AUTO_BACKUP_INTERVAL_MS = CONFIG_AUTO_BACKUP_INTERVAL_MINUTES * 60 * 1000;

export interface ConfigAutoBackupAlarm {
    name: string;
}

export interface ConfigAutoBackupAlarmApi {
    onAlarm: {
        addListener(listener: (alarm: ConfigAutoBackupAlarm) => void): void;
    };
    get(name: string): Promise<ConfigAutoBackupAlarm | undefined>;
    create(name: string, alarmInfo: {delayInMinutes: number; periodInMinutes: number}): void | Promise<void>;
}

export interface ConfigAutoBackupRuntimeDependencies {
    alarms: ConfigAutoBackupAlarmApi;
    ready: Promise<void>;
    getSnapshot(): ConfigAutoBackupState;
    capture(options: {savedAt: string}): Promise<ConfigAutoBackupState>;
    now(): number;
    warn(message: string, error: unknown): void;
}

export function isConfigAutoBackupDue(state: ConfigAutoBackupState, now: number): boolean {
    const lastSavedAt = state.entries.at(-1)?.savedAt;
    if (!lastSavedAt) return true;
    const lastSavedTime = new Date(lastSavedAt).getTime();
    return !Number.isFinite(lastSavedTime)
        || now - lastSavedTime >= CONFIG_AUTO_BACKUP_INTERVAL_MS;
}

function getConfigAutoBackupInitialDelayMinutes(state: ConfigAutoBackupState, now: number): number {
    const lastSavedTime = new Date(state.entries.at(-1)!.savedAt).getTime();
    const remainingMinutes = (lastSavedTime + CONFIG_AUTO_BACKUP_INTERVAL_MS - now) / (60 * 1000);
    return Math.max(1, Math.min(CONFIG_AUTO_BACKUP_INTERVAL_MINUTES, remainingMinutes));
}

/** service worker 重启时最多补一份，后续交给持久 alarm。 */
export function installConfigAutoBackupRuntime(
    dependencies: ConfigAutoBackupRuntimeDependencies,
): Promise<void> {
    let captureQueue: Promise<boolean> = Promise.resolve(false);
    const captureIfDue = (): Promise<boolean> => {
        const capture = captureQueue
            .catch(() => false)
            .then(async () => {
                await dependencies.ready;
                const now = dependencies.now();
                if (!isConfigAutoBackupDue(dependencies.getSnapshot(), now)) return false;
                await dependencies.capture({savedAt: new Date(now).toISOString()});
                return true;
            });
        captureQueue = capture;
        return capture;
    };

    dependencies.alarms.onAlarm.addListener((alarm) => {
        if (alarm.name !== CONFIG_AUTO_BACKUP_ALARM) return;
        void captureIfDue().catch((error) => {
            dependencies.warn('[FluentRead] 自动配置备份执行失败', error);
        });
    });

    const ready = (async () => {
        const captured = await captureIfDue();
        const alarm = await dependencies.alarms.get(CONFIG_AUTO_BACKUP_ALARM);
        if (!alarm) {
            await dependencies.alarms.create(CONFIG_AUTO_BACKUP_ALARM, {
                delayInMinutes: captured
                    ? CONFIG_AUTO_BACKUP_INTERVAL_MINUTES
                    : getConfigAutoBackupInitialDelayMinutes(
                        dependencies.getSnapshot(),
                        dependencies.now(),
                    ),
                periodInMinutes: CONFIG_AUTO_BACKUP_INTERVAL_MINUTES,
            });
        }
    })().catch((error) => {
        dependencies.warn('[FluentRead] 自动配置备份任务安装失败', error);
    });

    return ready;
}
