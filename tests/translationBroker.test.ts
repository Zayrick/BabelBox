import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {
    createTranslationBroker,
    type TranslationBroker,
} from '@/src/services/translation/broker';
import {
    createTranslationProviderConfigSnapshot,
    getTranslationProviderConfig,
} from '@/src/services/translation/requestSnapshot';

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
    transportProfile?: string;
    context?: string;
    pageContext?: string;
};

const mocks = vi.hoisted(() => {
    const cacheStore = new Map<string, string>();
    const machineServices = new Set([
        'mock',
        'custom',
        'deeplx',
        'newapi',
        'minimax',
        'mimo',
        'cozecom',
        'cozecn',
        'azureOpenai',
    ]);
    const aiServices = new Set(['ai', 'aiSdk', 'brokenAiSdk']);
    const aiSdkServices = new Set(['aiSdk', 'brokenAiSdk']);
    const service = vi.fn();
    const minimaxEndpoints = {
        payg: {cn: 'https://minimax.payg.cn', global: 'https://minimax.payg.global'},
        'token-plan': {cn: 'https://minimax.token.cn', global: 'https://minimax.token.global'},
    } as Record<string, Record<string, string>>;
    const providers = {
        '': service,
        ai: service,
        aiSdk: service,
        azureOpenai: service,
        brokenAiSdk: service,
        custom: service,
        cozecom: service,
        cozecn: service,
        deeplx: service,
        deepL: service,
        minimax: service,
        mimo: service,
        mock: service,
        newapi: service,
    };
    const buildTranslationCacheKey = vi.fn((identity: unknown) => JSON.stringify(identity));
    const config = {
        service: 'mock',
        from: 'auto',
        to: 'zh-Hans',
        useCache: true,
        enableAIContext: false,
        model: {
            mock: 'mock-model',
            ai: 'ai-model',
            aiSdk: 'ai-sdk-model',
            brokenAiSdk: 'broken-ai-sdk-model',
            custom: 'custom-model',
            deeplx: 'deeplx-model',
            newapi: 'newapi-model',
            minimax: 'minimax-model',
            mimo: 'mimo-model',
        } as Record<string, string>,
        customModel: {} as Record<string, string>,
        proxy: {} as Record<string, string>,
        custom: '',
        deeplx: '',
        newApiUrl: '',
        minimaxBillingPlan: 'payg',
        minimaxRegion: 'cn',
        mimoBillingPlan: 'payg',
        mimoRegion: 'cn',
        azureOpenaiEndpoint: '',
        robot_id: {} as Record<string, string>,
        customBody: {} as Record<string, string>,
        system_role: {} as Record<string, string>,
        user_role: {} as Record<string, string>,
        deepseekApiType: 'auto',
        deepseekThinkingMode: 'disabled',
    };

    return {
        aiSdkServices,
        aiServices,
        buildTranslationCacheKey,
        cacheStore,
        config,
        providers,
        endpointResolver: vi.fn((serviceName: string, _current?: unknown) => {
            if (serviceName === 'brokenAiSdk') throw new Error('endpoint missing');
            return {endpoint: `https://${serviceName}.endpoint.test`};
        }),
        getMissingCredentialMessage: vi.fn(() => null as string | null),
        machineServices,
        minimaxEndpoints,
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
        serviceIds: {minimax: 'minimax', mimo: 'mimo'},
        serviceTypes: {
            machine: mocks.machineServices,
            isAI: (service: string) => mocks.aiServices.has(service),
            isAiSdk: (service: string) => mocks.aiSdkServices.has(service),
            isUseAIContext: (service: string) => service === 'ai' || service === 'aiSdk' || service === 'brokenAiSdk',
        },
        endpointResolver: {
            resolveOpenAICompatibleEndpoint: mocks.endpointResolver,
            getMimoEndpoint: (plan: string, region: string) => `https://mimo.${plan}.${region}.test`,
            minimaxEndpoints: mocks.minimaxEndpoints,
            aiSdkTransportProfile: 'ai-sdk-profile',
        },
        promptBuilder: {
            buildPageSummaryPrompt: (pageContext: string) => `summarize:${pageContext}`,
            buildPageSummarySystemPrompt: () => 'summary-system',
        },
        getMissingCredentialMessage: mocks.getMissingCredentialMessage,
        getTranslationLanguages: (override?: {sourceLanguage?: string; targetLanguage?: string}) => ({
            sourceLanguage: override?.sourceLanguage || mocks.config.from,
            targetLanguage: override?.targetLanguage || mocks.config.to,
        }),
        resolveConfiguredModel: (selected?: string, custom?: string) => custom || selected || '',
        buildTranslationCacheKey: mocks.buildTranslationCacheKey,
        now,
    });
    translateWithCache = broker.translateWithCache;
    clearTranslationCache = broker.clearTranslationCache;
    cleanupTranslationCache = broker.cleanupTranslationCache;
}

function cacheKey(identity: CacheIdentity): string {
    return JSON.stringify(identity);
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
        mocks.aiSdkServices.clear();
        mocks.aiSdkServices.add('aiSdk');
        mocks.aiSdkServices.add('brokenAiSdk');
        mocks.aiServices.clear();
        mocks.aiServices.add('ai');
        mocks.aiServices.add('aiSdk');
        mocks.aiServices.add('brokenAiSdk');
        mocks.machineServices.clear();
        ['mock', 'custom', 'deeplx', 'newapi', 'minimax', 'mimo', 'cozecom', 'cozecn', 'azureOpenai'].forEach(service => mocks.machineServices.add(service));
        Object.assign(mocks.config, {
            service: 'mock',
            from: 'auto',
            to: 'zh-Hans',
            useCache: true,
            enableAIContext: false,
            proxy: {},
            custom: '',
            deeplx: '',
            newApiUrl: '',
            minimaxBillingPlan: 'payg',
            minimaxRegion: 'cn',
            mimoBillingPlan: 'payg',
            mimoRegion: 'cn',
            azureOpenaiEndpoint: '',
            robot_id: {},
            customBody: {},
            system_role: {},
            user_role: {},
            deepseekApiType: 'auto',
            deepseekThinkingMode: 'disabled',
        });
        mocks.config.model = {
            mock: 'mock-model',
            ai: 'ai-model',
            aiSdk: 'ai-sdk-model',
            azureOpenai: 'azure-openai-model',
            brokenAiSdk: 'broken-ai-sdk-model',
            custom: 'custom-model',
            cozecom: 'coze-model',
            cozecn: 'coze-cn-model',
            deeplx: 'deeplx-model',
            newapi: 'newapi-model',
            minimax: 'minimax-model',
            mimo: 'mimo-model',
        };
        mocks.config.customModel = {};
        delete (mocks.config as Record<string, unknown>).translationServices;
        delete (mocks.config as Record<string, unknown>).serviceCredentials;
        delete (mocks.config as Record<string, unknown>).token;
        delete (mocks.config as Record<string, unknown>).requireApiKey;
        mocks.service.mockReset();
        mocks.service.mockResolvedValue('默认译文');
        mocks.getMissingCredentialMessage.mockReturnValue(null);
        mocks.endpointResolver.mockImplementation((serviceName: string, _current?: unknown) => {
            if (serviceName === 'brokenAiSdk') throw new Error('endpoint missing');
            return {endpoint: `https://${serviceName}.endpoint.test`};
        });
        Object.assign(mocks.minimaxEndpoints, {
            payg: {cn: 'https://minimax.payg.cn', global: 'https://minimax.payg.global'},
            'token-plan': {cn: 'https://minimax.token.cn', global: 'https://minimax.token.global'},
        });
        installBroker();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('reuses persisted single cache entries and skips storing unchanged or empty results', async () => {
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
        mocks.service.mockResolvedValueOnce('');
        await expect(translateWithCache({origin: 'Empty'})).resolves.toBe('');

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

    it('拒绝 provider 的非字符串单条结果，且不污染缓存', async () => {
        mocks.service.mockResolvedValueOnce({translated: '对象不是协议结果'});
        await expect(translateWithCache({origin: 'Cached invalid'})).rejects.toThrow('单条翻译返回格式异常');

        mocks.service.mockResolvedValueOnce(undefined);
        await expect(translateWithCache({origin: 'Direct invalid', useCache: false})).rejects.toThrow('单条翻译返回格式异常');
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

    it('rejects invalid batch provider results and clears rejected pending batches', async () => {
        mocks.service.mockResolvedValueOnce('not-array');
        await expect(translateWithCache({origin: ['A'], useCache: false})).rejects.toThrow('批量翻译返回格式异常');

        mocks.service.mockResolvedValueOnce(['A', 'extra']);
        await expect(translateWithCache({origin: ['A'], useCache: false})).rejects.toThrow('批量翻译返回数量异常');

        mocks.service.mockResolvedValueOnce(['A', undefined]);
        await expect(translateWithCache({origin: ['A', 'B'], useCache: false})).rejects.toThrow('批量翻译返回格式异常');

        mocks.service.mockResolvedValueOnce(['直连 A']);
        await expect(translateWithCache({origin: ['A'], useCache: false})).resolves.toEqual(['直连 A']);

        mocks.service.mockResolvedValueOnce(['only-one']);
        await expect(translateWithCache({origin: ['A', 'B']})).rejects.toThrow('批量翻译返回数量异常');

        mocks.service.mockResolvedValueOnce(['A-译文', null]);
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

    it('builds provider cache identities for proxy, custom endpoints, Minimax, Mimo, and AI SDK services', async () => {
        mocks.config.proxy.mock = 'https://proxy.example';
        await translateWithCache({origin: 'Proxy'});
        expect(translationCacheIdentities().at(-1)).toMatchObject({endpoint: 'https://proxy.example'});

        mocks.config.service = 'custom';
        mocks.config.custom = 'https://custom.example';
        await translateWithCache({origin: 'Custom'});
        expect(translationCacheIdentities().at(-1)).toMatchObject({service: 'custom', endpoint: 'https://custom.example'});

        mocks.config.service = 'deeplx';
        mocks.config.deeplx = 'https://deeplx.example';
        await translateWithCache({origin: 'DeepLX'});
        expect(translationCacheIdentities().at(-1)).toMatchObject({service: 'deeplx', endpoint: 'https://deeplx.example'});

        mocks.config.service = 'newapi';
        mocks.config.newApiUrl = 'https://newapi.example';
        await translateWithCache({origin: 'New API'});
        expect(translationCacheIdentities().at(-1)).toMatchObject({service: 'newapi', endpoint: 'https://newapi.example'});

        mocks.config.service = 'minimax';
        mocks.config.minimaxBillingPlan = 'token-plan';
        mocks.config.minimaxRegion = 'global';
        await translateWithCache({origin: 'Minimax'});
        expect(translationCacheIdentities().at(-1)).toMatchObject({service: 'minimax', endpoint: 'https://minimax.token.global'});

        mocks.config.minimaxBillingPlan = 'unknown';
        mocks.config.minimaxRegion = 'cn';
        await translateWithCache({origin: 'Minimax default'});
        expect(translationCacheIdentities().at(-1)).toMatchObject({service: 'minimax', endpoint: 'https://minimax.payg.cn'});

        mocks.minimaxEndpoints.payg = {};
        installBroker();
        await translateWithCache({origin: 'Minimax missing endpoint'});
        expect(translationCacheIdentities().at(-1)).toMatchObject({service: 'minimax', endpoint: ''});

        mocks.config.service = 'mimo';
        mocks.config.mimoBillingPlan = 'subscription';
        mocks.config.mimoRegion = 'global';
        await translateWithCache({origin: 'Mimo'});
        expect(translationCacheIdentities().at(-1)).toMatchObject({service: 'mimo', endpoint: 'https://mimo.subscription.global.test'});

        mocks.config.service = 'aiSdk';
        await translateWithCache({origin: 'AI SDK'});
        expect(mocks.endpointResolver).toHaveBeenCalledWith('aiSdk', expect.any(Object));
        expect(translationCacheIdentities().at(-1)).toMatchObject({
            endpoint: 'https://aiSdk.endpoint.test',
            transportProfile: 'ai-sdk-profile',
        });

        mocks.config.service = 'brokenAiSdk';
        await translateWithCache({origin: 'Broken AI SDK'});
        expect(translationCacheIdentities().at(-1)).toMatchObject({
            endpoint: '',
            transportProfile: 'ai-sdk-profile',
        });

        mocks.config.service = 'cozecom';
        mocks.config.robot_id.cozecom = 'robot-1';
        await translateWithCache({origin: 'Coze'});
        expect(translationCacheIdentities().at(-1)).toMatchObject({
            robotId: 'robot-1',
            service: 'cozecom',
        });

        mocks.config.service = 'cozecn';
        await translateWithCache({origin: 'Coze CN'});
        expect(translationCacheIdentities().at(-1)).toMatchObject({
            robotId: '',
            service: 'cozecn',
        });

        mocks.config.service = 'azureOpenai';
        mocks.config.azureOpenaiEndpoint = 'https://azure-openai.example';
        await translateWithCache({origin: 'Azure OpenAI'});
        expect(translationCacheIdentities().at(-1)).toMatchObject({
            azureOpenaiEndpoint: 'https://azure-openai.example',
            service: 'azureOpenai',
        });

        mocks.config.service = 'mock';
        await translateWithCache({origin: 'Fallback service', serviceOverride: ''});
        expect(translationCacheIdentities().at(-1)).toMatchObject({service: 'mock'});

        mocks.machineServices.add('');
        mocks.config.model[''] = 'empty-service-model';
        mocks.config.service = '';
        await translateWithCache({origin: 'Empty configured service', serviceOverride: ''});
        expect(translationCacheIdentities().at(-1)).toMatchObject({service: ''});
    });

    it('passes modelOverride through credential checks, cache identity, and provider calls', async () => {
        mocks.service.mockResolvedValue('覆盖模型译文');

        await expect(translateWithCache({
            origin: 'Model override',
            modelOverride: 'manual-model',
            serviceOverride: 'ai',
        })).resolves.toBe('覆盖模型译文');

        expect(mocks.getMissingCredentialMessage).toHaveBeenCalledWith('ai', expect.objectContaining({
            model: expect.objectContaining({ai: 'manual-model'}),
            customModel: expect.objectContaining({ai: 'manual-model'}),
        }));
        expect(translationCacheIdentities().at(-1)).toMatchObject({service: 'ai', model: 'manual-model'});
        expect(mocks.service).toHaveBeenCalledWith(expect.objectContaining({
            modelOverride: 'manual-model',
            serviceOverride: 'ai',
        }));
    });

    it('reports credential, unsupported override, and missing adapter failures before provider calls', async () => {
        mocks.getMissingCredentialMessage.mockReturnValueOnce('缺少凭据');
        await expect(translateWithCache({origin: 'Credential'})).rejects.toThrow('缺少凭据');

        await expect(translateWithCache({
            origin: 'Unsupported',
            serviceOverride: 'unsupported',
        })).rejects.toThrow('独立翻译服务不可用');

        mocks.config.service = 'missing';
        mocks.machineServices.add('missing');
        await expect(translateWithCache({origin: 'Missing adapter'})).rejects.toThrow('未找到翻译服务适配器: missing');

        expect(mocks.service).not.toHaveBeenCalled();
    });

    it('keeps sibling instances of one provider isolated in requests and cache identity', async () => {
        const firstId = 'service:ai:first';
        const secondId = 'service:ai:second';
        const instance = (id: string, modelId: string, endpoint: string) => ({
            id,
            provider: 'ai',
            name: modelId,
            enabled: true,
            kind: 'ai',
            modelId,
            endpoint,
            proxy: '',
            customBody: '',
            systemRole: '',
            userRole: '',
            robotId: '',
            requireApiKey: true,
            deepseekApiType: 'auto',
            deepseekThinkingMode: 'disabled',
            minimaxBillingPlan: 'payg',
            minimaxRegion: 'cn',
            mimoBillingPlan: 'payg',
            mimoRegion: 'cn',
        });
        Object.assign(mocks.config, {
            service: firstId,
            translationServices: [
                instance(firstId, 'first-model', 'https://first.example.test/v1'),
                instance(secondId, 'second-model', 'https://second.example.test/v1'),
            ],
            serviceCredentials: {
                [firstId]: {apiKey: 'first-secret', appKey: '', appSecret: '', secretId: '', secretKey: ''},
                [secondId]: {apiKey: 'second-secret', appKey: '', appSecret: '', secretId: '', secretKey: ''},
            },
            token: {ai: 'legacy-secret'},
            requireApiKey: {},
        });
        mocks.service.mockImplementation(async (message: Record<string, unknown>) => {
            const current = getTranslationProviderConfig(
                message,
                createTranslationProviderConfigSnapshot(mocks.config),
            );
            return `${current.model.ai}|${current.proxy.ai}|${current.token.ai}`;
        });

        await expect(translateWithCache({
            origin: 'same',
            serviceOverride: firstId,
            modelOverride: 'stale-content-model',
        }))
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
        const instanceId = 'service:ai:disabled';
        Object.assign(mocks.config, {
            service: instanceId,
            translationServices: [{
                id: instanceId,
                provider: 'ai',
                name: 'Disabled AI',
                enabled: false,
                kind: 'ai',
                modelId: 'disabled-model',
                endpoint: '',
                proxy: '',
                customBody: '',
                systemRole: '',
                userRole: '',
                robotId: '',
                requireApiKey: true,
                deepseekApiType: 'auto',
                deepseekThinkingMode: 'disabled',
                minimaxBillingPlan: 'payg',
                minimaxRegion: 'cn',
                mimoBillingPlan: 'payg',
                mimoRegion: 'cn',
            }],
        });

        await expect(translateWithCache({origin: 'blocked'})).rejects.toThrow('已禁用');
        expect(mocks.getMissingCredentialMessage).not.toHaveBeenCalled();
        expect(mocks.cacheGet).not.toHaveBeenCalled();
        expect(mocks.service).not.toHaveBeenCalled();
    });

    it('adds DeepL context and AI page context only when the target service consumes them', async () => {
        mocks.machineServices.add('deepL');
        mocks.config.service = 'deepL';
        mocks.config.model.deepL = 'deepl-model';
        await translateWithCache({origin: 'DeepL text', context: 'Title'});
        expect(translationCacheIdentities().at(-1)).toMatchObject({service: 'deepL', context: 'Title'});

        mocks.config.service = 'mock';
        await translateWithCache({origin: 'Plain text', context: 'Title', pageContext: 'Article'});
        expect(translationCacheIdentities().at(-1)).toMatchObject({
            context: undefined,
            pageContext: undefined,
        });
    });

    it('uses persisted, shared, empty, failed, and evicted AI summaries without blocking translation', async () => {
        mocks.config.service = 'ai';
        mocks.config.enableAIContext = true;

        const persistedSummaryKey = cacheKey({
            requestMode: 'page-summary',
            sourceLanguage: 'auto',
            targetLanguage: '',
            sourceText: 'Persisted context',
            service: 'ai',
            provider: 'ai',
            model: 'ai-model',
            endpoint: '',
            customBody: '',
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
        mocks.service.mockImplementation((message: {summaryPrompt?: string; origin: string}) => (
            Promise.resolve(message.summaryPrompt ? {notText: true} : `${message.origin}-译文`)
        ));
        await expect(translateWithCache({origin: 'Object summary', pageContext: 'Object context'})).resolves.toBe('Object summary-译文');
        expect(mocks.service).toHaveBeenLastCalledWith(expect.objectContaining({pageContext: 'Object context'}));

        mocks.service.mockReset();
        mocks.service.mockImplementation((message: {summaryPrompt?: string; origin: string}) => {
            if (message.summaryPrompt) return Promise.reject(new Error('summary failed'));
            return Promise.resolve(`${message.origin}-译文`);
        });
        const summaryWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        await expect(translateWithCache({origin: 'Failed summary', pageContext: 'Failed context'})).resolves.toBe('Failed summary-译文');
        expect(mocks.service).toHaveBeenLastCalledWith(expect.objectContaining({pageContext: 'Failed context'}));
        expect(summaryWarn).toHaveBeenCalledWith(
            '[FluentRead] page context summary failed; using extracted context:',
            expect.any(Error),
        );
        summaryWarn.mockRestore();

        mocks.service.mockReset();
        mocks.service.mockImplementation((message: {summaryPrompt?: string; origin: string}) => (
            Promise.resolve(message.summaryPrompt ? `Summary ${message.summaryPrompt}` : `${message.origin}-译文`)
        ));
        for (let index = 0; index < 9; index += 1) {
            await translateWithCache({origin: `Evict ${index}`, pageContext: `Evict context ${index}`});
        }
        expect(mocks.service.mock.calls.filter(([message]) => message.summaryPrompt)).toHaveLength(9);

        mocks.service.mockReset();
        mocks.service.mockImplementation((message: {summaryPrompt?: string; origin: string}) => (
            message.summaryPrompt
                ? Promise.reject(new Error('summary failed'))
                : Promise.resolve(`${message.origin}-译文`)
        ));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {
            throw new Error('warn failed');
        });
        await expect(translateWithCache({origin: 'Reject summary', pageContext: 'Reject context'}))
            .resolves.toBe('Reject summary-译文');
        warn.mockRestore();
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

    it('keeps AI summary disabled for non-finite budgets and blank page contexts', async () => {
        mocks.config.service = 'ai';
        mocks.config.enableAIContext = true;
        mocks.service.mockResolvedValue('译文');

        await expect(translateWithCache({
            origin: 'Blank context',
            pageContext: '   ',
            requestTimeoutMs: Number.NaN,
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
        mocks.config.customBody.aiSdk = '{"temperature":0}';
        mocks.config.system_role.aiSdk = 'system';
        mocks.config.user_role.aiSdk = 'user';
        mocks.config.robot_id.aiSdk = 'ignored';
        mocks.config.deepseekApiType = 'reasoner';
        mocks.config.deepseekThinkingMode = 'enabled';

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
                transportProfile: 'ai-sdk-profile',
            }),
            expect.objectContaining({
                requestMode: 'single',
                customBody: '{"temperature":0}',
                deepseekApiType: 'reasoner',
                deepseekThinkingMode: 'enabled',
                endpoint: 'https://aiSdk.endpoint.test',
                model: 'ai-sdk-model',
                pageContext: expect.stringContaining('Identity context'),
                sourceLanguage: 'en',
                sourceText: 'Identity',
                systemRole: 'system',
                targetLanguage: 'fr',
                transportProfile: 'ai-sdk-profile',
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
        mocks.config.model.aiSdk = 'model-a';
        mocks.config.proxy.aiSdk = 'https://proxy-a.example/v1';
        mocks.config.customBody.aiSdk = '{"temperature":0.1}';
        mocks.config.system_role.aiSdk = 'system-a';
        mocks.config.user_role.aiSdk = 'user-a';
        mocks.endpointResolver.mockImplementation((serviceName: string, current?: unknown) => ({
            endpoint: (current as {proxy: Record<string, string>}).proxy[serviceName],
        }));

        const firstCacheRead = deferred<string | null>();
        mocks.cacheGet
            .mockImplementationOnce(() => firstCacheRead.promise)
            .mockImplementation(async (key: string) => mocks.cacheStore.get(key) ?? null);
        const providerSnapshots: ReturnType<typeof createTranslationProviderConfigSnapshot>[] = [];
        mocks.service.mockImplementation(async (message: Record<string, unknown>) => {
            const current = getTranslationProviderConfig(
                message,
                createTranslationProviderConfigSnapshot(mocks.config),
            );
            providerSnapshots.push(current);
            return [
                current.model.aiSdk,
                current.proxy.aiSdk,
                current.customBody.aiSdk,
                current.system_role.aiSdk,
                current.user_role.aiSdk,
            ].join('|');
        });

        const oldRequest = translateWithCache({origin: 'snapshot-race'});
        await vi.waitFor(() => expect(mocks.cacheGet).toHaveBeenCalledOnce());

        mocks.config.model.aiSdk = 'model-b';
        mocks.config.proxy.aiSdk = 'https://proxy-b.example/v1';
        mocks.config.customBody.aiSdk = '{"temperature":0.9}';
        mocks.config.system_role.aiSdk = 'system-b';
        mocks.config.user_role.aiSdk = 'user-b';
        firstCacheRead.resolve(null);

        await expect(oldRequest).resolves.toBe(
            'model-a|https://proxy-a.example/v1|{"temperature":0.1}|system-a|user-a',
        );
        expect(providerSnapshots).toHaveLength(1);
        expect(Object.isFrozen(providerSnapshots[0])).toBe(true);
        expect(Object.isFrozen(providerSnapshots[0].proxy)).toBe(true);
        expect(JSON.parse(mocks.cacheSet.mock.calls[0][0])).toMatchObject({
            model: 'model-a',
            endpoint: 'https://proxy-a.example/v1',
            customBody: '{"temperature":0.1}',
            systemRole: 'system-a',
            userRole: 'user-a',
        });

        await expect(translateWithCache({origin: 'snapshot-race'})).resolves.toBe(
            'model-b|https://proxy-b.example/v1|{"temperature":0.9}|system-b|user-b',
        );
        expect(mocks.service).toHaveBeenCalledTimes(2);
        expect(mocks.cacheSet.mock.calls.map(([key, value]) => ({
            identity: JSON.parse(key),
            value,
        }))).toEqual(expect.arrayContaining([
            expect.objectContaining({
                identity: expect.objectContaining({model: 'model-a', endpoint: 'https://proxy-a.example/v1'}),
                value: expect.stringContaining('model-a|https://proxy-a.example/v1'),
            }),
            expect.objectContaining({
                identity: expect.objectContaining({model: 'model-b', endpoint: 'https://proxy-b.example/v1'}),
                value: expect.stringContaining('model-b|https://proxy-b.example/v1'),
            }),
        ]));
    });

    it('批量冷缓存读取期间配置变化时，所有读写 key 与 provider 都固定在请求快照', async () => {
        mocks.config.service = 'aiSdk';
        mocks.config.model.aiSdk = 'batch-model-a';
        mocks.config.proxy.aiSdk = 'https://batch-a.example/v1';
        mocks.config.customBody.aiSdk = '{"batch":"a"}';
        mocks.config.system_role.aiSdk = 'batch-system-a';
        mocks.config.user_role.aiSdk = 'batch-user-a';
        mocks.endpointResolver.mockImplementation((serviceName: string, current?: unknown) => ({
            endpoint: (current as {proxy: Record<string, string>}).proxy[serviceName],
        }));

        const firstRead = deferred<string | null>();
        const secondRead = deferred<string | null>();
        mocks.cacheGet
            .mockImplementationOnce(() => firstRead.promise)
            .mockImplementationOnce(() => secondRead.promise)
            .mockImplementation(async (key: string) => mocks.cacheStore.get(key) ?? null);
        const providerSnapshots: ReturnType<typeof createTranslationProviderConfigSnapshot>[] = [];
        mocks.service.mockImplementation(async (message: {origin: string[]} & Record<string, unknown>) => {
            const current = getTranslationProviderConfig(
                message,
                createTranslationProviderConfigSnapshot(mocks.config),
            );
            providerSnapshots.push(current);
            return message.origin.map((origin) => `${origin}:${current.model.aiSdk}:${current.proxy.aiSdk}`);
        });

        const oldRequest = translateWithCache({origin: ['batch-one', 'batch-two']});
        await vi.waitFor(() => expect(mocks.cacheGet).toHaveBeenCalledTimes(2));
        const oldReadIdentities = mocks.cacheGet.mock.calls.slice(0, 2).map(([key]) => JSON.parse(key));
        expect(oldReadIdentities).toEqual([
            expect.objectContaining({
                requestMode: 'batch',
                sourceText: 'batch-one',
                model: 'batch-model-a',
                endpoint: 'https://batch-a.example/v1',
                customBody: '{"batch":"a"}',
                systemRole: 'batch-system-a',
                userRole: 'batch-user-a',
            }),
            expect.objectContaining({
                requestMode: 'batch',
                sourceText: 'batch-two',
                model: 'batch-model-a',
                endpoint: 'https://batch-a.example/v1',
            }),
        ]);

        mocks.config.model.aiSdk = 'batch-model-b';
        mocks.config.proxy.aiSdk = 'https://batch-b.example/v1';
        mocks.config.customBody.aiSdk = '{"batch":"b"}';
        mocks.config.system_role.aiSdk = 'batch-system-b';
        mocks.config.user_role.aiSdk = 'batch-user-b';
        firstRead.resolve(null);
        secondRead.resolve(null);

        await expect(oldRequest).resolves.toEqual([
            'batch-one:batch-model-a:https://batch-a.example/v1',
            'batch-two:batch-model-a:https://batch-a.example/v1',
        ]);
        expect(providerSnapshots).toHaveLength(1);
        expect(providerSnapshots[0].model.aiSdk).toBe('batch-model-a');
        const oldWriteIdentities = mocks.cacheSet.mock.calls.slice(0, 2).map(([key]) => JSON.parse(key));
        expect(oldWriteIdentities).toEqual(oldReadIdentities);

        await expect(translateWithCache({origin: ['batch-one', 'batch-two']})).resolves.toEqual([
            'batch-one:batch-model-b:https://batch-b.example/v1',
            'batch-two:batch-model-b:https://batch-b.example/v1',
        ]);
        expect(mocks.service).toHaveBeenCalledTimes(2);
        expect(providerSnapshots[1].model.aiSdk).toBe('batch-model-b');
        expect(mocks.cacheGet.mock.calls.slice(2).map(([key]) => JSON.parse(key))).toEqual([
            expect.objectContaining({sourceText: 'batch-one', model: 'batch-model-b'}),
            expect.objectContaining({sourceText: 'batch-two', model: 'batch-model-b'}),
        ]);
        expect(mocks.cacheSet.mock.calls.slice(2).map(([key]) => JSON.parse(key))).toEqual([
            expect.objectContaining({sourceText: 'batch-one', model: 'batch-model-b'}),
            expect.objectContaining({sourceText: 'batch-two', model: 'batch-model-b'}),
        ]);
    });

    it('AI 摘要等待缓存时沿用请求快照，后续配置不会交叉污染摘要与正文缓存', async () => {
        mocks.config.service = 'aiSdk';
        mocks.config.enableAIContext = true;
        mocks.config.model.aiSdk = 'summary-model-a';
        mocks.config.proxy.aiSdk = 'https://summary-a.example/v1';
        mocks.config.customBody.aiSdk = '{"seed":"a"}';
        mocks.config.system_role.aiSdk = 'summary-system-a';
        mocks.config.user_role.aiSdk = 'summary-user-a';
        mocks.endpointResolver.mockImplementation((serviceName: string, current?: unknown) => ({
            endpoint: (current as {proxy: Record<string, string>}).proxy[serviceName],
        }));

        const summaryCacheRead = deferred<string | null>();
        mocks.cacheGet
            .mockImplementationOnce(() => summaryCacheRead.promise)
            .mockImplementation(async (key: string) => mocks.cacheStore.get(key) ?? null);
        const providerCalls: Array<{summary: boolean; snapshot: ReturnType<typeof createTranslationProviderConfigSnapshot>}> = [];
        mocks.service.mockImplementation(async (message: Record<string, unknown>) => {
            const current = getTranslationProviderConfig(
                message,
                createTranslationProviderConfigSnapshot(mocks.config),
            );
            const summary = typeof message.summaryPrompt === 'string';
            providerCalls.push({summary, snapshot: current});
            return summary
                ? `summary:${current.model.aiSdk}:${current.system_role.aiSdk}`
                : `translation:${current.model.aiSdk}:${current.proxy.aiSdk}:${current.user_role.aiSdk}`;
        });

        const oldRequest = translateWithCache({origin: 'summary-race', pageContext: 'shared article'});
        await vi.waitFor(() => expect(mocks.cacheGet).toHaveBeenCalledOnce());

        mocks.config.model.aiSdk = 'summary-model-b';
        mocks.config.proxy.aiSdk = 'https://summary-b.example/v1';
        mocks.config.customBody.aiSdk = '{"seed":"b"}';
        mocks.config.system_role.aiSdk = 'summary-system-b';
        mocks.config.user_role.aiSdk = 'summary-user-b';
        summaryCacheRead.resolve(null);

        await expect(oldRequest).resolves.toBe(
            'translation:summary-model-a:https://summary-a.example/v1:summary-user-a',
        );
        expect(providerCalls).toHaveLength(2);
        expect(providerCalls.map(({summary, snapshot}) => ({
            summary,
            model: snapshot.model.aiSdk,
            endpoint: snapshot.proxy.aiSdk,
            systemRole: snapshot.system_role.aiSdk,
            userRole: snapshot.user_role.aiSdk,
        }))).toEqual([
            {
                summary: true,
                model: 'summary-model-a',
                endpoint: 'https://summary-a.example/v1',
                systemRole: 'summary-system-a',
                userRole: 'summary-user-a',
            },
            {
                summary: false,
                model: 'summary-model-a',
                endpoint: 'https://summary-a.example/v1',
                systemRole: 'summary-system-a',
                userRole: 'summary-user-a',
            },
        ]);

        const oldWrites = mocks.cacheSet.mock.calls.map(([key]) => JSON.parse(key) as CacheIdentity);
        expect(oldWrites).toEqual(expect.arrayContaining([
            expect.objectContaining({
                requestMode: 'page-summary',
                model: 'summary-model-a',
                endpoint: 'https://summary-a.example/v1',
                customBody: '{"seed":"a"}',
            }),
            expect.objectContaining({
                requestMode: 'single',
                model: 'summary-model-a',
                endpoint: 'https://summary-a.example/v1',
                systemRole: 'summary-system-a',
                userRole: 'summary-user-a',
            }),
        ]));

        await expect(translateWithCache({origin: 'summary-race', pageContext: 'shared article'})).resolves.toBe(
            'translation:summary-model-b:https://summary-b.example/v1:summary-user-b',
        );
        expect(providerCalls).toHaveLength(4);
        expect(providerCalls.slice(2).every(({snapshot}) => snapshot.model.aiSdk === 'summary-model-b')).toBe(true);
        const allWrites = mocks.cacheSet.mock.calls.map(([key]) => JSON.parse(key) as CacheIdentity);
        expect(allWrites).toEqual(expect.arrayContaining([
            expect.objectContaining({requestMode: 'page-summary', model: 'summary-model-b'}),
            expect.objectContaining({requestMode: 'single', model: 'summary-model-b'}),
        ]));
    });
});
