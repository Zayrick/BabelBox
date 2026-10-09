import {
    getTranslationServiceCredential,
    getTranslationServiceInstance,
    type TranslationServiceConfigLike,
} from '@/src/core/config/translationServices';
import type {ResolvedTranslationService} from './types';

/**
 * Copies one instance and its credential before any await, so later edits in
 * the settings page cannot change a request that is already in flight.
 */
export function resolveTranslationService(
    config: TranslationServiceConfigLike,
    serviceId: string,
    options: {allowDisabled?: boolean} = {},
): ResolvedTranslationService {
    const instance = getTranslationServiceInstance(config, serviceId);
    if (!instance) throw new Error('翻译服务不存在或已被删除，请重新选择');
    if (!instance.enabled && !options.allowDisabled) {
        throw new Error(`翻译服务「${instance.name}」已禁用，请先启用或选择其他服务`);
    }
    return Object.freeze({
        ...instance,
        credential: Object.freeze({...getTranslationServiceCredential(config, serviceId)}),
    });
}
