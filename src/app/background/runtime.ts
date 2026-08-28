import {browser} from 'wxt/browser';
import {installTranslationCacheCleanup} from './cacheCleanup';
import {
    installConfigAutoBackupRuntime,
    type ConfigAutoBackupAlarmApi,
} from './configAutoBackupRuntime';
import {installBackgroundContextMenus} from './contextMenuRuntime';
import {installBackgroundMessageRuntime} from './messageRuntime';
import {TabTranslationStateStore} from './tabTranslationState';
import {
    captureConfigAutoBackup,
    configAutoBackupsReady,
    getConfigAutoBackupsSnapshot,
} from '@/src/services/config/autoBackupStore';

// MV3 后台休眠后会重新从 content script 读取真值；这里只保存当前 worker 的瞬时缓存。
const tabTranslationStates = new TabTranslationStateStore();

/** 启动一次 MV2 background page 或 MV3 service worker 实例。 */
export function startBackgroundApp(): void {
    // 先建立菜单与 tab 生命周期，保证消息上报可以立即刷新展示。
    const contextMenus = installBackgroundContextMenus(tabTranslationStates);
    // 注册单一消息入口，把 provider 与 feature handlers 静态组装起来。
    installBackgroundMessageRuntime({
        tabTranslationStates,
        onFullPageStateChanged: (tabId) => {
            if (contextMenus.isSupported) void contextMenus.update(tabId);
        },
    });
    void installConfigAutoBackupRuntime({
        alarms: browser.alarms as unknown as ConfigAutoBackupAlarmApi,
        ready: configAutoBackupsReady,
        getSnapshot: getConfigAutoBackupsSnapshot,
        capture: captureConfigAutoBackup,
        now: () => Date.now(),
        warn: (message, error) => console.warn(message, error),
    });
    installTranslationCacheCleanup();
}
