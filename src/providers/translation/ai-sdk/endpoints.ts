import {getMimoEndpoint, MINIMAX_ENDPOINTS, urls} from '@/src/core/config/constants';
import {config as runtimeConfig} from '@/src/services/config/store';
import {services} from '@/src/core/config/catalog';

export type AiSdkEndpointRoute = 'common' | 'custom' | 'newapi' | 'azure';

export const AI_SDK_TRANSPORT_PROFILE = 'vercel-ai-sdk-openai-compatible-v1' as const;

export interface AiSdkEndpointConfig {
    proxy?: Record<string, string | undefined>;
    custom?: string;
    newApiUrl?: string;
    azureOpenaiEndpoint?: string;
    minimaxBillingPlan?: string;
    minimaxRegion?: string;
    mimoBillingPlan?: string;
    mimoRegion?: string;
}

export interface OpenAICompatibleEndpointResolution {
    /** Canonical URL that the current FluentRead adapter would call. */
    endpoint: string;
    /** URL prefix passed to an OpenAI-compatible provider before it appends /chat/completions. */
    baseURL: string;
    /** Query parameters removed from the endpoint and supplied at provider creation time. */
    queryParams?: Record<string, string>;
    /**
     * An endpoint that cannot be represented losslessly as baseURL plus the
     * provider query record, such as a non-standard path or duplicate query
     * keys. The SDK adapter rewrites its injected fetch target to this URL.
     */
    exactEndpoint?: string;
}

export type ResolvedOpenAICompatibleEndpoint = OpenAICompatibleEndpointResolution;

export const AI_SDK_COMMON_SERVICE_IDS = Object.freeze([
    services.yiyan,
    services.infini,
    services.minimax,
    services.mimo,
    services.openai,
    services.moonshot,
    services.baichuan,
    services.lingyi,
    services.jieyue,
    services.groq,
    services.huanYuan,
    services.doubao,
    services.siliconCloud,
    services.openrouter,
    services.grok,
]);

export const AI_SDK_SERVICE_IDS = Object.freeze([
    ...AI_SDK_COMMON_SERVICE_IDS,
    services.custom,
    services.newapi,
    services.azureOpenai,
]);

const commonServices = new Set<string>(AI_SDK_COMMON_SERVICE_IDS);

function parseAbsoluteEndpoint(rawEndpoint: string | undefined, label: string): URL {
    const endpoint = rawEndpoint?.trim();
    if (!endpoint) throw new Error(`${label}未配置`);

    let url: URL;
    try {
        url = new URL(endpoint);
    } catch {
        throw new Error(`${label}格式不正确`);
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error(`${label}仅支持 HTTP 或 HTTPS 协议`);
    }

    url.hash = '';
    return url;
}

function withoutTrailingSlash(value: string): string {
    return value.endsWith('/') ? value.slice(0, -1) : value;
}

/**
 * Split a complete Chat Completions URL into the fields expected by the
 * OpenAI-compatible provider. Non-standard paths retain an exactEndpoint marker
 * so the shared fetch wrapper preserves the configured direct target.
 */
export function parseChatCompletionsEndpoint(
    rawEndpoint: string,
    label = '翻译服务接口地址',
): OpenAICompatibleEndpointResolution {
    const url = parseAbsoluteEndpoint(rawEndpoint, label);
    const queryEntries = [...url.searchParams.entries()];
    const hasDuplicateQueryKeys = new Set(queryEntries.map(([key]) => key)).size !== queryEntries.length;
    const parsedQueryParams = Object.fromEntries(queryEntries);
    const queryParams = Object.keys(parsedQueryParams).length > 0 ? parsedQueryParams : undefined;
    url.search = '';

    const standardPath = url.pathname.match(/^(.*)\/chat\/completions\/?$/);
    if (standardPath) {
        const endpointUrl = new URL(rawEndpoint.trim());
        endpointUrl.hash = '';
        endpointUrl.pathname = endpointUrl.pathname.replace(/\/$/, '');

        url.pathname = standardPath[1] || '/';
        const resolution: OpenAICompatibleEndpointResolution = {
            endpoint: endpointUrl.toString(),
            baseURL: withoutTrailingSlash(url.toString()),
        };
        if (hasDuplicateQueryKeys) resolution.exactEndpoint = endpointUrl.toString();
        else resolution.queryParams = queryParams;
        return resolution;
    }

    const exactUrl = new URL(rawEndpoint.trim());
    exactUrl.hash = '';
    return {
        endpoint: exactUrl.toString(),
        baseURL: withoutTrailingSlash(url.toString()),
        queryParams,
        exactEndpoint: exactUrl.toString(),
    };
}

/** Match the URL completion rules in the existing New API adapter. */
export function normalizeNewApiEndpoint(rawEndpoint: string): string {
    const url = parseAbsoluteEndpoint(rawEndpoint, 'New API 地址');
    const path = url.pathname.replace(/\/+$/, '');

    if (/\/chat\/completions$/.test(path)) {
        url.pathname = path;
    } else if (/\/v1$/.test(path)) {
        url.pathname = `${path}/chat/completions`;
    } else {
        url.pathname = `${path}/v1/chat/completions`;
    }

    return url.toString();
}

export function getAiSdkEndpointRoute(service: string): AiSdkEndpointRoute | null {
    if (commonServices.has(service)) return 'common';
    if (service === services.custom) return 'custom';
    if (service === services.newapi) return 'newapi';
    if (service === services.azureOpenai) return 'azure';
    return null;
}

function resolveCommonEndpoint(service: string, config: AiSdkEndpointConfig): string {
    const proxy = config.proxy?.[service]?.trim();
    if (proxy) return proxy;

    if (service === services.minimax) {
        const plan = config.minimaxBillingPlan === 'token-plan' ? 'token-plan' : 'payg';
        const region = config.minimaxRegion === 'global' ? 'global' : 'cn';
        return MINIMAX_ENDPOINTS[plan][region];
    }

    if (service === services.mimo) {
        return getMimoEndpoint(config.mimoBillingPlan || 'payg', config.mimoRegion || 'cn');
    }

    const endpoint = urls[service];
    if (typeof endpoint !== 'string' || !endpoint.trim()) {
        throw new Error(`未找到翻译服务接口: ${service}`);
    }
    return endpoint;
}

export function resolveOpenAICompatibleEndpoint(
    service: string,
    config: AiSdkEndpointConfig = runtimeConfig,
): ResolvedOpenAICompatibleEndpoint {
    const route = getAiSdkEndpointRoute(service);
    if (!route) throw new Error(`翻译服务尚未纳入 AI SDK 端点解析: ${service}`);

    let endpoint: string;
    switch (route) {
        case 'common':
            endpoint = resolveCommonEndpoint(service, config);
            break;
        case 'custom':
            endpoint = config.proxy?.[service]?.trim() || config.custom || '';
            break;
        case 'newapi':
            endpoint = normalizeNewApiEndpoint(config.newApiUrl || '');
            break;
        case 'azure':
            endpoint = config.azureOpenaiEndpoint || '';
            break;
    }

    return parseChatCompletionsEndpoint(endpoint, `${service} 接口地址`);
}
