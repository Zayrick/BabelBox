import {getDeepLXEndpoints} from "@/src/core/config/deeplx";
import {createHttpStatusError, createProviderCodeError} from '@/src/platform/http/errors';
import type {TranslationProviderRequest} from '@/src/services/translation/types';

const DEEPLX_TOTAL_TIMEOUT_MS = 20_000;
const DEEPLX_ATTEMPT_TIMEOUT_MS = 8_000;

function normalizeLanguage(language: string): string {
    const normalized = language.toLowerCase();
    if (normalized === "auto") {
        return "AUTO";
    }
    if (normalized === "zh-hans" || normalized === "zh-cn") {
        return "ZH";
    }
    if (normalized === "zh-tw" || normalized === "zh-hant") {
        return "ZH-HANT";
    }
    return language.toUpperCase();
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function fetchDeepLX(url: string, requestInit: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {...requestInit, signal: controller.signal});
    } catch {
        if (controller.signal.aborted) {
            throw new Error(`请求超时（${timeoutMs / 1000} 秒）`);
        }
        throw new Error('网络请求失败');
    } finally {
        clearTimeout(timeout);
    }
}

async function translateFromDeepLX(
    url: string,
    text: string,
    sourceLang: string,
    targetLang: string,
    token: string,
    timeoutMs: number,
): Promise<string> {
    const headers: HeadersInit = {
        "Content-Type": "application/json",
    };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetchDeepLX(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
            text,
            source_lang: sourceLang,
            target_lang: targetLang,
        }),
    }, timeoutMs);

    if (!response.ok) {
        throw createHttpStatusError(response);
    }
    const responseBody = await response.text();

    let result: unknown;
    try {
        result = JSON.parse(responseBody);
    } catch {
        throw new Error('返回的不是 JSON');
    }

    if (!result || typeof result !== "object") {
        throw new Error("返回格式异常");
    }

    const responseData = result as {code?: unknown; data?: unknown; message?: unknown};
    if (responseData.code !== undefined && responseData.code !== 200) {
        throw createProviderCodeError('DeepLX 返回错误', responseData.code);
    }
    if (typeof responseData.data !== "string" || responseData.data.trim().length === 0) {
        throw new Error("返回格式异常：缺少译文");
    }

    return responseData.data;
}

export function getDeepLXRequestLanguages(from: string, to: string): {sourceLang: string; targetLang: string} {
    return {
        sourceLang: normalizeLanguage(from),
        targetLang: normalizeLanguage(to),
    };
}

async function deeplx(request: TranslationProviderRequest): Promise<string> {
    if (typeof request.origin !== "string") {
        throw new Error("DeepLX 翻译仅支持单条文本");
    }
    const token = request.service.credential.apiKey.trim();
    const endpoints = getDeepLXEndpoints(request.service.endpoint, token);
    const {sourceLang, targetLang} = getDeepLXRequestLanguages(request.sourceLanguage, request.targetLanguage);
    const deadline = Date.now() + DEEPLX_TOTAL_TIMEOUT_MS;
    const failures: string[] = [];

    for (const [index, endpoint] of endpoints.entries()) {
        const remainingTime = deadline - Date.now();
        if (remainingTime <= 0) {
            break;
        }

        try {
            return await translateFromDeepLX(
                endpoint,
                request.origin,
                sourceLang,
                targetLang,
                token,
                Math.min(DEEPLX_ATTEMPT_TIMEOUT_MS, remainingTime),
            );
        } catch (error) {
            failures.push(`备用站点 ${index + 1}: ${getErrorMessage(error)}`);
        }
    }

    const failureSummary = failures.length > 0 ? failures.join("；") : "总请求时间已耗尽";
    throw new Error(`DeepLX 所有备用站点均失败：${failureSummary}`);
}

export default deeplx;
