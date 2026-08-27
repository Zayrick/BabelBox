const LEGACY_TRANSLATION_CACHE_PREFIX = 'flcache_';
const LEGACY_CACHE_TIMESTAMP_KEY = 'flLastSessionTimestamp';

export interface LegacyPageStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  removeItem(key: string): void;
}

/**
 * 删除早期版本写入页面 origin 的 FluentRead 翻译缓存。
 * 只处理产品前缀与时间戳标记，绝不清空或遍历删除宿主站点的其他数据。
 */
export function clearLegacyPageTranslationCache(
  pageStorage: LegacyPageStorage = window.localStorage,
): number {
  try {
    const keysToDelete: string[] = [];
    for (let index = 0; index < pageStorage.length; index += 1) {
      const key = pageStorage.key(index);
      if (key?.startsWith(LEGACY_TRANSLATION_CACHE_PREFIX)) keysToDelete.push(key);
    }

    keysToDelete.forEach((key) => pageStorage.removeItem(key));
    if (keysToDelete.length > 0 || pageStorage.getItem(LEGACY_CACHE_TIMESTAMP_KEY) !== null) {
      pageStorage.removeItem(LEGACY_CACHE_TIMESTAMP_KEY);
    }
    return keysToDelete.length;
  } catch {
    // 沙箱或 opaque origin 可能禁用 Storage；迁移失败不能阻止内容脚本启动。
    return 0;
  }
}
