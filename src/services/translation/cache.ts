import Dexie, { type Table } from 'dexie';
import {sha256Hex} from '@/src/core/crypto/sha256';

export const TRANSLATION_CACHE_VERSION = 1;
export const TRANSLATION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
export const TRANSLATION_CACHE_MAX_ENTRIES = 2_000;
export const TRANSLATION_CACHE_MAX_BYTES = 5 * 1024 * 1024;
export const TRANSLATION_CACHE_MAX_ENTRY_BYTES = 256 * 1024;
export const TRANSLATION_CACHE_MEMORY_ENTRIES = 128;

export interface TranslationCacheIdentity {
  [key: string]: unknown;
}

export interface TranslationCacheRecord {
  key: string;
  translation: string;
  createdAt: number;
  lastAccessedAt: number;
  expiresAt: number;
  byteSize: number;
}

/**
 * 对结构化缓存身份做确定性序列化。
 * 对象字段顺序不能改变 key，用户文本也不能直接拼接成带分隔符的 key。
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'bigint') return JSON.stringify(value.toString());
  if (typeof value === 'undefined') return 'null';

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => typeof item !== 'undefined')
      .sort(([left], [right]) => left.localeCompare(right));

    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(',')}}`;
  }

  return JSON.stringify(String(value));
}

/**
 * 从结构化请求身份生成带版本的不可读 key。
 * 版本号防止读取与当前协议不兼容的记录。
 */
export function buildTranslationCacheKey(identity: TranslationCacheIdentity): string {
  const payload = canonicalize({
    version: TRANSLATION_CACHE_VERSION,
    ...identity,
  });
  const digest = sha256Hex(payload);
  return `v${TRANSLATION_CACHE_VERSION}:${digest}`;
}

function getByteSize(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).byteLength;
  }
  return value.length * 2;
}

class FluentReadCacheDatabase extends Dexie {
  entries!: Table<TranslationCacheRecord, string>;

  constructor() {
    super('FluentReadTranslationCache');
    this.version(1).stores({
      entries: '&key, createdAt, expiresAt, lastAccessedAt',
    });
    this.version(2).stores({
      entries: '&key, createdAt, expiresAt, lastAccessedAt',
    });
  }
}

export const translationCacheDb = new FluentReadCacheDatabase();

function isExpired(record: TranslationCacheRecord, now: number): boolean {
  return record.expiresAt <= now || record.createdAt + TRANSLATION_CACHE_TTL_MS <= now;
}

/**
 * 翻译缓存由后台统一持有，IndexedDB 之外再保留一层小型热数据内存缓存。
 * 读取、写入和维护失败会降级为未命中，使无痕模式、禁用 IndexedDB 或配额不足时仍能翻译。
 */
class TranslationCache {
  private readonly memory = new Map<string, TranslationCacheRecord>();

  private remember(record: TranslationCacheRecord): void {
    // 重新插入记录，把它移动到内存 LRU 的最新位置。
    this.memory.delete(record.key);
    this.memory.set(record.key, record);

    // 超过热数据上限时，从最旧记录开始逐个淘汰。
    while (this.memory.size > TRANSLATION_CACHE_MEMORY_ENTRIES) {
      // Map.size 已确认大于上限，因此迭代器必然返回一个 key。
      const oldestKey = this.memory.keys().next().value as string;
      this.memory.delete(oldestKey);
    }
  }

  private forget(key: string): void {
    this.memory.delete(key);
  }

  async get(key: string, now = Date.now()): Promise<string | null> {
    // 优先读取热数据；过期记录同时从内存和持久层移除。
    const memoryRecord = this.memory.get(key);
    if (memoryRecord) {
      if (isExpired(memoryRecord, now)) {
        this.forget(key);
        void translationCacheDb.entries.delete(key).catch(() => undefined);
        return null;
      }

      memoryRecord.lastAccessedAt = now;
      this.remember(memoryRecord);
      return memoryRecord.translation;
    }

    try {
      // 冷数据从 IndexedDB 读取，并同步刷新持久层 LRU 时间。
      const record = await translationCacheDb.entries.get(key);
      if (!record) return null;

      if (isExpired(record, now)) {
        await translationCacheDb.entries.delete(key);
        return null;
      }

      record.lastAccessedAt = now;
      await translationCacheDb.entries.put(record);
      this.remember(record);
      return record.translation;
    } catch (error) {
      // 缓存不可用时只按未命中处理，不能阻断真实翻译。
      console.warn('[FluentRead] translation cache read failed:', error);
      return null;
    }
  }

  async set(key: string, translation: string, now = Date.now()): Promise<boolean> {
    // 空译文和过大单项不进入缓存，避免无效数据或配额攻击。
    const byteSize = getByteSize(key) + getByteSize(translation);
    if (!translation || byteSize > TRANSLATION_CACHE_MAX_ENTRY_BYTES) {
      return false;
    }

    const record: TranslationCacheRecord = {
      key,
      translation,
      createdAt: now,
      lastAccessedAt: now,
      expiresAt: now + TRANSLATION_CACHE_TTL_MS,
      byteSize,
    };

    try {
      // 在同一事务中写入新记录，并按条目数与总字节数执行持久层 LRU。
      await translationCacheDb.transaction('rw', translationCacheDb.entries, async () => {
        await translationCacheDb.entries.put(record);

        const entries = await translationCacheDb.entries.orderBy('lastAccessedAt').toArray();
        let totalBytes = entries.reduce((total, item) => total + item.byteSize, 0);
        const keysToDelete: string[] = [];

        while (
          entries.length - keysToDelete.length > TRANSLATION_CACHE_MAX_ENTRIES ||
          totalBytes > TRANSLATION_CACHE_MAX_BYTES
        ) {
          // 循环条件保证仍有待淘汰记录；每轮固定消费最旧的一项。
          const candidate = entries[keysToDelete.length];
          keysToDelete.push(candidate.key);
          totalBytes -= candidate.byteSize;
        }

        if (keysToDelete.length > 0) {
          await translationCacheDb.entries.bulkDelete(keysToDelete);
          keysToDelete.forEach((entryKey) => this.forget(entryKey));
        }
      });

      // 持久化成功后再进入热数据层，防止内存和 IndexedDB 状态分叉。
      this.remember(record);
      return true;
    } catch (error) {
      console.warn('[FluentRead] translation cache write failed:', error);
      return false;
    }
  }

  async cleanup(now = Date.now()): Promise<void> {
    try {
      // 同时按 expiresAt 和当前 TTL 清理持久层，兼容历史 TTL 策略。
      await translationCacheDb.entries.where('expiresAt').belowOrEqual(now).delete();
      await translationCacheDb.entries
        .where('createdAt')
        .belowOrEqual(now - TRANSLATION_CACHE_TTL_MS)
        .delete();
      // 再清理热数据，保证同一时间点下两层过期判断一致。
      for (const [key, record] of this.memory) {
        if (isExpired(record, now)) this.memory.delete(key);
      }
    } catch (error) {
      console.warn('[FluentRead] translation cache cleanup failed:', error);
    }
  }

  async clear(): Promise<void> {
    // 先清空当前 service worker 的热数据。
    this.memory.clear();
    try {
      // 再清空 IndexedDB；失败时向调用方报告，避免 UI 误报已清除。
      await translationCacheDb.entries.clear();
    } catch (error) {
      console.warn('[FluentRead] translation cache clear failed:', error);
      throw error;
    }
  }
}

export const translationCache = new TranslationCache();
