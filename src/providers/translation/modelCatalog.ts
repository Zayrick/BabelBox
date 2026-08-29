import {services} from '@/src/core/config/catalog';
import {urls} from '@/src/core/config/constants';
import {config} from '@/src/services/config/store';
import {
    hasDynamicTranslationModelCatalog,
} from '@/src/services/translation/modelCatalog';
import {
    createTranslationProviderConfigSnapshot,
    resolveTranslationServiceConfig,
    type ResolvedTranslationServiceConfig,
} from '@/src/services/translation/requestSnapshot';
import type {TranslationConfigSource} from '@/src/services/translation/types';
import {runtimeFetch} from '@/src/platform/http/runtime';
import {appendOptionalBearer, appendOptionalHeader} from './auth';
import {resolveOpenAICompatibleEndpoint} from './ai-sdk/endpoints';

const MODEL_CATALOG_TIMEOUT_MS = 15_000;
const MAX_MODEL_COUNT = 2_000;
const MAX_ERROR_DETAIL_LENGTH = 240;

interface ModelCatalogRequest {
    url: string;
    headers: Headers;
}

function modelListUrlFromEndpoint(rawEndpoint: string): URL {
    let url: URL;
    try {
        url = new URL(rawEndpoint.trim());
    } catch {
        throw new Error('模型列表接口地址格式不正确');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('模型列表接口仅支持 HTTP 或 HTTPS 协议');
    }

    url.hash = '';
    url.search = '';
    const path = url.pathname.replace(/\/+$/u, '');
    const replaced = path.replace(/\/(?:chat\/completions|responses|messages)$/u, '/models');
    url.pathname = replaced === path ? `${path}/models` : replaced;
    return url;
}

function configuredChatEndpoint(resolved: ResolvedTranslationServiceConfig): string {
    const {provider, config: scoped} = resolved;
    if ([
        services.openai,
        services.yiyan,
        services.infini,
        services.minimax,
        services.mimo,
        services.moonshot,
        services.jieyue,
        services.groq,
        services.huanYuan,
        services.doubao,
        services.siliconCloud,
        services.openrouter,
        services.grok,
        services.custom,
        services.newapi,
    ].includes(provider)) {
        return resolveOpenAICompatibleEndpoint(provider, scoped).endpoint;
    }

    return scoped.proxy[provider] || urls[provider];
}

export function createTranslationModelCatalogRequest(
    resolved: ResolvedTranslationServiceConfig,
): ModelCatalogRequest {
    const {provider, config: scoped} = resolved;
    if (!hasDynamicTranslationModelCatalog(provider)) {
        throw new Error('该供应商没有可用的模型列表接口');
    }

    const apiKey = scoped.token[provider] || '';
    const headers = new Headers({Accept: 'application/json'});
    let url: URL;

    if (provider === services.gemini) {
        const proxy = scoped.proxy[provider]?.trim();
        if (proxy) {
            const generateContentPath = /\/models\/[^/]+:generateContent\/?$/u;
            const proxyUrl = new URL(proxy);
            if (generateContentPath.test(proxyUrl.pathname)) {
                proxyUrl.pathname = proxyUrl.pathname.replace(generateContentPath, '/models');
                proxyUrl.search = '';
                url = proxyUrl;
            } else {
                url = modelListUrlFromEndpoint(proxy);
            }
        } else {
            url = new URL('https://generativelanguage.googleapis.com/v1beta/models');
            url.searchParams.set('pageSize', '1000');
        }
        appendOptionalHeader(headers, 'x-goog-api-key', apiKey);
    } else if (provider === services.claude) {
        url = modelListUrlFromEndpoint(scoped.proxy[provider] || urls[provider]);
        url.searchParams.set('limit', '1000');
        appendOptionalHeader(headers, 'x-api-key', apiKey);
        headers.set('anthropic-version', '2023-06-01');
        headers.set('anthropic-dangerous-direct-browser-access', 'true');
    } else {
        url = modelListUrlFromEndpoint(configuredChatEndpoint(resolved));
        appendOptionalBearer(headers, apiKey);
        if (provider === services.siliconCloud) {
            url.searchParams.set('type', 'text');
            url.searchParams.set('sub_type', 'chat');
        }
        if (provider === services.openrouter) {
            headers.set('HTTP-Referer', 'https://github.com/Zayrick/BabelBox');
            headers.set('X-Title', 'BabelBox');
        }
    }

    return {url: url.toString(), headers};
}

function readString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function modelIdFromItem(item: unknown): string {
    if (typeof item === 'string') return item.trim();
    if (!item || typeof item !== 'object' || Array.isArray(item)) return '';
    const record = item as Record<string, unknown>;
    const baseModelId = readString(record.baseModelId);
    if (baseModelId) return baseModelId;
    const id = readString(record.id) || readString(record.model) || readString(record.name);
    return id.startsWith('models/') ? id.slice('models/'.length) : id;
}

function isGeminiGenerationModel(item: unknown): boolean {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return true;
    const methods = (item as Record<string, unknown>).supportedGenerationMethods;
    return !Array.isArray(methods) || methods.includes('generateContent');
}

export function extractTranslationModelIds(payload: unknown): string[] {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new Error('接口返回的模型列表格式不受支持');
    }
    const record = payload as Record<string, unknown>;
    const output = record.output && typeof record.output === 'object' && !Array.isArray(record.output)
        ? record.output as Record<string, unknown>
        : undefined;
    const candidates = Array.isArray(record.data)
        ? record.data
        : Array.isArray(record.models)
            ? record.models.filter(isGeminiGenerationModel)
            : Array.isArray(output?.models)
                ? output.models
                : null;
    if (!candidates) throw new Error('接口返回的模型列表格式不受支持');

    const seen = new Set<string>();
    const models: string[] = [];
    for (const item of candidates) {
        const modelId = modelIdFromItem(item);
        if (!modelId || seen.has(modelId)) continue;
        seen.add(modelId);
        models.push(modelId);
        if (models.length >= MAX_MODEL_COUNT) break;
    }
    if (!models.length) throw new Error('接口没有返回可用的模型');
    return models;
}

function redactSensitiveText(value: string, apiKey = ''): string {
    let text = value.replace(/[\r\n\t]+/gu, ' ').replace(/\s{2,}/gu, ' ').trim();
    const trimmedKey = apiKey.trim();
    if (trimmedKey) text = text.split(trimmedKey).join('***');
    text = text
        .replace(/(bearer\s+)[^\s,;]+/giu, '$1***')
        .replace(/\b(?:sk|tp|key|token)-[a-z0-9._-]{8,}\b/giu, '***');
    return text.slice(0, MAX_ERROR_DETAIL_LENGTH);
}

function providerErrorDetail(payload: unknown): string {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return '';
    const record = payload as Record<string, unknown>;
    const nested = record.error && typeof record.error === 'object' && !Array.isArray(record.error)
        ? record.error as Record<string, unknown>
        : undefined;
    return readString(nested?.message)
        || readString(record.message)
        || readString(record.error);
}

async function createModelCatalogHttpError(response: Response, apiKey: string): Promise<Error> {
    let detail = '';
    try {
        detail = providerErrorDetail(await response.clone().json());
    } catch {
        // 非 JSON 错误页只显示 HTTP 状态，避免把代理回显内容带入设置页。
    }
    const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
    const safeDetail = redactSensitiveText(detail, apiKey);
    return new Error(safeDetail ? `${status}：${safeDetail}` : status);
}

export async function listTranslationServiceModels(
    instanceId: string,
    source: TranslationConfigSource = config,
): Promise<string[]> {
    const snapshot = createTranslationProviderConfigSnapshot(source);
    const resolved = resolveTranslationServiceConfig(snapshot, instanceId, {allowDisabled: true});
    const request = createTranslationModelCatalogRequest(resolved);
    const apiKey = resolved.config.token[resolved.provider] || '';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), MODEL_CATALOG_TIMEOUT_MS);

    try {
        const response = await runtimeFetch(request.url, {
            method: 'GET',
            headers: request.headers,
            signal: controller.signal,
        });
        if (!response.ok) throw await createModelCatalogHttpError(response, apiKey);
        let payload: unknown;
        try {
            payload = await response.json();
        } catch {
            throw new Error('模型列表接口返回的不是有效 JSON');
        }
        return extractTranslationModelIds(payload);
    } catch (error) {
        if (controller.signal.aborted) throw new Error('请求模型列表超时');
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(redactSensitiveText(message, apiKey) || '请求模型列表失败');
    } finally {
        clearTimeout(timeout);
    }
}

export function formatTranslationModelCatalogError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return redactSensitiveText(message) || '请求模型列表失败';
}
