import {method, urls} from "@/src/core/config/constants";
import {services} from "@/src/core/config/catalog";
import {commonMsgTemplate} from '@/src/services/translation/templates';
import {config} from "@/src/services/config/store";
import {createHttpStatusError, readJsonResponse} from '@/src/platform/http/errors';
import {runtimeFetch} from '@/src/platform/http/runtime';
import {getTranslationProviderConfig} from '@/src/services/translation/requestSnapshot';
import {hmacSha256Base64} from '@/src/core/crypto/sha256';


const JWT_CACHE_DURATION_MS = 60 * 60 * 1000;
const jwtCache = new Map<string, {apiKey: string; secret: string; expiration: number}>();

// 文档参考：https://docs.bigmodel.cn/cn/guide/develop/http/introduction
async function zhipu(message: any) {
    const current = getTranslationProviderConfig(message, config);
    const service = message.serviceOverride || services.zhipu;
    // 智谱根据 token 获取 secret（签名密钥） 和 expiration
    const token = current.token[service];
    const cached = jwtCache.get(service);
    let secret = cached?.apiKey === token && cached.expiration > Date.now()
        ? cached.secret
        : undefined;
    if (!token?.trim()) {
        secret = undefined;
        jwtCache.delete(service);
    } else if (!secret) {
        secret = generateToken(token);
        if (!secret) throw new Error('无法生成令牌');
        // JWT 是可复算的派生凭据，只在当前后台进程内缓存，不进入 Config/storage/history/export。
        jwtCache.set(service, {apiKey: token, secret, expiration: Date.now() + JWT_CACHE_DURATION_MS});
    }

    // 构建请求头
    let headers = new Headers();
    headers.append('Content-Type', 'application/json');
    if (secret) headers.append('Authorization', `Bearer ${secret}`);

    // 发起 fetch 请求
    const resp = await runtimeFetch(urls[services.zhipu], {
        method: method.POST,
        headers: headers,
            body: commonMsgTemplate(message.origin, message.pageContext, message.summaryPrompt, message.summarySystemPrompt, service, message.targetLanguage, message.modelOverride, current)
    });

    if (resp.ok) {
        const result = await readJsonResponse<any>(resp, '智谱返回的不是有效 JSON');
        return result.choices[0].message.content;
    } else {
        throw createHttpStatusError(resp, '翻译失败');
    }
}

function generateToken(APIKey: string) {
    if (!APIKey || !APIKey.includes('.')) {
        return;
    }
    const now = Date.now();
    const [key, secret] = APIKey.split('.');

    return generateJWT(secret, {alg: "HS256", sign_type: "SIGN", typ: "JWT"}, {
        api_key: key,
        exp: now + JWT_CACHE_DURATION_MS,
        timestamp: now,
    });
}

// 生成JWT（JSON Web Token）
function generateJWT(secret: string, header: any, payload: any) {
    // 对header和payload部分进行UTF-8编码，然后转换为Base64URL格式
    const encodedHeader = base64UrlSafe(btoa(JSON.stringify(header)));
    const encodedPayload = base64UrlSafe(btoa(JSON.stringify(payload)));
    // 生成 jwt 签名
    const hmacsha256 = base64UrlSafe(hmacSha256Base64(`${encodedHeader}.${encodedPayload}`, secret));
    return `${encodedHeader}.${encodedPayload}.${hmacsha256}`;
}

// 将Base64字符串转换为Base64URL格式的函数
function base64UrlSafe(base64String: string) {
    return base64String.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export default zhipu;
