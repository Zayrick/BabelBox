import {config} from "@/src/services/config/store";
import {isApiKeyRequired} from "@/src/core/config/validation";
import {translateWithOpenAICompatibleAiSdk} from './ai-sdk/openai-compatible';
import {getTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';

async function azureOpenai(message: any) {
    const current = getTranslationProviderConfig(message, config);
    const service = message.serviceOverride || current.service;
    const apiKey = current.token[service];
    if ((!apiKey || apiKey.trim() === '') && isApiKeyRequired(service, current)) {
        throw new Error('Azure OpenAI API Key 未配置，请在设置中输入有效的 API Key');
    }

    const endpoint = current.azureOpenaiEndpoint;
    if (!endpoint || endpoint.trim() === '') {
        throw new Error('Azure OpenAI 端点地址未配置，请在设置中输入完整的端点地址');
    }

    if (!endpoint.includes('openai.azure.com') || !endpoint.includes('/chat/completions')) {
        throw new Error('Azure OpenAI 端点地址格式不正确，请确保包含正确的域名和路径');
    }

    return translateWithOpenAICompatibleAiSdk({...message, serviceOverride: service});
}

export default azureOpenai;
