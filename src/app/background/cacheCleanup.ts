import {cleanupTranslationCache} from '@/src/app/translation/runtime';

export const TRANSLATION_CACHE_CLEANUP_ALARM = 'fluentread-translation-cache-cleanup';

interface BrowserAlarm {
    name: string;
}

/**
 * 注册翻译缓存维护任务。
 *
 * Step 1: worker 每次启动都先做一次轻量清理。
 * Step 2: 复用已有 alarm；仅在缺失时创建每日任务，兼容 MV2 与 MV3 重启。
 */
export function installTranslationCacheCleanup(): void {
    void cleanupTranslationCache();
    browser.alarms.onAlarm.addListener((alarm: BrowserAlarm) => {
        if (alarm.name === TRANSLATION_CACHE_CLEANUP_ALARM) void cleanupTranslationCache();
    });

    void browser.alarms.get(TRANSLATION_CACHE_CLEANUP_ALARM).then((alarm: BrowserAlarm | undefined) => {
        if (!alarm) {
            void browser.alarms.create(TRANSLATION_CACHE_CLEANUP_ALARM, {
                delayInMinutes: 1,
                periodInMinutes: 24 * 60,
            });
        }
    });
}
