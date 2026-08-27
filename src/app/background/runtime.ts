import {installTranslationCacheCleanup} from './cacheCleanup';
import {installBackgroundContextMenus} from './contextMenuRuntime';
import {installBackgroundMessageRuntime} from './messageRuntime';
import {TabTranslationStateStore} from './tabTranslationState';

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
    // 最后注册独立的缓存维护任务，不阻塞 worker 启动。
    installTranslationCacheCleanup();
}
