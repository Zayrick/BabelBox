import type {BackgroundMessageHandler} from '@/src/platform/browser/messageRouter';
import type {
    TranslationRequestMessage,
    TranslationRequestMessageBase,
} from '@/src/services/translation/types';

interface TranslationRequestCandidate extends Record<string, unknown> {
    type: 'translate';
    origin: unknown;
}

export interface TranslationRequestHandlerDependencies {
    translate(message: TranslationRequestMessage): Promise<string | string[]>;
    serializeError(error: unknown): unknown;
}

const STRING_FIELDS = [
    'context',
    'pageContext',
    'serviceOverride',
    'modelOverride',
    'sourceLanguage',
    'targetLanguage',
] as const satisfies readonly (keyof TranslationRequestMessageBase)[];

function assertOptionalString(candidate: TranslationRequestCandidate, field: typeof STRING_FIELDS[number]): void {
    const value = candidate[field];
    if (value !== undefined && typeof value !== 'string') {
        throw new TypeError(`翻译请求字段 ${field} 必须是字符串`);
    }
}

export function parseTranslationRequest(candidate: TranslationRequestCandidate): TranslationRequestMessage {
    let origin: string | string[];
    if (typeof candidate.origin === 'string') {
        origin = candidate.origin;
    } else if (Array.isArray(candidate.origin)
        && candidate.origin.every((item): item is string => typeof item === 'string')) {
        origin = [...candidate.origin];
    } else {
        throw new TypeError('翻译请求 origin 必须是字符串或字符串数组');
    }

    for (const field of STRING_FIELDS) assertOptionalString(candidate, field);
    if (candidate.useCache !== undefined && typeof candidate.useCache !== 'boolean') {
        throw new TypeError('翻译请求字段 useCache 必须是布尔值');
    }
    if (candidate.requestTimeoutMs !== undefined
        && (typeof candidate.requestTimeoutMs !== 'number' || !Number.isFinite(candidate.requestTimeoutMs))) {
        throw new TypeError('翻译请求字段 requestTimeoutMs 必须是有限数字');
    }

    const base: TranslationRequestMessageBase = {};
    for (const field of STRING_FIELDS) {
        const value = candidate[field];
        if (typeof value === 'string') base[field] = value;
    }
    if (typeof candidate.useCache === 'boolean') base.useCache = candidate.useCache;
    if (typeof candidate.requestTimeoutMs === 'number') base.requestTimeoutMs = candidate.requestTimeoutMs;
    return typeof origin === 'string' ? {...base, origin} : {...base, origin};
}

export function createTranslationRequestHandler<TContext = undefined>(
    dependencies: TranslationRequestHandlerDependencies,
): BackgroundMessageHandler<TContext, TranslationRequestCandidate> {
    return {
        type: 'translate',
        async handle(candidate) {
            try {
                const message = parseTranslationRequest(candidate);
                return await dependencies.translate(message);
            } catch (error) {
                return dependencies.serializeError(error);
            }
        },
    };
}
