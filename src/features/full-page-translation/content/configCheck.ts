import {customModelString, services, servicesType} from '@/src/core/config/catalog';
import {config} from '@/src/services/config/store';
import {sendErrorMessage} from '@/src/features/page-notice/public';

export function checkConfig(): boolean {
    if (!config.on) return false;

    // content 无法读取 session 凭据，统一由 background 校验。

    if (servicesType.isAI(config.service) && ![services.cozecn, services.cozecom].includes(config.service)) {
        const model = config.model[config.service];
        const customModel = config.customModel[config.service];
        if (!model || (model === customModelString && !customModel)) {
            sendErrorMessage("模型尚未配置，请前往设置页配置");
            return false;
        }
    }

    if (config.display === 0 && config.service === services.google) {
        sendErrorMessage("「谷歌翻译」仅支持双语模式，请切换翻译服务");
        return false;
    }

    return true;
}
