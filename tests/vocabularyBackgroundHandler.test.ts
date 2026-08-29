import {describe, expect, it, vi} from 'vitest';

import {
    createBrowserVocabularyBookChangedBroadcaster,
    createVocabularyBackgroundHandlers,
    createVocabularyBookChangedMessage,
    createVocabularyBookHandler,
    VOCABULARY_BOOK_CHANGED_ACK_RESPONSE,
    type VocabularyBookBackgroundDependencies,
} from '@/src/features/vocabulary/background';
import {createBackgroundMessageRouter} from '@/src/platform/browser/messageRouter';
import {
    VOCABULARY_BOOK_CHANGED_MESSAGE,
    VOCABULARY_BOOK_MESSAGE,
} from '@/src/features/vocabulary/protocol';

async function flushMicrotasks(times = 4): Promise<void> {
    for (let index = 0; index < times; index += 1) await Promise.resolve();
}

function createRepository() {
    return {
        list: vi.fn(async (options = {}) => ({method: 'list', options})),
        get: vi.fn(async (entryId: string) => ({method: 'get', entryId})),
        getByTerm: vi.fn(async (sourceLanguage: string, term: string) => ({method: 'getByTerm', sourceLanguage, term})),
        upsert: vi.fn(async () => ({id: 'entry-upsert', method: 'upsert'})),
        review: vi.fn(async (entryId: string, rating: string) => ({method: 'review', entryId, rating})),
        setMastery: vi.fn(async (entryId: string) => ({method: 'setMastery', entryId})),
        relearn: vi.fn(async (entryId: string) => ({method: 'relearn', entryId})),
        getReviewLogs: vi.fn(async (entryId: string) => ({method: 'getReviewLogs', entryId})),
        remove: vi.fn(async (entryId: string): Promise<unknown> => ({id: entryId, removed: true})),
        removeWithSnapshot: vi.fn(async (entryId: string): Promise<unknown> => ({id: entryId, snapshot: true})),
        clear: vi.fn(async () => undefined),
        exportData: vi.fn(async (options) => ({method: 'exportData', options})),
        importData: vi.fn(async (data) => ({method: 'importData', data})),
    };
}

function createDependencies(overrides: Partial<VocabularyBookBackgroundDependencies> = {}) {
    const repository = createRepository();
    const dependencies: VocabularyBookBackgroundDependencies = {
        configReady: Promise.resolve(),
        isVocabularyBookEnabled: () => true,
        vocabularyBook: repository as unknown as VocabularyBookBackgroundDependencies['vocabularyBook'],
        broadcastChanged: vi.fn(),
        logOperationFailure: vi.fn(),
        ...overrides,
    };
    return {dependencies, repository};
}

describe('vocabulary background message handlers', () => {
    it('通过静态 registry 处理变更通知 ACK 和词书请求', async () => {
        const {dependencies, repository} = createDependencies();
        const router = createBackgroundMessageRouter(createVocabularyBackgroundHandlers(dependencies));

        await expect(router.dispatch({
            type: VOCABULARY_BOOK_CHANGED_MESSAGE,
            reason: 'upsert',
        }, {})).resolves.toEqual({
            handled: true,
            response: VOCABULARY_BOOK_CHANGED_ACK_RESPONSE,
        });

        await expect(router.dispatch({
            type: VOCABULARY_BOOK_MESSAGE,
            action: 'get',
            entryId: ' entry-1 ',
        }, {})).resolves.toEqual({
            handled: true,
            response: {success: true, data: {method: 'get', entryId: 'entry-1'}},
        });
        expect(repository.get).toHaveBeenCalledWith('entry-1');
    });

    it('处理读取类 action 和 getByTerm 查询', async () => {
        const {dependencies, repository} = createDependencies();
        const handler = createVocabularyBookHandler(dependencies);

        await expect(handler.handle({type: VOCABULARY_BOOK_MESSAGE, action: 'list'}, {}))
            .resolves.toEqual({success: true, data: {method: 'list', options: {}}});
        await expect(handler.handle({type: VOCABULARY_BOOK_MESSAGE, action: 'list', options: {status: 'new'}}, {}))
            .resolves.toEqual({success: true, data: {method: 'list', options: {status: 'new'}}});
        await expect(handler.handle({
            type: VOCABULARY_BOOK_MESSAGE,
            action: 'getByTerm',
            sourceLanguage: 'en',
            term: 'common',
        }, {})).resolves.toEqual({success: true, data: {method: 'getByTerm', sourceLanguage: 'en', term: 'common'}});
        expect(repository.list).toHaveBeenCalledWith(undefined);
        expect(repository.list).toHaveBeenCalledWith({status: 'new'});
        expect(repository.getByTerm).toHaveBeenCalledWith('en', 'common');
    });

    it('执行会广播的写入和复习 action，并保持旧响应结构', async () => {
        const {dependencies, repository} = createDependencies();
        const handler = createVocabularyBookHandler(dependencies);

        const input = {sourceLanguage: 'en', targetLanguage: 'zh-CN', term: 'common', translation: '常见'};
        await expect(handler.handle({type: VOCABULARY_BOOK_MESSAGE, action: 'upsert', input}, {}))
            .resolves.toEqual({success: true, data: {id: 'entry-upsert', method: 'upsert'}});
        await expect(handler.handle({type: VOCABULARY_BOOK_MESSAGE, action: 'review', entryId: 'entry-1', rating: 'good'}, {}))
            .resolves.toEqual({success: true, data: {method: 'review', entryId: 'entry-1', rating: 'good'}});
        await expect(handler.handle({type: VOCABULARY_BOOK_MESSAGE, action: 'setMastery', entryId: 'entry-1'}, {}))
            .resolves.toEqual({success: true, data: {method: 'setMastery', entryId: 'entry-1'}});
        await expect(handler.handle({type: VOCABULARY_BOOK_MESSAGE, action: 'relearn', entryId: 'entry-1'}, {}))
            .resolves.toEqual({success: true, data: {method: 'relearn', entryId: 'entry-1'}});
        await expect(handler.handle({type: VOCABULARY_BOOK_MESSAGE, action: 'clear'}, {}))
            .resolves.toEqual({success: true, data: true});
        await expect(handler.handle({type: VOCABULARY_BOOK_MESSAGE, action: 'importData', data: {entries: []}}, {}))
            .resolves.toEqual({success: true, data: {method: 'importData', data: {entries: []}}});

        expect(repository.upsert).toHaveBeenCalledWith(input);
        expect(dependencies.broadcastChanged).toHaveBeenCalledWith('upsert', 'entry-upsert');
        expect(dependencies.broadcastChanged).toHaveBeenCalledWith('review', 'entry-1');
        expect(dependencies.broadcastChanged).toHaveBeenCalledWith('manual-mastered', 'entry-1');
        expect(dependencies.broadcastChanged).toHaveBeenCalledWith('relearn', 'entry-1');
        expect(dependencies.broadcastChanged).toHaveBeenCalledWith('clear', undefined);
        expect(dependencies.broadcastChanged).toHaveBeenCalledWith('import', undefined);
    });

    it('执行删除、日志、导出 action，并只在真实删除时广播', async () => {
        const {dependencies, repository} = createDependencies();
        const handler = createVocabularyBookHandler(dependencies);

        await expect(handler.handle({type: VOCABULARY_BOOK_MESSAGE, action: 'getReviewLogs', entryId: 'entry-1'}, {}))
            .resolves.toEqual({success: true, data: {method: 'getReviewLogs', entryId: 'entry-1'}});
        await expect(handler.handle({type: VOCABULARY_BOOK_MESSAGE, action: 'remove', entryId: 'entry-1'}, {}))
            .resolves.toEqual({success: true, data: {id: 'entry-1', removed: true}});
        repository.remove.mockResolvedValueOnce(false);
        await expect(handler.handle({type: VOCABULARY_BOOK_MESSAGE, action: 'remove', entryId: 'entry-missing'}, {}))
            .resolves.toEqual({success: true, data: false});
        await expect(handler.handle({type: VOCABULARY_BOOK_MESSAGE, action: 'removeWithSnapshot', entryId: 'entry-2'}, {}))
            .resolves.toEqual({success: true, data: {id: 'entry-2', snapshot: true}});
        repository.removeWithSnapshot.mockResolvedValueOnce(null);
        await expect(handler.handle({type: VOCABULARY_BOOK_MESSAGE, action: 'removeWithSnapshot', entryId: 'entry-missing'}, {}))
            .resolves.toEqual({success: true, data: null});
        await expect(handler.handle({type: VOCABULARY_BOOK_MESSAGE, action: 'exportData', options: {format: 'anki'}}, {}))
            .resolves.toEqual({success: true, data: {method: 'exportData', options: {format: 'anki'}}});

        expect(dependencies.broadcastChanged).toHaveBeenCalledWith('remove', 'entry-1');
        expect(dependencies.broadcastChanged).toHaveBeenCalledWith('remove', 'entry-2');
        expect(dependencies.broadcastChanged).toHaveBeenCalledTimes(2);
    });

    it('Beta 未启用、无痕窗口和非法 entryId 都返回词书业务错误', async () => {
        const disabled = createDependencies({isVocabularyBookEnabled: () => false});
        await expect(createVocabularyBookHandler(disabled.dependencies).handle({
            type: VOCABULARY_BOOK_MESSAGE,
            action: 'upsert',
            input: {sourceLanguage: 'en', targetLanguage: 'zh-CN', term: 'common', translation: '常见'},
        }, {})).resolves.toMatchObject({
            success: false,
            error: {code: 'invalid-input', message: '请先在单词本页面开启 Beta'},
        });
        expect(disabled.repository.upsert).not.toHaveBeenCalled();

        const incognito = createDependencies();
        await expect(createVocabularyBookHandler(incognito.dependencies).handle({
            type: VOCABULARY_BOOK_MESSAGE,
            action: 'upsert',
            input: {sourceLanguage: 'en', targetLanguage: 'zh-CN', term: 'common', translation: '常见'},
        }, {sender: {tab: {incognito: true}}})).resolves.toMatchObject({
            success: false,
            error: {code: 'invalid-input', message: '无痕窗口不保存单词本数据'},
        });
        expect(incognito.repository.upsert).not.toHaveBeenCalled();

        const invalid = createDependencies();
        await expect(createVocabularyBookHandler(invalid.dependencies).handle({
            type: VOCABULARY_BOOK_MESSAGE,
            action: 'get',
            entryId: 42,
        }, {})).resolves.toMatchObject({
            success: false,
            error: {code: 'invalid-input', message: '缺少有效的单词条目标识'},
        });
        await expect(createVocabularyBookHandler(invalid.dependencies).handle({
            type: VOCABULARY_BOOK_MESSAGE,
            action: 'get',
            entryId: '   ',
        }, {})).resolves.toMatchObject({
            success: false,
            error: {code: 'invalid-input', message: '缺少有效的单词条目标识'},
        });
    });

    it('存储失败、非 Error 异常、广播同步失败和非法 action 都按旧协议返回', async () => {
        const storageFailure = createDependencies();
        storageFailure.repository.list.mockRejectedValueOnce(new Error('indexeddb blocked'));
        await expect(createVocabularyBookHandler(storageFailure.dependencies).handle({
            type: VOCABULARY_BOOK_MESSAGE,
            action: 'list',
        }, {})).resolves.toEqual({
            success: false,
            error: {code: 'storage-error', message: 'indexeddb blocked'},
        });
        expect(storageFailure.dependencies.logOperationFailure).toHaveBeenCalledWith(expect.any(Error));

        const nonErrorFailure = createDependencies();
        nonErrorFailure.repository.exportData.mockRejectedValueOnce('plain failure');
        await expect(createVocabularyBookHandler(nonErrorFailure.dependencies).handle({
            type: VOCABULARY_BOOK_MESSAGE,
            action: 'exportData',
        }, {})).resolves.toEqual({
            success: false,
            error: {code: 'storage-error', message: '本地单词本暂时不可用'},
        });
        expect(nonErrorFailure.dependencies.logOperationFailure).toHaveBeenCalledWith('plain failure');

        const broadcastFailure = createDependencies({broadcastChanged: vi.fn(() => { throw new Error('broadcast failed'); })});
        await expect(createVocabularyBookHandler(broadcastFailure.dependencies).handle({
            type: VOCABULARY_BOOK_MESSAGE,
            action: 'review',
            entryId: 'entry-1',
            rating: 'again',
        }, {})).resolves.toEqual({success: true, data: {method: 'review', entryId: 'entry-1', rating: 'again'}});
        expect(broadcastFailure.dependencies.logOperationFailure).toHaveBeenCalledWith(expect.any(Error));

        const illegal = createDependencies();
        await expect(createVocabularyBookHandler(illegal.dependencies).handle({
            type: VOCABULARY_BOOK_MESSAGE,
            action: 'dropAll',
        }, {})).resolves.toMatchObject({
            success: false,
            error: {code: 'invalid-input', message: '不支持的单词本操作'},
        });
    });

    it('拒绝后台信任边界上的非法 payload，不把 unknown 强转给 repository', async () => {
        const {dependencies, repository} = createDependencies();
        const handler = createVocabularyBookHandler(dependencies);

        await expect(handler.handle({type: VOCABULARY_BOOK_MESSAGE, action: 'getByTerm', sourceLanguage: 'en'}, {}))
            .resolves.toMatchObject({success: false, error: {code: 'invalid-input', message: '缺少有效的查询单词'}});
        await expect(handler.handle({type: VOCABULARY_BOOK_MESSAGE, action: 'getByTerm', term: 'common'}, {}))
            .resolves.toMatchObject({success: false, error: {code: 'invalid-input', message: '缺少有效的源语言'}});
        await expect(handler.handle({type: VOCABULARY_BOOK_MESSAGE, action: 'upsert', input: 'common'}, {}))
            .resolves.toMatchObject({success: false, error: {code: 'invalid-input', message: '缺少有效的单词保存内容'}});
        await expect(handler.handle({
            type: VOCABULARY_BOOK_MESSAGE,
            action: 'upsert',
            input: {sourceLanguage: 'en', targetLanguage: 'zh-CN', term: 'common'},
        }, {})).resolves.toMatchObject({success: false, error: {code: 'invalid-input', message: '缺少有效的译文'}});
        await expect(handler.handle({type: VOCABULARY_BOOK_MESSAGE, action: 'review', entryId: 'entry-1', rating: 'easy'}, {}))
            .resolves.toMatchObject({success: false, error: {code: 'invalid-input', message: '缺少有效的复习评分'}});
        await expect(handler.handle({type: VOCABULARY_BOOK_MESSAGE, action: 'list', options: []}, {}))
            .resolves.toMatchObject({success: false, error: {code: 'invalid-input', message: '查询选项无效'}});
        await expect(handler.handle({type: VOCABULARY_BOOK_MESSAGE, action: 'exportData', options: []}, {}))
            .resolves.toMatchObject({success: false, error: {code: 'invalid-input', message: '导出选项无效'}});
        await expect(handler.handle({type: VOCABULARY_BOOK_MESSAGE, action: 'importData', data: []}, {}))
            .resolves.toMatchObject({success: false, error: {code: 'invalid-input', message: '导入数据无效'}});

        expect(repository.getByTerm).not.toHaveBeenCalled();
        expect(repository.upsert).not.toHaveBeenCalled();
        expect(repository.review).not.toHaveBeenCalled();
        expect(repository.importData).not.toHaveBeenCalled();
    });
});

describe('vocabulary browser changed broadcaster', () => {
    it('构造带 entryId 的变更消息，并广播到扩展页和可用 tab', async () => {
        const sendRuntimeMessage = vi.fn(async () => undefined);
        const queryTabs = vi.fn(async () => [{id: 1}, {}, {id: 2}]);
        const sendTabMessage = vi.fn(async () => undefined);
        const broadcaster = createBrowserVocabularyBookChangedBroadcaster({
            sendRuntimeMessage,
            queryTabs,
            sendTabMessage,
        });

        broadcaster('upsert', 'entry-1');
        await flushMicrotasks();

        const message = createVocabularyBookChangedMessage('upsert', 'entry-1');
        expect(sendRuntimeMessage).toHaveBeenCalledWith(message);
        expect(queryTabs).toHaveBeenCalledOnce();
        expect(sendTabMessage).toHaveBeenCalledWith(1, message);
        expect(sendTabMessage).toHaveBeenCalledWith(2, message);
        expect(sendTabMessage).toHaveBeenCalledTimes(2);
    });

    it('构造不带 entryId 的变更消息，并吞掉广播链路失败', async () => {
        const runtimeFailure = new Error('runtime closed');
        const sendRuntimeMessage = vi.fn(async () => { throw runtimeFailure; });
        const queryTabs = vi.fn()
            .mockRejectedValueOnce(new Error('tabs unavailable'))
            .mockResolvedValueOnce([{id: 1}]);
        const sendTabMessage = vi.fn(async () => { throw new Error('restricted tab'); });
        const broadcaster = createBrowserVocabularyBookChangedBroadcaster({
            sendRuntimeMessage,
            queryTabs,
            sendTabMessage,
        });

        expect(() => broadcaster('clear')).not.toThrow();
        await flushMicrotasks();
        expect(sendRuntimeMessage).toHaveBeenCalledWith({type: VOCABULARY_BOOK_CHANGED_MESSAGE, reason: 'clear'});
        expect(queryTabs).toHaveBeenCalledOnce();

        expect(() => broadcaster('import')).not.toThrow();
        await flushMicrotasks();
        expect(sendTabMessage).toHaveBeenCalledWith(1, {type: VOCABULARY_BOOK_CHANGED_MESSAGE, reason: 'import'});
    });
});
