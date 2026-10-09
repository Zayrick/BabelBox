import type {
    ResolvedTranslationService,
    TranslationBroker,
    TranslationBrokerDependencies,
    TranslationProvider,
    TranslationProviderRequest,
    TranslationRequestMessage,
} from './types';
import {resolveTranslationService} from './requestSnapshot';

export type {
    ResolvedTranslationService,
    TranslationBatchRequestMessage,
    TranslationBroker,
    TranslationBrokerConfig,
    TranslationBrokerDependencies,
    TranslationLanguageOverride,
    TranslationProvider,
    TranslationProviderRegistry,
    TranslationProviderRequest,
    TranslationRequestMessage,
    TranslationRequestMessageBase,
    TranslationSingleRequestMessage,
} from './types';

type CacheRequestMode = 'single' | 'batch';

interface TranslationRequestExecution {
    readonly service: ResolvedTranslationService;
    readonly enableAIContext: boolean;
    readonly sourceLanguage: string;
    readonly targetLanguage: string;
    readonly requestTimeoutMs?: number;
}

const PAGE_SUMMARY_CACHE_SIZE = 8;
const PAGE_SUMMARY_LIMIT = 1200;

export function createTranslationBroker(deps: TranslationBrokerDependencies): TranslationBroker {
    const pendingTranslations = new Map<string, Promise<string>>();
    const pendingBatches = new Map<string, Promise<string[]>>();
    const pageSummaryCache = new Map<string, string>();
    const pendingPageSummaries = new Map<string, Promise<string>>();
    const pendingCacheWrites = new Map<Promise<unknown>, number>();
    let cacheGeneration = 0;
    const now = deps.now ?? (() => Date.now());

    function usesAIContext(execution: TranslationRequestExecution): boolean {
        return execution.enableAIContext
            && deps.isUseAIContext(execution.service.provider, execution.service.modelId);
    }

    /** Fields that change what a provider would return for the same text. */
    function serviceIdentity(service: ResolvedTranslationService) {
        return {
            service: service.id,
            provider: service.provider,
            model: service.modelId,
            endpoint: deps.describeEndpoint(service),
            robotId: service.robotId,
            customBody: service.customBody,
            systemRole: service.systemRole,
            userRole: service.userRole,
            deepseekApiType: service.deepseekApiType,
            deepseekThinkingMode: service.deepseekThinkingMode,
        };
    }

    function buildCacheKey(
        execution: TranslationRequestExecution,
        origin: string | string[],
        context: string,
        pageContext: string,
        mode: CacheRequestMode,
    ): string {
        return deps.buildTranslationCacheKey({
            requestMode: mode,
            sourceText: origin,
            sourceLanguage: execution.sourceLanguage,
            targetLanguage: execution.targetLanguage,
            ...serviceIdentity(execution.service),
            // DeepL 把标题上下文直接发送给 provider；AI adapter 通过 prompt 注入页面上下文。
            context: execution.service.provider === 'deepL' ? context : undefined,
            pageContext: usesAIContext(execution) ? pageContext : undefined,
        });
    }

    function isCacheableResult(origin: string, result: unknown): result is string {
        return typeof result === 'string' && result !== origin;
    }

    function requireSingleResult(result: unknown): string {
        if (typeof result !== 'string' || !result.trim()) throw new Error('单条翻译返回格式异常');
        return result;
    }

    function requireBatchResult(result: unknown, expectedLength: number): string[] {
        if (!Array.isArray(result) || result.length !== expectedLength ||
            result.some((value) => typeof value !== 'string' || !value.trim())) {
            throw new Error('批量翻译返回格式异常');
        }
        return result;
    }

    function getProvider(provider: string): TranslationProvider {
        const adapter = deps.providers[provider];
        if (!adapter) throw new Error(`未找到翻译服务适配器: ${provider}`);
        return adapter;
    }

    function callProvider(
        execution: TranslationRequestExecution,
        request: Omit<TranslationProviderRequest, 'service' | 'sourceLanguage' | 'targetLanguage'>,
    ): Promise<unknown> {
        return getProvider(execution.service.provider)({
            ...request,
            service: execution.service,
            sourceLanguage: execution.sourceLanguage,
            targetLanguage: execution.targetLanguage,
        });
    }

    function normalizeRequestTimeoutMs(requestTimeoutMs?: number): number | undefined {
        if (requestTimeoutMs === undefined) return undefined;
        return Math.max(1_000, Math.floor(requestTimeoutMs));
    }

    function buildPendingRequestKey(cacheKey: string, requestTimeoutMs?: number): string {
        const normalizedTimeoutMs = normalizeRequestTimeoutMs(requestTimeoutMs);
        const timeoutIdentity = normalizedTimeoutMs === undefined ? 'default' : `${normalizedTimeoutMs}ms`;
        return `${cacheKey}:timeout:${timeoutIdentity}`;
    }

    function buildPageSummaryCacheKey(execution: TranslationRequestExecution, pageContext: string): string {
        return deps.buildTranslationCacheKey({
            requestMode: 'page-summary',
            sourceText: pageContext,
            ...serviceIdentity(execution.service),
        });
    }

    function cachePageSummary(key: string, value: string): void {
        if (pageSummaryCache.size >= PAGE_SUMMARY_CACHE_SIZE) {
            const oldestKey = pageSummaryCache.keys().next().value;
            if (oldestKey) pageSummaryCache.delete(oldestKey);
        }
        pageSummaryCache.set(key, value);
    }

    async function writeCacheIfCurrent(generation: number, key: string, value: string): Promise<void> {
        if (generation !== cacheGeneration) return;

        const write = Promise.resolve(deps.cache.set(key, value));
        pendingCacheWrites.set(write, generation);
        try {
            await write;
        } finally {
            pendingCacheWrites.delete(write);
        }
    }

    async function addPageSummary(
        execution: TranslationRequestExecution,
        pageContext: string,
        useCache: boolean,
        requestGeneration: number,
        requestTimeoutMs?: number,
    ): Promise<string> {
        if (!usesAIContext(execution) || !pageContext.trim()) return '';

        const key = buildPageSummaryCacheKey(execution, pageContext);
        if (useCache) {
            const cached = pageSummaryCache.get(key);
            if (cached) return cached;
        }

        const pendingKey = `${buildPendingRequestKey(key, requestTimeoutMs)}:cache:${useCache ? 'on' : 'off'}`;
        const existing = pendingPageSummaries.get(pendingKey);
        if (existing) return existing;

        const request = (async () => {
            try {
                // 先读持久缓存，覆盖 MV3 service worker 重启后的重复摘要。
                if (useCache) {
                    const persisted = await deps.cache.get(key);
                    if (persisted !== null) {
                        if (requestGeneration === cacheGeneration) cachePageSummary(key, persisted);
                        return persisted;
                    }
                }

                // 缓存未命中时生成短摘要，失败时回退到原始上下文。
                const result = await callProvider(execution, {
                    origin: '',
                    context: '',
                    pageContext: '',
                    summaryPrompt: deps.promptBuilder.buildPageSummaryPrompt(pageContext),
                    summarySystemPrompt: deps.promptBuilder.buildPageSummarySystemPrompt(),
                    requestTimeoutMs,
                });
                const summary = typeof result === 'string' ? result.trim().slice(0, PAGE_SUMMARY_LIMIT) : '';
                if (!summary) {
                    if (useCache && requestGeneration === cacheGeneration) cachePageSummary(key, pageContext);
                    return pageContext;
                }

                const summarizedContext = `Page summary (AI-generated reference):\n${summary}\n\n${pageContext}`.slice(0, 4000);
                if (useCache && requestGeneration === cacheGeneration) cachePageSummary(key, summarizedContext);
                if (useCache) await writeCacheIfCurrent(requestGeneration, key, summarizedContext);
                return summarizedContext;
            } catch (error) {
                console.warn('[BabelBox] page context summary failed; using extracted context:', error);
                if (useCache && requestGeneration === cacheGeneration) cachePageSummary(key, pageContext);
                return pageContext;
            }
        })();

        pendingPageSummaries.set(pendingKey, request);
        // addPageSummary 把摘要与缓存失败降级为原始上下文，因此该 Promise 只会 fulfilled。
        void request.then(() => {
            if (pendingPageSummaries.get(pendingKey) === request) pendingPageSummaries.delete(pendingKey);
        });
        return request;
    }

    async function addPageSummaryWithinBudget(
        execution: TranslationRequestExecution,
        pageContext: string,
        useCache: boolean,
        requestGeneration: number,
        requestTimeoutMs?: number,
    ): Promise<string> {
        const request = addPageSummary(execution, pageContext, useCache, requestGeneration, requestTimeoutMs);
        if (requestTimeoutMs === undefined) return request;

        // 摘要是可选增强，不允许占满整次 provider 请求预算。
        return new Promise((resolve) => {
            let settled = false;
            const finish = (value: string) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(value);
            };
            const timer = setTimeout(() => finish(pageContext), requestTimeoutMs);
            void request.then(finish, () => finish(pageContext));
        });
    }

    function trackPending<T>(pending: Map<string, Promise<T>>, key: string, request: Promise<T>): Promise<T> {
        pending.set(key, request);
        const release = () => {
            if (pending.get(key) === request) pending.delete(key);
        };
        void request.then(release, release);
        return request;
    }

    async function translateSingleWithCache(
        execution: TranslationRequestExecution,
        origin: string,
        context: string,
        pageContext: string,
        useCache: boolean,
        requestGeneration: number,
    ): Promise<string> {
        const translate = async () => requireSingleResult(await callProvider(execution, {
            origin,
            context,
            pageContext,
            requestTimeoutMs: execution.requestTimeoutMs,
        }));
        if (!useCache) return translate();

        const key = buildCacheKey(execution, origin, context, pageContext, 'single');
        const pendingKey = buildPendingRequestKey(key, execution.requestTimeoutMs);
        const existing = pendingTranslations.get(pendingKey);
        if (existing) return existing;

        return trackPending(pendingTranslations, pendingKey, (async () => {
            // 先读持久缓存；未命中后只发起一次 provider 请求。
            const cached = await deps.cache.get(key);
            if (cached !== null) return cached;

            const result = await translate();
            if (isCacheableResult(origin, result)) await writeCacheIfCurrent(requestGeneration, key, result);
            return result;
        })());
    }

    async function translateBatchWithCache(
        execution: TranslationRequestExecution,
        origins: string[],
        context: string,
        pageContext: string,
        useCache: boolean,
        requestGeneration: number,
    ): Promise<string[]> {
        const translate = async (batch: string[]) => requireBatchResult(await callProvider(execution, {
            origin: batch,
            context,
            pageContext,
            requestTimeoutMs: execution.requestTimeoutMs,
        }), batch.length);
        if (!useCache) return translate(origins);

        const itemKey = (origin: string) => buildCacheKey(execution, origin, context, pageContext, 'batch');
        const batchKey = buildCacheKey(execution, origins, context, pageContext, 'batch');
        const pendingKey = buildPendingRequestKey(batchKey, execution.requestTimeoutMs);
        const existing = pendingBatches.get(pendingKey);
        if (existing) return existing;

        return trackPending(pendingBatches, pendingKey, (async () => {
            // 分项读取缓存，只把缺失且去重后的原文交给 provider。
            const keys = origins.map(itemKey);
            const result = await Promise.all(keys.map((key) => deps.cache.get(key)));
            const missing = new Map<string, string>();
            result.forEach((value, index) => {
                if (value === null) missing.set(keys[index], origins[index]);
            });
            if (missing.size === 0) return result as string[];

            const missingOrigins = [...missing.values()];
            const translated = await translate(missingOrigins);
            const translatedByKey = new Map([...missing.keys()].map((key, index) => [key, translated[index]]));

            // 按原请求顺序回填结果，并只缓存有效译文。
            await Promise.all([...translatedByKey].map(([key, value], index) =>
                isCacheableResult(missingOrigins[index], value)
                    ? writeCacheIfCurrent(requestGeneration, key, value)
                    : undefined));
            return keys.map((key, index) => result[index] ?? translatedByKey.get(key) as string);
        })());
    }

    async function translateWithCache(message: TranslationRequestMessage): Promise<string | string[]> {
        await deps.ready;
        // 空请求没有 provider 语义，直接返回可避免无效计费和适配器格式错误。
        if (Array.isArray(message.origin) && message.origin.length === 0) return [];
        if (typeof message.origin === 'string' && !message.origin.trim()) return message.origin;
        const requestGeneration = cacheGeneration;

        // 在任何 cache/provider await 前解析一次服务；后续 UI 原地修改不能改变本请求身份。
        const config = deps.getConfig();
        const serviceId = message.serviceOverride || config.service;
        const service = resolveTranslationService(config, serviceId);
        const missingCredentialMessage = deps.getMissingCredentialMessage(serviceId, config);
        if (missingCredentialMessage) throw new Error(missingCredentialMessage);

        const {sourceLanguage, targetLanguage} = deps.getTranslationLanguages({
            sourceLanguage: message.sourceLanguage?.trim() || config.from,
            targetLanguage: message.targetLanguage?.trim() || config.to,
        });
        const context = typeof message.context === 'string' ? message.context : '';
        const rawPageContext = typeof message.pageContext === 'string' ? message.pageContext : '';
        const useCache = config.useCache && message.useCache !== false;
        const providerBudget = normalizeRequestTimeoutMs(message.requestTimeoutMs);
        const baseExecution: TranslationRequestExecution = {
            service,
            enableAIContext: config.enableAIContext,
            sourceLanguage,
            targetLanguage,
        };

        // 摘要是 AI 上下文增强，只拿 provider deadline 的一小段预算。
        const providerStartedAt = now();
        const summaryBudget = providerBudget === undefined
            ? undefined
            : Math.min(10_000, Math.max(1_000, Math.floor(providerBudget / 4)));
        const pageContext = await addPageSummaryWithinBudget(
            baseExecution,
            rawPageContext,
            useCache,
            requestGeneration,
            summaryBudget,
        );
        const elapsed = now() - providerStartedAt;
        if (providerBudget !== undefined && elapsed >= providerBudget) throw new Error('翻译请求超时');

        // 把摘要耗时从剩余 provider 请求中扣除，避免后台无限等待。
        const execution: TranslationRequestExecution = {
            ...baseExecution,
            requestTimeoutMs: providerBudget === undefined ? undefined : Math.max(1_000, providerBudget - elapsed),
        };
        return Array.isArray(message.origin)
            ? translateBatchWithCache(execution, message.origin, context, pageContext, useCache, requestGeneration)
            : translateSingleWithCache(execution, message.origin, context, pageContext, useCache, requestGeneration);
    }

    async function clearTranslationCache(): Promise<void> {
        // 先切换代次并断开旧请求去重；旧 provider 仍可返回给原调用者，但不能重新填充缓存。
        cacheGeneration += 1;
        pendingTranslations.clear();
        pendingBatches.clear();
        pendingPageSummaries.clear();
        pageSummaryCache.clear();

        // 等待清理开始前已经进入存储适配器的写入，随后再清库，保证成功返回后没有旧写入复活。
        const staleWrites = [...pendingCacheWrites]
            .filter(([, generation]) => generation < cacheGeneration)
            .map(([write]) => write);
        await Promise.allSettled(staleWrites);
        await deps.cache.clear();
        pageSummaryCache.clear();
    }

    async function cleanupTranslationCache(): Promise<void> {
        await deps.cache.cleanup();
    }

    return {
        translateWithCache,
        clearTranslationCache,
        cleanupTranslationCache,
    };
}
