export const VOCABULARY_BOOK_MESSAGE = 'babelboxVocabularyBook' as const;
export const VOCABULARY_BOOK_CHANGED_MESSAGE = 'babelboxVocabularyBookChanged' as const;

export type VocabularyStatus = 'new' | 'learning' | 'mastered';
export type VocabularyReviewRating = 'again' | 'good' | 'manual-mastered' | 'relearn';
export type VocabularyScheduledReviewRating = Extract<VocabularyReviewRating, 'again' | 'good'>;

export interface VocabularyContextInput {
    text?: string;
    sourceUrl?: string;
    pageTitle?: string;
    capturedAt?: number;
}

export interface VocabularyUpsertInput {
    sourceLanguage: string;
    targetLanguage: string;
    term: string;
    translation: string;
    phonetic?: string;
    partOfSpeech?: string | string[];
    context?: VocabularyContextInput;
    contexts?: VocabularyContextInput[];
}

export interface VocabularyListOptions {
    status?: VocabularyStatus | VocabularyStatus[];
    sourceLanguage?: string;
    targetLanguage?: string;
    search?: string;
    dueOnly?: boolean;
    now?: number;
    order?: 'recent' | 'due' | 'term';
    offset?: number;
    limit?: number;
}

export interface VocabularyExportOptions {
    includePrivateContext?: boolean;
    now?: number;
}

export type VocabularyBookErrorCode =
    | 'invalid-input'
    | 'not-found'
    | 'limit-exceeded'
    | 'invalid-export'
    | 'storage-error';

export type VocabularyBookAction =
    | 'list'
    | 'get'
    | 'getByTerm'
    | 'upsert'
    | 'review'
    | 'setMastery'
    | 'relearn'
    | 'getReviewLogs'
    | 'remove'
    | 'removeWithSnapshot'
    | 'clear'
    | 'exportData'
    | 'importData';

export interface VocabularyBookRuntimeMessage {
    type: typeof VOCABULARY_BOOK_MESSAGE;
    action?: VocabularyBookAction | unknown;
    entryId?: unknown;
    term?: unknown;
    sourceLanguage?: unknown;
    rating?: unknown;
    input?: unknown;
    options?: unknown;
    data?: unknown;
}

export type VocabularyBookResponse<T = unknown> =
    | {success: true; data: T}
    | {
        success: false;
        error: {
            code: VocabularyBookErrorCode;
            message: string;
        };
    };

export interface VocabularyBookChangedMessage {
    type: typeof VOCABULARY_BOOK_CHANGED_MESSAGE;
    reason:
        | 'upsert'
        | 'review'
        | 'manual-mastered'
        | 'relearn'
        | 'remove'
        | 'clear'
        | 'import';
    entryId?: string;
}
