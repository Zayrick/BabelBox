import { method } from "@/src/core/config/constants";
import { config } from "@/src/services/config/store";
import { detectlang } from "@/src/core/language/detect";
import { mergeCustomBody } from "@/src/core/config/customBody";
import { services } from "@/src/core/config/catalog";
import {getTranslationLanguages} from '@/src/services/translation/languages';
import {createHttpStatusError, createProviderCodeError, readJsonResponse} from '@/src/platform/http/errors';
import {getTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';

// 混元翻译大模型支持的语言代码映射
const languageMap: Record<string, string> = {
    'zh-Hans': 'zh',    // 简体中文
    'zh-Hant': 'yue',   // 繁体中文使用粤语代码
    'en': 'en',         // 英语
    'ja': 'ja',         // 日语
    'ko': 'ko',         // 韩语
    'fr': 'fr',         // 法语
    'ru': 'ru',         // 俄语
    'de': 'de',         // 德语
    'es': 'es',         // 西班牙语
    'it': 'it',         // 意大利语
    'tr': 'tr',         // 土耳其语
    'ar': 'ar',         // 阿拉伯语
    'pt': 'pt',         // 葡萄牙语
    'th': 'th',         // 泰语
    'vi': 'vi',         // 越南语
    'ms': 'ms',         // 马来语
    'id': 'id',         // 印尼语
    // 注意：auto由代码逻辑特殊处理，不在此映射
};

// 生成HMAC签名 (返回二进制数据)
async function generateHmacSignature(key: string | ArrayBuffer, message: string): Promise<ArrayBuffer> {
    const encoder = new TextEncoder();
    const keyData = typeof key === 'string' ? encoder.encode(key) : key;
    
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    
    return await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
}

// 将二进制数据转换为十六进制字符串
function arrayBufferToHex(buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

// 生成腾讯云API签名
async function createHunyuanSignature(requestPayload: string, timestamp: number, secretId: string, secretKey: string): Promise<string> {
    const date = new Date(timestamp * 1000).toISOString().substring(0, 10);
    
    // 步骤1：拼接规范请求串
    const httpRequestMethod = "POST";
    const canonicalUri = "/";
    const canonicalQueryString = "";
    const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:hunyuan.tencentcloudapi.com\n`;
    const signedHeaders = "content-type;host";
    
    const hashedRequestPayload = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(requestPayload));
    const hashedPayloadHex = Array.from(new Uint8Array(hashedRequestPayload))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    
    const canonicalRequest = `${httpRequestMethod}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayloadHex}`;
    
    // 步骤2：拼接待签名字符串
    const algorithm = "TC3-HMAC-SHA256";
    const credentialScope = `${date}/hunyuan/tc3_request`;
    
    const hashedCanonicalRequest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalRequest));
    const hashedCanonicalRequestHex = Array.from(new Uint8Array(hashedCanonicalRequest))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
    
    const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${hashedCanonicalRequestHex}`;
    
    // 步骤3：计算签名
    const kDate = await generateHmacSignature(`TC3${secretKey}`, date);
    const kService = await generateHmacSignature(kDate, "hunyuan");
    const kSigning = await generateHmacSignature(kService, "tc3_request");
    const signatureBuffer = await generateHmacSignature(kSigning, stringToSign);
    const signature = arrayBufferToHex(signatureBuffer);
    
    // 步骤4：拼接 Authorization
    const authorization = `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    
    return authorization;
}

export function buildHunyuanTranslationRequestBody(
    text: string,
    target: string,
    model: string,
    customBody?: unknown,
) {
    return mergeCustomBody({
        Model: model,
        Stream: false,
        Text: text,
        Target: target,
    }, customBody);
}

async function hunyuanTranslation(message: any) {
    try {
        const current = getTranslationProviderConfig(message, config);
        const service = message.serviceOverride || services.huanYuanTranslation;
        
        // 从配置中获取 SecretId 和 SecretKey
        const secretId = current.tencentSecretId?.trim();
        const secretKey = current.tencentSecretKey?.trim();
        
        if (!secretId || !secretKey) {
            throw new Error('腾讯混元翻译密钥未配置，请在设置中配置SecretId和SecretKey');
        }
        
        // 基本格式验证
        if (secretId.length < 10 || secretKey.length < 10) {
            throw new Error('SecretId或SecretKey格式不正确，请检查是否完整复制了密钥信息');
        }
        
        // 转换语言代码
        // 对于自动检测，使用FluentRead内置的语言检测
        const {sourceLanguage, targetLanguage} = getTranslationLanguages(message);
        let sourceLang: string;
        if (sourceLanguage === 'auto') {
            const detectedLang = detectlang(message.origin.replace(/[\s\u3000]/g, ''));
            sourceLang = languageMap[detectedLang] || detectedLang;
        } else {
            sourceLang = languageMap[sourceLanguage] || sourceLanguage;
        }
        
        const mappedTargetLang = languageMap[targetLanguage] || targetLanguage;
        
        // 如果源语言和目标语言相同，直接返回原文
        if (sourceLang === mappedTargetLang) {
            return message.origin;
        }
        
        if (!mappedTargetLang) {
            throw new Error('混元翻译不支持该目标语言');
        }
        
        // 获取模型配置，默认使用 hunyuan-translation
        const model = message.modelOverride || current.model[service] || 'hunyuan-translation';
        
        // 自定义字段必须在序列化和签名前合并，否则签名内容会与实际请求体不一致。
        const requestBody = buildHunyuanTranslationRequestBody(
            message.origin,
            mappedTargetLang,
            model,
            current.customBody?.[service],
        );
        
        // 如果有配置领域信息，可以添加 Field 参数
        // requestBody.Field = '通用';
        
        // 如果需要参考示例，可以添加 References 参数
        // requestBody.References = [{
        //     Type: "sentence",
        //     Text: "示例原文",
        //     Translation: "示例译文"
        // }];
        
        const requestBodyStr = JSON.stringify(requestBody);
        const timestamp = Math.floor(Date.now() / 1000);
        
        // 生成签名和Authorization头
        const authorization = await createHunyuanSignature(requestBodyStr, timestamp, secretId, secretKey);
        
        // 判断是否使用代理
        const url = current.proxy[service] || 'https://hunyuan.tencentcloudapi.com/';
        
        const response = await fetch(url, {
            method: method.POST,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Host': 'hunyuan.tencentcloudapi.com',
                'Authorization': authorization,
                'X-TC-Action': 'ChatTranslations',
                'X-TC-Version': '2023-09-01',
                'X-TC-Region': 'ap-beijing',
                'X-TC-Timestamp': timestamp.toString()
            },
            body: requestBodyStr
        });
        
        if (!response.ok) {
            throw createHttpStatusError(response, '腾讯混元翻译请求失败');
        }
        
        const result = await readJsonResponse<any>(response, '腾讯混元翻译返回的不是有效 JSON');
        
        // 检查是否有错误
        if (result.Response?.Error) {
            throw createProviderCodeError('腾讯混元翻译错误', result.Response.Error.Code);
        }
        
        // 返回翻译结果
        if (result.Response?.Choices && result.Response.Choices.length > 0) {
            const translatedText = result.Response.Choices[0].Message?.Content;
            if (translatedText) {
                return translatedText;
            }
        }
        
        throw new Error('腾讯混元翻译返回格式异常');
        
    } catch (error) {
        throw error;
    }
}

export default hunyuanTranslation;
