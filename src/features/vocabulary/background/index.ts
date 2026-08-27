export {
    createBrowserVocabularyBookChangedBroadcaster,
    createVocabularyBackgroundHandlers,
    createVocabularyBookChangedAckHandler,
    createVocabularyBookChangedMessage,
    createVocabularyBookHandler,
    VOCABULARY_BOOK_CHANGED_ACK_RESPONSE,
    type VocabularyBackgroundContext,
    type VocabularyBookBackgroundDependencies,
    type VocabularyBookChangeBroadcastAdapter,
    type VocabularyBookChangedBroadcaster,
    type VocabularyBookRepositoryContract,
} from './handler';

export type {
    VocabularyBookRuntimeMessage,
} from '@/src/features/vocabulary/protocol';
