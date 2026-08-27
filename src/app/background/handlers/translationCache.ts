import type {BackgroundMessageHandler} from '@/src/platform/browser/messageRouter';

export const CLEAR_TRANSLATION_CACHE_MESSAGE = 'clearTranslationCache' as const;

export interface ClearTranslationCacheMessage {
    type: typeof CLEAR_TRANSLATION_CACHE_MESSAGE;
}
export interface ClearTranslationCacheResponse {
    success: true;
}

/** 创建翻译缓存清理 handler；具体缓存实现由 composition root 注入。 */
export function createTranslationCacheHandler(
    clearTranslationCache: () => Promise<void>,
): BackgroundMessageHandler<unknown, ClearTranslationCacheMessage, ClearTranslationCacheResponse> {
    return {
        type: CLEAR_TRANSLATION_CACHE_MESSAGE,
        async handle() {
            // 同时清理持久译文缓存和 broker 的页面摘要缓存。
            await clearTranslationCache();
            // 只有底层清理成功后才向调用方报告成功。
            return {success: true};
        },
    };
}
