import { servicesType } from './catalog';
import {
    getTranslationServiceCredential,
    getTranslationServiceInstance,
    type TranslationServiceConfigLike,
} from './translationServices';

/** 返回设置页和翻译前校验共用的凭据提示；返回 null 表示当前服务不缺凭据。 */
export function getMissingCredentialMessage(
    serviceId: string,
    config: TranslationServiceConfigLike,
): string | null {
    const instance = getTranslationServiceInstance(config, serviceId);
    if (!instance) return null;
    const credential = getTranslationServiceCredential(config, serviceId);

    if (servicesType.isYoudao(instance.provider)
        && (!credential.appKey.trim() || !credential.appSecret.trim())) {
        return `${instance.name} 需要 App Key 和 App Secret，当前尚未完整配置；请先在设置中填写，再开始翻译。`;
    }
    if (servicesType.isTencent(instance.provider)
        && (!credential.secretId.trim() || !credential.secretKey.trim())) {
        return `${instance.name} 需要 SecretId 和 SecretKey，当前尚未完整配置；请先在设置中填写，再开始翻译。`;
    }
    return null;
}
