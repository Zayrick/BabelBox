import type {
    TranslationBatchRequestMessage,
    TranslationBroker,
    TranslationBrokerDependencies,
    TranslationProviderConfigSnapshot,
    TranslationProvider,
    TranslationRequestMessage,
    TranslationSingleRequestMessage,
} from './types';
import {
    attachTranslationProviderConfig,
    createTranslationProviderConfigSnapshot,
    resolveTranslationServiceConfig,
} from './requestSnapshot';

export type {
    TranslationBatchRequestMessage,
    TranslationBroker,
    TranslationBrokerDependencies,
    TranslationConfigSnapshot,
    TranslationProviderConfigSnapshot,
    TranslationLanguageOverride,
    TranslationProvider,
    TranslationProviderRegistry,
    TranslationRequestMessage,
    TranslationRequestMessageBase,
    TranslationSingleRequestMessage,
} from './types';

type CacheRequestMode = 'single' | 'batch';

interface TranslationRequestExecution {
    readonly config: TranslationProviderConfigSnapshot;
    readonly instanceId: string;
    readonly service: string;
    readonly sourceLanguage: string;
    readonly targetLanguage: string;
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

    function config() {
        return deps.getConfig();
    }

    function getSelectedModel(
        current: TranslationProviderConfigSnapshot,
        service: string,
        modelOverride?: string,
    ): string {
        return deps.resolveConfiguredModel(
            modelOverride || current.model[service],
            modelOverride || current.customModel[service],
        );
    }

    function isAIContextEnabled(
        current: TranslationProviderConfigSnapshot,
        service: string,
        modelOverride?: string,
    ): boolean {
        return current.enableAIContext
            && deps.serviceTypes.isUseAIContext(service, getSelectedModel(current, service, modelOverride));
    }

    function getProviderEndpoint(current: TranslationProviderConfigSnapshot, service: string): string {
        if (deps.serviceTypes.isAiSdk(service)) {
            return deps.endpointResolver.resolveOpenAICompatibleEndpoint(service, current).endpoint;
        }
        if (current.proxy[service]) return current.proxy[service];
        if (service === 'custom') return current.custom;
        if (service === 'deeplx') return current.deeplx;
        if (service === 'newapi') return current.newApiUrl;
        if (service === deps.serviceIds.minimax) {
            const plan = current.minimaxBillingPlan === 'token-plan' ? 'token-plan' : 'payg';
            const region = current.minimaxRegion === 'cn' ? 'cn' : 'global';
            return deps.endpointResolver.minimaxEndpoints[plan][region];
        }
        if (service === deps.serviceIds.mimo) {
            return deps.endpointResolver.getMimoEndpoint(current.mimoBillingPlan, current.mimoRegion);
        }
        return '';
    }

    function buildCacheKey(
        execution: TranslationRequestExecution,
        origin: string | string[],
        context: string,
        pageContext: string,
        mode: CacheRequestMode,
        modelOverride?: string,
    ): string {
        const {config: current, service, sourceLanguage, targetLanguage} = execution;

        return deps.buildTranslationCacheKey({
            requestMode: mode,
            sourceText: origin,
            sourceLanguage,
            targetLanguage,
            service: execution.instanceId,
            provider: service,
            model: getSelectedModel(current, service, modelOverride),
            endpoint: getProviderEndpoint(current, service),
            azureOpenaiEndpoint: service === 'azureOpenai' ? current.azureOpenaiEndpoint : undefined,
            robotId: service === 'cozecom' || service === 'cozecn'
                ? current.robot_id[service] || ''
                : undefined,
            customBody: current.customBody[service] || '',
            systemRole: current.system_role[service] || '',
            userRole: current.user_role[service] || '',
            deepseekApiType: current.deepseekApiType,
            deepseekThinkingMode: current.deepseekThinkingMode,
            transportProfile: deps.serviceTypes.isAiSdk(service)
                ? deps.endpointResolver.aiSdkTransportProfile
                : undefined,
            // DeepL 把标题上下文直接发送给 provider；AI adapter 通过 prompt 注入页面上下文。
            context: service === 'deepL' ? context : undefined,
            pageContext: isAIContextEnabled(current, service, modelOverride) ? pageContext : undefined,
        });
    }

    function isCacheEnabled(current: TranslationProviderConfigSnapshot, message: TranslationRequestMessage): boolean {
        return current.useCache && message.useCache !== false;
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

    function getTranslationService(serviceName: string): TranslationProvider {
        const service = deps.providers[serviceName];
        if (!service) throw new Error(`未找到翻译服务适配器: ${serviceName}`);
        return service;
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

    function buildPageSummaryCacheKey(
        execution: TranslationRequestExecution,
        pageContext: string,
        modelOverride?: string,
    ): string {
        const {config: current, service} = execution;
        return deps.buildTranslationCacheKey({
            requestMode: 'page-summary',
            sourceLanguage: current.from,
            targetLanguage: '',
            sourceText: pageContext,
            service: execution.instanceId,
            provider: service,
            model: getSelectedModel(current, service, modelOverride),
            endpoint: getProviderEndpoint(current, service),
            customBody: current.customBody[service] || '',
            transportProfile: deps.serviceTypes.isAiSdk(service)
                ? deps.endpointResolver.aiSdkTransportProfile
                : undefined,
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
        modelOverride?: string,
        requestTimeoutMs?: number,
    ): Promise<string> {
        if (!isAIContextEnabled(execution.config, execution.service, modelOverride) || !pageContext.trim()) return '';

        const key = buildPageSummaryCacheKey(execution, pageContext, modelOverride);
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
                const result = await getTranslationService(execution.service)(attachTranslationProviderConfig({
                    origin: '',
                    context: '',
                    pageContext: '',
                    summaryPrompt: deps.promptBuilder.buildPageSummaryPrompt(pageContext),
                    summarySystemPrompt: deps.promptBuilder.buildPageSummarySystemPrompt(),
                    serviceOverride: execution.service,
                    sourceLanguage: execution.sourceLanguage,
                    targetLanguage: execution.targetLanguage,
                    modelOverride,
                    requestTimeoutMs,
                }, execution.config));
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
        modelOverride?: string,
        requestTimeoutMs?: number,
    ): Promise<string> {
        const request = addPageSummary(
            execution,
            pageContext,
            useCache,
            requestGeneration,
            modelOverride,
            requestTimeoutMs,
        );
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

    async function translateSingleWithCache(
        execution: TranslationRequestExecution,
        message: TranslationSingleRequestMessage,
        context: string,
        pageContext: string,
        useCache: boolean,
        requestGeneration: number,
    ): Promise<string> {
        if (!useCache) {
            const result = await getTranslationService(execution.service)({...message, context, pageContext});
            return requireSingleResult(result);
        }

        const key = buildCacheKey(execution, message.origin, context, pageContext, 'single', message.modelOverride);
        const pendingKey = buildPendingRequestKey(key, message.requestTimeoutMs);
        const existing = pendingTranslations.get(pendingKey);
        if (existing) return existing;

        const request = (async () => {
            // 先读持久缓存；未命中后只发起一次 provider 请求。
            const cached = await deps.cache.get(key);
            if (cached !== null) return cached;

            const result = requireSingleResult(
                await getTranslationService(execution.service)({...message, context, pageContext}),
            );
            if (isCacheableResult(message.origin, result)) {
                await writeCacheIfCurrent(requestGeneration, key, result);
            }
            return result;
        })();

        pendingTranslations.set(pendingKey, request);
        void request.then(
            () => {
                if (pendingTranslations.get(pendingKey) === request) pendingTranslations.delete(pendingKey);
            },
            () => {
                if (pendingTranslations.get(pendingKey) === request) pendingTranslations.delete(pendingKey);
            },
        );
        return request;
    }

    async function translateBatchWithCache(
        execution: TranslationRequestExecution,
        message: TranslationBatchRequestMessage,
        context: string,
        pageContext: string,
        useCache: boolean,
        requestGeneration: number,
    ): Promise<string[]> {
        if (!useCache) {
            const result = await getTranslationService(execution.service)({...message, context, pageContext});
            return requireBatchResult(result, message.origin.length);
        }

        const batchKey = buildCacheKey(execution, message.origin, context, pageContext, 'batch', message.modelOverride);
        const pendingKey = buildPendingRequestKey(batchKey, message.requestTimeoutMs);
        const existing = pendingBatches.get(pendingKey);
        if (existing) return existing;

        const request = (async () => {
            // 分项读取缓存，只把缺失且去重后的原文交给 provider。
            const cached = await Promise.all(
                message.origin.map((origin) => deps.cache.get(
                    buildCacheKey(execution, origin, context, pageContext, 'batch', message.modelOverride),
                )),
            );
            const missingIndexes = cached
                .map((value, index) => value === null ? index : -1)
                .filter((index) => index >= 0);

            if (missingIndexes.length === 0) return cached as string[];

            const missingEntries = missingIndexes.map((index) => ({index, origin: message.origin[index]}));
            const uniqueMissingOrigins = Array.from(
                new Map(
                    missingEntries.map(({origin}) => [
                        buildCacheKey(execution, origin, context, pageContext, 'batch', message.modelOverride),
                        origin,
                    ]),
                ).values(),
            );
            const translated = requireBatchResult(
                await getTranslationService(execution.service)({
                    ...message,
                    context,
                    pageContext,
                    origin: uniqueMissingOrigins,
                }),
                uniqueMissingOrigins.length,
            );

            // 按原请求顺序回填结果，并只缓存有效译文。
            const result = [...cached] as Array<string | null>;
            const translatedByKey = new Map(
                uniqueMissingOrigins.map((origin, index) => [
                    buildCacheKey(execution, origin, context, pageContext, 'batch', message.modelOverride),
                    translated[index],
                ]),
            );
            await Promise.all(missingEntries.map(async ({index, origin}) => {
                const value = translatedByKey.get(buildCacheKey(execution, origin, context, pageContext, 'batch', message.modelOverride));
                result[index] = value as string;
                if (isCacheableResult(origin, value)) {
                    await writeCacheIfCurrent(
                        requestGeneration,
                        buildCacheKey(execution, origin, context, pageContext, 'batch', message.modelOverride),
                        value,
                    );
                }
            }));

            return result as string[];
        })();

        pendingBatches.set(pendingKey, request);
        void request.then(
            () => {
                if (pendingBatches.get(pendingKey) === request) pendingBatches.delete(pendingKey);
            },
            () => {
                if (pendingBatches.get(pendingKey) === request) pendingBatches.delete(pendingKey);
            },
        );
        return request;
    }

    async function translateWithCache(message: TranslationRequestMessage): Promise<string | string[]> {
        await deps.ready;
        // 空请求没有 provider 语义，直接返回可避免无效计费和适配器格式错误。
        if (Array.isArray(message.origin) && message.origin.length === 0) return [];
        if (typeof message.origin === 'string' && !message.origin.trim()) return message.origin;
        const requestGeneration = cacheGeneration;

        // 在任何 cache/provider await 前复制一次配置；后续 UI 原地修改不能改变本请求身份。
        const sourceConfig = createTranslationProviderConfigSnapshot(config());
        const serviceOverride = message.serviceOverride;
        const selectedService = serviceOverride || sourceConfig.service;
        const resolvedService = resolveTranslationServiceConfig(sourceConfig, selectedService);
        const current = resolvedService.config;
        const selectedProvider = resolvedService.provider;
        // 已安装实例的模型以本次配置快照为准；请求级覆盖只用于独立入口。
        const effectiveModelOverride = resolvedService.instance
            ? resolvedService.instance.modelId || undefined
            : message.modelOverride;
        const {sourceLanguage, targetLanguage} = deps.getTranslationLanguages({
            sourceLanguage: message.sourceLanguage?.trim() || current.from,
            targetLanguage: message.targetLanguage?.trim() || current.to,
        });
        const execution: TranslationRequestExecution = {
            config: current,
            instanceId: selectedService,
            service: selectedProvider,
            sourceLanguage,
            targetLanguage,
        };
        const credentialConfig = effectiveModelOverride
            ? {
                ...current,
                model: {...current.model, [selectedProvider]: effectiveModelOverride},
                customModel: {...current.customModel, [selectedProvider]: effectiveModelOverride},
            }
            : current;
        const missingCredentialMessage = deps.getMissingCredentialMessage(selectedService, credentialConfig);
        if (missingCredentialMessage) throw new Error(missingCredentialMessage);
        if (!deps.serviceTypes.machine.has(selectedProvider) && !deps.serviceTypes.isAI(selectedProvider)) {
            throw new Error('独立翻译服务不可用，请选择已配置的机器翻译或 AI 服务');
        }

        const context = typeof message.context === 'string' ? message.context : '';
        const rawPageContext = typeof message.pageContext === 'string' ? message.pageContext : '';
        const useCache = isCacheEnabled(current, message);
        const providerStartedAt = now();
        const providerBudget = normalizeRequestTimeoutMs(message.requestTimeoutMs);
        // 摘要是 AI 上下文增强，只拿 provider deadline 的一小段预算。
        const summaryBudget = providerBudget === undefined
            ? undefined
            : Math.min(10_000, Math.max(1_000, Math.floor(providerBudget / 4)));
        const pageContext = await addPageSummaryWithinBudget(
            execution,
            rawPageContext,
            useCache,
            requestGeneration,
            effectiveModelOverride,
            summaryBudget,
        );
        const elapsed = now() - providerStartedAt;
        if (providerBudget !== undefined && elapsed >= providerBudget) throw new Error('翻译请求超时');

        // 把摘要耗时从剩余 provider 请求中扣除，避免后台无限等待。
        const normalizedMessage = {
            ...message,
            serviceOverride: selectedProvider,
            modelOverride: effectiveModelOverride,
            sourceLanguage,
            targetLanguage,
        } as TranslationRequestMessage;
        const requestMessage = attachTranslationProviderConfig(
            providerBudget === undefined
                ? normalizedMessage
                : {
                ...normalizedMessage,
                serviceOverride: selectedProvider,
                modelOverride: effectiveModelOverride,
                sourceLanguage,
                targetLanguage,
                requestTimeoutMs: Math.max(1_000, providerBudget - elapsed),
            } as TranslationRequestMessage,
            current,
        );
        // 根据 origin 类型进入单条或批量管线，两者共享缓存身份与 pending 去重。
        if (Array.isArray(requestMessage.origin)) {
            return translateBatchWithCache(
                execution,
                requestMessage as TranslationBatchRequestMessage,
                context,
                pageContext,
                useCache,
                requestGeneration,
            );
        }
        return translateSingleWithCache(
            execution,
            requestMessage as TranslationSingleRequestMessage,
            context,
            pageContext,
            useCache,
            requestGeneration,
        );
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
