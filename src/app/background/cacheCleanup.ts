import {browser} from 'wxt/browser';
import {cleanupTranslationCache} from '@/src/app/translation/runtime';

export const TRANSLATION_CACHE_CLEANUP_ALARM = 'babelbox-translation-cache-cleanup';

interface BrowserAlarm {
    name: string;
}

/** worker 启动时清理一次，并确保每日清理 alarm 已注册。 */
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
