import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
    createTranslationBroker,
    type ResolvedTranslationService,
    type TranslationBroker,
    type TranslationProviderRequest,
} from '@/src/services/translation/broker';
import type {TranslationServiceInstance} from '@/src/core/config/translationServices';

type CacheIdentity = {
    [key: string]: unknown;
    requestMode: string;
    sourceText: string | string[];
    sourceLanguage?: string;
    targetLanguage?: string;
    service?: string;
    provider?: string;
    model?: string;
    endpoint?: string;
    context?: string;
    pageContext?: string;
};

type ProviderCall = TranslationProviderRequest & {origin: string | string[]};

function instance(id: string, overrides: Partial<TranslationServiceInstance> = {}): TranslationServiceInstance {
    return {
        id,
        provider: id,
        name: id,
        enabled: true,
        kind: 'ai',
        modelId: '',
        endpoint: '',
        customBody: '',
        systemRole: '',
        userRole: '',
        robotId: '',
        deepseekApiType: 'auto',
        deepseekThinkingMode: 'disabled',
        minimaxBillingPlan: 'payg',
        minimaxRegion: 'cn',
        mimoBillingPlan: 'payg',
        mimoRegion: 'cn',
        ...overrides,
    };
}

const mocks = vi.hoisted(() => {
    const cacheStore = new Map<string, string>();
    const service = vi.fn();
    const providers = {
        ai: service,
        aiSdk: service,
        cozecom: service,
        deepL: service,
        mock: service,
    };
    const buildTranslationCacheKey = vi.fn((identity: unknown) => JSON.stringify(identity));
    const config = {
        service: 'mock',
        from: 'auto',
        to: 'zh-Hans',
        useCache: true,
        enableAIContext: false,
        translationServices: [] as TranslationServiceInstance[],
        serviceCredentials: {} as Record<string, {apiKey: string; appKey: string; appSecret: string; secretId: string; secretKey: string}>,
    };

    return {
        buildTranslationCacheKey,
        cacheStore,
        config,
        providers,
        describeEndpoint: vi.fn((resolved: ResolvedTranslationService) =>
            resolved.endpoint || `https://${resolved.provider}.endpoint.test`),
        getMissingCredentialMessage: vi.fn(() => null as string | null),
        service,
        cacheGet: vi.fn(async (key: string) => cacheStore.get(key) ?? null),
        cacheSet: vi.fn(async (key: string, value: string) => {
            cacheStore.set(key, value);
            return true;
        }),
        cacheClear: vi.fn(async () => {
            cacheStore.clear();
        }),
        cacheCleanup: vi.fn(async () => undefined),
    };
});

/** The mutable configured instance; edits model what the settings page does. */
function configured(id: string): TranslationServiceInstance {
    const found = mocks.config.translationServices.find((item) => item.id === id);
    if (!found) throw new Error(`missing test service ${id}`);
    return found;
}

let translateWithCache: TranslationBroker['translateWithCache'];
let clearTranslationCache: TranslationBroker['clearTranslationCache'];
let cleanupTranslationCache: TranslationBroker['cleanupTranslationCache'];

function installBroker(now?: () => number): void {
    const broker = createTranslationBroker({
        ready: Promise.resolve(),
        getConfig: () => mocks.config,
        providers: mocks.providers,
        cache: {
            get: mocks.cacheGet,
            set: mocks.cacheSet,
            clear: mocks.cacheClear,
            cleanup: mocks.cacheCleanup,
        },
        describeEndpoint: mocks.describeEndpoint,
        isUseAIContext: (provider: string) => provider === 'ai' || provider === 'aiSdk',
        promptBuilder: {
            buildPageSummaryPrompt: (pageContext: string) => `summarize:${pageContext}`,
            buildPageSummarySystemPrompt: () => 'summary-system',
        },
        getMissingCredentialMessage: mocks.getMissingCredentialMessage,
        getTranslationLanguages: (override?: {sourceLanguage?: string; targetLanguage?: string}) => ({
            sourceLanguage: override?.sourceLanguage || mocks.config.from,
            targetLanguage: override?.targetLanguage || mocks.config.to,
        }),
        buildTranslationCacheKey: mocks.buildTranslationCacheKey,
        now,
    });
    translateWithCache = broker.translateWithCache;
    clearTranslationCache = broker.clearTranslationCache;
    cleanupTranslationCache = broker.cleanupTranslationCache;
}

function cacheIdentityAt(index: number): CacheIdentity {
    return mocks.buildTranslationCacheKey.mock.calls[index][0] as CacheIdentity;
}

function translationCacheIdentities(): CacheIdentity[] {
    return mocks.buildTranslationCacheKey.mock.calls
        .map(([identity]) => identity as CacheIdentity)
        .filter(identity => identity.requestMode !== 'page-summary');
}

async function flushMicrotasks(times = 6): Promise<void> {
    for (let index = 0; index < times; index += 1) {
        await Promise.resolve();
    }
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return {promise, reject, resolve};
}

describe('translation broker', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        mocks.cacheStore.clear();
        Object.assign(mocks.config, {
            service: 'mock',
            from: 'auto',
            to: 'zh-Hans',
            useCache: true,
            enableAIContext: false,
            translationServices: [
                instance('mock', {kind: 'machine', modelId: 'mock-model'}),
                instance('ai', {modelId: 'ai-model'}),
                instance('aiSdk', {modelId: 'ai-sdk-model'}),
                instance('cozecom'),
                instance('deepL', {kind: 'machine'}),
            ],
            serviceCredentials: {},
        });
        mocks.service.mockReset();
        mocks.service.mockResolvedValue('默认译文');
        mocks.getMissingCredentialMessage.mockReturnValue(null);
        installBroker();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('reuses persisted single cache entries and skips storing unchanged results', async () => {
        mocks.service.mockResolvedValueOnce('共享译文');
        await expect(translateWithCache({origin: 'Readable source'})).resolves.toBe('共享译文');
        await expect(translateWithCache({origin: 'Readable source'})).resolves.toBe('共享译文');

        expect(mocks.service).toHaveBeenCalledTimes(1);
        expect(mocks.cacheSet).toHaveBeenCalledTimes(1);
        expect(mocks.cacheGet).toHaveBeenCalledTimes(2);

        await clearTranslationCache();
        vi.clearAllMocks();
        mocks.service.mockResolvedValueOnce('Same');
        await expect(translateWithCache({origin: 'Same'})).resolves.toBe('Same');

        expect(mocks.cacheSet).not.toHaveBeenCalled();
    });

    it('bypasses cache when disabled globally or by request', async () => {
        mocks.service.mockResolvedValue('直连译文');

        mocks.config.useCache = false;
        await expect(translateWithCache({origin: 'A'})).resolves.toBe('直连译文');

        mocks.config.useCache = true;
        await expect(translateWithCache({origin: 'B', useCache: false})).resolves.toBe('直连译文');

        expect(mocks.cacheGet).not.toHaveBeenCalled();
        expect(mocks.cacheSet).not.toHaveBeenCalled();
        expect(mocks.service).toHaveBeenCalledTimes(2);
    });

    it('空单条和空批量请求直接返回，不读取凭据、缓存或 provider', async () => {
        mocks.getMissingCredentialMessage.mockReturnValue('missing credential');

        await expect(translateWithCache({origin: '  \n'})).resolves.toBe('  \n');
        await expect(translateWithCache({origin: []})).resolves.toEqual([]);
        expect(mocks.getMissingCredentialMessage).not.toHaveBeenCalled();
        expect(mocks.cacheGet).not.toHaveBeenCalled();
        expect(mocks.service).not.toHaveBeenCalled();
    });

    it('拒绝 provider 的空单条结果，且不污染缓存', async () => {
        mocks.service.mockResolvedValueOnce('');
        await expect(translateWithCache({origin: 'Cached invalid'})).rejects.toThrow('单条翻译返回格式异常');
        expect(mocks.cacheSet).not.toHaveBeenCalled();
    });

    it('deduplicates concurrent single requests and clears pending state after success and rejection', async () => {
        let resolveFirst!: (value: string) => void;
        mocks.service.mockImplementationOnce(() => new Promise<string>(resolve => {
            resolveFirst = resolve;
        }));

        const first = translateWithCache({origin: 'Pending'});
        const second = translateWithCache({origin: 'Pending'});
        await flushMicrotasks();
        resolveFirst('Pending 译文');

        await expect(first).resolves.toBe('Pending 译文');
        await expect(second).resolves.toBe('Pending 译文');
        expect(mocks.service).toHaveBeenCalledTimes(1);

        await clearTranslationCache();
        mocks.service
            .mockRejectedValueOnce(new Error('provider down'))
            .mockResolvedValueOnce('恢复译文');

        await expect(translateWithCache({origin: 'Reject once'})).rejects.toThrow('provider down');
        await expect(translateWithCache({origin: 'Reject once'})).resolves.toBe('恢复译文');
        expect(mocks.service).toHaveBeenCalledTimes(3);
    });

    it('只合并超时预算完全相同的并发请求，不混用不同 deadline', async () => {
        // provider 会扣除摘要阶段已经消耗的毫秒；冻结时钟后只验证 timeout identity 本身。
        vi.spyOn(Date, 'now').mockReturnValue(0);
        const firstWave = [deferred<string>(), deferred<string>()];
        mocks.service
            .mockImplementationOnce(() => firstWave[0].promise)
            .mockImplementationOnce(() => firstWave[1].promise);

        // 先短后长；过去按秒取整会错误共享同一个 pending Promise。
        const shortFirst = translateWithCache({origin: 'Timeout identity A', requestTimeoutMs: 1_001});
        const longSecond = translateWithCache({origin: 'Timeout identity A', requestTimeoutMs: 1_999});
        await flushMicrotasks();
        expect(mocks.service).toHaveBeenCalledTimes(2);
        expect(mocks.service.mock.calls.map(([message]) => message.requestTimeoutMs)).toEqual([1_001, 1_999]);
        firstWave[0].resolve('短预算译文');
        firstWave[1].resolve('长预算译文');
        await expect(Promise.all([shortFirst, longSecond])).resolves.toEqual(['短预算译文', '长预算译文']);

        await clearTranslationCache();
        mocks.service.mockClear();
        const secondWave = [deferred<string>(), deferred<string>()];
        mocks.service
            .mockImplementationOnce(() => secondWave[0].promise)
            .mockImplementationOnce(() => secondWave[1].promise);

        // 再验证相反顺序，避免较短 deadline 被较长请求放宽。
        const longFirst = translateWithCache({origin: 'Timeout identity B', requestTimeoutMs: 1_999});
        const shortSecond = translateWithCache({origin: 'Timeout identity B', requestTimeoutMs: 1_001});
        await flushMicrotasks();
        expect(mocks.service).toHaveBeenCalledTimes(2);
        expect(mocks.service.mock.calls.map(([message]) => message.requestTimeoutMs)).toEqual([1_999, 1_001]);
        secondWave[0].resolve('长预算译文');
        secondWave[1].resolve('短预算译文');
        await expect(Promise.all([longFirst, shortSecond])).resolves.toEqual(['长预算译文', '短预算译文']);

        await clearTranslationCache();
        mocks.service.mockClear();
        const sameBudget = deferred<string>();
        mocks.service.mockImplementationOnce(() => sameBudget.promise);

        // 完全相同的归一化预算仍应共享 provider 工作。
        const sameFirst = translateWithCache({origin: 'Timeout identity C', requestTimeoutMs: 1_999.9});
        const sameSecond = translateWithCache({origin: 'Timeout identity C', requestTimeoutMs: 1_999.1});
        await flushMicrotasks();
        expect(mocks.service).toHaveBeenCalledOnce();
        sameBudget.resolve('共享预算译文');
        await expect(Promise.all([sameFirst, sameSecond])).resolves.toEqual(['共享预算译文', '共享预算译文']);
    });

    it('deduplicates missing batch entries, preserves order, and reuses full batch cache hits', async () => {
        mocks.service.mockImplementation(async (message: {origin: string[]}) => (
            message.origin.map(origin => `${origin}-译文`)
        ));

        await expect(translateWithCache({
            origin: ['same', 'same', 'other'],
            sourceLanguage: 'en',
            targetLanguage: 'zh-Hans',
        })).resolves.toEqual(['same-译文', 'same-译文', 'other-译文']);

        expect(mocks.service).toHaveBeenCalledWith(expect.objectContaining({
            origin: ['same', 'other'],
            sourceLanguage: 'en',
            targetLanguage: 'zh-Hans',
        }));

        mocks.service.mockClear();
        await expect(translateWithCache({
            origin: ['same', 'other'],
            sourceLanguage: 'en',
            targetLanguage: 'zh-Hans',
        })).resolves.toEqual(['same-译文', 'other-译文']);
        expect(mocks.service).not.toHaveBeenCalled();
    });

    it('rejects an unusable batch result and clears rejected pending work', async () => {
        mocks.service.mockResolvedValueOnce(['A-译文', '']);
        await expect(translateWithCache({origin: ['A', 'B']})).rejects.toThrow('批量翻译返回格式异常');

        mocks.service.mockResolvedValueOnce(['A-译文', 'B-译文']);
        await expect(translateWithCache({origin: ['A', 'B']})).resolves.toEqual(['A-译文', 'B-译文']);

        let resolveBatch!: (value: string[]) => void;
        mocks.service.mockImplementationOnce(() => new Promise<string[]>(resolve => {
            resolveBatch = resolve;
        }));
        const first = translateWithCache({origin: ['P', 'Q']});
        const second = translateWithCache({origin: ['P', 'Q']});
        await flushMicrotasks();
        resolveBatch(['P-译文', 'Q-译文']);
        await expect(first).resolves.toEqual(['P-译文', 'Q-译文']);
        await expect(second).resolves.toEqual(['P-译文', 'Q-译文']);
    });

    it('builds cache identities from the instance request fields', async () => {
        configured('mock').endpoint = 'https://proxy.example';
        await translateWithCache({origin: 'Proxy'});
        expect(translationCacheIdentities().at(-1)).toMatchObject({
            service: 'mock',
            provider: 'mock',
            model: 'mock-model',
            endpoint: 'https://proxy.example',
        });

        mocks.config.service = 'aiSdk';
        await translateWithCache({origin: 'AI SDK'});
        expect(mocks.describeEndpoint).toHaveBeenLastCalledWith(expect.objectContaining({id: 'aiSdk'}));
        expect(translationCacheIdentities().at(-1)).toMatchObject({endpoint: 'https://aiSdk.endpoint.test'});

        mocks.config.service = 'cozecom';
        configured('cozecom').robotId = 'robot-1';
        await translateWithCache({origin: 'Coze'});
        expect(translationCacheIdentities().at(-1)).toMatchObject({robotId: 'robot-1', service: 'cozecom'});
    });

    it('reports credential, deleted service, and missing adapter failures before provider calls', async () => {
        mocks.getMissingCredentialMessage.mockReturnValueOnce('缺少凭据');
        await expect(translateWithCache({origin: 'Credential'})).rejects.toThrow('缺少凭据');

        await expect(translateWithCache({
            origin: 'Deleted',
            serviceOverride: 'service:ai:deleted',
        })).rejects.toThrow('翻译服务不存在或已被删除');

        mocks.config.translationServices.push(instance('missing'));
        mocks.config.service = 'missing';
        await expect(translateWithCache({origin: 'Missing adapter'})).rejects.toThrow('未找到翻译服务适配器: missing');

        expect(mocks.service).not.toHaveBeenCalled();
    });

    it('keeps sibling instances of one provider isolated in requests and cache identity', async () => {
        const firstId = 'service:ai:first';
        const secondId = 'service:ai:second';
        Object.assign(mocks.config, {
            service: firstId,
            translationServices: [
                instance(firstId, {provider: 'ai', modelId: 'first-model', endpoint: 'https://first.example.test/v1'}),
                instance(secondId, {provider: 'ai', modelId: 'second-model', endpoint: 'https://second.example.test/v1'}),
            ],
            serviceCredentials: {
                [firstId]: {apiKey: 'first-secret', appKey: '', appSecret: '', secretId: '', secretKey: ''},
                [secondId]: {apiKey: 'second-secret', appKey: '', appSecret: '', secretId: '', secretKey: ''},
            },
        });
        mocks.service.mockImplementation(async ({service}: ProviderCall) =>
            `${service.modelId}|${service.endpoint}|${service.credential.apiKey}`);

        await expect(translateWithCache({origin: 'same', serviceOverride: firstId}))
            .resolves.toBe('first-model|https://first.example.test/v1|first-secret');
        await expect(translateWithCache({origin: 'same', serviceOverride: secondId}))
            .resolves.toBe('second-model|https://second.example.test/v1|second-secret');
        await expect(translateWithCache({origin: 'same', serviceOverride: firstId}))
            .resolves.toBe('first-model|https://first.example.test/v1|first-secret');

        expect(mocks.service).toHaveBeenCalledTimes(2);
        expect(translationCacheIdentities()).toEqual(expect.arrayContaining([
            expect.objectContaining({service: firstId, provider: 'ai', model: 'first-model'}),
            expect.objectContaining({service: secondId, provider: 'ai', model: 'second-model'}),
        ]));
    });

    it('rejects a disabled instance before credentials, cache, or provider work', async () => {
        configured('ai').enabled = false;
        mocks.config.service = 'ai';

        await expect(translateWithCache({origin: 'blocked'})).rejects.toThrow('已禁用');
        expect(mocks.getMissingCredentialMessage).not.toHaveBeenCalled();
        expect(mocks.cacheGet).not.toHaveBeenCalled();
        expect(mocks.service).not.toHaveBeenCalled();
    });

    it('adds DeepL context and AI page context only when the target service consumes them', async () => {
        mocks.config.service = 'deepL';
        await translateWithCache({origin: 'DeepL text', context: 'Title'});
        expect(translationCacheIdentities().at(-1)).toMatchObject({service: 'deepL', context: 'Title'});

        mocks.config.service = 'mock';
        await translateWithCache({origin: 'Plain text', context: 'Title', pageContext: 'Article'});
        expect(translationCacheIdentities().at(-1)).toMatchObject({
            context: undefined,
            pageContext: undefined,
        });
    });

    it('uses persisted and shared AI summaries and falls back when summary generation fails', async () => {
        mocks.config.service = 'ai';
        mocks.config.enableAIContext = true;

        const persistedSummaryKey = JSON.stringify({
            requestMode: 'page-summary',
            sourceText: 'Persisted context',
            service: 'ai',
            provider: 'ai',
            model: 'ai-model',
            endpoint: 'https://ai.endpoint.test',
            robotId: '',
            customBody: '',
            systemRole: '',
            userRole: '',
            deepseekApiType: 'auto',
            deepseekThinkingMode: 'disabled',
        });
        mocks.cacheStore.set(persistedSummaryKey, 'Persisted summary');
        await translateWithCache({origin: 'Persisted', pageContext: 'Persisted context'});
        expect(mocks.service).toHaveBeenCalledWith(expect.objectContaining({
            pageContext: 'Persisted summary',
        }));
        expect(mocks.service.mock.calls.some(([message]) => message.summaryPrompt === 'summarize:Persisted context')).toBe(false);

        mocks.service.mockReset();
        let resolveSummary!: (value: string) => void;
        mocks.service.mockImplementation((message: {summaryPrompt?: string; origin: string | string[]}) => {
            if (message.summaryPrompt) {
                return new Promise<string>(resolve => {
                    resolveSummary = resolve;
                });
            }
            return Promise.resolve(`${message.origin}-译文`);
        });
        const first = translateWithCache({origin: 'A', pageContext: 'Concurrent context'});
        const second = translateWithCache({origin: 'B', pageContext: 'Concurrent context'});
        await flushMicrotasks();
        resolveSummary('Concurrent summary');
        await expect(first).resolves.toBe('A-译文');
        await expect(second).resolves.toBe('B-译文');
        expect(mocks.service.mock.calls.filter(([message]) => message.summaryPrompt)).toHaveLength(1);
        await expect(translateWithCache({origin: 'C', pageContext: 'Concurrent context'})).resolves.toBe('C-译文');
        expect(mocks.service.mock.calls.filter(([message]) => message.summaryPrompt)).toHaveLength(1);

        mocks.service.mockReset();
        mocks.service.mockImplementation((message: {summaryPrompt?: string; origin: string}) => (
            Promise.resolve(message.summaryPrompt ? '' : `${message.origin}-译文`)
        ));
        await expect(translateWithCache({origin: 'Empty summary', pageContext: 'Empty context'})).resolves.toBe('Empty summary-译文');
        expect(mocks.service).toHaveBeenLastCalledWith(expect.objectContaining({pageContext: 'Empty context'}));

        mocks.service.mockReset();
        mocks.service.mockImplementation((message: {summaryPrompt?: string; origin: string}) => {
            if (message.summaryPrompt) return Promise.reject(new Error('summary failed'));
            return Promise.resolve(`${message.origin}-译文`);
        });
        const summaryWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await expect(translateWithCache({origin: 'Failed summary', pageContext: 'Failed context'})).resolves.toBe('Failed summary-译文');
        expect(mocks.service).toHaveBeenLastCalledWith(expect.objectContaining({pageContext: 'Failed context'}));
        expect(summaryWarn).toHaveBeenCalledWith(
            '[BabelBox] page context summary failed; using extracted context:',
            expect.any(Error),
        );
        summaryWarn.mockRestore();
    });

    it('摘要耗时不同的相同总预算请求不共享正文 provider deadline', async () => {
        mocks.config.service = 'ai';
        mocks.config.enableAIContext = true;
        const timestamps = [0, 1_000, 1_000, 1_000];
        installBroker(() => timestamps.shift() ?? 1_000);
        const firstProvider = deferred<string>();
        const secondProvider = deferred<string>();
        const providerRequests = [firstProvider, secondProvider];
        mocks.service.mockImplementation((message: {summaryPrompt?: string}) => {
            if (message.summaryPrompt) return Promise.resolve('共享摘要');
            const request = providerRequests.shift();
            if (!request) throw new Error('unexpected extra provider request');
            return request.promise;
        });

        // 首个请求用 1 秒生成摘要，正文只剩 3 秒。
        const summarizedFirst = translateWithCache({
            origin: 'Same deadline',
            pageContext: 'Same article',
            requestTimeoutMs: 4_000,
        });
        await flushMicrotasks(20);
        expect(mocks.service).toHaveBeenCalledWith(expect.objectContaining({
            origin: 'Same deadline',
            requestTimeoutMs: 3_000,
        }));

        // 后发请求直接命中摘要，正文仍有 4 秒，必须拥有独立 pending 身份。
        const cachedSummarySecond = translateWithCache({
            origin: 'Same deadline',
            pageContext: 'Same article',
            requestTimeoutMs: 4_000,
        });
        await flushMicrotasks(20);
        const translationCalls = mocks.service.mock.calls.filter(([message]) => !message.summaryPrompt);
        expect(translationCalls.map(([message]) => message.requestTimeoutMs)).toEqual([3_000, 4_000]);

        firstProvider.resolve('首请求译文');
        secondProvider.resolve('后发请求译文');
        await expect(Promise.all([summarizedFirst, cachedSummarySecond]))
            .resolves.toEqual(['首请求译文', '后发请求译文']);
    });

    it('关闭缓存时 AI 上下文只做请求内去重，不读写或复用任何摘要缓存', async () => {
        mocks.config.service = 'ai';
        mocks.config.enableAIContext = true;
        let resolveFirstSummary!: (value: string) => void;
        let summaryCalls = 0;
        mocks.service.mockImplementation((message: {summaryPrompt?: string; origin: string}) => {
            if (!message.summaryPrompt) return Promise.resolve(`${message.origin}-译文`);
            summaryCalls += 1;
            if (summaryCalls === 1) {
                return new Promise<string>((resolve) => {
                    resolveFirstSummary = resolve;
                });
            }
            return Promise.resolve(`摘要 ${summaryCalls}`);
        });
        mocks.cacheGet.mockClear();
        mocks.cacheSet.mockClear();

        const first = translateWithCache({origin: 'A', pageContext: 'private context', useCache: false});
        const second = translateWithCache({origin: 'B', pageContext: 'private context', useCache: false});
        await flushMicrotasks();
        expect(summaryCalls).toBe(1);
        resolveFirstSummary('请求内共享摘要');
        await expect(Promise.all([first, second])).resolves.toEqual(['A-译文', 'B-译文']);

        await expect(translateWithCache({origin: 'C', pageContext: 'private context', useCache: false}))
            .resolves.toBe('C-译文');
        expect(summaryCalls).toBe(2);

        mocks.config.useCache = false;
        await expect(translateWithCache({origin: 'D', pageContext: 'global no-cache context'}))
            .resolves.toBe('D-译文');
        expect(summaryCalls).toBe(3);
        expect(mocks.cacheGet).not.toHaveBeenCalled();
        expect(mocks.cacheSet).not.toHaveBeenCalled();
    });

    it('falls back to raw page context when summary budget expires and reports total budget exhaustion', async () => {
        mocks.config.service = 'ai';
        mocks.config.enableAIContext = true;
        vi.useFakeTimers();
        mocks.service.mockImplementation((message: {summaryPrompt?: string; origin: string}) => {
            if (message.summaryPrompt) return new Promise<string>(() => undefined);
            return Promise.resolve(`${message.origin}-译文`);
        });

        const timed = translateWithCache({
            origin: 'Budgeted',
            pageContext: 'Slow context',
            requestTimeoutMs: 4_000,
            useCache: false,
        });
        await vi.advanceTimersByTimeAsync(1_000);
        await expect(timed).resolves.toBe('Budgeted-译文');
        expect(mocks.service).toHaveBeenLastCalledWith(expect.objectContaining({
            pageContext: 'Slow context',
            requestTimeoutMs: 3_000,
        }));

        mocks.service.mockReset();
        mocks.service.mockImplementation((message: {summaryPrompt?: string; origin: string}) => {
            if (message.summaryPrompt) {
                return new Promise<string>(resolve => {
                    setTimeout(() => resolve('Late summary'), 1_500);
                });
            }
            return Promise.resolve(`${message.origin}-译文`);
        });
        const late = translateWithCache({
            origin: 'Late budget',
            pageContext: 'Late context',
            requestTimeoutMs: 4_000,
            useCache: false,
        });
        await vi.advanceTimersByTimeAsync(1_000);
        await expect(late).resolves.toBe('Late budget-译文');
        await vi.advanceTimersByTimeAsync(500);

        vi.useRealTimers();
        vi.spyOn(Date, 'now')
            .mockReturnValueOnce(0)
            .mockReturnValueOnce(4_000);
        mocks.service.mockReset();
        mocks.service.mockImplementation((message: {summaryPrompt?: string}) => (
            Promise.resolve(message.summaryPrompt ? 'Too late summary' : 'never')
        ));
        await expect(translateWithCache({
            origin: 'Timeout',
            pageContext: 'Timeout context',
            requestTimeoutMs: 4_000,
            useCache: false,
        })).rejects.toThrow('翻译请求超时');
        expect(mocks.service.mock.calls.filter(([message]) => !message.summaryPrompt)).toHaveLength(0);
    });

    it('skips AI summary when page context is blank', async () => {
        mocks.config.service = 'ai';
        mocks.config.enableAIContext = true;
        mocks.service.mockResolvedValue('译文');

        await expect(translateWithCache({
            origin: 'Blank context',
            pageContext: '   ',
            requestTimeoutMs: 4_000,
            useCache: false,
        })).resolves.toBe('译文');

        expect(mocks.service).toHaveBeenCalledOnce();
        expect(mocks.service).toHaveBeenCalledWith(expect.objectContaining({
            pageContext: '',
        }));
    });

    it('clears persisted and summary caches and exposes cleanup', async () => {
        mocks.config.service = 'ai';
        mocks.config.enableAIContext = true;
        mocks.service.mockImplementation((message: {summaryPrompt?: string}) => (
            Promise.resolve(message.summaryPrompt ? 'Summary' : '译文')
        ));

        await translateWithCache({origin: 'Before clear', pageContext: 'Clear context'});
        await clearTranslationCache();
        await translateWithCache({origin: 'After clear', pageContext: 'Clear context'});
        await cleanupTranslationCache();

        expect(mocks.cacheClear).toHaveBeenCalledOnce();
        expect(mocks.cacheCleanup).toHaveBeenCalledOnce();
        expect(mocks.service.mock.calls.filter(([message]) => message.summaryPrompt)).toHaveLength(2);
    });

    it('清理期间使未完成的单条与批量请求失效，旧结果不能重新写缓存或继续参与去重', async () => {
        let resolveSingle!: (value: string) => void;
        mocks.service.mockImplementationOnce(() => new Promise<string>((resolve) => {
            resolveSingle = resolve;
        }));
        const staleSingle = translateWithCache({origin: 'stale-single'});
        await flushMicrotasks();

        await clearTranslationCache();
        resolveSingle('旧单条译文');
        await expect(staleSingle).resolves.toBe('旧单条译文');
        expect(mocks.cacheSet).not.toHaveBeenCalled();

        mocks.service.mockResolvedValueOnce('新单条译文');
        await expect(translateWithCache({origin: 'stale-single'})).resolves.toBe('新单条译文');
        expect(mocks.service).toHaveBeenCalledTimes(2);

        mocks.cacheSet.mockClear();
        let resolveBatch!: (value: string[]) => void;
        mocks.service.mockImplementationOnce(() => new Promise<string[]>((resolve) => {
            resolveBatch = resolve;
        }));
        const staleBatch = translateWithCache({origin: ['stale-a', 'stale-b']});
        await flushMicrotasks();

        await clearTranslationCache();
        resolveBatch(['旧 A', '旧 B']);
        await expect(staleBatch).resolves.toEqual(['旧 A', '旧 B']);
        expect(mocks.cacheSet).not.toHaveBeenCalled();

        mocks.service.mockResolvedValueOnce(['新 A', '新 B']);
        await expect(translateWithCache({origin: ['stale-a', 'stale-b']})).resolves.toEqual(['新 A', '新 B']);
        expect(mocks.service).toHaveBeenCalledTimes(4);
    });

    it('清理使未完成的 AI 摘要失效，完成后的原请求可用但下一请求必须重新生成摘要', async () => {
        mocks.config.service = 'ai';
        mocks.config.enableAIContext = true;
        let resolveSummary!: (value: string) => void;
        let summaryCalls = 0;
        mocks.service.mockImplementation((message: {summaryPrompt?: string; origin: string}) => {
            if (!message.summaryPrompt) return Promise.resolve(`${message.origin}-译文`);
            summaryCalls += 1;
            if (summaryCalls === 1) {
                return new Promise<string>((resolve) => {
                    resolveSummary = resolve;
                });
            }
            return Promise.resolve('新摘要');
        });

        const staleRequest = translateWithCache({
            origin: '旧请求',
            pageContext: '同一页面上下文',
            useCache: true,
        });
        await flushMicrotasks();
        await clearTranslationCache();
        resolveSummary('迟到摘要');
        await expect(staleRequest).resolves.toBe('旧请求-译文');
        expect(mocks.cacheSet).not.toHaveBeenCalled();

        await expect(translateWithCache({
            origin: '新请求',
            pageContext: '同一页面上下文',
            useCache: true,
        })).resolves.toBe('新请求-译文');
        expect(summaryCalls).toBe(2);
        expect(mocks.cacheSet).toHaveBeenCalledTimes(2);
    });

    it('清理会等待已经进入存储适配器的旧写入，再执行最终清库', async () => {
        let releaseWrite!: () => void;
        mocks.service.mockResolvedValueOnce('待清理译文');
        mocks.cacheSet.mockImplementationOnce(async (key: string, value: string) => {
            await new Promise<void>((resolve) => {
                releaseWrite = resolve;
            });
            mocks.cacheStore.set(key, value);
            return true;
        });

        const translation = translateWithCache({origin: 'write-race'});
        await vi.waitFor(() => expect(mocks.cacheSet).toHaveBeenCalledOnce());
        const clearing = clearTranslationCache();
        await flushMicrotasks();
        expect(mocks.cacheClear).not.toHaveBeenCalled();

        releaseWrite();
        await expect(translation).resolves.toBe('待清理译文');
        await clearing;
        expect(mocks.cacheClear).toHaveBeenCalledOnce();
        expect(mocks.cacheStore.size).toBe(0);
    });

    it('records every cache identity input expected by the broker contract', async () => {
        mocks.config.service = 'aiSdk';
        mocks.config.enableAIContext = true;
        Object.assign(configured('aiSdk'), {
            customBody: '{"temperature":0}',
            systemRole: 'system',
            userRole: 'user',
            deepseekApiType: 'responses',
            deepseekThinkingMode: 'enabled',
        });

        await translateWithCache({
            origin: 'Identity',
            pageContext: 'Identity context',
            sourceLanguage: 'en',
            targetLanguage: 'fr',
        });

        const identities = mocks.buildTranslationCacheKey.mock.calls.map(([identity]) => identity as CacheIdentity);
        expect(identities).toEqual(expect.arrayContaining([
            expect.objectContaining({
                requestMode: 'page-summary',
                customBody: '{"temperature":0}',
                endpoint: 'https://aiSdk.endpoint.test',
                model: 'ai-sdk-model',
                sourceText: 'Identity context',
            }),
            expect.objectContaining({
                requestMode: 'single',
                customBody: '{"temperature":0}',
                deepseekApiType: 'responses',
                deepseekThinkingMode: 'enabled',
                endpoint: 'https://aiSdk.endpoint.test',
                model: 'ai-sdk-model',
                pageContext: expect.stringContaining('Identity context'),
                sourceLanguage: 'en',
                sourceText: 'Identity',
                systemRole: 'system',
                targetLanguage: 'fr',
                userRole: 'user',
            }),
        ]));

        expect(cacheIdentityAt(0)).toMatchObject({requestMode: 'page-summary'});
    });

    it('请求级语言覆盖同时进入 provider 与缓存身份，切换目标语言不会复用旧译文', async () => {
        mocks.service.mockImplementation(async (message: {sourceLanguage?: string; targetLanguage?: string}) =>
            `${message.sourceLanguage}->${message.targetLanguage}`);

        await expect(translateWithCache({origin: 'same', sourceLanguage: 'en', targetLanguage: 'ja'}))
            .resolves.toBe('en->ja');
        await expect(translateWithCache({origin: 'same', sourceLanguage: 'en', targetLanguage: 'fr'}))
            .resolves.toBe('en->fr');
        await expect(translateWithCache({origin: 'same', sourceLanguage: 'en', targetLanguage: 'ja'}))
            .resolves.toBe('en->ja');

        expect(mocks.service).toHaveBeenCalledTimes(2);
        expect(mocks.service.mock.calls.map(([message]) => ({
            sourceLanguage: message.sourceLanguage,
            targetLanguage: message.targetLanguage,
        }))).toEqual([
            {sourceLanguage: 'en', targetLanguage: 'ja'},
            {sourceLanguage: 'en', targetLanguage: 'fr'},
        ]);
        expect(translationCacheIdentities()).toEqual(expect.arrayContaining([
            expect.objectContaining({sourceLanguage: 'en', targetLanguage: 'ja'}),
            expect.objectContaining({sourceLanguage: 'en', targetLanguage: 'fr'}),
        ]));
    });

    it('cache.get 等待期间配置变化时，单条 provider 与缓存身份仍共用同一不可变快照', async () => {
        mocks.config.service = 'aiSdk';
        const aiSdk = configured('aiSdk');
        Object.assign(aiSdk, {
            modelId: 'model-a',
            endpoint: 'https://proxy-a.example/v1',
            customBody: '{"temperature":0.1}',
            systemRole: 'system-a',
        });

        const firstCacheRead = deferred<string | null>();
        mocks.cacheGet
            .mockImplementationOnce(() => firstCacheRead.promise)
            .mockImplementation(async (key: string) => mocks.cacheStore.get(key) ?? null);
        const providerServices: ResolvedTranslationService[] = [];
        mocks.service.mockImplementation(async ({service}: ProviderCall) => {
            providerServices.push(service);
            return [service.modelId, service.endpoint, service.customBody, service.systemRole].join('|');
        });

        const oldRequest = translateWithCache({origin: 'snapshot-race'});
        await vi.waitFor(() => expect(mocks.cacheGet).toHaveBeenCalledOnce());

        Object.assign(aiSdk, {
            modelId: 'model-b',
            endpoint: 'https://proxy-b.example/v1',
            customBody: '{"temperature":0.9}',
            systemRole: 'system-b',
        });
        firstCacheRead.resolve(null);

        await expect(oldRequest).resolves.toBe('model-a|https://proxy-a.example/v1|{"temperature":0.1}|system-a');
        expect(Object.isFrozen(providerServices[0])).toBe(true);
        expect(JSON.parse(mocks.cacheSet.mock.calls[0][0])).toMatchObject({
            model: 'model-a',
            endpoint: 'https://proxy-a.example/v1',
            customBody: '{"temperature":0.1}',
            systemRole: 'system-a',
        });

        await expect(translateWithCache({origin: 'snapshot-race'}))
            .resolves.toBe('model-b|https://proxy-b.example/v1|{"temperature":0.9}|system-b');
        expect(mocks.service).toHaveBeenCalledTimes(2);
    });

    it('批量冷缓存读取期间配置变化时，所有读写 key 与 provider 都固定在请求快照', async () => {
        mocks.config.service = 'aiSdk';
        const aiSdk = configured('aiSdk');
        Object.assign(aiSdk, {modelId: 'batch-model-a', endpoint: 'https://batch-a.example/v1'});

        const firstRead = deferred<string | null>();
        const secondRead = deferred<string | null>();
        mocks.cacheGet
            .mockImplementationOnce(() => firstRead.promise)
            .mockImplementationOnce(() => secondRead.promise)
            .mockImplementation(async (key: string) => mocks.cacheStore.get(key) ?? null);
        mocks.service.mockImplementation(async ({service, origin}: ProviderCall) =>
            (origin as string[]).map((text) => `${text}:${service.modelId}:${service.endpoint}`));

        const oldRequest = translateWithCache({origin: ['batch-one', 'batch-two']});
        await vi.waitFor(() => expect(mocks.cacheGet).toHaveBeenCalledTimes(2));
        const oldReadIdentities = mocks.cacheGet.mock.calls.slice(0, 2).map(([key]) => JSON.parse(key));
        expect(oldReadIdentities).toEqual([
            expect.objectContaining({requestMode: 'batch', sourceText: 'batch-one', model: 'batch-model-a'}),
            expect.objectContaining({requestMode: 'batch', sourceText: 'batch-two', model: 'batch-model-a'}),
        ]);

        Object.assign(aiSdk, {modelId: 'batch-model-b', endpoint: 'https://batch-b.example/v1'});
        firstRead.resolve(null);
        secondRead.resolve(null);

        await expect(oldRequest).resolves.toEqual([
            'batch-one:batch-model-a:https://batch-a.example/v1',
            'batch-two:batch-model-a:https://batch-a.example/v1',
        ]);
        expect(mocks.cacheSet.mock.calls.slice(0, 2).map(([key]) => JSON.parse(key))).toEqual(oldReadIdentities);

        await expect(translateWithCache({origin: ['batch-one', 'batch-two']})).resolves.toEqual([
            'batch-one:batch-model-b:https://batch-b.example/v1',
            'batch-two:batch-model-b:https://batch-b.example/v1',
        ]);
    });

    it('AI 摘要等待缓存时沿用请求快照，后续配置不会交叉污染摘要与正文缓存', async () => {
        mocks.config.service = 'aiSdk';
        mocks.config.enableAIContext = true;
        const aiSdk = configured('aiSdk');
        aiSdk.modelId = 'summary-model-a';

        const summaryCacheRead = deferred<string | null>();
        mocks.cacheGet
            .mockImplementationOnce(() => summaryCacheRead.promise)
            .mockImplementation(async (key: string) => mocks.cacheStore.get(key) ?? null);
        mocks.service.mockImplementation(async ({service, summaryPrompt}: ProviderCall) =>
            `${summaryPrompt ? 'summary' : 'translation'}:${service.modelId}`);

        const oldRequest = translateWithCache({origin: 'summary-race', pageContext: 'shared article'});
        await vi.waitFor(() => expect(mocks.cacheGet).toHaveBeenCalledOnce());
        aiSdk.modelId = 'summary-model-b';
        summaryCacheRead.resolve(null);

        await expect(oldRequest).resolves.toBe('translation:summary-model-a');
        expect(mocks.service.mock.calls.map(([call]) => (call as ProviderCall).service.modelId))
            .toEqual(['summary-model-a', 'summary-model-a']);
        expect(mocks.cacheSet.mock.calls.map(([key]) => JSON.parse(key) as CacheIdentity)).toEqual(expect.arrayContaining([
            expect.objectContaining({requestMode: 'page-summary', model: 'summary-model-a'}),
            expect.objectContaining({requestMode: 'single', model: 'summary-model-a'}),
        ]));

        await expect(translateWithCache({origin: 'summary-race', pageContext: 'shared article'}))
            .resolves.toBe('translation:summary-model-b');
    });

});
