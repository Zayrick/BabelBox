export interface TranslationCacheClearRequest {
    type: 'clearTranslationCache';
}

/** Popup 直接请求后台清库，并且只把后台明确确认的成功当作成功。 */
export async function requestTranslationCacheClear(
    sendMessage: (message: TranslationCacheClearRequest) => Promise<unknown>,
): Promise<void> {
    const response = await sendMessage({type: 'clearTranslationCache'});
    if (response && typeof response === 'object' && (response as {success?: unknown}).success === true) return;

    const error = response && typeof response === 'object'
        && typeof (response as {error?: unknown}).error === 'string'
        ? (response as {error: string}).error
        : '后台未确认缓存清理成功';
    throw new Error(error);
}
