import {translateWithOpenAICompatibleAiSdk} from './ai-sdk/openai-compatible';
import type {TranslationProviderRequest} from '@/src/services/translation/types';

async function azureOpenai(request: TranslationProviderRequest) {
    const endpoint = request.service.endpoint.trim();
    if (!endpoint) {
        throw new Error('Azure OpenAI 端点地址未配置，请在设置中输入完整的端点地址');
    }
    if (!endpoint.includes('openai.azure.com') || !endpoint.includes('/chat/completions')) {
        throw new Error('Azure OpenAI 端点地址格式不正确，请确保包含正确的域名和路径');
    }
    return translateWithOpenAICompatibleAiSdk(request);
}

export default azureOpenai;
