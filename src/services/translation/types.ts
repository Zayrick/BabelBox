import type {
    TranslationServiceConfigLike,
    TranslationServiceCredential,
    TranslationServiceInstance,
} from '@/src/core/config/translationServices';

export interface TranslationRequestMessageBase {
    context?: string;
    pageContext?: string;
    useCache?: boolean;
    /** 视频字幕、文档、翻译中心等独立入口使用的服务实例；普通网页请求不设置。 */
    serviceOverride?: string;
    /** 翻译中心仅对当前请求使用的语言，不改变全局设置。 */
    sourceLanguage?: string;
    targetLanguage?: string;
    /** provider deadline；用于避免可选摘要耗尽整次请求。 */
    requestTimeoutMs?: number;
}

export type TranslationSingleRequestMessage = TranslationRequestMessageBase & {origin: string};
export type TranslationBatchRequestMessage = TranslationRequestMessageBase & {origin: string[]};
export type TranslationRequestMessage = TranslationSingleRequestMessage | TranslationBatchRequestMessage;

/** One service instance with its credential, frozen for the lifetime of a request. */
export interface ResolvedTranslationService extends Readonly<TranslationServiceInstance> {
    readonly credential: Readonly<TranslationServiceCredential>;
}

/** Everything a provider adapter needs; adapters never read the global config. */
export interface TranslationProviderRequest {
    readonly service: ResolvedTranslationService;
    readonly origin: string | readonly string[];
    readonly context: string;
    readonly pageContext: string;
    readonly sourceLanguage: string;
    readonly targetLanguage: string;
    /** Set only for the page-summary request; replaces the instance prompts. */
    readonly summaryPrompt?: string;
    readonly summarySystemPrompt?: string;
    readonly requestTimeoutMs?: number;
    readonly abortSignal?: AbortSignal;
}

export type TranslationProvider = (request: TranslationProviderRequest) => Promise<unknown>;
export type TranslationProviderRegistry = Record<string, TranslationProvider>;

export interface TranslationLanguageOverride {
    sourceLanguage?: string;
    targetLanguage?: string;
}

export interface TranslationLanguages {
    sourceLanguage: string;
    targetLanguage: string;
}

export interface TranslationCachePort {
    get: (key: string) => Promise<string | null>;
    set: (key: string, value: string) => Promise<boolean>;
    clear: () => Promise<void>;
    cleanup: () => Promise<void>;
}

export interface TranslationBrokerConfig extends TranslationServiceConfigLike {
    service: string;
    from: string;
    to: string;
    useCache: boolean;
    enableAIContext: boolean;
}

export interface TranslationPromptBuilder {
    buildPageSummaryPrompt: (pageContext: string) => string;
    buildPageSummarySystemPrompt: () => string;
}

export interface TranslationBrokerDependencies {
    ready: Promise<unknown>;
    getConfig: () => TranslationBrokerConfig;
    providers: TranslationProviderRegistry;
    cache: TranslationCachePort;
    /** Request destination that participates in the cache identity. */
    describeEndpoint: (service: ResolvedTranslationService) => string;
    isUseAIContext: (provider: string, model: string) => boolean;
    promptBuilder: TranslationPromptBuilder;
    getMissingCredentialMessage: (serviceId: string, config: TranslationServiceConfigLike) => string | null;
    getTranslationLanguages: (override?: TranslationLanguageOverride) => TranslationLanguages;
    buildTranslationCacheKey: (identity: Record<string, unknown>) => string;
    now?: () => number;
}

export interface TranslationBroker {
    translateWithCache: (message: TranslationRequestMessage) => Promise<string | string[]>;
    clearTranslationCache: () => Promise<void>;
    cleanupTranslationCache: () => Promise<void>;
}
