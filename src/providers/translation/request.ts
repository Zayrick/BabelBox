import type {TranslationProviderRequest} from '@/src/services/translation/types';

/** Adapters whose upstream API accepts one text per request. */
export function requireSingleOrigin(request: TranslationProviderRequest): string {
    if (typeof request.origin !== 'string') throw new Error('该翻译服务仅支持单条文本');
    return request.origin;
}
