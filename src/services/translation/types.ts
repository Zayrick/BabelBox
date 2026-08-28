import type {
    TranslationServiceCredential,
} from '@/src/core/config/model';
import type {
    TranslationServiceInstance,
} from '@/src/core/config/translationServices';

export interface TranslationRequestMessageBase {
    context?: string;
    pageContext?: string;
    useCache?: boolean;
    /** 视频字幕、文档等独立入口使用的翻译服务；普通网页请求不设置。 */
    serviceOverride?: string;
    /** 文档、翻译中心等独立入口指定的实际模型；普通网页请求不设置。 */
    modelOverride?: string;
    /** 翻译中心仅对当前请求使用的语言，不改变全局设置。 */
    sourceLanguage?: string;
    targetLanguage?: string;
    /** provider deadline；用于避免可选摘要耗尽整次请求。 */
    requestTimeoutMs?: number;
}

export type TranslationSingleRequestMessage = TranslationRequestMessageBase & {origin: string};
export type TranslationBatchRequestMessage = TranslationRequestMessageBase & {origin: string[]};
export type TranslationRequestMessage = TranslationSingleRequestMessage | TranslationBatchRequestMessage;

export type TranslationProvider = (message: Record<string, unknown>) => Promise<unknown>;
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

export interface TranslationConfigSnapshot {
    service: string;
    from: string;
    to: string;
    useCache: boolean;
    enableAIContext: boolean;
    model: Record<string, string>;
    customModel: Record<string, string>;
    proxy: Record<string, string>;
    custom: string;
    deeplx: string;
    newApiUrl: string;
    minimaxBillingPlan: string;
    minimaxRegion: string;
    mimoBillingPlan: string;
    mimoRegion: string;
    azureOpenaiEndpoint: string;
    robot_id: Record<string, string>;
    customBody: Record<string, string>;
    system_role: Record<string, string>;
    user_role: Record<string, string>;
    deepseekApiType: string;
    deepseekThinkingMode: string;
    translationServices?: readonly TranslationServiceInstance[];
}

export interface TranslationProviderConfigFields {
    token: Record<string, string>;
    requireApiKey: Record<string, boolean>;
    youdaoAppKey: string;
    youdaoAppSecret: string;
    tencentSecretId: string;
    tencentSecretKey: string;
    serviceCredentials?: Record<string, TranslationServiceCredential>;
}

/** 一次 provider 调用使用的完整、不可变配置视图。 */
export type TranslationProviderConfigSnapshot = Readonly<TranslationConfigSnapshot & TranslationProviderConfigFields>;

/** 测试或迁移期配置源可以省略凭据字段，snapshot factory 会补安全默认值。 */
export type TranslationConfigSource = TranslationConfigSnapshot & Partial<TranslationProviderConfigFields>;

export interface TranslationServiceIds {
    minimax: string;
    mimo: string;
}

export interface TranslationServiceTypes {
    machine: {has: (service: string) => boolean};
    isAI: (service: string) => boolean;
    isAiSdk: (service: string) => boolean;
    isUseAIContext: (service: string, model?: string) => boolean;
}

export interface TranslationEndpointResolver {
    resolveOpenAICompatibleEndpoint: (
        service: string,
        config?: TranslationProviderConfigSnapshot,
    ) => {endpoint: string};
    getMimoEndpoint: (plan: string, region: string) => string;
    minimaxEndpoints: Record<string, Record<string, string>>;
    aiSdkTransportProfile: string;
}

export interface TranslationPromptBuilder {
    buildPageSummaryPrompt: (pageContext: string) => string;
    buildPageSummarySystemPrompt: () => string;
}

export interface TranslationBrokerDependencies {
    ready: Promise<unknown>;
    getConfig: () => TranslationConfigSource;
    providers: TranslationProviderRegistry;
    cache: TranslationCachePort;
    serviceIds: TranslationServiceIds;
    serviceTypes: TranslationServiceTypes;
    endpointResolver: TranslationEndpointResolver;
    promptBuilder: TranslationPromptBuilder;
    getMissingCredentialMessage: (service: string, config: TranslationConfigSnapshot) => string | null;
    getTranslationLanguages: (override?: TranslationLanguageOverride) => TranslationLanguages;
    resolveConfiguredModel: (selected?: string, custom?: string) => string;
    buildTranslationCacheKey: (identity: Record<string, unknown>) => string;
    now?: () => number;
    logger?: Pick<Console, 'warn'>;
}

export interface TranslationBroker {
    translateWithCache: (message: TranslationRequestMessage) => Promise<string | string[]>;
    clearTranslationCache: () => Promise<void>;
    cleanupTranslationCache: () => Promise<void>;
}
